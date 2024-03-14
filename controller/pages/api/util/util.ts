import * as path from "path";
import {
  AuthPermissions,
  TestManagerError
} from "../../../types";
import {
  LogLevel,
  PpaasS3File,
  log,
  logger
} from "@fs/ppaas-common";
import { Entry as ZipEntry, ZipFile, Options as ZipOptions, open as _yauzlOpen } from "yauzl";
import { formatError, isYamlFile } from "./clientutil";
// V3 is moving to ESM. We'll need to await import formidable and import type the rest
import formidable, {
  Fields,
  File,
  FileJSON,
  Files,
  Options as FormidableOptions
} from "formidable";
import { NextApiRequest as Request } from "next";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import { promisify } from "util";
import { tmpdir } from "os";

const yauzlOpen: (path: string, options: ZipOptions) => Promise<ZipFile | undefined> = promisify(_yauzlOpen);
// We have to set this before we make any log calls
logger.config.LogFileName = "ppaas-controller";

export const LOCAL_FILE_LOCATION: string = process.env.LOCAL_FILE_LOCATION || process.env.TEMP || tmpdir() || "/tmp";
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || "0") || 500;
const MAX_ZIP_FILE_COUNT = 10;
export const PEWPEW_BINARY_FOLDER: string = "pewpew";
export const ENCRYPTED_TEST_SCHEDULER_FOLDERNAME = "settings";
export const ENCRYPTED_TEST_SCHEDULER_FILENAME = "testscheduler.json";

export interface ParsedForm {
  fields: Fields;
  files: Files;
}

export function createErrorResponse (request: Request, error: any, logLevel?: LogLevel): TestManagerError {
  const message = `${request.method} ${request.url} failed with ${error}`;
  if (logLevel) {
    log(message, logLevel, error);
  }
  return {
    message,
    error: formatError(error)
  };
}

/**
 * Creates a Formidable File object based on it's typings
 * @param originalFilename {string} Name of the file
 * @param filepath {string} Full local path to the file
 * @param type {string} Content Type
 * @param size {number} Size in bytes
 * @param mtime {Date | null} Modified Time
 * @returns {File} Formidable File object
 */
export function createFormidableFile (originalFilename: string, filepath: string, mimetype: string | null, size: number, mtime: Date | null): File {
  const file: File = {
    size,
    originalFilename,
    newFilename: path.basename(filepath),
    filepath,
    mimetype,
    mtime,
    hashAlgorithm: false,
    toJSON (): FileJSON {
      return {
        ...this,
        length: size,
        mtime
      };
    },
    toString (): string {
      return JSON.stringify(this.toJSON());
    }
  };
  return file;
}

export async function uploadFile (file: File, s3Folder: string, tags?: Map<string, string>): Promise<PpaasS3File> {
  try {
    // Removed the force upload to pewpew/latest so we can upload special versions for an individual test
    const oldFilepath: string = file.filepath;
    const basepath: string = path.dirname(file.filepath);
    let filename: string = path.basename(file.filepath);
    // Check if we need to rename it
    if (file.originalFilename && filename !== file.originalFilename) {
      log(`Renaming ${filename} to ${file.originalFilename}`, LogLevel.DEBUG, { filename, originalFilename: file.originalFilename, oldFilePath: oldFilepath });
      filename = file.originalFilename!;
      const newFilepath: string = path.join(basepath, filename);
      await fs.rename(oldFilepath, newFilepath);
    }
    const s3File: PpaasS3File = new PpaasS3File({ filename, s3Folder, localDirectory: basepath, tags });
    await s3File.upload();
    return s3File;
  } catch (error) {
    log("Could not upload file: " + (file && file.originalFilename), LogLevel.ERROR, error);
    throw error;
  }
}

/**
 * Parses the zip file, extracts the files in it and returns an array of File objects
 * @param file (File) zip file object
 * @returns File[] array of File objects
 */
