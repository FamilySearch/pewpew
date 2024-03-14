import * as path from "path";
import { AUTH_PERMISSIONS_SCHEDULER, TestScheduler } from "./testscheduler";
import {
  AllTests,
  AllTestsResponse,
  AuthPermission,
  AuthPermissions,
  EnvironmentVariablesFile,
  ErrorResponse,
  MessageResponse,
  PreviousEnvironmentVariables,
  PreviousTestData,
  PreviousTestDataResponse,
  ScheduledTestData,
  StoredTestData,
  TestData,
  TestDataResponse,
  TestListResponse
} from "../../../types";
import {
  ENCRYPTED_TEST_SCHEDULER_FOLDERNAME,
  PEWPEW_BINARY_FOLDER,
  ParsedForm,
  createFormidableFile,
  getLogAuthPermissions,
  LOCAL_FILE_LOCATION as localDirectory,
  makeRandomString,
  sortAndValidateDaysOfWeek,
  uploadFile
} from "./util";
import {
  EnvironmentVariables,
  LogLevel,
  MessageType,
  PpaasS3File,
  PpaasS3Message,
  PpaasTestId,
  PpaasTestMessage,
  PpaasTestStatus,
  TestMessage,
  TestStatus,
  TestStatusMessage,
  YamlParser,
  log,
  logger,
  s3,
  sqs,
  util
} from "@fs/ppaas-common";
import type { Fields, File, Files } from "formidable";
import PpaasEncryptEnvironmentFile, { ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME } from "./ppaasencryptenvfile";
import { formatError, isYamlFile, latestPewPewVersion } from "./clientutil";
import { createS3Filename as createS3MessageFilename } from "@fs/ppaas-common/dist/src/ppaass3message";
import { createS3Filename as createS3StatusFilename } from "@fs/ppaas-common/dist/src/ppaasteststatus";
import fs from "fs/promises";
import semver from "semver";

logger.config.LogFileName = "ppaas-controller";

const sendTestScalingMessage = sqs.sendTestScalingMessage;
const createStatsFileName = util.createStatsFileName;
export const MAX_SAVED_TESTS_RECENT: number = parseInt(process.env.MAX_SAVED_TESTS_RECENT || "0", 10) || 10;
export const MAX_SAVED_TESTS_CACHED: number = parseInt(process.env.MAX_SAVED_TESTS_CACHED || "0", 10) || 1000;
const MIN_SEARCH_LENGTH: number = parseInt(process.env.MIN_SEARCH_LENGTH || "0", 10) || 0;
const MAX_SEARCH_LENGTH: number = parseInt(process.env.MAX_SEARCH_LENGTH || "0", 10) || 1024;
const DEFAULT_MAX_SEARCH_RESULTS: number = parseInt(process.env.DEFAULT_MAX_SEARCH_RESULTS || "0", 10) || 20;
const MAX_SEARCH_RESULTS: number = parseInt(process.env.MAX_SEARCH_RESULTS || "0", 10) || 10000;
const ONE_MINUTE: number = 60000;
const FIFTEEN_MINUTES: number = 15 * ONE_MINUTE;
const LEGACY_PEWPEW_VERSION = "<0.6.0-preview";
// Don't export so that the original can't be modified
const RECURRING_FILE_TAGS_INTERNAL = new Map<string, string>([["recurring", "true"]]);
/** Returns a new copy of the Map each time so the original can't be modified */
export const defaultRecurringFileTags = (): Map<string, string> => new Map(RECURRING_FILE_TAGS_INTERNAL);

// Export for testing
export enum CacheLocation {
  Running = "Running",
  Recent = "Recent",
  Requested = "Requested",
  Searched = "Searched"
}

// Internal to also return where it's cached so we know if we need to move it
// export for testing
// We can't extend since we need to return one that is modifiable
export interface CachedTestData {
  testData: StoredTestData;
  cacheLocation: CacheLocation;
}

type CachedTestList = Map<string, StoredTestData>;

function sortTestData (unsorted: TestData[]): TestData[] {
  return unsorted.sort((a, b) => (a.startTime < b.startTime) ? 1 : -1);
}

function getDateTimeFromString (dateString: string): number {
  try {
    // Could be NaN
    const parsed =  Date.parse(dateString);
    log("getDateTimeFromString parse Date: " + dateString, LogLevel.DEBUG, { parsed });
    return parsed || 0;
  } catch (error) {
    log("getDateTimeFromString could not parse Date: " + dateString, LogLevel.WARN, error);
    return 0;
  }
}

// Export for testing
export function getLatestDateTime (storedTestData: StoredTestData): number {
  const lastChecked: number = typeof storedTestData.lastChecked === "string"
    ? getDateTimeFromString(storedTestData.lastChecked)
    : (storedTestData.lastChecked?.getTime() || 0);
  const lastUpdated: number = typeof storedTestData.lastUpdated === "string"
    ? getDateTimeFromString(storedTestData.lastUpdated)
    : (storedTestData.lastUpdated?.getTime() || 0);
  const lastRequested = storedTestData.lastRequested?.getTime() || 0;
  const latestDateTime: number = Math.max(
    lastChecked,
    lastUpdated,
    lastRequested
  );
  log("Math.max", LogLevel.DEBUG, { latestDateTime, lastChecked, lastUpdated, lastRequested, storedTestData });
  return latestDateTime;
}

// Export for testing
export function removeOldest (cachedTestList: CachedTestList): StoredTestData | undefined {
  // We can't just do a sort and pop since there are 3 fields to look at
  let oldestTest: StoredTestData | undefined;
  let oldestDate: number = 0;
  for (const storedTestData of cachedTestList.values()) {
    if (oldestTest === undefined) {
      oldestTest = storedTestData;
      oldestDate = getLatestDateTime(storedTestData);
    } else {
      const latestDateTime = getLatestDateTime(storedTestData);
      if (latestDateTime < oldestDate) {
        oldestTest = storedTestData;
        oldestDate = latestDateTime;
      }
    }
    if (oldestDate === 0) {
      // If it's zero, no point in continuing
      cachedTestList.delete(oldestTest.testId);
      return oldestTest;
    }
  }
  if (oldestTest) {
    cachedTestList.delete(oldestTest.testId);
  }
  return oldestTest;
}

function getTestDataFromStoredData (storedTestData: StoredTestData): TestData {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ppaasTestStatus, ppaasTestStatusChecked, lastRequested, ...testData }: StoredTestData = storedTestData;
  return testData;
}

async function getUpdatedTestDataFromStoredData (storedTestData: StoredTestData): Promise<TestData> {
  const { testId, ppaasTestStatus, lastChecked }: StoredTestData = storedTestData;
  // Update the status from S3 if we have one and it's not finished (or failed)
  log("lastChecked: " + lastChecked, LogLevel.DEBUG, { lastChecked, ppaasTestStatus });
  if (ppaasTestStatus === undefined) {
    const ppaasTestId = PpaasTestId.getFromTestId(testId);
    const newTestStatus: PpaasTestStatus | undefined = await PpaasTestStatus.getStatus(ppaasTestId);
    log(`PpaasTestStatus.getStatus(${testId})`, LogLevel.DEBUG, { newTestStatus });
    if (newTestStatus) {
      const { resultsFilename, ...testStatusParts }: TestStatusMessage = newTestStatus.getTestStatusMessage();
      log("storedTestData before", LogLevel.DEBUG, { storedTestData, testStatusParts });
      Object.assign(storedTestData, testStatusParts); // We have to assign so we can overwrite it in whichever list it's in
      log("storedTestData after", LogLevel.DEBUG, { storedTestData });
      storedTestData.ppaasTestStatus = newTestStatus;
      storedTestData.lastUpdated = newTestStatus.getLastModifiedRemote();
      storedTestData.lastChecked = new Date();
      storedTestData.resultsFileLocation = resultsFilename.map((resultsFile: string) =>
        new PpaasS3File({ filename: resultsFile, s3Folder: ppaasTestId.s3Folder, localDirectory }).remoteUrl
      );
      storedTestData.errors = newTestStatus.errors;
    }
  } else if (ppaasTestStatus && ppaasTestStatus.status !== TestStatus.Finished && ppaasTestStatus.status !== TestStatus.Failed
    && (!lastChecked || new Date(lastChecked).getTime() < (Date.now() - ONE_MINUTE) || storedTestData.status === TestStatus.Unknown)
  ) {
    log("Read Status before", LogLevel.TRACE, { lastChecked, ppaasTestStatus });
    const readDate: Date = await ppaasTestStatus.readStatus(); // Update and get new numbers and maybe status, TODO: Force
    log("Read Status after", LogLevel.DEBUG, { lastChecked, readDate, ppaasTestStatus });
    if (!lastChecked || readDate.getTime() > new Date (lastChecked).getTime()) {
      storedTestData.lastChecked = storedTestData.lastUpdated = readDate;
    }
    // Check if we're long past the endtime or check if the date returned by readStatus is long ago and update
    log("new ppaasTestStatus", LogLevel.DEBUG, { ppaasTestStatus });
    if ((ppaasTestStatus.status === TestStatus.Created || ppaasTestStatus.status === TestStatus.Running)
      && ppaasTestStatus.endTime < (Date.now() - FIFTEEN_MINUTES) && readDate.getTime() < (Date.now() - FIFTEEN_MINUTES)
    ) {
      ppaasTestStatus.status = TestStatus.Failed;
      ppaasTestStatus.errors = [...(ppaasTestStatus.errors || []), "End time or last status update were more than fifteen minutes ago, status manually changed to Failed"];
      storedTestData.lastChecked = new Date();
      ppaasTestStatus.writeStatus().catch((error) => log("Could not write testStatus to S3 for testId " + storedTestData.testId, LogLevel.ERROR, error));
      TestScheduler.addHistoricalTest(ppaasTestStatus.getTestId(), undefined, ppaasTestStatus.startTime, ppaasTestStatus.endTime, ppaasTestStatus.status)
      .catch(() => { /* noop */ });
    }
    const { resultsFilename, ...testStatusParts }: TestStatusMessage = ppaasTestStatus.getTestStatusMessage();
    Object.assign(storedTestData, testStatusParts); // We have to assign so we can overwrite it in whichever list it's in
    storedTestData.status = ppaasTestStatus.status;
    storedTestData.resultsFileLocation = resultsFilename.map((resultsFile: string) =>
      new PpaasS3File({ filename: resultsFile, s3Folder: storedTestData.s3Folder, localDirectory }).remoteUrl
    );
    storedTestData.errors = ppaasTestStatus.errors;
  }
  return getTestDataFromStoredData(storedTestData);
}

