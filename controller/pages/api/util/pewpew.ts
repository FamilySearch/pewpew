import {
  AuthPermissions,
  ErrorResponse,
  PewPewVersionsResponse
} from "../../../types";
import type { Fields, File, Files } from "formidable";
import {
  LOCAL_FILE_LOCATION,
  PEWPEW_BINARY_FOLDER,
  ParsedForm,
  getLogAuthPermissions,
  uploadFile
} from "./util";
import {
  LogLevel,
  PpaasS3File,
  log,
  logger,
  s3
} from "@fs/ppaas-common";
import { latestPewPewVersion, versionSort } from "./clientutil";
import { TestScheduler } from "./testscheduler";
import { execFile as _execFile } from "child_process";
import { chmod } from "fs/promises";
import fs from "fs";
import { latestPewPewInFile } from "../../../.latestpewpewversionfile";
import os from "os";
import { promisify } from "util";
import semver from "semver";

const execFile = promisify(_execFile);
// We have to set this before we make any log calls
logger.config.LogFileName = "ppaas-controller";

const deleteS3 = s3.deleteObject;
export const PEWPEW_EXECUTABLE_NAME: string = "pewpew";
const PEWPEW_EXECUTABLE_NAME_WINDOWS: string = "pewpew.exe";

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
      extension: PEWPEW_EXECUTABLE_NAME
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
    log("Could not load pewpew versions from S3", LogLevel.ERROR, error);
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
    log(`getPewpew failed: ${error}`, LogLevel.ERROR, error);
    throw error;
  }
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
    } else if (
        ((Array.isArray(files.additionalFiles) && files.additionalFiles.every((file: File) => file && (file.originalFilename === PEWPEW_EXECUTABLE_NAME || file.originalFilename === PEWPEW_EXECUTABLE_NAME_WINDOWS)))
        || (!Array.isArray(files.additionalFiles) && (files.additionalFiles.originalFilename === PEWPEW_EXECUTABLE_NAME || files.additionalFiles.originalFilename === PEWPEW_EXECUTABLE_NAME_WINDOWS)))
        ) {
      // Everything here is just pepew
      if (Array.isArray(fields.latest)) {
        return { json: { message: "Only one 'latest' is allowed" }, status: 400 };
      }

      log(`fields.latest: ${fields.latest}`, LogLevel.DEBUG);

      const latest: boolean = fields.latest === "true";

      // Run pewpew --version and parse the version
      const pewpewVersionBinaryName = os.platform() === "win32" ? PEWPEW_EXECUTABLE_NAME_WINDOWS : PEWPEW_EXECUTABLE_NAME;
      log(`os.platform(): ${os.platform()}`, LogLevel.DEBUG, { platform: os.platform(), pewpewVersionBinary: pewpewVersionBinaryName });

      // Find the binary for our platform.
      const pewpewVersionBinary: File | undefined = Array.isArray(files.additionalFiles)
        ? files.additionalFiles.find((file) => file.originalFilename === pewpewVersionBinaryName)
        : (files.additionalFiles.originalFilename === pewpewVersionBinaryName ? files.additionalFiles : undefined);
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
      // If latest version is being updated, write it to file:
      if(latest){
        const filename = "./.latestpewpewversionfile.ts";
        const data = "export const latestPewPewInFile = {\"version\": \"" + version + "\"}; // " + new Date() + ";";
        try {
          fs.writeFileSync(filename, data);
          log("Sucessfully saved PewPew's latest version to file. ", LogLevel.INFO);
        } catch (error) {
          log("Writing latest PewPew's latest version to file failed: ", LogLevel.ERROR, error);
        }
      }
      const uploadPromises: Promise<PpaasS3File>[] = [];
      const versionLogDisplay = latest ? `${version} as latest` : version;
      const versionFolder = latest ? latestPewPewVersion : version;
      log(PEWPEW_EXECUTABLE_NAME + " only upload, version: " + versionLogDisplay, LogLevel.DEBUG, files);
      // Pass in an override Map to override the default tags and not set a "test" tag
      const tags = new Map<string, string>([["pewpew", "true"]]);
      if (Array.isArray(files.additionalFiles)) {
        for (const file of files.additionalFiles) {
          uploadPromises.push(uploadFile(file, `${PEWPEW_BINARY_FOLDER}/${versionFolder}`, tags));
        }
      } else {
        uploadPromises.push(uploadFile(files.additionalFiles, `${PEWPEW_BINARY_FOLDER}/${versionFolder}`, tags));
      }
      await Promise.all(uploadPromises);
      log(PEWPEW_EXECUTABLE_NAME + " only uploaded, version: " + versionLogDisplay, LogLevel.INFO, { files, authPermissions: getLogAuthPermissions(authPermissions) });
      return { json: { message: "PewPew uploaded, version: " + versionLogDisplay }, status: 200 };
    } else {
      // We're missing pewpew uploads
      return { json: { message: "Only pewpew executables are allowed" }, status: 400 };
    }
  } catch (error) {
    // If we get here it's a 500. All the "bad requests" are handled above
    log(`postPewPew failed: ${error}`, LogLevel.ERROR, error);
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
        s3Folder: `${PEWPEW_BINARY_FOLDER}/${pewpewVersion}`,
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
    log(`deletePewPew failed: ${error}`, LogLevel.ERROR, error);
    throw error;
  }
}

export function getPewPewVersionInFile (): string {
  try {
    const latestVersion: string = latestPewPewInFile.version;
    return latestVersion;
  } catch (error) {
    log("Could not load latest pewpew in file", LogLevel.ERROR, error);
    throw error;
  }
}
