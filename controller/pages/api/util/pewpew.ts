import {
  AuthPermissions,
  ErrorResponse,
  PewPewVersionsResponse
} from "../../../types";
import type { Fields, File, Files } from "formidable";
import {
  LOCAL_FILE_LOCATION,
  ParsedForm,
  getLogAuthPermissions,
  uploadFile
} from "./util";
import {
  LogLevel,
  PEWPEW_BINARY_EXECUTABLE,
  PEWPEW_BINARY_EXECUTABLE_NAMES,
  PEWPEW_BINARY_FOLDER,
  PpaasS3File,
  log,
  s3
} from "@fs/ppaas-common";
import { latestPewPewVersion, versionSort } from "./clientutil";
import { TestScheduler } from "./testscheduler";
import { execFile as _execFile } from "child_process";
import { chmod } from "fs/promises";
import os from "os";
import { promisify } from "util";
import semver from "semver";

const execFile = promisify(_execFile);
const deleteS3 = s3.deleteObject;
export const VERSION_TAG_NAME: string = "version";

/**
 * Queries S3 for all objects in the pewpew/ folder that end with pewpew (not pewpew.exe).
 * Then parses out the version folder number and returns an array of those.
 */
export async function getPewPewVersionsInS3 (): Promise<string[]> {
  try {
    // Find all files in the /pewpew s3 folder that end with pewpew. Files are /pewpew/<version>/pewpew
    const pewpewFiles: PpaasS3File[] = await PpaasS3File.getAllFilesInS3({
      s3Folder: PEWPEW_BINARY_FOLDER,
      localDirectory: LOCAL_FILE_LOCATION,
      extension: PEWPEW_BINARY_EXECUTABLE
    });
    if (pewpewFiles.length === 0) {
      throw new Error("No pewpew binaries found in s3");
    }
    // Find all version folders, pop off the last piece, filter out undefined, then sort reversed so the newest are at the top
    const pewpewVersions: string[] = pewpewFiles.map((pewpewFile: PpaasS3File) => pewpewFile.s3Folder.split("/").pop())
    .filter((folder: string | undefined) => folder !== undefined).sort(versionSort) as string[];
    log("pewpewVersions: " + pewpewVersions, LogLevel.DEBUG, pewpewVersions);
    return pewpewVersions;
  } catch (error) {
    log("Could not load pewpew versions from S3", LogLevel.WARN, error);
    throw error;
  }
}

/**
 * defines the GET /api/pewpew route returns which versions of pewpew are in s3
 * @returns either an ErrorResponse or an array of versions in s3
 */
export async function getPewpew (): Promise<ErrorResponse | PewPewVersionsResponse> {
  try {
    const pewpewVersions: string[] = await getPewPewVersionsInS3();
    return { json: pewpewVersions, status: 200 };
  } catch (error) {
    log(`getPewpew failed: ${error}`, LogLevel.WARN, error);
    throw error;
  }
}

// Store these as maps for fast lookup oldest can be found by lastRequested, lastUpdated, and lastChecked
// We can't use static variables since the memory spaces aren't shared between api and getServerSideProps
// https://stackoverflow.com/questions/70260701/how-to-share-data-between-api-route-and-getserversideprops
declare global {
  // https://stackoverflow.com/questions/68481686/type-typeof-globalthis-has-no-index-signature
  /** The pewpew version that 'latest' is currently set to */
  // eslint-disable-next-line no-var
  var currentLatestVersion: string | undefined;
}

/**
 * defines the POST /api/pewpew route which posts new versions of pewpew to s3
 * @param parsedForm ParsedForm with the data
 * @param authPermissions AuthPermissions of the user making the request
 * @returns ErrorResponse containing either an error message or a message that is a string saying what version of pewpew uploaded
 */