async function parseEnvironmentVariablesFile (filePath: string, filename?: string): Promise<EnvironmentVariablesFile> {
  try {
    const environmentVariables: EnvironmentVariablesFile = {};
    const data: string = await fs.readFile(filePath, "utf8");
    if (!data) {
      throw new Error(`No data in file ${filePath}.`);
    }
    const lines = data.replace(/\r/g, "").split("\n");
    for (let line of lines) {
      // Ignore commented lines
      line = line.split("#")[0];
      // Check if it's an export variable=value
      // Allow empty string, first character must be a letter per https://stackoverflow.com/questions/2821043/allowed-characters-in-linux-environment-variable-names
      const match: RegExpMatchArray | null = line.match(/(export )?([a-zA-Z_][_a-zA-z0-9]*)="?([^"]*)"?/);
      log(line, LogLevel.DEBUG, match);
      if (match) {
        const key: string = match[match.length - 2];
        const value: string = match[match.length - 1] || "";
      // Debug level since it might have passwords
      log(key + "=" + value, LogLevel.DEBUG);
        // Server-side parsed files will all be hidden since we can't determine which should be visible
        environmentVariables[key] = { value, hidden: true };
      } else if (line) {
        log("Could not parse line from " + (filename || filePath), LogLevel.WARN, line);
      }
    }
    // Debug level since it might have passwords
    log("parseEnvironmentVariables", LogLevel.DEBUG, environmentVariables);
    return environmentVariables;
  } catch (error) {
    log("Could not parse environment variables file: " + (filename || filePath), LogLevel.ERROR, error);
    throw error;
  }
}

export async function convertPPaaSFileToFile (ppaasS3File: PpaasS3File): Promise<File> {
  const stats = await fs.stat(ppaasS3File.localFilePath);
  return createFormidableFile(ppaasS3File.filename, ppaasS3File.localFilePath, ppaasS3File.contentType, stats.size, stats.mtime);
}

function convertToDatetime (value: string, name: string): number | ErrorResponse {
  let parsedDatetime: number | undefined;
  try {
    // Make sure it can be converted into a Date. Then get the time in ms.
    // First check if it's all numbers and parse it
    const parsedValue: number = Number(value);
    // If it's not a pure number then see if the string is a date/time
    parsedDatetime = new Date(isNaN(parsedValue) ? value : parsedValue).getTime();
    log(`${name}: ${parsedDatetime}`, LogLevel.DEBUG);
    if (isNaN(parsedDatetime)) {
      throw new Error(`${name} new Date(${value}).getTime() is not a number`);
    }
  } catch (error) {
    return { json: { message: `Received an invalid ${name}: ${value}`, error: formatError(error) }, status: 400 };
  }
  return parsedDatetime;
}

// Export for testing
export interface DownloadPriorTestIdResult {
  environmentVariables: EnvironmentVariablesFile;
  profile: string | undefined;
  yamlFile: File | undefined;
  yamlFileName: string;
  additionalFiles: PpaasS3File[];
  additionalFileNames: string[];
}

// Export for testing
export async function downloadPriorTestId (
  priorTestId: string,
  fieldYamlFile: string | string[] | undefined,
  fieldAdditionalFiles: string | string[] | undefined,
  localPath: string
): Promise<ErrorResponse | DownloadPriorTestIdResult> {
  const environmentVariables: EnvironmentVariablesFile = {};
  let profile: string | undefined;
  let yamlFile: File | undefined;
  let yamlFileName: string | undefined;
  const additionalFiles: PpaasS3File[] = [];
  const additionalFileNames: string[] = [];

  let priorPpaasTestId: PpaasTestId;
  try {
    priorPpaasTestId = PpaasTestId.getFromTestId(priorTestId);
  } catch (error) {
    return {
      json: {
        message: "Could not parse testId into a PpaasTestId: " + priorTestId,
        error: formatError(error)
      },
      status: 400
    };
  }
  // convert the testId to a s3Folder
  const priorS3Folder = priorPpaasTestId.s3Folder;
  // Download the files that are specified in fields (not files)
  const downloadAndConvertFile = async (ppaasFile: PpaasS3File): Promise<File> => {
    await ppaasFile.download();
    const file: File = await convertPPaaSFileToFile(ppaasFile);
    return file;
  };
  // Get them all so we can get their existing tags
  const priorS3Files = await PpaasS3File.getAllFilesInS3({
    s3Folder: priorS3Folder,
    localDirectory
  });
  if (fieldYamlFile) {
    if (Array.isArray(fieldYamlFile)) {
      // Log the json stringified object here so we can check splunk but don't return it
      log("Received more than one yamlFile", LogLevel.WARN, fieldYamlFile);
      return { json: { message: "Received multiple yamlFiles: " + fieldYamlFile.map((file) => file) }, status: 400 };
    }
    try {
      const yamlPpaasFile: PpaasS3File = new PpaasS3File({
        filename: fieldYamlFile, s3Folder: priorS3Folder, localDirectory: localPath
      });
      yamlFile = await downloadAndConvertFile(yamlPpaasFile);
      yamlFileName = fieldYamlFile;
      log("Prior yamlFile converted for testId: " + priorTestId, LogLevel.DEBUG, yamlFile);
    } catch (error) {
      return {
        json: {
          message: "Could not download prior yamlFile for testId: " + priorTestId,
          error: formatError(error)
        },
        status: 400
      };
    }
  } else {
    // We still need to return the prior yaml file name so we can see if the user tried to change it.
    const yamlFiles: PpaasS3File[] = (priorS3Files).filter((s3File) => isYamlFile(s3File.filename));
    if (yamlFiles.length !== 1) {
      return {
        json: {
          message: "Could not find prior yamlFile for testId: " + priorTestId,
          error: "Yaml File not found in " + JSON.stringify(yamlFiles.map((file) => file.filename))
        },
        status: 400
      };
    }
    yamlFileName = yamlFiles[0].filename;
  }
  try {
    if (fieldAdditionalFiles) {
      // Even though the docs say that you can have multiple fields, https://github.com/node-formidable/formidable/pull/340
      // was closed and is not in the IncomingForm we have access to. https://github.com/node-formidable/formidable/pull/380
      // was merged but is not in the latest "released" code so we don't have access to it either.
      // The new canary builds of https://github.com/node-formidable/formidable/ support it but they don't have the @types for it yet
      // We have to JSON.stringify it from the client and parse it here
      if (!Array.isArray(fieldAdditionalFiles) && fieldAdditionalFiles.startsWith("[") && fieldAdditionalFiles.endsWith("]")) {
        try {
          const parsedAdditionalFiles: any = JSON.parse(fieldAdditionalFiles);
          if (Array.isArray(parsedAdditionalFiles)
            && parsedAdditionalFiles.every((additionalFile: any) => typeof additionalFile === "string")) {
            fieldAdditionalFiles = parsedAdditionalFiles as string[];
          }
        } catch (error) {
          log("Could not parse fieldAdditionalFiles: " + fieldAdditionalFiles, LogLevel.WARN, fieldAdditionalFiles);
        }
      }
      fieldAdditionalFiles = Array.isArray(fieldAdditionalFiles) ? fieldAdditionalFiles : [fieldAdditionalFiles];
      if (Array.isArray(fieldAdditionalFiles)) {
        additionalFileNames.push(...fieldAdditionalFiles);
        for (const additionalFile of fieldAdditionalFiles) {
          const s3File = priorS3Files.find((priorS3File) => priorS3File.filename === additionalFile);
          if (s3File) {
            additionalFiles.push(s3File);
          } else {
            log("Could not find additionalFile in prior files: " + additionalFile, LogLevel.WARN, { additionalFile, fieldAdditionalFiles, priorS3Files: priorS3Files.map((priorS3File) => priorS3File.filename) });
            throw new Error(`Could not find ${additionalFile} in prior files ${priorS3Files.map((priorS3File) => priorS3File.filename)}`);
          }
        }
      }
    }
    log("Prior additionalFiles converted for testId: " + priorTestId, LogLevel.DEBUG, additionalFiles);
  } catch (error) {
    return {
      json: {
        message: "Could not find prior additionalFiles for testId: " + priorTestId,
        error: formatError(error)
      },
      status: 400
    };
  }

  // Load the old environment variables (may be overwritten later)
  try {
    const ppaasEncryptEnvironmentVarsFile = new PpaasEncryptEnvironmentFile({ s3Folder: priorS3Folder, environmentVariablesFile: undefined });
    const existsInS3 = await ppaasEncryptEnvironmentVarsFile.existsInS3();
    if (existsInS3) {
      const vars: EnvironmentVariablesFile | undefined = (await ppaasEncryptEnvironmentVarsFile.download()).getEnvironmentVariablesFile();
      if (vars) {
        Object.assign(environmentVariables, vars || {});
        if (environmentVariables && environmentVariables.PROFILE) {
          profile = typeof environmentVariables.PROFILE === "string"
            ? environmentVariables.PROFILE.toLowerCase()
            : environmentVariables.PROFILE.value?.toLowerCase();
        }
        log("postTest environmentVariable names for testid " + priorTestId, LogLevel.DEBUG, { testId: priorTestId, envVariableNames: Object.keys(environmentVariables) });
      } else {
        log("postTest could not load for testid " + priorTestId, LogLevel.ERROR, { testId: priorTestId, existsInS3, fileContents: vars });
      }
    }
  } catch (error) {
    log("postTest Could not load encrypted environment variables file for testId " + priorTestId, LogLevel.ERROR, error, { testId: priorTestId });
    // Swallow
  }
  return {
    environmentVariables,
    profile,
    yamlFile,
    yamlFileName,
    additionalFiles,
    additionalFileNames
  };
}