export async function unzipFile (file: File): Promise<File[]> {
  log(`checkUnzipFile ${file.originalFilename}`, LogLevel.DEBUG, file.toJSON());
  if (!file.originalFilename?.toLocaleLowerCase().endsWith(".zip")) {
    throw new Error("checkUnzipFile called with a non-zip file: " + file.originalFilename);
  }
  let zipfile: ZipFile | undefined;
  try {
    const basepath: string = path.dirname(file.filepath);
    const newFiles: File[] = [];
    const zipOptions: ZipOptions = { lazyEntries: true };
    zipfile = await yauzlOpen(file.filepath, zipOptions);
    if (!zipfile) {
      throw new Error("zipFile was undefined after opening " + (file.originalFilename || file.filepath));
    }
    // readEntry will emit a entry event, end, or error
    if (zipfile.entryCount > MAX_ZIP_FILE_COUNT) {
      throw new Error(`zipFile ${file.originalFilename || file.filepath} has more than ${MAX_ZIP_FILE_COUNT} files`);
    }
    await new Promise<void>((resolve, reject) => {
      zipfile!.readEntry();
      zipfile!.on("entry", (entry: ZipEntry) => {
        log(`checkUnzipFile zipfile on entry ${entry.fileName} from ${file.originalFilename || file.filepath}`, LogLevel.DEBUG, entry);
        if (/\//.test(entry.fileName) || /\\/.test(entry.fileName)) {
          // Directory file names end with '/'.
          reject(new Error("Zip files with directories are not supported: " + entry.fileName));
          return;
        } else {
          // file entry
          // Check the size to avoid filling up the memory/hard drive?
          if (entry.uncompressedSize > MAX_FILE_SIZE_MB * 1024 * 1024) {
            reject(new Error(`File ${entry.fileName} is ${entry.uncompressedSize} bytes which is larger than the max ${MAX_FILE_SIZE_MB} MB`));
          }
          zipfile!.openReadStream(entry, (error, readStream) => {
            if (error) {
              log(`checkUnzipFile zipfile.openReadStream error ${entry.fileName} from ${file.originalFilename || file.filepath}`, LogLevel.ERROR, error, entry);
              reject(error);
              return;
            }
            if (!readStream) {
              log(`checkUnzipFile zipfile.openReadStream undefined ${entry.fileName} from ${file.originalFilename || file.filepath}`, LogLevel.ERROR, entry);
              reject(new Error (`Could not open ${entry.fileName} from ${file.originalFilename || file.filepath}`));
              return;
            }
            const filename: string = entry.fileName;
            const newFilepath = path.join(basepath, filename);
            const newFile: File = createFormidableFile(
              filename,
              newFilepath,
              null,
              entry.uncompressedSize,
              entry.getLastModDate()
            );
            log(`checkUnzipFile new file ${newFile.originalFilename || file.filepath}`, LogLevel.DEBUG, newFile.toJSON());
            newFiles.push(newFile);
            readStream.on("error", (err) => {
              log(`checkUnzipFile zipfile.openReadStream on error ${newFile.originalFilename}`, LogLevel.ERROR, err, { filename: file.originalFilename || file.filepath });
              reject(err);
            });
            readStream.on("end", () => {
              log(`checkUnzipFile zipfile.openReadStream on end ${newFile.originalFilename}`, LogLevel.DEBUG, { filename: file.originalFilename || file.filepath });
              zipfile!.readEntry();
            });
            readStream.pipe(createWriteStream(newFilepath));
          });
        }
      });
      zipfile!.on("error", (error) => {
        log(`checkUnzipFile zipfile error ${file.originalFilename || file.filepath}`, LogLevel.ERROR, error, { filename: file.originalFilename || file.filepath });
        reject(error);
      });
      zipfile!.on("end", (entry) => {
        log(`checkUnzipFile zipfile end ${file.originalFilename || file.filepath}`, LogLevel.DEBUG, { filename: file.originalFilename || file.filepath, entry });
        resolve();
      });
    });
    log(`newFiles for ${file.originalFilename || file.filepath}: ${newFiles.length}`, LogLevel.DEBUG, { filename: file.originalFilename || file.filepath, newFiles: newFiles.map((newFile) => newFile.toJSON()) });
    return newFiles;
  } catch (error) {
    log("checkUnzipFile: Could not unzip file: " + (file && (file.originalFilename || file.filepath)), LogLevel.WARN, error);
    try {
      if (zipfile) { zipfile.close(); }
    } catch (err) {
      log("checkUnzipFile: Could not close file: " + (file && (file.originalFilename || file.filepath)), LogLevel.ERROR, err);
    }
    throw error;
  }
}

export async function createTestFolder (testIdTime: string): Promise<string> {
  const localPath = path.join(LOCAL_FILE_LOCATION, testIdTime);
  // Create Local Path
  try {
    await fs.mkdir(localPath);
  } catch (error) {
    // If it already exists, don't throw

    if (!error || (error as any).code !== "EEXIST") {
      throw error;
    }
  }
  log(`localPath created = ${localPath}`, LogLevel.DEBUG);
  return localPath;
}

export async function cleanupTestFolder (localPath: string | undefined): Promise<void> {
  let files: string[] | undefined;
  try {
    if (localPath) {
      // Do not use fs.access() to check for the accessibility of a file before calling fs.open(), fs.readFile(), or fs.writeFile().
      // Doing so introduces a race condition, since other processes may change the file's state between the two calls.
      // Instead, user code should open/read/write the file directly and handle the error raised if the file is not accessible.
      const deleteFiles = [];
      files = await fs.readdir(localPath);
      if (files && files.length > 0) {
        for (const file of files) {
          if (file) {
            deleteFiles.push(fs.unlink(path.join(localPath, file)));
          }
        }
      }
      await Promise.all(deleteFiles);
      await fs.rmdir(localPath);
    }
  } catch (error) {
    log(`Could not delete ${localPath}: ${error}`, LogLevel.ERROR, error, files);
  }
}