export async function postPewPew (parsedForm: ParsedForm, authPermissions: AuthPermissions): Promise<ErrorResponse> {
  try {
    const fields: Fields = parsedForm.fields;
    const files: Files = parsedForm.files;
    log("postPewPew fields", LogLevel.DEBUG, Object.assign({}, fields, { environmentVariables: undefined })); // Environment variables can have passwords, sanitize
    log("postPewPew files", LogLevel.DEBUG, files);
    const fileKeys: string[] = Object.keys(files);
    log("fileKeys.length: " + fileKeys.length, LogLevel.DEBUG, fileKeys);
    // Check if either one is empty
    if (!files || fileKeys.length === 0 || !fileKeys.includes("additionalFiles")) {
      return { json: { message: "Must provide a additionalFiles minimally" }, status: 400 };
    } else if (files.additionalFiles && files.additionalFiles.length > 0 && files.additionalFiles.every((file: File) =>
        file && file.originalFilename && PEWPEW_BINARY_EXECUTABLE_NAMES.includes(file.originalFilename)
    )) {
      // Everything here is just pepew
      if (fields.latest && fields.latest.length !== 1) {
        return { json: { message: "Only one 'latest' is allowed" }, status: 400 };
      }

      log(`fields.latest: ${fields.latest}`, LogLevel.DEBUG);
      const latest: boolean = fields.latest?.length === 1 && fields.latest[0] === "true";

      // Run pewpew --version and parse the version
      const pewpewVersionBinaryName = PEWPEW_BINARY_EXECUTABLE;
      log(`os.platform(): ${os.platform()}`, LogLevel.DEBUG, { platform: os.platform(), pewpewVersionBinary: pewpewVersionBinaryName });

      // Find the binary for our platform.
      const pewpewVersionBinary: File | undefined = files.additionalFiles.find((file) => file.originalFilename === pewpewVersionBinaryName);
      log(`pewpewVersionBinary: ${JSON.stringify(pewpewVersionBinary)}`, LogLevel.DEBUG);

      if (pewpewVersionBinary === undefined) {
        // We don't have the binary for this OS and can't check the version
        return { json: { message: `You must provide the binary for platform ${os.platform()} so we can check the version`}, status: 400 };
      }

      // Execute pewpew --version and parse the version
      if (os.platform() !== "win32") {
        await chmod(pewpewVersionBinary.filepath, 0o775);
      }
      const { stdout, stderr } = await execFile(`${pewpewVersionBinary.filepath}`, ["--version"]);
      log(`${pewpewVersionBinary.filepath} output`, LogLevel.DEBUG, { stdout, stderr });
      const match = stdout.match(/pewpew (\d+\.\d+\.\d+[^\s]*)/); // Need to allow for -preview1, etc.
      log(`${pewpewVersionBinary.originalFilename} version match`, LogLevel.DEBUG, { match });
      if (!match || match.length < 2) {
        return { json: { message: "Could not determine version" }, status: 400 };
      }
      const version: string | null = semver.valid(match[1]);
      if (version === null) {
        return { json: { message: `${match[1]} is not a valid semver version: ${version}` }, status: 400 };
      }
      const uploadPromises: Promise<PpaasS3File>[] = [];
      const versionLogDisplay = latest ? `${version} as latest` : version;
      const versionFolder = latest ? latestPewPewVersion : version;
      log(PEWPEW_BINARY_EXECUTABLE + " only upload, version: " + versionLogDisplay, LogLevel.DEBUG, files);
      // Pass in an override Map to override the default tags and not set a "test" tag
      const tags = new Map<string, string>([[PEWPEW_BINARY_FOLDER, "true"], [VERSION_TAG_NAME, version]]);
      for (const file of files.additionalFiles) {
        uploadPromises.push(uploadFile(file, `${PEWPEW_BINARY_FOLDER}/${versionFolder}`, tags));
      }
      await Promise.all(uploadPromises);
      // If latest version is being updated:
      if (latest) {
        global.currentLatestVersion = version;
        log("Sucessfully updated currentLatestVersion: " + version, LogLevel.INFO, version);
      }
      log(PEWPEW_BINARY_EXECUTABLE + " only uploaded, version: " + versionLogDisplay, LogLevel.INFO, { files, authPermissions: getLogAuthPermissions(authPermissions) });
      return { json: { message: "PewPew uploaded, version: " + versionLogDisplay }, status: 200 };
    } else {
      // We're missing pewpew uploads
      return { json: { message: "Only pewpew executables are allowed" }, status: 400 };
    }
  } catch (error) {
    // If we get here it's a 500. All the "bad requests" are handled above
    log(`postPewPew failed: ${error}`, LogLevel.WARN, error);
    throw error;
  }
}