// Export for testing
export function getValidateLegacyOnly (version: string | undefined): boolean | undefined {
  // undefined or "latest" parse as anything (reutrn undefined)
  if (!version || version === latestPewPewVersion) {
    return undefined;
  }
  // This needs to create the validateLegacyOnly, so anything less than 0.6.0
  return semver.satisfies(version, LEGACY_PEWPEW_VERSION, { includePrerelease: true });
}

// Export for testing
export interface ValidateYamlfileResult {
  testRunTimeMn: number | undefined;
  bucketSizeMs: number | undefined;
}

// Export for testing
export async function validateYamlfile (
  yamlFile: File,
  environmentVariables: EnvironmentVariables,
  additionalFileNames: string[],
  bypassParser: boolean | undefined,
  authPermissions: AuthPermissions,
  validateLegacyOnly?: boolean
): Promise<ErrorResponse | ValidateYamlfileResult> {
  let testRunTimeMn: number | undefined;
  let bucketSizeMs: number | undefined;
  if (bypassParser) {
    if (authPermissions.authPermission < AuthPermission.Admin) {
      log("Unauthorized User attempted to bypass the config parser.", LogLevel.WARN, { yamlFile, userId: authPermissions.userId });
      return { json: { message: "User is not authorized to bypass the config parser. If you think this is an error, please contact the PerformanceQA team." }, status: 403 };
    }
  } else {
    // bypassPaser is false or undefined, run the parser
    let yamlParser: YamlParser;
    // webconfig pewpew parser validation here
    // Create a random dummy folder name that we can look for later that we'll use to identify loggers writing to splunk (and allow them)
    const dummySplunkPath = makeRandomString(25);
    try {
      const dummyEnvironmentVariables: EnvironmentVariables = Object.assign({}, environmentVariables);
      // Add our dummy paths and overwrite these with our own like the agent would do.
      for (const splunkPath of logger.PEWPEW_SPLUNK_INJECTED_VARIABLES) {
        dummyEnvironmentVariables[splunkPath] = dummySplunkPath;
      }
      // Pass pewpew version legacy/scripting
      yamlParser = await YamlParser.parseYamlFile(yamlFile.filepath, dummyEnvironmentVariables, validateLegacyOnly);
    } catch (error) {
      return { json: { message: `yamlFile: ${yamlFile.originalFilename || yamlFile.filepath} failed to parse`, error: formatError(error) }, status: 400 };
    }

    // testRunTime
    testRunTimeMn = yamlParser.getTestRunTimeMn();
    if (!testRunTimeMn || testRunTimeMn <= 0) {
      return { json: { message: `Yaml File ${yamlFile.originalFilename || yamlFile.filepath} has an invalid testRunTime: ${testRunTimeMn}` }, status: 400 };
    }

    // bucketSize
    bucketSizeMs = yamlParser.getBucketSizeMs();
    if (!bucketSizeMs || bucketSizeMs <= 0) {
      return { json: { message: `Yaml File ${yamlFile.originalFilename || yamlFile.filepath} has an invalid bucketSize: ${bucketSizeMs}` }, status: 400 };
    }

    // Check for input files that include a / or a \ since we will put the files in the same directory
    const expectedInputFiles: string[] = yamlParser.getInputFileNames();
    const badInputFiles: string[] = expectedInputFiles.filter((filename) => filename.includes("/") || filename.includes("\\"));
    if (badInputFiles.length > 0) {
      return { json: { message: `Yaml File ${yamlFile.originalFilename || yamlFile.filepath} is referencing files outside of its directory. Please change them to non-external paths\nBadInputFiles: ${badInputFiles}` }, status: 400 };
    }

    // Check for log files that include a / or a \ to avoid overwritting system or our own files
    const expectedLogFiles: string[] = yamlParser.getLoggerFileNames();
    const badLogFiles: string[] = expectedLogFiles.filter((filename) => filename.includes("/") || filename.includes("\\"))
      .filter((slashfilename) => {
        // The only allowed outside paths are to the Splunk folder and no other outside folders are allowed
        // If it's a \ we won't allow it at all.
        const splitFile = slashfilename.split("/");
        return (splitFile.length !== 2 || splitFile[0] !== dummySplunkPath);
      });
    if (badLogFiles.length > 0) {
      return { json: { message: `Yaml File ${yamlFile.originalFilename || yamlFile.filepath} is referencing log files outside of its directory. Please change them to non-external paths\n{ badLogFiles: ${badLogFiles}, allowedLogLocations: ${logger.PEWPEW_SPLUNK_INJECTED_VARIABLES } }` }, status: 400 };
    }

    // Check the parser to make sure we have them all.
    const missingFiles: string[] = expectedInputFiles.filter((filename) => !additionalFileNames.includes(filename));
    if (missingFiles.length > 0) {
      return { json: { message: `Yaml File ${yamlFile.originalFilename || yamlFile.filepath} is expecting files that were not provided: ${missingFiles}, additionalFileNames: ${additionalFileNames}` }, status: 400 };
    }
  }
  return { testRunTimeMn, bucketSizeMs };
}

// Store these as maps for fast lookup oldest can be found by lastRequested, lastUpdated, and lastChecked
// We can't use static variables since the memory spaces aren't shared between api and getServerSideProps
// https://stackoverflow.com/questions/70260701/how-to-share-data-between-api-route-and-getserversideprops
declare global {
  // https://stackoverflow.com/questions/68481686/type-typeof-globalthis-has-no-index-signature
  // eslint-disable-next-line no-var
  var runningTests: Map<string, StoredTestData> | undefined;
  // eslint-disable-next-line no-var
  var recentTests: Map<string, StoredTestData> | undefined;
  // eslint-disable-next-line no-var
  var requestedTests: Map<string, StoredTestData> | undefined;
}

// export for testing
export function getRunningTests (): Map<string, StoredTestData> {
  if (global.runningTests === undefined) {
    global.runningTests = new Map();
  }
  return global.runningTests;
}

// export for testing
export function getRecentTests (): Map<string, StoredTestData> {
  if (global.recentTests === undefined) {
    global.recentTests = new Map();
  }
  return global.recentTests;
}

// export for testing
export function getRequestedTests (): Map<string, StoredTestData> {
  if (global.requestedTests === undefined) {
    global.requestedTests = new Map();
  }
  return global.requestedTests;
}

export abstract class TestManager {
  // Store these as maps for fast lookup oldest can be found by lastRequested, lastUpdated, and lastChecked
  // Cache for the Searches
  protected static searchedTests = new Map<string, StoredTestData>();
  // Last time a message was sent to the queue
  protected static lastNewTestMap: Map<string, Date> = new Map<string, Date>();

  protected static removeFromList (testId: string, cacheLocation: CacheLocation): void {
    switch (cacheLocation) {
      case CacheLocation.Running:
        // Running doesn't have a max length
        getRunningTests().delete(testId);
        break;
      case CacheLocation.Recent:
        getRecentTests().delete(testId);
        break;
      case CacheLocation.Requested:
        getRequestedTests().delete(testId);
        break;
      case CacheLocation.Searched:
        this.searchedTests.delete(testId);
        break;
      default:{
        const error = "removeFromList unknown CacheLocation: ";
        log(error, LogLevel.ERROR);
        throw new Error(error);
      }
    }
  }

  // Shared usage
  // 1. Message - Get then update from message (possibly moving to running or finished)
  // 2. /api/test - Get then update from s3
  // 3. /api/teststatus - Get then update from s3 only if we don't have a status (search cache)
  // 4. /api/search - searchTests - Add to cached list if not there (cache list only)
  // Returns element or none if not found
  protected static async getFromList (testId: string, updateFromS3: boolean): Promise<CachedTestData | undefined> {
    let foundTest: StoredTestData | undefined;
    let cacheLocation: CacheLocation = CacheLocation.Searched;
    // Running
    if (getRunningTests().has(testId)) {
      cacheLocation = CacheLocation.Running;
      foundTest = getRunningTests().get(testId);
      log(`testId ${testId} found in runningTests`, LogLevel.DEBUG, foundTest);
    // Recent
    } else if (getRecentTests().has(testId)) {
      cacheLocation = CacheLocation.Recent;
      foundTest = getRecentTests().get(testId);
      log(`testId ${testId} found in recentTests`, LogLevel.DEBUG, foundTest);
    // Requested
    } else if (getRequestedTests().has(testId)) {
      cacheLocation = CacheLocation.Requested;
      foundTest = getRequestedTests().get(testId);
      log(`testId ${testId} found in requestedTests`, LogLevel.DEBUG, foundTest);
    // Search Cache
    } else if (this.searchedTests.has(testId)) {
      cacheLocation = CacheLocation.Searched;
      foundTest = this.searchedTests.get(testId);
      log(`testId ${testId} found in searchedTests`, LogLevel.DEBUG, foundTest);
    }
    if (foundTest && updateFromS3) {
      await getUpdatedTestDataFromStoredData(foundTest);
      // Move to running if running and not there
      // Or are in running and are no longer runnning
      if ((foundTest.status === TestStatus.Created || foundTest.status === TestStatus.Running)
        && cacheLocation !== CacheLocation.Running) {
        cacheLocation = CacheLocation.Running;
        this.addToStoredList(foundTest, CacheLocation.Running);
      } else if ((foundTest.status !== TestStatus.Created && foundTest.status !== TestStatus.Running)
        && cacheLocation === CacheLocation.Running) {
        cacheLocation = CacheLocation.Recent;
        this.addToStoredList(foundTest, CacheLocation.Recent);
      }
    }
    return foundTest ? ({ testData: foundTest, cacheLocation }) : undefined;
  }