export async function parseZip (formFiles: Files): Promise<void> {
  try {
    const yamlFiles: File[] = [];
    // Check if there's a yamlFile and exclude it
    const fileKeys: string[] = Object.keys(formFiles);
    log(`parseZip parseForm fileKeys: ${fileKeys}`, LogLevel.DEBUG, fileKeys);
    if (fileKeys.includes("yamlFile")) {
      log("parseForm yamlFile", LogLevel.DEBUG, formFiles.yamlFile);
      yamlFiles.push(...(Array.isArray(formFiles.yamlFile) ? formFiles.yamlFile : [formFiles.yamlFile]));
    }
    // Don't put yamlFiles in the loop
    const filterYamlFromUnzipped = (unzippedFiles: File[]): File[] => {
      const nonYamlFiles: File[] = [];
      for (const unzippedFile of unzippedFiles) {
        // Check if any are yamlFiles
        if (isYamlFile(unzippedFile.originalFilename || unzippedFile.filepath)) {
          yamlFiles.push(unzippedFile);
        } else {
          nonYamlFiles.push(unzippedFile);
        }
      }
      return nonYamlFiles;
    };
    if (fileKeys.includes("additionalFiles")) {
      const additionalFiles: File | File[] = formFiles.additionalFiles;
      log("parseForm currentFile", LogLevel.DEBUG, additionalFiles);
      if (Array.isArray(additionalFiles)) {
        // Check if any of them are a zip file, create a new array that has the unzipped
        const newFiles: File[] = [];
        // Need to do an "as" cast here for typechecking
        for (const file of additionalFiles) {
          if (file.originalFilename?.endsWith(".zip")) {
            // Remove this one and add the unzipped
            const unzippedFiles: File[] = await unzipFile(file);
            // Check if any are yamlFiles
            newFiles.push(...filterYamlFromUnzipped(unzippedFiles));
          } else {
            // Just stick it in the new list
            newFiles.push(file);
          }
        }
        // Put the newFiles on (should be the original if we didn't change any)
        // It's ok if we put a single in an array
        formFiles.additionalFiles = newFiles;
      } else {
        if (additionalFiles.originalFilename?.endsWith(".zip")) {
          const unzippedFiles: File[] = await unzipFile(additionalFiles);
          formFiles.additionalFiles = filterYamlFromUnzipped(unzippedFiles);
        }
      }
    }
    // If additionalFiles is an empty array, remove it
    if (Array.isArray(formFiles.additionalFiles) && formFiles.additionalFiles.length === 0) {
      delete formFiles.additionalFiles; // It was probably a yamlFile zipped
    }
    // Put the yaml files back in
    if (yamlFiles.length > 0) {
      // yamlFile will error if it's a single in an array
      formFiles.yamlFile = yamlFiles.length > 1 ? yamlFiles : yamlFiles[0];
    }
    // return formFiles;
  } catch (error: any) {
    log ("Error parsing files in incoming test form files for zips: " + (error?.msg || error?.message || `${error}`), LogLevel.WARN, error);
    if (error instanceof Error && error.stack) {
      // eslint-disable-next-line no-console
      console.log(error.stack);
      log("error.stack", LogLevel.DEBUG, error.stack);
    }
    throw error;
  }
}

export async function parseForm (localPath: string, request: Request, maxFileSizeMb: number = MAX_FILE_SIZE_MB, allowMultiples: boolean = true): Promise<ParsedForm> {
  const options: FormidableOptions = {
    maxFileSize: maxFileSizeMb * 1024 * 1024, // Default is 200MB
    uploadDir: localPath,
    multiples: allowMultiples // Allow multiple files (arrays)
  };
  const form = formidable(options);
  const parsedForm: ParsedForm = await new Promise((resolve, reject) => form.parse(request, (err: any, formFields: Fields, formFiles: Files) => {
    if (err) {
      log ("Error parsing incoming test form: " + err, LogLevel.ERROR, err);
      reject(err);
    } else {
      log("parseForm form", LogLevel.DEBUG, { maxFileSizeMb, localPath, allowMultiples });
      log("parseForm formFields", LogLevel.DEBUG, Object.assign({}, formFields, { environmentVariables: undefined })); // Environment variables can have passwords, sanitize
      log("parseForm formFiles", LogLevel.DEBUG, formFiles);
      // Check if any of the files are zip files and unpack them
      parseZip(formFiles)
      .then(() => resolve({ fields: formFields, files: formFiles }))
      .catch((error) => reject(error));
    }
  }));
  return parsedForm;
}

export function makeRandomString (length: number): string {
  let result = "";
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

// Truncate the sessionId token for security
export function getLogAuthPermissions (authPermissions: AuthPermissions) {
  return { ...authPermissions, token: authPermissions && authPermissions.token?.slice(-10) };
}

export function sortAndValidateDaysOfWeek (inputDays: number[]): number[] {
  // validate days of week
  if (!inputDays || inputDays.length === 0) {
    throw new Error("daysOfWeek cannot be empty");
  }
  // filter out duplicates and sort aphabetically (single digets sort fine)
  const daysOfWeek: number[] = inputDays.filter((value: number, index: number, self: number[]) => self.indexOf(value) === index).sort();
  // Make sure only 0-6
  if (daysOfWeek.some((day: number) => day < 0 || day > 6)) {
    throw new Error("Only 0 - 6 allowed for daysOfWeek");
  }
  return daysOfWeek;
}
