import {
  PpaasTestStatus,
  TestStatusMessage
} from "@fs/ppaas-common";
import { Readable } from "stream";

export interface FileData {
  value: string | Readable;
  options: { filename: string, encoding?: string };
}

/** Data used for POST /test calls */
export interface FormDataPost {
  /** The yamlFile to be run */
  yamlFile: FileData | string;
  /** Prior Test Id to use as a basis */
  testId?: string;
  /** The name of the sqs queue to send the test to */
  queueName: string;
  /** Additional files required by the test */
  additionalFiles?: FileData | string | (FileData | string)[];
  /** Environment variables needed for the test */
  environmentVariables?: EnvironmentVariablesFile | string;
  /** Override the pewpew version, version must be in s3 */
  version?: string;
  /** Restart the test if it crashes */
  restartOnFailure?: "true" | "false";
  /** Date as a timestamp to schedule a test rather than run it immediately */
  scheduleDate?: number;
  /** Recurring schedule, Array of 0-6 days of the week to run the test or a stringified array */
  daysOfWeek?: number | number[] | string;
  /** Recurring schedule, when to stop running the tests */
  endDate?: number;
}

export interface FormDataPewPew {
  additionalFiles?: FileData | FileData[];
  latest?: "true" | "false";
}

export interface FormDataPut {
  yamlFile: FileData;
  testId: string;
}

export interface TestManagerResponse {
  json: any;
  status: number;
}

export interface TestManagerError {
  message: string;
  error?: string;
}

export interface ErrorResponse extends TestManagerResponse {
  json: TestManagerError;
  status: number;
}

// This should always include everything in TestStatusMessage, but change endTime to optional
export interface TestData extends Omit<TestStatusMessage, "endTime" | "resultsFilename"> {
  // instanceId?: string;
  // hostname?: string;
  // ipAddress?: string;
  // startTime: number;
  // resultsFilename: string[];
  // status: TestStatus;
  // errors?: string[];
  // version?: string;
  // queueName?: string;
  // userId?: string;
  testId: string;
  s3Folder: string;
  resultsFileLocation?: string[];
  resultsFilename?: string[];
  endTime?: number;
  lastUpdated?: Date | string;
  lastChecked?: Date | string;
}

/** Legacy files are always populated.
 * TODO: On 2/2/2024 this can be removed
 */
export interface EnvironmentVariableStateLegacy {
  value: string;
  hidden: boolean;
}
/** Going forward, we'll remove the value if hidden=true */
export interface EnvironmentVariableStateHidden {
  value: undefined;
  hidden: true;
}
/** Going forward, only hidden=false will have a value */
export interface EnvironmentVariableStateVisible {
  value: string;
  hidden: false;
}
export type EnvironmentVariableState = EnvironmentVariableStateLegacy | EnvironmentVariableStateVisible | EnvironmentVariableStateHidden;

/**
 * POST Data:
 * Environment variables for a prior run. The server will have a PreviousEnvironmentVariable or string (legacy),
 * the client will get either a string or null (hidden and legacy)
 */
 export type EnvironmentVariablesFile = Record<string, string | EnvironmentVariableState>;

/**
 * GET Data:
 * Environment variables for a prior run. The server will have a PreviousEnvironmentVariable,
 * the client will get either a string or null (hidden)
 */
export type PreviousEnvironmentVariables = Record<string, string | null>;

// We can't extend TestStatusMessage since we need to change the type of envVariables to PreviousEnvironmentVariables
// But this should always include everything in TestStatusMessage
/** All the data we can find from a previous or scheduled test to create a new run (or edit it) */
export interface PreviousTestData extends TestData {
  yamlFile: string;
  additionalFiles?: string[];
  environmentVariables: PreviousEnvironmentVariables;
  restartOnFailure?: boolean;
  bypassParser?: boolean;
  scheduleDate?: number;
  // recurrence
  daysOfWeek?: number[];
  endDate?: number;
}

export interface StoredTestData extends TestData {
  ppaasTestStatus?: PpaasTestStatus;
  ppaasTestStatusChecked?: boolean; // Used for the cache to not check again
  lastRequested?: Date;
}

export interface AllTests {
  /** Tests currently created and waiting for an agent or running */
  runningTests: TestData[];
  /** Tests that have recently run and finished or failed */
  recentTests: TestData[];
  /** Cache of tests that have been recently viewed */
  requestedTests: TestData[];
}

export interface TestDataResponse extends TestManagerResponse {
  json: TestData;
  status: number;
}

export interface PreviousTestDataResponse extends TestManagerResponse {
  json: PreviousTestData;
  status: number;
}

export interface TestListResponse extends TestManagerResponse {
  json: TestData[];
  status: number;
}

export interface AllTestsResponse extends TestManagerResponse {
  json: AllTests;
  status: number;
}

export interface TestManagerMessage {
  message: string;
  messageId?: string;
}

export interface MessageResponse extends TestManagerResponse {
  json: TestManagerMessage;
  status: number;
}

export interface PewPewVersionsResponse extends TestManagerResponse {
  json: string[];
  status: number;
}