  // Returns removed element or none if we haven't maxed out
  protected static async addToStoredList (newData: StoredTestData, cacheLocation: CacheLocation): Promise<StoredTestData | undefined> {
    log(`addToStoredTest testId (${newData.testId})`, LogLevel.DEBUG, { newData, cacheLocation });
    // Strip off the cacheLocation if it's a CachedTestData
    if ((newData as any).cacheLocation) {
      delete (newData as any).cacheLocation;
    }
    const { testId } = newData;
    let currentCacheLocation: CacheLocation | undefined;
    let removed: StoredTestData | undefined;
    try {
      const foundTest = await this.getFromList(testId, false);
      if (foundTest) {
        currentCacheLocation = foundTest.cacheLocation;
      }
    } catch (error) {
      log(`addToStoredTest could not getFromList(${testId})`, LogLevel.ERROR, error);
      // Swallow
    }
    // Remove it from the old list unless we're adding to search, then don't add it
    if (currentCacheLocation) {
      if (cacheLocation === CacheLocation.Searched) {
        // It doesn't matter, don't remove it or move it
        return undefined;
      } else if (currentCacheLocation !== cacheLocation) {
        // Remove it from the wrong list so we can add it
        this.removeFromList(testId, currentCacheLocation);
      }
    }
    switch (cacheLocation) {
      case CacheLocation.Running:
        // Running doesn't have a max length
        getRunningTests().set(testId, newData);
        break;
      case CacheLocation.Recent:
        if (getRecentTests().size >= MAX_SAVED_TESTS_RECENT && !getRecentTests().has(testId)) {
          removed = removeOldest(getRecentTests());
        }
        // Add after remove so this on isn't removed
        getRecentTests().set(testId, newData);
        break;
      case CacheLocation.Requested:
        if (getRequestedTests().size >= MAX_SAVED_TESTS_RECENT && !getRequestedTests().has(testId)) {
          removed = removeOldest(getRequestedTests());
        }
        // Add after remove so this on isn't removed
        getRequestedTests().set(testId, newData);
        break;
      case CacheLocation.Searched:
        if (this.searchedTests.size >= MAX_SAVED_TESTS_CACHED && !this.searchedTests.has(testId)) {
          removed = removeOldest(this.searchedTests);
        }
        // Add after remove so this on isn't removed
        this.searchedTests.set(testId, newData);
        break;
    }
    return removed;
  }

  /**
   * Gets the last time a message was sent to the queue
   * @param queueName Name of the queue to check from PpaasTestMessage.getAvailableQueueNames()
   * @returns Date the last test was sent or undefined
   */
  public static getLastNewTestDate (queueName: string): Date | undefined {
    const date: Date | undefined = this.lastNewTestMap.get(queueName);
    // If it's not undefined, return a new Date object so the one in our Map can't be modified
    return date ? new Date(date.getTime()) : date;
  }

  /**
   * Internal method to set the last time a message was sent to the queue
   * @param queueName Name of the queue from PpaasTestMessage.getAvailableQueueNames()
   * @param date Optional. The date the message was sent. Default: now
   */
  public static setLastNewTestDate (queueName: string, date: Date = new Date()): void {
    this.lastNewTestMap.set(queueName, date);
  }

  public static async updateRunningTest (testId: string, testStatusMessage: TestStatusMessage, messageType: MessageType): Promise<void> {
    log("updateRunningTest", LogLevel.DEBUG, { testId, testStatusMessage, messageType });
    const foundTest: CachedTestData | undefined = await this.getFromList(testId, true);
    let testData: StoredTestData;
    if (foundTest !== undefined) {
      log(`testId ${testId} found in one of the lists`, LogLevel.DEBUG, foundTest);
      testData = foundTest.testData;
      // Update the status
    } else {
      const ppaasTestId = PpaasTestId.getFromTestId(testId);
      testData = {
        testId,
        s3Folder: ppaasTestId.s3Folder,
        status: TestStatus.Unknown,
        startTime: ppaasTestId.date.getTime()
      };
      log(`testId ${testId} not found in runningTests or recentTests, creating it`, LogLevel.DEBUG, foundTest);
      // We can add this on delayed. We don't need to use the data since we have updated data from the message
      PpaasTestStatus.getStatus(ppaasTestId)
      .then((ppaasTestStatus: PpaasTestStatus | undefined) => {
        if (testData && ppaasTestStatus) { testData.ppaasTestStatus = ppaasTestStatus; }
      })
      .catch((error) => log(`Could not load PpaasTestStatus from s3 for testId ${testId}`, LogLevel.ERROR, error));
    }
    // Check if it's in running
    if (!foundTest || foundTest.cacheLocation !== CacheLocation.Running) {
      await this.addToStoredList(testData, CacheLocation.Running);
    }
    const { resultsFilename, ...testStatusParts }: TestStatusMessage = testStatusMessage;
    log("foundTest before", LogLevel.DEBUG, { testData, testStatusParts });
    Object.assign(testData, testStatusParts); // We have to assign so we can overwrite it in whichever list it's in
    testData.resultsFileLocation = resultsFilename.map((resultsFile: string) =>
      new PpaasS3File({ filename: resultsFile, s3Folder: testData!.s3Folder, localDirectory }).remoteUrl
    );
    testData.lastUpdated = new Date(); // Update the last updated
    log("foundTest after", LogLevel.DEBUG, { testData, testStatusParts });
    if (messageType === MessageType.TestFinished || messageType === MessageType.TestFailed) {
      // move it to recent
      await this.addToStoredList(testData, CacheLocation.Recent);
    }
    // Update the historical schedule
    TestScheduler.addHistoricalTest(testId, undefined, testStatusMessage.startTime, testStatusMessage.endTime, testStatusMessage.status)
    .catch(() => { /* noop */ });
  }

  // define get route
  public static getAllTest (): AllTestsResponse {
    // No query param return all recent tests
    const allTests: AllTests = {
      runningTests: sortTestData([...getRunningTests().values()].map(getTestDataFromStoredData)),
      recentTests: sortTestData([...getRecentTests().values()].map(getTestDataFromStoredData)),
      requestedTests: sortTestData([...getRequestedTests().values()].map(getTestDataFromStoredData))
    };
    return { json: allTests, status: 200 };
  }

  // define get route
  public static async getTest (testId: string): Promise<ErrorResponse | TestDataResponse> {
    try {
      // If we get more than one testId, just return all, don't try to pick one
      log(`testId: ${testId}`, LogLevel.DEBUG);
      let ppaasTestId: PpaasTestId;
      try {
        ppaasTestId = PpaasTestId.getFromTestId(testId);
      } catch (error) {
        return {
          json: {
            message: "Could not parse testId into a PpaasTestId: " + testId,
            error: formatError(error)
          },
          status: 400
        };
      }
      // convert the testId to a s3Folder
      const s3Folder = ppaasTestId.s3Folder;

      // Find any info on the testId
      // Check lists first
      let foundTest: CachedTestData | undefined = await this.getFromList(testId, true);
      if (foundTest !== undefined) {
        foundTest.testData.lastRequested = new Date();
        log(`testId ${testId} found test lists`, LogLevel.DEBUG, foundTest);
        // If it's on search, we need to move it
        if (foundTest.cacheLocation === CacheLocation.Searched) {
          this.addToStoredList(foundTest.testData, CacheLocation.Requested);
        }
        return { json: getTestDataFromStoredData(foundTest.testData), status: 200 };
      } else {
          // If it's not in any of the above find it in S3 save it to recentTests
          foundTest = {
            testData: {
            testId,
            s3Folder,
            status: TestStatus.Unknown,
            startTime: ppaasTestId.date.getTime(),
            lastRequested: new Date()
            },
            cacheLocation: CacheLocation.Requested
          };
          // new won't and Cached may not have PpaasTestStatus or results files
          // Even if we've checked ppaasTestStatusChecked while cached, let's do it again for real this time
          const testData = await getUpdatedTestDataFromStoredData(foundTest.testData);
          if (foundTest.testData.ppaasTestStatus === undefined) {
            // If it's not in s3, 404
            return { json: { message: `TestId ${testId} not Found in S3` }, status: 404 };
          }
          const isRunning: boolean = foundTest.testData.ppaasTestStatus !== undefined
            && (foundTest.testData.ppaasTestStatus.status === TestStatus.Created || foundTest.testData.ppaasTestStatus.status === TestStatus.Running);
          const isScheduled: boolean = foundTest.testData.ppaasTestStatus !== undefined && foundTest.testData.ppaasTestStatus.status === TestStatus.Scheduled;
          // We don't want to remove any from running since the communications loop will do it.
          if (isScheduled) {
            // Don't put Scheduled tests on the recent. They're already on the calendar, but do keep them in cache
            this.addToStoredList(foundTest.testData, CacheLocation.Searched);
          } else if (isRunning) {
            this.addToStoredList(foundTest.testData, CacheLocation.Running);
          } else {
            this.addToStoredList(foundTest.testData, CacheLocation.Requested);
          }
          return { json: testData, status: 200 };
      }
    } catch (error) {
      log(`TestManager.getTest(${testId}) failed: ${error}`, LogLevel.ERROR, error);
      throw error;
    }
  }

  // define get route
  public static async getTestStatus (testId: string | string[] | undefined): Promise<ErrorResponse | MessageResponse> {
    try {
      // If we get more than one testId, error
      if (testId && !Array.isArray(testId)) {
        log(`testId: ${testId}`, LogLevel.DEBUG);
        let ppaasTestId: PpaasTestId;
        try {
          ppaasTestId = PpaasTestId.getFromTestId(testId);
        } catch (error) {
          return {
            json: {
              message: "Could not parse testId into a PpaasTestId: " + testId,
              error: formatError(error)
            },
            status: 400
          };
        }
        // Find any info on the testId
        // Check running first
        let foundTest: CachedTestData | undefined = await this.getFromList(testId, false);
        if (foundTest !== undefined) {
          log(`testId ${testId} found tests list`, LogLevel.DEBUG, foundTest);
        } else {
          // create new
          foundTest = {
            testData: {
            testId: ppaasTestId.testId,
            s3Folder: ppaasTestId.s3Folder,
            startTime: ppaasTestId.date.getTime(),
            status: TestStatus.Unknown,
            lastRequested: new Date()
            },
            cacheLocation: CacheLocation.Searched
          };
          this.addToStoredList(foundTest.testData, CacheLocation.Searched);
        }
        if (foundTest.cacheLocation === CacheLocation.Searched && !foundTest.testData.ppaasTestStatus && !foundTest.testData.ppaasTestStatusChecked) {
          await getUpdatedTestDataFromStoredData(foundTest.testData);
          foundTest.testData.ppaasTestStatusChecked = true;
        }
        // We need to return 404 here if it's an old status or we'll cause infinite loops in TestsList
        return {
          json: { message: foundTest.testData.status },
          status: foundTest.testData.ppaasTestStatus || foundTest.testData.status !== TestStatus.Unknown ? 200 : 404
        };
      } else {
        // No query param
        return { json: { message: "Must provide a testId minimally" }, status: 400 };
      }
    } catch (error) {
      log(`TestManager.getTestStatus(${testId}) failed: ${error}`, LogLevel.ERROR, error);
      throw error;
    }
  }

