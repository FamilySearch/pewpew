import { EnvironmentVariablesFile } from "./testmanager";
import { TestMessage } from "@fs/ppaas-common/dist/types";

export interface ScheduledTestRecurrence {
  daysOfWeek: number[];
  endDate: number;
}

/** Has all the data to pass to be able to run tests on a Schedule */
export interface ScheduledTestData {
  queueName: string;
  testMessage: TestMessage;
  /** Stores the state of the variables (hidden/etc) vs. the ones in TestMessage */
  environmentVariables?: EnvironmentVariablesFile;
  /** We can't use a Date because it can't be stringified */
  scheduleDate: number;
  recurrence?: ScheduledTestRecurrence;
}