/**
 * defines the DELETE /api/pewpew route which deletes versions of pewpew from s3
 * @param parsedForm ParsedForm with the data
 * @param authPermissions AuthPermissions of the user making the request
 * @returns ErrorResponse containing either an error message or a message that is a string saying what version of pewpew uploaded
 */
export async function deletePewPew (query: Partial<Record<string, string | string[]>>, authPermissions: AuthPermissions): Promise<ErrorResponse> {
  try {
    log("deletePewPew query", LogLevel.DEBUG, query);
    // Check if either one is empty
    if (!query || !query.version) {
      return { json: { message: "Must provide a version minimally" }, status: 400 };
    } else if (Array.isArray(query.version)) {
      return { json: { message: "Only one 'version' is allowed" }, status: 400 };

    } else if (query.version === latestPewPewVersion) {
      // Don't allow delete of latest. Only updates with new postPewpew
      return { json: { message: `Pewpew version ${latestPewPewVersion} cannot be deleted, only replaced` }, status: 400 };
    } else {
      const pewpewVersion: string = query.version;
      log(`query.version: [${query.version}]`, LogLevel.DEBUG, { pewpewVersion });

      // Check the calendar if anyone has a scheduled test with this version
      const testIdsInUse: string[] | undefined = await TestScheduler.getTestIdsForPewPewVersion(pewpewVersion);
      if (testIdsInUse && testIdsInUse.length > 0) {
        // Don't allow delete if in use.
        return { json: { message: `Pewpew version ${pewpewVersion} cannot be deleted, in use by testId(s): ${testIdsInUse}` }, status: 400 };
      }

      const pewpewFiles: PpaasS3File[] = await PpaasS3File.getAllFilesInS3({
        s3Folder: `${PEWPEW_BINARY_FOLDER}/${pewpewVersion}/`,
        localDirectory: LOCAL_FILE_LOCATION
      });
      log(`pewpewFiles version: ${query.version}`, LogLevel.DEBUG, pewpewFiles);
      if (pewpewFiles.length === 0) {
        return { json: { message: "Pewpew version not found: " + pewpewVersion }, status: 404 };
      }

      const deletePromises: Promise<any>[] = [];
      for (const pewpewFile of pewpewFiles) {
        log("Deleting s3 object " + pewpewFile.key, LogLevel.DEBUG, { pewpewFile, authPermissions: getLogAuthPermissions(authPermissions) });
        deletePromises.push(deleteS3(pewpewFile.key));
      }
      await Promise.all(deletePromises);
      log("PewPew deleted, version: " + pewpewVersion, LogLevel.INFO, { pewpewFiles, authPermissions: getLogAuthPermissions(authPermissions) });
      return { json: { message: "PewPew deleted, version: " + pewpewVersion }, status: 200 };
    }
  } catch (error) {
    // If we get here it's a 500. All the "bad requests" are handled above
    log(`deletePewPew failed: ${error}`, LogLevel.WARN, error);
    throw error;
  }
}

export async function getCurrentPewPewLatestVersion (): Promise<string | undefined> {
  if (global.currentLatestVersion) {
    return global.currentLatestVersion;
  }
  try {
    const pewpewTags = await s3.getTags({
      s3Folder: `${PEWPEW_BINARY_FOLDER}/${latestPewPewVersion}`,
      filename: PEWPEW_BINARY_EXECUTABLE
    });
    global.currentLatestVersion = pewpewTags && pewpewTags.get(VERSION_TAG_NAME); // <- change to get the tag here
    if (global.currentLatestVersion) {
      log("Sucessfully retrieved currentLatestVersion: " + global.currentLatestVersion, LogLevel.INFO, global.currentLatestVersion);
    } else {
      log("Failed to retrieve currentLatestVersion: " + global.currentLatestVersion, LogLevel.WARN, global.currentLatestVersion);
    }
    return global.currentLatestVersion;
  } catch (error) {
    log("Could not load latest pewpew in file for currentLatestVersion", LogLevel.WARN, error);
    throw error;
  }
}