  // define get route
  public static async getPreviousTestData (testId: string): Promise<ErrorResponse | PreviousTestDataResponse> {
    try {
      log(`testId: ${testId}`, LogLevel.DEBUG);
      const environmentVariables: PreviousEnvironmentVariables = {};

      const scheduledTestData: ScheduledTestData | undefined = await TestScheduler.getTestData(testId);
      if (scheduledTestData) {
        const { queueName, testMessage, scheduleDate, recurrence, environmentVariables: previousEnvironmentVariables } = scheduledTestData;
        const { envVariables, ...testMessageRest } = testMessage;
        // New schedules will have previousEnvironmentVariables, old one's won't
        if (previousEnvironmentVariables) {
          Object.assign(environmentVariables, PpaasEncryptEnvironmentFile.getPreviousEnvironmentVariables(previousEnvironmentVariables));
        } else {
          for (const name of Object.keys(envVariables)) {
            environmentVariables[name] = null;
          }
        }
        const previousScheduledTestData: PreviousTestData = {
          queueName,
          scheduleDate,
          ...testMessageRest,
          environmentVariables,
          startTime: scheduleDate,
          status: TestStatus.Scheduled,
          ...recurrence
        };
        return { json: previousScheduledTestData, status: 200 };
      }

      let ppaasTestId: PpaasTestId;
      try {
        ppaasTestId = PpaasTestId.getFromTestId(testId);
      } catch (error) {
        return {
          json: {
            message: "Could not parse testId into a PpaasTestId: " + testId,
            error: formatError(error)
          },
          status: 400
        };
      }
      // convert the testId to a s3Folder
      const s3Folder = ppaasTestId.s3Folder;

      const getTestResponse = await this.getTest(testId);
      const testData: TestData = getTestResponse.status === 200
        ? getTestResponse.json as TestData
        : {
          testId,
          s3Folder,
          status: TestStatus.Unknown,
          startTime: ppaasTestId.date.getTime()
        };
      // Check s3 for the files
      const s3MessageFilename: string = createS3MessageFilename(ppaasTestId);
      const s3StatusFilename: string = createS3StatusFilename(ppaasTestId);
      const statsFileName: string = path.parse(createStatsFileName(testId)).name;
      const pewpewOutFilename: string = logger.pewpewStdOutFilename(testId).split("-").slice(0,4).join("-");
      const s3Files: PpaasS3File[] = await PpaasS3File.getAllFilesInS3({ s3Folder, localDirectory });
      let yamlFile: string | undefined;
      const additionalFiles: string[] = [];
      let encryptedEnvironmentVariablesFile: boolean = false;
      for (const s3File of s3Files) {
        if (isYamlFile(s3File.filename)) {
          yamlFile = s3File.filename;
        } else if (s3File.filename === ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME) {
          encryptedEnvironmentVariablesFile = true;
        } else if (s3File.filename !== s3MessageFilename && s3File.filename !== s3StatusFilename
          && !s3File.filename.startsWith(statsFileName) && !s3File.filename.startsWith(pewpewOutFilename)
          && !(s3File.filename.startsWith("stats-") && s3File.filename.endsWith(".json"))) {
          // Leave pewpew executables. If they don't have permissions, the POST /test will reject it
          additionalFiles.push(s3File.filename);
        }
      }
      log("getTestData Found files in s3", LogLevel.DEBUG, { yamlFile, additionalFiles, encryptedEnvironmentVariablesFile });
      if (!yamlFile) {
        return {
          json: {
            message: "Could not find yamlFile for testId: " + testId
          },
          status: 404
        };
      }
      if (encryptedEnvironmentVariablesFile) {
        try {
          const envFile: PpaasEncryptEnvironmentFile = await new PpaasEncryptEnvironmentFile({ s3Folder, environmentVariablesFile: undefined }).download();
          if (envFile.getEnvironmentVariablesFile()) {
            Object.assign(environmentVariables, envFile.getPreviousEnvironmentVariables());
            log("getTestData environmentVariable names for testid " + testId, LogLevel.DEBUG, { testId, envVariableNames: environmentVariables, envFile: envFile.sanitizedCopy() });
          }
        } catch (error) {
          log("getTestData Could not load encrypted environment variables file for testId " + testId, LogLevel.ERROR, error, { testId });
          // Swallow
        }
      }
      const previousTestData: PreviousTestData = {
        ...testData,
        yamlFile,
        additionalFiles: additionalFiles.length > 0 ? additionalFiles : undefined,
        environmentVariables
      };
      return {
        json: previousTestData,
        status: 200
      };
    } catch (error) {
      log(`TestManager.getTest(${testId}) failed: ${error}`, LogLevel.ERROR, error);
      throw error;
    }
  }

  // define the post route or the PUT /schedule route (same code for parsing the form)
  public static async postTest (parsedForm: ParsedForm, authPermissions: AuthPermissions, localPath: string, editSchedule?: boolean): Promise<ErrorResponse | TestDataResponse> {
    const authPermission: AuthPermission = authPermissions.authPermission;
    try {
      const fields: Fields = parsedForm.fields;
      const files: Files = parsedForm.files;
      log("fields", LogLevel.DEBUG, Object.assign({}, fields, { environmentVariables: undefined })); // Environment variables can have passwords, sanitize
      log("files", LogLevel.DEBUG, files);
      const fieldKeys: string[] = Object.keys(fields);
      const fileKeys: string[] = Object.keys(files);
      log("fieldKeys", LogLevel.DEBUG, fieldKeys);
      log("fileKeys", LogLevel.DEBUG, fileKeys);
      // Check if either one is empty
      if (!fields || !files || fieldKeys.length === 0
          || !(fileKeys.includes("yamlFile") || (fieldKeys.includes("testId") && fieldKeys.includes("yamlFile")))
          || !fieldKeys.includes("queueName")) {
        // We're missing yamlFile or queueName
        return { json: { message: "Must provide a yamlFile and queueName minimally" }, status: 400 };
      } else {
        const environmentVariablesFile: EnvironmentVariablesFile = {};
        let profile: string | undefined;
        let yamlFile: File | undefined;
        const additionalFiles: File[] = [];
        const copyFiles: PpaasS3File[] = [];
        const additionalFileNames: string[] = [];
        let priorTestId: string | undefined;

        if (fieldKeys.includes("testId")) {
          if (Array.isArray(fields.testId) || !fields.testId) {
            return { json: { message: "Received an invalid testId: " + fields.testId }, status: 400 };
          }
          // Download the files from the prior testId and either get an error or the files and their data.
          priorTestId = fields.testId;
          const downloadResponse: ErrorResponse | DownloadPriorTestIdResult = await downloadPriorTestId(priorTestId, fields.yamlFile, fields.additionalFiles, localPath);
          // eslint-disable-next-line no-prototype-builtins
          if (downloadResponse.hasOwnProperty("json")) {
            return downloadResponse as ErrorResponse;
          }
          // Get the other attributes
          const priorTestIdResult: DownloadPriorTestIdResult = downloadResponse as DownloadPriorTestIdResult;
          // Only include the prior environment variables (including passwords) if it's the scheduler
          if (authPermissions.token === AUTH_PERMISSIONS_SCHEDULER.token) {
            Object.assign(environmentVariablesFile, priorTestIdResult.environmentVariables);
          }
          yamlFile = priorTestIdResult.yamlFile;
          // Check if they passed in a new yaml file that has a different name
          // New runs can use a new file, editSchedule CANNOT or we'll have two yaml files in the folder
          if (editSchedule) {
            log("editSchedule", LogLevel.DEBUG, { priorYamlFile: priorTestIdResult.yamlFileName, yamlFile: files.yamlFile, fileKeys, priorTestIdResult });
          }
          if (editSchedule && fileKeys.includes("yamlFile") && !Array.isArray(files.yamlFile)
            && files.yamlFile.originalFilename !== priorTestIdResult.yamlFileName) {
            // Check if the name changed
            const errorText = `Edit Schedule called with changed yaml file name: ${priorTestIdResult.yamlFileName} -> ${files.yamlFile.originalFilename}`;
            log(errorText, LogLevel.WARN, {
              oldYamlFile: priorTestIdResult.yamlFileName,
              newYamlFile: files.yamlFile.originalFilename
            });
            return { json: { message: errorText }, status: 400 };
          }
          profile = priorTestIdResult.profile;

          // These files weren't downloaded. We'll just copy them to the new s3 location later
          // Do we need to remove ones that have been updated?
          copyFiles.push(...priorTestIdResult.additionalFiles);
          // We do need the file names to confirm the config/yaml file
          additionalFileNames.push(...priorTestIdResult.additionalFileNames);
        } else if (editSchedule) {
          return { json: { message: "Edit Schedule must have a prior testId: " + fields.testId }, status: 400 };
        }
        // Yay! We have the basics
        // queueName
        if (Array.isArray(fields.queueName)) {
          return { json: { message: "Received an invalid queueName: " + fields.queueName }, status: 400 };
        }
        const queueName: string | undefined = fields.queueName;
        if (!queueName || !PpaasTestMessage.getAvailableQueueNames().includes(queueName)) {
          return { json: { message: `Received an invalid queueName: ${queueName}\nqueues: ${JSON.stringify(PpaasTestMessage.getAvailableQueueMap())}` }, status: 400 };
        }

        // version
        let version: string | undefined;
        if (fieldKeys.includes("version")) {
          // Validate the version is in s3
          if (Array.isArray(fields.version) || !fields.version || !await PpaasS3File.existsInS3("pewpew/" + fields.version)) {
            return { json: { message: "Received an invalid version: " + fields.version }, status: 400 };
          }
          version = fields.version;
        }

        let restartOnFailure: boolean | undefined;
        if (fieldKeys.includes("restartOnFailure")) {

          if (Array.isArray(fields.restartOnFailure) || (fields.restartOnFailure !== "true" && fields.restartOnFailure !== "false")) {
            return { json: { message: "Received an invalid restartOnFailure: " + fields.restartOnFailure }, status: 400 };
          }

          restartOnFailure = fields.restartOnFailure === "true";
        }

        let bypassParser: boolean | undefined;
        if (fieldKeys.includes("bypassParser")) {

          if (Array.isArray(fields.bypassParser) || (fields.bypassParser !== "true" && fields.bypassParser !== "false")) {
            return { json: { message: "Received an invalid bypassParser: " + fields.bypassParser }, status: 400 };
          }

          bypassParser = fields.bypassParser === "true";
        }

        // yamlFile
        if (fileKeys.includes("yamlFile")) {
          // We can't validate the file.type because depending on the framework the type can come in as application/octet-stream or text/yaml or other
          // And pewpew doesn't care. We'll use the pewpew webconfig parser to validate
          if (Array.isArray(files.yamlFile)) {
            // Log the json stringified object here so we can check splunk but don't return it
            log("Received more than one yamlFile", LogLevel.WARN, yamlFile);
            return { json: { message: "Received multiple yamlFiles: " + files.yamlFile.map((file) => file.originalFilename || file.filepath) }, status: 400 };
          } else if (!files.yamlFile.originalFilename) {
            log("Missing yamlFile", LogLevel.WARN, yamlFile);
            return { json: { message: "Yaml file did not have a file.name: " + JSON.stringify(files.yamlFile) }, status: 400 };
          }
          yamlFile = files.yamlFile;
        }
        if (yamlFile === undefined) {
          // Log the json stringified object here so we can check splunk but don't return it
          log("No Yamlfile after parsing fields and files", LogLevel.WARN, yamlFile);
          return { json: { message: "No Yamlfile after parsing fields and files: " + yamlFile}, status: 400 };
        }

        // environmentVariables. It'll be stringified
        if (Array.isArray(fields.environmentVariables)) {
          return { json: { message: "Received more than one environmentVariables: " + fields.environmentVariables }, status: 400 };
        }
        if (fieldKeys.includes("environmentVariables")) {
          log("fields.environmentVariables", LogLevel.TRACE, fields.environmentVariables);
          try {
            Object.assign(environmentVariablesFile, JSON.parse(fields.environmentVariables));
            if (environmentVariablesFile && environmentVariablesFile.PROFILE) {
              profile = typeof environmentVariablesFile.PROFILE === "string"
                ? environmentVariablesFile.PROFILE.toLowerCase()
                : environmentVariablesFile.PROFILE.value?.toLowerCase();
              if (profile === undefined) {
                return { json: { message: "PROFILE cannot be hidden", error: "PROFILE cannot be hidden" }, status: 400 };
              }
            }
            log("parsed environmentVariables", LogLevel.DEBUG, Object.keys(environmentVariablesFile));
          } catch (error) {
            log("Could not parse environmentVariables", LogLevel.TRACE, error, fields.environmentVariables);
            // Don't log the actual error or environmentVariables since it could include passwords
            return { json: { message: "Could not parse environmentVariables", error: formatError(error) }, status: 400 };
          }
        }

        // Pre-parse any environment variables files so we can get a PROFILE if we have one
        // The rest have to wait until after we generate our testId and s3Folder
        // But we'll also put the non-.sh ones in an array for our yamlValidation
        const processFile = async (file: File): Promise<ErrorResponse | undefined> => {
          if (!file.originalFilename) { return undefined; }
          if (file.originalFilename.endsWith(".sh")) {
            // Server-side parsed files will all be hidden since we can't determine which should be visible
            const parsedEnv: EnvironmentVariablesFile = await parseEnvironmentVariablesFile(file.filepath, file.originalFilename);
            if (parsedEnv.PROFILE) {
              profile = typeof parsedEnv.PROFILE === "string"
                ? parsedEnv.PROFILE.toLowerCase()
                : parsedEnv.PROFILE.value?.toLowerCase();
              if (profile === undefined) {
                return { json: { message: "PROFILE cannot be hidden", error: "PROFILE cannot be hidden" }, status: 400 };
              }
            }
            Object.assign(environmentVariablesFile, parsedEnv);

          } else if (file.originalFilename === "pewpew" || file.originalFilename === "pewpew.exe") {
            if (authPermission < AuthPermission.Admin) {
              log("Unauthorized User attempted to use custom pewpew binary.", LogLevel.WARN, { yamlFile });
              return { json: { message: "User is not authorized to use custom pewpew binaries. If you think this is an error, please contact the PerformanceQA team." }, status: 403 };
            }
            log("Authorized user uploaded custom binary.", LogLevel.INFO, { yamlFile });
            additionalFileNames.push(file.originalFilename);
            additionalFiles.push(file);
          } else {
            // Put it in an array for our yamlValidation
            additionalFileNames.push(file.originalFilename);
            additionalFiles.push(file);
          }
          return undefined;
        };
        if (fileKeys.includes("additionalFiles")) {
          try {
            // If there's more than one it'll be an array, otherwise a File object
            if (Array.isArray(files.additionalFiles)) {
              // Need to do an "as" cast here for typechecking
              for (const file of files.additionalFiles) {
                const processError: ErrorResponse | undefined = await processFile(file);
                if (processError) { return processError; }
              }
            } else {
              const processError: ErrorResponse | undefined = await processFile(files.additionalFiles);
              if (processError) { return processError; }
            }
          } catch (error) {
            // Don't log the actual error or environmentVariables since it could include passwords
            return { json: { message: "Could not parse environmentVariables from files", error: formatError(error) }, status: 400 };
          }
        }
        // Trace level since it might have passwords
        log("environmentVariables", LogLevel.TRACE, environmentVariablesFile);

        // Pass pewpew version legacy/scripting
        const validateLegacyOnly = getValidateLegacyOnly(version);
        const validateResult: ErrorResponse | ValidateYamlfileResult = await validateYamlfile(yamlFile, PpaasEncryptEnvironmentFile.getEnvironmentVariables(environmentVariablesFile), additionalFileNames, bypassParser, authPermissions, validateLegacyOnly);
        // eslint-disable-next-line no-prototype-builtins
        if (validateResult.hasOwnProperty("json")) {
          return validateResult as ErrorResponse;
        }
        const { testRunTimeMn, bucketSizeMs } = validateResult as ValidateYamlfileResult;

        // Check if it's a scheduled test or a POST test
        let scheduleDate: number | undefined;
        let daysOfWeek: number[] | undefined;
        let endDate: number | undefined;
        let fileTags: Map<string, string> | undefined;
        if (fieldKeys.includes("scheduleDate")) {
          log("fields.scheduleDate: " + fields.scheduleDate, LogLevel.DEBUG);
          if (Array.isArray(fields.scheduleDate)) {
            return { json: { message: "Received an invalid scheduleDate: " + fields.scheduleDate }, status: 400 };
          }
          const convertedScheduleDate = convertToDatetime(fields.scheduleDate, "scheduleDate");
          if (typeof convertedScheduleDate === "number") {
            scheduleDate = convertedScheduleDate;
          } else {
            return convertedScheduleDate;
          }
          try {
            // Make sure it can be converted into a Date. Then get the time in ms.
            // First check if it's all numbers and parse it
            const parsedScheduledDate: number = Number(fields.scheduleDate);
            // If it's not a pure number then see if the string is a date/time
            scheduleDate = new Date(isNaN(parsedScheduledDate) ? fields.scheduleDate : parsedScheduledDate).getTime();
            log("scheduleDate: " + scheduleDate, LogLevel.DEBUG);
            if (isNaN(scheduleDate)) {
              throw new Error(`scheduleDate new Date(${fields.scheduleDate}).getTime() is not a number`);
            }
          } catch (error) {
            return { json: { message: "Received an invalid scheduleDate: " + fields.scheduleDate, error: formatError(error) }, status: 400 };
          }

          // If we have a scheduleDate, check for recurrence
          // daysOfWeek: number[];
          if (fieldKeys.includes("daysOfWeek")) {
            log("fields.daysOfWeek: " + fields.daysOfWeek, LogLevel.DEBUG);
            try { // Any issues parsing this, throw to the catch to return
              if (!Array.isArray(fields.daysOfWeek) && fields.daysOfWeek.startsWith("[") && fields.daysOfWeek.endsWith("]")) {
                // JSON Stringified array
                const parsedDaysOfWeek: any = JSON.parse(fields.daysOfWeek);
                if (Array.isArray(parsedDaysOfWeek)
                  && parsedDaysOfWeek.every((dayOfWeek: any) => typeof dayOfWeek === "number")) {
                    daysOfWeek = parsedDaysOfWeek as number[];
                } else {
                  throw new Error(fields.daysOfWeek + " did not parse into an array of numbers");
                }
              } else if (Array.isArray(fields.daysOfWeek)) {
                // Array of strings. make sure each one is a number
                daysOfWeek = fields.daysOfWeek.map((dayOfWeek: string) => {
                  const numberOfWeek: number = Number(dayOfWeek);

                  if (numberOfWeek.toString() !== dayOfWeek) {
                    throw new Error(`${dayOfWeek} is not a valid number`);
                  }
                  return numberOfWeek;
                });
              } else {
                const numberOfWeek: number = Number(fields.daysOfWeek);
                if (numberOfWeek.toString() !== fields.daysOfWeek) {
                  throw new Error(fields.daysOfWeek + " is not a valid number");
                }
                daysOfWeek = [numberOfWeek];
              }
              // Now that it's parsed, we still need to validate the range of numbers
              daysOfWeek = sortAndValidateDaysOfWeek(daysOfWeek);
            } catch (error) {
              return { json: { message: "Received an invalid daysOfWeek: " + fields.daysOfWeek, error: (error as any)?.message || `${error}` }, status: 400 };
            }
          }
          // endDate: number;
          if (fieldKeys.includes("endDate")) {
            log("fields.endDate: " + fields.endDate, LogLevel.DEBUG);
            if (Array.isArray(fields.endDate)) {
              return { json: { message: "Received an invalid endDate: " + fields.endDate }, status: 400 };
            }
            const convertedEndDate = convertToDatetime(fields.endDate, "endDate");
            if (typeof convertedEndDate === "number") {
              endDate = convertedEndDate;
            } else {
              return convertedEndDate;
            }
              // Add tags test=false? or is recurring=true enough
              fileTags = defaultRecurringFileTags();
          }

          if ((daysOfWeek !== undefined || endDate !== undefined) && !(daysOfWeek !== undefined && endDate !== undefined)) {
            return { json: { message: "Recurring tests must specify both daysOfWeek and endDate" }, status: 400 };
          }
        } else if (editSchedule) {
          // You can't turn a scheduled test into a non-scheduled test
          return { json: { message: "Edit Schedule must have a scheduleDate: " + fields.scheduleDate }, status: 400 };
        }

        // Create these before we parse the additional files so we can upload them
        // Even if we have a scheduleDate, don't use it for the testId so we can keep it unique in case we want to schedule the same test at the same time
        // If we're editSchedule, check that the status is scheduled (no overwriting files on in progress or finished tests)
        let ppaasTestId: PpaasTestId;
        try {
          ppaasTestId = editSchedule ? PpaasTestId.getFromTestId(priorTestId!) : PpaasTestId.makeTestId(yamlFile.originalFilename!, { profile });
        } catch (error) {
          return { json: { message: "Invalid Yaml filename", error: `${error}` }, status: 400 };
        }
        // Check for pewpew/ and settings/ and reject
        if ((ppaasTestId.yamlFile) === PEWPEW_BINARY_FOLDER || ppaasTestId.yamlFile === ENCRYPTED_TEST_SCHEDULER_FOLDERNAME) {
          return { json: { message: ppaasTestId.yamlFile + " is a reserved word and cannot be used for a yaml file. Please change your yaml filename" }, status: 400 };
        }
        const testId = ppaasTestId.testId;
        if (editSchedule) {
          // Get the status
          const ppaasTestStatus: PpaasTestStatus | undefined = await PpaasTestStatus.getStatus(ppaasTestId);
          if (!ppaasTestStatus || ppaasTestStatus.status !== TestStatus.Scheduled) {
            return { json: { message: "Edit Schedule can only run against tests in scheduled status: " + ppaasTestStatus?.status }, status: 400 };
          }
          // Check permissions before we upload files
          const permissionsError: ErrorResponse | undefined = await TestScheduler.isAuthorizedForTest(testId, authPermissions);
          if (permissionsError) {
            return permissionsError;
          }
        }
        const s3Folder: string = ppaasTestId.s3Folder;
        log(`new test s3Folder: ${s3Folder}`, LogLevel.DEBUG);
        log(`${yamlFile.originalFilename} testId: ${testId}`, LogLevel.INFO);

        // Upload files
        const uploadPromises: Promise<PpaasS3File | void>[] = [uploadFile(yamlFile, s3Folder, fileTags)];
        // additionalFiles - Do this last so we can upload them at the same time
        uploadPromises.push(...(additionalFiles.map((file: File) => uploadFile(file, s3Folder, fileTags || s3.defaultTestExtraFileTags()))));
        if (!editSchedule) {
          // copyFiles, just copy them from the old s3 location to the new one
          uploadPromises.push(...(copyFiles.map((file: PpaasS3File) => {
            file.tags = fileTags || s3.defaultTestExtraFileTags();
            return file.copy({ destinationS3Folder: s3Folder });
          })));
        } else {
          const s3StatusFilename: string = createS3StatusFilename(ppaasTestId);
          uploadPromises.push(...(copyFiles.map((file: PpaasS3File) => {
            // If we're changing from non-recurring to recurring or vice-versa we need to edit the existing file tags.
            // yaml and status files need defaultTestFileTags, all others should be defaultTestExtraFileTags
            file.tags = fileTags
              ? fileTags
              : isYamlFile(file.filename) || file.filename === s3StatusFilename // yaml and status files are test files
                ? s3.defaultTestFileTags()
                : s3.defaultTestExtraFileTags();
            return file.updateTags();
          })));
        }
        // Store encrypted environment variables in s3
        uploadPromises.push(new PpaasEncryptEnvironmentFile({ s3Folder, environmentVariablesFile, tags: fileTags || s3.defaultTestExtraFileTags() }).upload());
        // Wait for all uploads to complete
        await Promise.all(uploadPromises);

        // If we have a ScheduleDate, we just need to put it on the Schedule list, not actually run it.
        const testMessage: TestMessage = {
          testId,
          s3Folder,
          yamlFile: yamlFile.originalFilename!,
          additionalFiles: additionalFileNames.length > 0 ? additionalFileNames : undefined,
          testRunTimeMn,
          bucketSizeMs,
          version: version || latestPewPewVersion,
          envVariables: PpaasEncryptEnvironmentFile.getEnvironmentVariables(environmentVariablesFile),
          restartOnFailure: restartOnFailure || false,
          bypassParser,
          userId: authPermissions.userId || undefined
        };
        if (scheduleDate) {
          // Send the testMessage and queue to the scheduler
          const scheduledTestData: ScheduledTestData = { queueName, testMessage, scheduleDate, environmentVariables: environmentVariablesFile };
          if (daysOfWeek && endDate) {
            scheduledTestData.recurrence = { daysOfWeek, endDate };
          }
          // addTest doesn't check if there's an existing testId, it will just replace it with this one
          return await TestScheduler.addTest(scheduledTestData, authPermissions);
        } else {
          // Create our message in the scaling queue
          const testData: StoredTestData = await this.sendTestToQueue(testMessage, queueName, ppaasTestId, testRunTimeMn, authPermissions);
          return { json: testData, status: 200 };
        }
      }
    } catch (error) {
      // If we get here it's a 500. All the "bad requests" are handled above
      log(`TestManger.postTest failed: ${error}`, LogLevel.ERROR, error, getLogAuthPermissions(authPermissions));
      throw error;
    }
  }

  /**
   * Shared function used by postTest and the testScheduler. Sends the message to the queue,
   * creates the TestStatus, and updates the running tests and last new test date.
   * @param testMessage {TestMessage} to send to the queue
   * @param queueName {string} the sqs queue name
   * @param ppaasTestId {PpaasTestId} which has the testId and s3Folder
   * @param testRunTimeMn {number | undefined} The runtime if available to set the TestStatus
   * @param authPermissions {AuthPermissions} of the user to log who started the test
   */
  public static async sendTestToQueue (
    testMessage: TestMessage,
    queueName: string,
    ppaasTestId: PpaasTestId,
    testRunTimeMn: number | undefined,
    authPermissions: AuthPermissions
  ): Promise<StoredTestData> {
    const testId = ppaasTestId.testId;
    const s3Folder = ppaasTestId.s3Folder;

    // Create a dummy results file so we can get the remoteFileLocation
    const resultsFile: PpaasS3File = new PpaasS3File({
      filename: createStatsFileName(testId),
      s3Folder,
      localDirectory
    });
    const startTime = Date.now();
    const endTime = (startTime + (60000 * (testRunTimeMn ? testRunTimeMn : 60)) + 600000); // Add extra 10 minutes (for now)
    const userId = authPermissions.userId || testMessage.userId || undefined;
    const ppaasTestStatus = new PpaasTestStatus(
      ppaasTestId,
      {
        startTime,
        endTime,
        resultsFilename: [resultsFile.filename],
        status: TestStatus.Created,
        queueName,
        version: testMessage.version,
        userId
      }
    );
    // We need to upload the default status before we send the message to the queue so the agent can read it.
    const statusUrl = await ppaasTestStatus.writeStatus();
    log(`PpaasTestStatus url: ${statusUrl}`, LogLevel.DEBUG, { statusUrl });
    const resultsFileLocation: string[] = [resultsFile.remoteUrl];
    const testData: StoredTestData = {
      testId,
      s3Folder,
      status: TestStatus.Created,
      userId,
      resultsFileLocation,
      startTime,
      endTime,
      ppaasTestStatus
    };

    // Create our message in the scaling queue
    const ppaasTestMessage: PpaasTestMessage = new PpaasTestMessage(testMessage);
    await ppaasTestMessage.send(queueName);
    // Put a message on the scale in queue so we don't scale back in
    await sendTestScalingMessage(queueName);
    // We succeeded! Yay!
    log ("New Load Test started", LogLevel.INFO, { testMessage: ppaasTestMessage.sanitizedCopy(), queueName, testData, authPermissions: getLogAuthPermissions(authPermissions) });

    // Add it to the runningTests
    // We don't want to remove any since the communications loop will do it.
    this.updateRunningTest(testId, ppaasTestStatus.getTestStatusMessage(), MessageType.TestStatus);
    // Update the lastNewTestMap
    this.setLastNewTestDate(queueName);
    return testData;
  }

  // define the put route to update the yaml file
  public static async putTest (parsedForm: ParsedForm, authPermissions: AuthPermissions): Promise<ErrorResponse | MessageResponse> {
    const authPermission: AuthPermission = authPermissions.authPermission;
    try {
      const fields: Fields = parsedForm.fields;
      const files: Files = parsedForm.files;
      log("fields", LogLevel.DEBUG, fields);
      log("files", LogLevel.DEBUG, files);
      const fieldKeys: string[] = Object.keys(fields);
      const fileKeys: string[] = Object.keys(files);
      log("fieldKeys", LogLevel.DEBUG, fieldKeys);
      log("fileKeys", LogLevel.DEBUG, fileKeys);
      // Check if either one is empty
      if (!fields || !files || fieldKeys.length === 0 || fileKeys.length === 0
          || !fileKeys.includes("yamlFile") || !fieldKeys.includes("testId")) {
        // We're missing yamlFile or testId
        return { json: { message: "Must provide a yamlFile and testId minimally" }, status: 400 };
      } else {
        if (Array.isArray(files.yamlFile)) {
          // Log the json stringified object here so we can check splunk but don't return it
          log("Received an more than one yamlFile", LogLevel.WARN, files.yamlFile);
          return { json: { message: "Received multiple yamlFiles: " + files.yamlFile.map((file) => file.originalFilename) }, status: 400 };
        }
        const yamlFile: File | Files = files.yamlFile;
        const testIdString: string | string[] = fields.testId;
        if (Array.isArray(testIdString)) {
          // Log the json stringified object here so we can check splunk but don't return it
          log("Received more than one testId", LogLevel.WARN, testIdString);
          return { json: { message: "Received multiple testIds: " + testIdString }, status: 400 };
        }
        let testId: PpaasTestId;
        try {
          testId = PpaasTestId.getFromTestId(testIdString);
        } catch (error) {
          log("Could not parse testId " + testIdString, LogLevel.WARN, error);
          return { json: { message: "Could not parse testId " + testIdString, error: formatError(error) }, status: 400 };
        }
        log(`PUT testId: ${testIdString}`, LogLevel.DEBUG, testId);

        // Check if it's in s3 and if the file matches
        const s3Folder: string = testId.s3Folder;
        if (!await PpaasS3File.existsInS3(s3Folder + "/" + yamlFile.originalFilename)) {
          // Couldn't find it
          log("Could not find file in s3 " + s3Folder + "/" + yamlFile.originalFilename, LogLevel.WARN, { testId: testIdString });
          return { json: { message: "Could not find file in s3 " + s3Folder + "/" + yamlFile.originalFilename }, status: 400 };
        }
        log(`PUT testId: ${testIdString}. Found ${yamlFile.originalFilename} in S3`, LogLevel.DEBUG, testId);

        let bypassParser: boolean | undefined;
        if (fieldKeys.includes("bypassParser")) {

          if (Array.isArray(fields.bypassParser) || (fields.bypassParser !== "true" && fields.bypassParser !== "false")) {
            return { json: { message: "Received an invalid bypassParser: " + fields.bypassParser }, status: 400 };
          }

          bypassParser = fields.bypassParser === "true";
        }

        if (bypassParser) {
          if (authPermission < AuthPermission.Admin) {
            log("Unauthorized User attempted to bypass the config parser.", LogLevel.WARN, { yamlFile });
            return { json: { message: "User is not authorized to bypass the config parser. If you think this is an error, please contact the PerformanceQA team." }, status: 403 };
          }
        } else {
          // Read in the actual variables so we can inject them and make sure it's valid.
          const envFile: PpaasEncryptEnvironmentFile = await new PpaasEncryptEnvironmentFile({ s3Folder, environmentVariablesFile: undefined }).download();
          // BUG: Possible bug. If the variable was hidden/not saved and it's needed for a hit rate or ramp, bypass parser is the only option
          if (envFile.getEnvironmentVariablesFile() === undefined) {
            throw new Error(`No environment variables file found in s3 ${s3Folder}/${ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME}`);
          }
          const environmentVariables: EnvironmentVariables = envFile.getEnvironmentVariables();
          // Add our dummy Splunk paths and overwrite these with our own like the agent would do.
          for (const splunkPath of logger.PEWPEW_SPLUNK_INJECTED_VARIABLES) {
            environmentVariables[splunkPath] = "";
          }
          try {
            await YamlParser.parseYamlFile(yamlFile.filepath, environmentVariables);
          } catch (error) {
            return { json: { message: `yamlFile: ${yamlFile.originalFilename || yamlFile.filepath} failed to parse`, error: formatError(error) }, status: 400 };
          }
        }

        const yamlS3File: PpaasS3File = await uploadFile(yamlFile, s3Folder);
        log(`PUT testId: ${testIdString}. ${yamlFile.originalFilename || yamlFile.filepath} uploaded to S3`, LogLevel.DEBUG, testId);

        // Create our message in the communications queue
        const ppaasCommunicationsMessage = new PpaasS3Message({
          testId,
          messageType: MessageType.UpdateYaml,
          messageData: yamlFile.originalFilename || yamlFile.filepath
        });
        const messageId: string | undefined = await ppaasCommunicationsMessage.send();
        log ("Load Test updated", LogLevel.INFO, { testId, communicationsMessage: ppaasCommunicationsMessage.sanitizedCopy(), messageId, authPermissions: getLogAuthPermissions(authPermissions) });

        return { json: { message: `Yamlfile ${yamlFile.originalFilename || yamlFile.filepath} Updated: ${yamlS3File.remoteUrl}`, messageId }, status: 200 };
      }
    } catch (error) {
      // If we get here it's a 500. All the "bad requests" are handled above
      log(`Testmanager.putTest failed: ${error}`, LogLevel.ERROR, error, getLogAuthPermissions(authPermissions));
      throw error;
    }
  }

  // define the put stop route to put a message on the queue to stop a test
  public static async stopTest (
    testIdString: string | string[] | undefined,
    authPermissions: AuthPermissions,
    killTest?: boolean
  ): Promise<ErrorResponse | MessageResponse> {
    try {
      // Check if either one is empty
      if (!testIdString) {
        // We're missing yamlFile or testId
        return { json: { message: "Must provide a testId minimally" }, status: 400 };
      } else {
        if (Array.isArray(testIdString)) {
          // Log the json stringified object here so we can check splunk but don't return it
          log("Received more than one testId", LogLevel.WARN, testIdString);
          return { json: { message: "Received multiple testIds: " + testIdString }, status: 400 };
        }
        let testId: PpaasTestId;
        try {
          testId = PpaasTestId.getFromTestId(testIdString);
        } catch (error) {
          log("Could not parse testId " + testIdString, LogLevel.WARN, error);
          return { json: { message: "Could not parse testId " + testIdString, error: formatError(error) }, status: 400 };
        }
        log(`PUT stopTest testId: ${testIdString}`, LogLevel.DEBUG, testId);

        // Check if it's in s3 and if the file matches
        if (!await PpaasS3File.existsInS3(testId.s3Folder)) {
          // Couldn't find it
          log("Could not find file in s3 " + testId.s3Folder, LogLevel.WARN, { testId: testIdString });
          return { json: { message: `Could not find testId ${testIdString} in s3: ${testId.s3Folder} ` }, status: 404 };
        }
        log(`PUT testId: ${testIdString} found in S3`, LogLevel.DEBUG, testId);

        const ppaasCommunicationsMessage = new PpaasS3Message({
          testId,
          messageType: killTest ? MessageType.KillTest : MessageType.StopTest,
          messageData: undefined
        });
        const messageId: string | undefined = await ppaasCommunicationsMessage.send();
        log ("Load Test stopped", LogLevel.INFO, { testId, communicationsMessage: ppaasCommunicationsMessage.sanitizedCopy(), messageId, authPermissions: getLogAuthPermissions(authPermissions) });

        return { json: { message: `${killTest ? "Kill" : "Stop"} TestId ${testIdString} Message Sent.`, messageId }, status: 200 };
      }
    } catch (error) {
      // If we get here it's a 500. All the "bad requests" are handled above
      log(`TestManager.stopTest(${testIdString}) failed: ${error}`, LogLevel.ERROR, error, getLogAuthPermissions(authPermissions));
      throw error;
    }
  }

  // define the put stop route to put a message on the queue to stop a test
  public static async searchTests (
    s3FolderQuery: string | string[] | undefined,
    maxResultsQuery: string | string[] | undefined,
    extension: string | string[] = [".yaml", ".yml"]
  ): Promise<ErrorResponse | TestListResponse> {
    try {
      // Check if either one is empty
      if (s3FolderQuery === undefined) {
        // We're missing s3Folder
        return { json: { message: "Must provide a s3Folder (partial) minimally" }, status: 400 };
      } else {
        const s3FolderPartial: string | string[] = s3FolderQuery;
        if (Array.isArray(s3FolderPartial)) {
          return { json: { message: "Received multiple s3Folders: " + s3FolderPartial }, status: 400 };
        }
        if (s3FolderPartial.length < MIN_SEARCH_LENGTH || s3FolderPartial.length > MAX_SEARCH_LENGTH) {
          return { json: { message: `Must provide at least ${MIN_SEARCH_LENGTH} and not more than ${MAX_SEARCH_LENGTH} characters to search.` }, status: 400 };
        }
        let maxResults = DEFAULT_MAX_SEARCH_RESULTS;
        if (maxResultsQuery && !Array.isArray(maxResultsQuery)) {
          maxResults = Number(maxResultsQuery) || DEFAULT_MAX_SEARCH_RESULTS;
          if (isNaN(maxResults) || maxResults < 0 || maxResults > MAX_SEARCH_RESULTS) {
            maxResults = DEFAULT_MAX_SEARCH_RESULTS;
          }
        }
        // Sanitize the input
        // Only allow letters, numbers, and slashes. PpaasTestId will remove anything other than those
        if (!/^[\w\d/]*$/.test(s3FolderPartial)) {
          log("Invalid Characters passed to searchTests", LogLevel.WARN, s3FolderPartial);
          return { json: { message: `Invalid characters passed to searchTest: ${s3FolderPartial}` }, status: 400 };
        }

        // We always need to query 1000 because we can't search just for the files we want. We can only download "All"
        // files and then sort by recent.
        const s3YamlFiles: PpaasS3File[] = await PpaasS3File.getAllFilesInS3({
          s3Folder: s3FolderPartial,
          localDirectory,
          extension,
          maxFiles: 1000
        });
        if (s3YamlFiles.length === 0) {
          return { json: [], status: 204 };
        }
        log(`Found files for s3FolderSearch: ${s3FolderPartial}`, LogLevel.DEBUG, s3YamlFiles.map((s3YamlFile) => s3YamlFile.key));

        let tests: TestData[] = [];
        for (const s3YamlFile of s3YamlFiles) {
          try {
            const ppaasTestId: PpaasTestId = PpaasTestId.getFromS3Folder(s3YamlFile.s3Folder);
            // Check cache or other lists
            const newTestData: TestData = { testId: ppaasTestId.testId, s3Folder: ppaasTestId.s3Folder, startTime: ppaasTestId.date.getTime(), status: TestStatus.Unknown };
            this.addToStoredList(newTestData, CacheLocation.Searched);
            tests.push(newTestData);
          } catch (error) {
            log("Could not parse s3Folder " + s3YamlFile.s3Folder, LogLevel.WARN, error);
          }
        }

        // Sort and return most recent.
        // Sort by reverse date, not testId name
        sortTestData(tests);
        if (tests.length > maxResults) {
          tests = tests.slice(0, maxResults);
        }

        return { json: tests, status: 200 };
      }
    } catch (error) {
      // If we get here it's a 500. All the "bad requests" are handled above
      log(`TestManager.searchTests(${s3FolderQuery}, ${maxResultsQuery}) failed: ${error}`, LogLevel.ERROR, error);
      throw error;
    }
  }
}

export default TestManager;
