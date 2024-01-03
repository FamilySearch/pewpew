import {
  AuthPermission,
  AuthPermissions,
  ErrorResponse,
  PAGE_START_TEST,
  PAGE_TEST_HISTORY,
  ScheduledTestData,
  ScheduledTestRecurrence,
  StoredTestData,
  TestData,
  TestDataResponse,
  TestManagerError
} from "../../../types";
import {
  ENCRYPTED_TEST_SCHEDULER_FILENAME,
  ENCRYPTED_TEST_SCHEDULER_FOLDERNAME,
  ParsedForm,
  cleanupTestFolder,
  createTestFolder,
  getLogAuthPermissions,
  LOCAL_FILE_LOCATION as localDirectory,
  sortAndValidateDaysOfWeek
} from "./util";
import {
  LogLevel,
  PpaasS3File,
  PpaasTestId,
  PpaasTestStatus,
  TestMessage,
  TestStatus,
  log,
  logger,
  s3,
  util
} from "@fs/ppaas-common";
import { TestManager, defaultRecurringFileTags } from "./testmanager";
import { formatError, getHourMinuteFromTimestamp } from "./clientutil";
import type { EventInput } from "@fullcalendar/core";
import { IS_RUNNING_IN_AWS } from "./authclient";
import { PpaasEncryptS3File } from "./ppaasencrypts3file";

const { sleep } = util;
logger.config.LogFileName = "ppaas-controller";

const TEST_SCHEDULER_POLL_INTERVAL_MS: number = parseInt(process.env.TEST_SCHEDULER_POLL_INTERVAL_MS || "0", 10) || 60000;
const RUN_HISTORICAL_SEARCH: boolean = process.env.RUN_HISTORICAL_SEARCH?.toLowerCase() === "true";
const HISTORICAL_SEARCH_MAX_FILES: number = parseInt(process.env.HISTORICAL_SEARCH_MAX_FILES || "0", 10) || 100000;
const RUN_HISTORICAL_DELETE: boolean = process.env.RUN_HISTORICAL_DELETE?.toLowerCase() === "true";
const DELETE_OLD_FILES_DAYS: number = parseInt(process.env.DELETE_OLD_FILES_DAYS || "0") || 365;
const ONE_DAY: number = 24 * 60 * 60000;
export const AUTH_PERMISSIONS_SCHEDULER: AuthPermissions = { authPermission: AuthPermission.Admin, token: "startTestSchedulerLoop", userId: "controller" };
export const TEST_HISTORY_FILENAME = "testhistory.json";

/** We need an interface we can store in s3 (encrypted) rather than a class so we can stringify */
export interface TestSchedulerItem {
  /** The calendar data returned to the clients */
  eventInput: EventInput;
  /** The data used to run the test */
  scheduledTestData: ScheduledTestData;
  /**
   * When is the next run of this. After each run we'll check for recurrence and delete or update the nextStart.
   * We can't use a Date because we need to be able to stringify this
   */
  nextStart: number;
  /** The userId who started the tests, only Admins or the original user can edit or delete */
  userId?: string | null;
}

// Utility functions. Exported for testing
export function getTestsToRun (scheduledTests: Map<string, TestSchedulerItem> | undefined): TestSchedulerItem[] {
  if (!scheduledTests || scheduledTests.size === 0) {
    return [];
  }
  return Array.from(scheduledTests.values()).filter((testItem: TestSchedulerItem) => testItem.nextStart <= Date.now());
}

const createHistoricalUrl = (testId: string) => `${PAGE_TEST_HISTORY}?testId=${testId}`;
const createEventUrl = (testId: string) => `${PAGE_START_TEST}?testId=${testId}&edit`;
const createHistoricalEvent = (testId: string, yamlFile: string, startTime: number, endTime: number, testStatus: TestStatus): EventInput => ({
  /** String or Integer. Will uniquely identify your event. Useful for getEventById. */
  id: testId,
  /** String. A URL that will be visited when this event is clicked by the user. For more information on controlling this behavior, see the eventClick callback. */
  url: createHistoricalUrl(testId),
  /** String. The text that will appear on an event. */
  title: yamlFile,
  color: testStatus === TestStatus.Failed ? "red" : (testStatus === TestStatus.Finished ? "green" : "purple"),
  start: startTime,
  end: endTime
});

/**
 * Finds the next start time greater than or equal to startTime and less than or equal to endTime where the
 * Date.getDay() is in the daysOfWeek array
 * @param startTime {number} datetime when to start
 * @param endTime {number} datetime to end by
 * @param daysOfWeek {number[]} array of days of the week (0-6) that are valid run days
 */
export function getNextStart (startTime: number, endTime: number, daysOfWeek: number[]): number | undefined {
  // Check if we're past the endtTime, the array is empty, or includes days outside of 0 - 6
  if (endTime < startTime || daysOfWeek.length === 0 || daysOfWeek.some((day: number) => day < 0 || day > 6)) {
    return undefined;
  }
  daysOfWeek.sort(); // Alphabetical sort is fine for single digits
  const startDate: Date = new Date(startTime);
  const startDay: number = startDate.getDay();
  log("startDay: " + startDay, LogLevel.DEBUG, { startDate, startTime, endTime });
  if (daysOfWeek.includes(startDay)) {
    return startTime;
  } else {
    // Find the next day. Might be next week
    const inXDays: number = (daysOfWeek.find((day: number) => day > startDay) || (daysOfWeek[0] + 7)) - startDay;
    log("inXDays: " + inXDays, LogLevel.DEBUG, { startDay, inXDays, daysOfWeek });
    // setDay increment will shift based on daylight savings. This fixes it
    const nextTime: number = startTime + (inXDays * ONE_DAY);
    log("nextTime: " + nextTime, LogLevel.DEBUG, { nextDate: new Date(nextTime), nextTime, endTime });
    return (nextTime > endTime) ? undefined : nextTime;
  }
}

// https://stackoverflow.com/questions/70260701/how-to-share-data-between-api-route-and-getserversideprops
declare global {
  // https://stackoverflow.com/questions/68481686/type-typeof-globalthis-has-no-index-signature
  // eslint-disable-next-line no-var
  var scheduledTests: Map<string, TestSchedulerItem> | undefined;
  // eslint-disable-next-line no-var
  var historicalTests: Map<string, EventInput> | undefined;
  // eslint-disable-next-line no-var
  var nextStart: number | undefined;
  // eslint-disable-next-line no-var
  var testSchedulerLoopRunning: boolean | undefined;
}

/**
 * TestScheduler handles all the scheduling, running, deleting and editing of Scheduled load tests
 * We use @fullcalender in the UI and it's @EventInput class to store the data. @EventInput has a
 * extendedProps field that will let us store our data in it. However, we need to be able to return
 * that data to the user and don't want to store passwords in it. Normal test posting will store all
 * the data in S3 we need.
 */
export class TestScheduler implements TestSchedulerItem {
  public eventInput: EventInput;
  public scheduledTestData: ScheduledTestData;
  public nextStart: number;
  public userId: string | null | undefined;
  protected static scheduledEncryptFile: PpaasEncryptS3File = new PpaasEncryptS3File({
    filename: ENCRYPTED_TEST_SCHEDULER_FILENAME,
    s3Folder: ENCRYPTED_TEST_SCHEDULER_FOLDERNAME,
    fileContents: ""
  });
  protected static historicalEncryptFile: PpaasEncryptS3File = new PpaasEncryptS3File({
    filename: TEST_HISTORY_FILENAME,
    s3Folder: ENCRYPTED_TEST_SCHEDULER_FOLDERNAME,
    fileContents: ""
  });

  protected constructor (scheduledTestData: ScheduledTestData, userId?: string | null) {
    if (!scheduledTestData.queueName || !scheduledTestData.testMessage || !scheduledTestData.scheduleDate) {
      throw new Error("scheduledTestData is missing queueName, testMessage, or scheduleDate");
    }
    if (scheduledTestData.scheduleDate < Date.now()) {
      throw new Error("scheduledTestData.scheduleDate is in the past");
    }
    this.scheduledTestData = scheduledTestData;
    this.nextStart = scheduledTestData.scheduleDate;
    this.userId = userId || scheduledTestData.testMessage.userId;
    /** Something date-parseable. When your event begins. */
    let start: number | undefined = scheduledTestData.scheduleDate;
    /** Something date-parseable. When your event ends. If omitted, your events will appear to have the default duration. */
    let end: number | undefined;
    // https://fullcalendar.io/docs/recurring-events
    // If any of these properties are specified, the event is assumed to be recurring and there is no need to specify the normal start and end properties.
    /** startRecur is the date when the recurring events start. if ommited continues into the past indefinitely */
    let startRecur: number | undefined;
    /** startRecur is the date when the recurring events end. if ommited continues into the future indefinitely */
    let endRecur: number | undefined;
    /** For recurring events, start is ignored and this is the time of day the event starts */
    let startTime: string | undefined;
    /** For recurring events, end is ignored and this is the time of day the event ends */
    let endTime: string | undefined;
    /** The days of the week this event repeats. An array of integers. Each integer represents a day-of-week,
     * with 0 signifying Sunday, 1 signifying Monday, etc. For example, [ 2, 4 ] means an event repeats every Tuesday and Thursday.
     */
    let daysOfWeek: number[] | undefined;
    const { testRunTimeMn }: TestMessage = scheduledTestData.testMessage;
    if (testRunTimeMn) {
      end = scheduledTestData.scheduleDate + (60000 * testRunTimeMn);
    }
    if (scheduledTestData.recurrence) {
      startRecur = scheduledTestData.scheduleDate;
      startTime = getHourMinuteFromTimestamp(scheduledTestData.scheduleDate);
      start = undefined;
      if (end) {
        endTime = getHourMinuteFromTimestamp(end);
        end = undefined;
      }
      const recurrence: ScheduledTestRecurrence = scheduledTestData.recurrence;
      // validate days of week
      if (!recurrence.endDate) {
        throw new Error("endDate cannot be empty");
      }
      // filter out duplicates and sort aphabetically (single digets sort fine) and make sure only 0-6
      daysOfWeek = recurrence.daysOfWeek = sortAndValidateDaysOfWeek(recurrence.daysOfWeek);
      // validate endRecur and nextStart
      endRecur = recurrence.endDate;
      const nextStart: number | undefined = getNextStart(scheduledTestData.scheduleDate, endRecur, daysOfWeek);
      if (nextStart === undefined) {
        throw new Error(`Invalid endDate ${new Date(recurrence.endDate)} and daysOfWeek ${daysOfWeek}`);
      }
      this.nextStart = nextStart; // Based on daysOfWeek it could be in the future
    }
    const eventInput: EventInput = {
      /** String or Integer. Will uniquely identify your event. Useful for getEventById. */
      id: scheduledTestData.testMessage.testId,
      /** String or Integer. Events that share a groupId will be dragged and resized together automatically. */
      groupId: scheduledTestData.recurrence ? scheduledTestData.testMessage.testId : undefined,
      /** String. A URL that will be visited when this event is clicked by the user. For more information on controlling this behavior, see the eventClick callback. */
      url: createEventUrl(scheduledTestData.testMessage.testId),
      /** String. The text that will appear on an event. */
      title: scheduledTestData.testMessage.yamlFile,
      start,
      end,
      startRecur,
      endRecur,
      startTime,
      endTime,
      daysOfWeek,
      testRunTimeMn
    };
    this.eventInput = eventInput;
  }

  /** Map of testIds to the TestSchedulerItem */
  // protected static scheduledTests: Map<string, TestSchedulerItem> | undefined;
  protected static get scheduledTests (): Map<string, TestSchedulerItem> | undefined {
    return global.scheduledTests;
  }

  protected static set scheduledTests (value: Map<string, TestSchedulerItem> | undefined) {
    global.scheduledTests = value;
  }
  // protected static historicalTests: Map<string, EventInput> | undefined;
  protected static get historicalTests (): Map<string, EventInput> | undefined {
    return global.historicalTests;
  }

  protected static set historicalTests (value: Map<string, EventInput> | undefined) {
    global.historicalTests = value;
  }
  /** nextStart out of all tests in scheduledTests */
  protected static get nextStart (): number | undefined {
    // protected static nextStart: number | undefined;
    return global.nextStart;
  }

  protected static set nextStart (value: number | undefined) {
    global.nextStart = value;
  }

  /**
   * Called internally when we have a recurring test that has at least one more run left.
   * @param testToRun
   * @param nextStart The next run that has been calculated
   */
  protected static async startNewTest (testToRun: TestSchedulerItem, nextStart: number): Promise<TestData | undefined> {
    // Use the saved userId if we have it
    const authPermissions: AuthPermissions = {
      ...AUTH_PERMISSIONS_SCHEDULER,
      userId: testToRun.userId || AUTH_PERMISSIONS_SCHEDULER.userId
    };
    const { queueName, testMessage, environmentVariables: environmentVariablesFile } = testToRun.scheduledTestData;
    const { testId, envVariables, restartOnFailure, version, bypassParser, yamlFile, additionalFiles } = testMessage;
    log("Test Scheduler Loop: startNewTest", LogLevel.INFO, { testId, authPermissions, queueName, version, yamlFile });
    let localPath: string | undefined;
    try {
      // If it's recurring and we have a nextStart, clone the directory and create a new testId to use
      // Or just call testManager with a previous testId which will clone it for us and start start the test
      const testIdTime: string = PpaasTestId.getDateString();
      localPath = await createTestFolder(testIdTime);
      const parsedForm: ParsedForm = {
        fields: {
          queueName,
          testId,
          yamlFile,
          environmentVariables: environmentVariablesFile ? JSON.stringify(environmentVariablesFile) : JSON.stringify(envVariables),
          version
        },
        files: {}
      };
      if (additionalFiles) {
        parsedForm.fields.additionalFiles = JSON.stringify(additionalFiles);
      }
      if (restartOnFailure) {
        parsedForm.fields.restartOnFailure = "true";
      }
      if (bypassParser) {
        parsedForm.fields.bypassParser = "true";
      }
      const result: ErrorResponse | TestDataResponse = await TestManager.postTest(parsedForm, authPermissions, localPath);
      if (result.status !== 200) {
        const errorResponse: TestManagerError  = result.json as TestManagerError;
        throw new Error(errorResponse.error || errorResponse.message);
      }
      const testData: TestData = result.json as TestData;
      // Update the next start
      testToRun.nextStart = nextStart;
      // Set the startRecur so we don't show the old value on the calendar
      testToRun.eventInput.startRecur = nextStart;
      // Update the scheduleDate so it will still show as delete-able
      testToRun.scheduledTestData.scheduleDate = nextStart;
      log("Test Scheduler Loop: New Load Test started", LogLevel.INFO, { queueName, testData, authPermissions, nextStart });
      log("Test Scheduler: Updated EventInput", LogLevel.DEBUG, testToRun.eventInput);
      // Just like add and remove, we need to call this so the calendar and scheduler get updated and saved
      TestScheduler.updateNextStart();
      TestScheduler.saveTestsToS3().catch(() => {/* noop logs itself */});
      return testData;
    } catch (error) {
      // Log an error, don't delete it
      log(`Could not send Recurring Scheduled Test ${testId} to the ${queueName} queue`, LogLevel.ERROR, error);
      return undefined;
    } finally {
      // Delete any and all of the temporary files and remove the directory
      await cleanupTestFolder(localPath);
    }
  }

  /**
   * Called internally when the test either isn't recurring or it's the last test in the series. We can use this testId as-is
   * @param testToRun
   */
  protected static async startExistingTest (testToRun: TestSchedulerItem): Promise<TestData | undefined> {
    // Use the saved userId if we have it
    const authPermissions: AuthPermissions = {
      ...AUTH_PERMISSIONS_SCHEDULER,
      userId: testToRun.userId || AUTH_PERMISSIONS_SCHEDULER.userId
    };
    const { queueName, testMessage } = testToRun.scheduledTestData;
    const { testId, testRunTimeMn } = testMessage;
    log("Test Scheduler Loop: startExistingTest", LogLevel.INFO, { testId, authPermissions, queueName });
    try {
      // Not recurring, or the last run for this set, use the same dir and message
      const testData: StoredTestData = await TestManager.sendTestToQueue(testMessage, queueName, PpaasTestId.getFromTestId(testId), testRunTimeMn, authPermissions);
      log ("Test Scheduler Loop: New Load Test started", LogLevel.INFO, { testMessage: { ...testMessage, envVariables: undefined }, queueName, testData, authPermissions });
      // It's not recurring or it's the last one, Delete it from the calendar if it's succesful
      await TestScheduler.removeTest(testId, authPermissions);
      return testData;
    } catch (error) {
      // Log an error, don't delete it
      log(`Could not send Scheduled Test ${testId} to the ${queueName} queue`, LogLevel.ERROR, error);
      return undefined;
    }
  }

  protected static async startScheduledItem (testToRun: TestSchedulerItem): Promise<TestData | undefined> {
    const { recurrence } = testToRun.scheduledTestData;
    try {
      // Get the next start if we have one
      const tomorrowStart: number = testToRun.nextStart + ONE_DAY;
      const nextStart: number | undefined = recurrence ? getNextStart(tomorrowStart, recurrence.endDate, recurrence.daysOfWeek) : undefined;
      // Check recurrence
      if (recurrence && nextStart) {
        // If it's recurring and we have a nextStart, clone the directory and create a new testId to use
        // Or just call testManager with a previous testId which will clone it for us and start start the test
        return await TestScheduler.startNewTest(testToRun, nextStart);
      } else {
        // Not recurring, or the last run for this set, use the same dir and message
        // If it's the last run of a recurring we need to add the tags to let it be cleaned up
        if (recurrence) {
          await PpaasS3File.getAllFilesInS3({ s3Folder: testToRun.scheduledTestData.testMessage.s3Folder, localDirectory })
          .then((s3Files) => Promise.all(s3Files.map((s3File) => {
            // Update the tags back to the default for a test to clean-up after bucket expiration
            const newTags = s3.defaultTestFileTags();
            log("startScheduledItem last run. Updating Test Tags", LogLevel.WARN, { currentTags: [...(s3File.tags || [])], newTags: [...newTags] });
            s3File.tags = newTags;
            return s3File.updateTags();
          }))).catch((error) => log(`startScheduledItem ${testToRun.scheduledTestData.testMessage.testId} last run could not update tags for files. Please clean-up tags manually`, LogLevel.ERROR, error));
        }
        return await TestScheduler.startExistingTest(testToRun);
      }
    } catch (error) {
      // Log an error, don't delete it
      log(`Could not send Scheduled Test ${testToRun.scheduledTestData.testMessage.testId} to the ${testToRun.scheduledTestData.queueName} queue`, LogLevel.ERROR, error);
      return undefined;
    }
  }

  // Used to only start the loop if it's not running yet.
  // protected static running: boolean = false;
  public static startTestSchedulerLoop (): boolean {
    if (global.testSchedulerLoopRunning) {
      return global.testSchedulerLoopRunning;
    }
    global.testSchedulerLoopRunning = true;
    log("Starting Test Scheduler Loop", LogLevel.INFO);
    if (RUN_HISTORICAL_SEARCH) {
      TestScheduler.runHistoricalSearch().catch(() => { /* already logs error, swallow */ });
    }
    if (RUN_HISTORICAL_DELETE) {
      // Start background task to delete old files
      (async () => {
        // Don't start right away, delay to sometime within today
        let nextLoop: number = Date.now() + (IS_RUNNING_IN_AWS ? Math.floor(Math.random() * ONE_DAY) : 0);
        if (nextLoop > Date.now()) {
          const delay = nextLoop - Date.now();
          log("Delete Historical Loop: nextLoop: " + new Date(nextLoop), LogLevel.DEBUG, { delay, nextLoop });
          await sleep(delay);
        }
        while (global.testSchedulerLoopRunning) {
          const loopStart = Date.now();
          try {
            await TestScheduler.runHistoricalDelete();
          } catch (error) {
            log("Delete Historical Loop: Error running runHistoricalDelete", LogLevel.ERROR, error);
          }
          // If Date.now() is exactly the same time we need to check the next one
          nextLoop += ONE_DAY;
          const delay = nextLoop - Date.now();
          log("Delete Historical Loop: nextLoop: " + new Date(nextLoop), LogLevel.DEBUG, { loopStart, delay, nextLoop });
          if (delay > 0) {
            await sleep(delay);
          }
        }
        // We'll only reach here if we got some kind of sigterm message or an unhandled exception. Shut down this loop so we can be restarted or replaced
        log("Shutting Down Delete Historical Loop.", LogLevel.INFO);
      })().catch((err) => {
        log("Error during Delete Historical Loop", LogLevel.ERROR, err);
      });
    }
    (async () => {
      // We'll never set this to false unless something really bad happens
      while (global.testSchedulerLoopRunning) {
        const loopStart = Date.now();
        try {
          await TestScheduler.loadTestsFromS3();
          // Check if tests to run
          if (TestScheduler.nextStart && Date.now() >= TestScheduler.nextStart) {
            // We have tests to run
            const testsToRun: TestSchedulerItem[] = getTestsToRun(TestScheduler.scheduledTests);
            log("Test Scheduler Loop: testsToRun " + testsToRun.length, LogLevel.INFO, testsToRun
            .map((item) => ({
              userId: item.userId,
              testId: item.scheduledTestData.testMessage.testId,
              nextStart: new Date(item.nextStart).toISOString(),
              scheduleDate: item.scheduledTestData.scheduleDate
            })));
            for (const testToRun of testsToRun) {
              await TestScheduler.startScheduledItem(testToRun);
            }
            // Update the next run
            TestScheduler.updateNextStart();
          } else {
            log("Test Scheduler Loop: nextStart not yet: " + TestScheduler.nextStart, LogLevel.DEBUG, { nextStart: TestScheduler.nextStart });
          }
        } catch (error) {
          log("Test Scheduler Loop: Error running loop", LogLevel.ERROR, error);
        }
        // If Date.now() is exactly the same time we need to check the next one
        const nextPollTime = loopStart + TEST_SCHEDULER_POLL_INTERVAL_MS;
        const nextStartTime = TestScheduler.nextStart || Number.MAX_VALUE;
        const delay = Math.min(nextPollTime - Date.now(), nextStartTime - Date.now(), TEST_SCHEDULER_POLL_INTERVAL_MS);
        log(
          "Test Scheduler Loop: nextPollTime: " + new Date(nextPollTime),
          LogLevel.DEBUG,
          { loopStart, nextPollTime, nextStartTime, delay, TEST_SCHEDULER_POLL_INTERVAL_MS }
        );
        if (delay > 0) {
          await sleep(delay);
        }
      }
      // We'll only reach here if we got some kind of sigterm message or an unhandled exception. Shut down this loop so we can be restarted or replaced
      log("Shutting Down Test Scheduler Loop.", LogLevel.INFO);
      global.testSchedulerLoopRunning = false;
    })().catch((err) => {
      log("Error during Test Scheduler Loop", LogLevel.FATAL, err);
      global.testSchedulerLoopRunning = false;
    });
    return global.testSchedulerLoopRunning;
  }

  protected static async loadTestsFromS3 (force?: boolean): Promise<void> {
    log("TestScheduler: loadTestsFromS3", LogLevel.DEBUG, {
      thisScheduledTests: (TestScheduler.scheduledTests !== undefined)
    });
    if (TestScheduler.scheduledTests !== undefined) {
      return;
    }
    // Load from S3
    try {
      const exists: boolean = await this.scheduledEncryptFile.existsInS3();
      if (exists) {
        const fileContents: string | undefined = (await this.scheduledEncryptFile.download(force)).getFileContents();
        // Debug only since it might have passwords
        log("TestScheduler: loadTestsFromS3 fileContents", LogLevel.DEBUG, fileContents);
        if (fileContents) {
          const json = JSON.parse(fileContents);
          log("TestScheduler: loadTestsFromS3 json", LogLevel.DEBUG, json);
          TestScheduler.scheduledTests = new Map<string, TestSchedulerItem>(json);
          log("TestScheduler: loadTestsFromS3 scheduledTests.size: " + TestScheduler.scheduledTests.size, LogLevel.INFO, {
            testIds: Array.from(TestScheduler.scheduledTests.keys())
          });
        } else {
          TestScheduler.scheduledTests = new Map<string, TestSchedulerItem>();
        }
      } else {
        TestScheduler.scheduledTests = new Map<string, TestSchedulerItem>();
      }
      TestScheduler.updateNextStart();
    } catch (error) {
      log(`Could not load /${ENCRYPTED_TEST_SCHEDULER_FOLDERNAME}/${ENCRYPTED_TEST_SCHEDULER_FILENAME} from s3`, LogLevel.ERROR, error);
      throw error;
    }
  }

  protected static async saveTestsToS3 (force?: boolean): Promise<void> {
    log("TestScheduler: saveTestsToS3", LogLevel.DEBUG, {
      thisScheduledTests: (TestScheduler.scheduledTests !== undefined)
    });
    if (TestScheduler.scheduledTests === undefined) {
      // Load it or get the global
      await this.loadTestsFromS3();
      // Make typescript happy
      if (TestScheduler.scheduledTests === undefined) {
        return;
      }
    }
    try {
      const jsonText = JSON.stringify(Array.from(TestScheduler.scheduledTests.entries()));
      log("saveTestsToS3", LogLevel.DEBUG, { force, contentsChanged: jsonText !== this.scheduledEncryptFile.getFileContents() });
      if (force || jsonText !== this.scheduledEncryptFile.getFileContents()) {
        this.scheduledEncryptFile.setFileContents(jsonText);
        await this.scheduledEncryptFile.upload(force, true);
      }
    } catch (error) {
      log(`Could not save /${ENCRYPTED_TEST_SCHEDULER_FOLDERNAME}/${ENCRYPTED_TEST_SCHEDULER_FILENAME} to s3`, LogLevel.ERROR, error);
      throw error;
    }
  }

  /**
   * Parses through all scheduled tests and finds the next one to run
   */
  protected static updateNextStart () {
    const nextStartBefore = TestScheduler.nextStart;
    // Reset back to undefined in case we're in a bad state
    TestScheduler.nextStart = undefined;
    if (TestScheduler.scheduledTests && TestScheduler.scheduledTests.size > 0) {
      log("updateNextStart before", LogLevel.DEBUG, { nextStart: nextStartBefore });
      TestScheduler.scheduledTests.forEach((testItem: TestSchedulerItem) => {
        TestScheduler.nextStart = TestScheduler.nextStart ? Math.min(TestScheduler.nextStart, testItem.nextStart) : testItem.nextStart;
        log("updateNextStart forEach", LogLevel.DEBUG, { nextStart: TestScheduler.nextStart, itemNextStart: testItem.nextStart });
      });
      log("updateNextStart", LogLevel.DEBUG, { nextStart: TestScheduler.nextStart, nextStartBefore });
    }
  }

  public static async isAuthorizedForTest (testId: string, authPermissions: AuthPermissions): Promise<ErrorResponse | undefined> {
    await TestScheduler.loadTestsFromS3();
    if (TestScheduler.scheduledTests!.has(testId)) {
      const scheduledTest: TestSchedulerItem = TestScheduler.scheduledTests!.get(testId)!;
      return TestScheduler.checkScheduleTestPermissions(scheduledTest, authPermissions);
    }
    return undefined;
  }

  protected static checkScheduleTestPermissions (scheduledTest: TestSchedulerItem, authPermissions: AuthPermissions): ErrorResponse | undefined {

    if (authPermissions.authPermission !== AuthPermission.Admin && scheduledTest.userId !== authPermissions.userId) {
      const testId: string = scheduledTest.scheduledTestData.testMessage.testId;
      log(`Unauthorized modify request for testId ${testId} by userId ${authPermissions.userId}`, LogLevel.WARN, getLogAuthPermissions(authPermissions));
      return {
        json: { message: `Only the original user can modify ${testId}` },
        status: 403
      };
    }
    return undefined;
  }

  /**
   * Adds a new test to the schedule and creates a @fullcalendar event.
   * @param newTest ScheduledTestData to add to the schedule
   * @param authPermissions AuthPermissions to set the owner
   */
  public static async addTest (newTest: ScheduledTestData, authPermissions: AuthPermissions): Promise<ErrorResponse | TestDataResponse> {
    try {
      await TestScheduler.loadTestsFromS3();
      const { queueName, scheduleDate, testMessage }: ScheduledTestData = newTest;
      let testScheduler: TestScheduler;
      try {
        testScheduler = new TestScheduler(newTest, authPermissions.userId);
      } catch (error) {
        log(`TestScheduler: Could not addTest ${newTest?.testMessage?.testId} to the schedule`, LogLevel.WARN, error, getLogAuthPermissions(authPermissions));
        return {
          json: {
            message: `Could not addTest ${newTest?.testMessage?.testId} to the schedule`,
            error: formatError(error)
          },
          status: 400
        };
      }
      const { testId, s3Folder, testRunTimeMn, version, userId }: TestMessage = testMessage;
      const ppaasTestId = PpaasTestId.getFromTestId(testId);

      // Create a dummy results file so we can get the remoteFileLocation
      const resultsFile: PpaasS3File = new PpaasS3File({
        filename: util.createStatsFileName(testId),
        s3Folder,
        localDirectory
      });
      const startTime: number = scheduleDate;
      const endTime: number = (startTime + (60000 * (testRunTimeMn ? testRunTimeMn : 60)) + 600000); // Add extra 10 minutes (for now)
      const ppaasTestStatus = new PpaasTestStatus(
        ppaasTestId, {
          startTime,
          endTime,
          resultsFilename: [resultsFile.filename],
          status: TestStatus.Scheduled,
          queueName,
          version,
          userId: authPermissions.userId || userId || undefined
        }
      );
      if (newTest.recurrence) {
        ppaasTestStatus.tags = defaultRecurringFileTags();
      }
      const statusUrl = await ppaasTestStatus.writeStatus();
      log(`PpaasTestStatus url: ${statusUrl}`, LogLevel.DEBUG, { statusUrl });
      // Check if the testId already exists. If so, only admin or the original user can update it.
      if (TestScheduler.scheduledTests!.has(testId)) {
        const scheduledTest: TestSchedulerItem = TestScheduler.scheduledTests!.get(testId)!;
        const permissionsError: ErrorResponse | undefined = TestScheduler.checkScheduleTestPermissions(scheduledTest, authPermissions);
        if (permissionsError) {
          return permissionsError;
        }
        log("Updating Scheduled Test", LogLevel.DEBUG, { scheduledTest, authPermissions: getLogAuthPermissions(authPermissions) });
      }

      TestScheduler.scheduledTests!.set(testMessage.testId, testScheduler);
      TestScheduler.updateNextStart();
      log ("New Load Test scheduled", LogLevel.INFO, {
        scheduleDate: new Date(scheduleDate).toLocaleString(),
        now: new Date().toLocaleString(),
        testMessage: { ...testMessage, envVariables: undefined },
        queueName,
        ppaasTestStatus: ppaasTestStatus.sanitizedCopy(),
        statusUrl,
        authPermissions: getLogAuthPermissions(authPermissions),
        scheduledTests: TestScheduler.scheduledTests?.size,
        scheduleDateTs: scheduleDate,
        nextStart: TestScheduler.nextStart
      });
      await TestScheduler.saveTestsToS3().catch(() => {/* noop logs itself */});
      const testData: TestData = { testId, s3Folder, status: TestStatus.Scheduled, startTime, endTime, userId };
      return { json: testData, status: 200 };
    } catch (error) {
      log(`TestScheduler: Could not addTest ${newTest?.testMessage?.testId} to the schedule`, LogLevel.WARN, error);
      throw error;
    }
  }

  /**
   * Removes a scheduled test from running
   * @param testId testId to be removed
   * @param authPermissions permissions for the request
   */
  public static async removeTest (testId: string, authPermissions: AuthPermissions, deleteS3Files?: boolean): Promise<ErrorResponse> {
    await TestScheduler.loadTestsFromS3();
    await TestScheduler.loadHistoricalFromS3();
    if (!TestScheduler.scheduledTests!.has(testId) && !TestScheduler.historicalTests!.has(testId)) {
      log(`testId ${testId} not found for delete by userId ${authPermissions.userId}`, LogLevel.WARN, getLogAuthPermissions(authPermissions));
      return {
        json: { message: `${testId} not found in the scheduled tests` },
        status: 404
      };
    }
    let s3Folder: string;
    try {
      s3Folder = PpaasTestId.getFromTestId(testId).s3Folder;
    } catch (error) {
      log("Could not parse testId " + testId, LogLevel.WARN, error);
      return { json: { message: "Could not parse testId " + testId, error: formatError(error) }, status: 400 };
    }
    if (TestScheduler.scheduledTests!.has(testId)) {
      const scheduledTest: TestSchedulerItem = TestScheduler.scheduledTests!.get(testId)!;
      const permissionsError: ErrorResponse | undefined = TestScheduler.checkScheduleTestPermissions(scheduledTest, authPermissions);
      if (permissionsError) {
        return permissionsError;
      }
      log("Removing Scheduled Test", LogLevel.DEBUG, { scheduledTest, authPermissions: getLogAuthPermissions(authPermissions) });
      TestScheduler.scheduledTests!.delete(testId);
      log(`Scheduled Load Test removed testId ${testId} by userId ${authPermissions.userId}`, LogLevel.INFO, { ...getLogAuthPermissions(authPermissions), testId });
      TestScheduler.updateNextStart();
      if (deleteS3Files) {
        // Delete schedule needs to delete the files in S3 too.
        await s3.listFiles({ s3Folder }).then((s3Files) =>
          Promise.allSettled(
            s3Files.filter((s3File) => s3File.Key)
            .map((s3File) => s3.deleteObject(s3File.Key!)
              .then(() => log(`removeTest ${testId} deleted ${s3File.Key}`, LogLevel.INFO, { s3Folder }))
              .catch((error) => log(`removeTest ${testId} failed to delete s3 file ${s3File.Key}`, LogLevel.WARN, error, { s3Folder, s3File }))
            )
          )
        ).catch((error) => log(`removeTest ${testId} failed to find s3 files`, LogLevel.ERROR, error));
      }
      await TestScheduler.saveTestsToS3().catch(() => {/* noop logs itself */});
      try {
        if (deleteS3Files) {
          // Delete schedule needs to delete the files in S3 too.
          await s3.listFiles({ s3Folder }).then(async (s3Files) => {
            const results = await Promise.allSettled(
              s3Files.filter((s3File) => s3File.Key)
              .map((s3File) => s3.deleteObject(s3File.Key!)
                .then(() => log(`removeTest ${testId} deleted ${s3File.Key}`, LogLevel.INFO, { s3Folder }))
                .catch((error) => log(`removeTest ${testId} failed to delete s3 file ${s3File.Key}`, LogLevel.ERROR, error, { s3Folder, s3File }))
              )
            );
            const failure = results.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
            if (failure) {
              throw failure.reason;
            }
          }
          ).catch((error) => {
            log(`removeTest ${testId} failed to find s3 files`, LogLevel.ERROR, error);
            throw error;
          });
        }
      } catch (error) {
        return {
          json: {
            message: `Removed TestId ${testId} Failed`,
            error: `${error}`
          },
          status: 500
        };
      }
    } else {
      if (authPermissions.authPermission !== AuthPermission.Admin) {
        log(`Unauthorized modify request for testId ${testId} by userId ${authPermissions.userId}`, LogLevel.WARN, getLogAuthPermissions(authPermissions));
        return {
          json: { message: `Only an admin can delete ${testId}` },
          status: 403
        };
      }
      log("Removing Historical Test", LogLevel.DEBUG, { testId, authPermissions });
      TestScheduler.historicalTests!.delete(testId);
      log(`Historical Load Test removed testId ${testId} by userId ${authPermissions.userId}`, LogLevel.INFO, { ...getLogAuthPermissions(authPermissions), testId });
      await TestScheduler.saveHistoricalToS3().catch(() => {/* noop logs itself */});
    }
    return {
      json: { message: `Removed TestId ${testId}` },
      status: 200
    };
  }

  /**
   * Creates a @fullcalendar event and adds it to the historical calendar.
   * @param testId {string}
   * @param yamlFile {string}
   * @param startTime {number}
   * @param endTime {number}
   */
  public static async addHistoricalTest (testId: string, yamlFile: string | undefined, startTime: number, endTime: number, testStatus: TestStatus): Promise<void> {
    try {
      if (yamlFile === undefined) {
        yamlFile = PpaasTestId.getFromTestId(testId).yamlFile;
      }
      await TestScheduler.loadHistoricalFromS3();
      const event: EventInput = createHistoricalEvent(testId, yamlFile, startTime, endTime, testStatus);
      const logLevel: LogLevel = !TestScheduler.historicalTests!.has(testId)
        || testStatus === TestStatus.Finished || testStatus === TestStatus.Failed
        ? LogLevel.INFO
        : LogLevel.DEBUG;
      log(`TestScheduler: Add Historical Test ${testId} to the schedule`, logLevel, event);
      TestScheduler.historicalTests!.set(testId, event);
      await TestScheduler.saveHistoricalToS3().catch(() => {/* noop logs itself */});
    } catch (error) {
      log(`TestScheduler: Could not addHistoricalTest ${testId} to the schedule`, LogLevel.ERROR, error);
      throw error;
    }
  }

  /** Returns all the Events to load into a @fullcalendar in the client */
  public static async getCalendarEvents (): Promise<EventInput[]> {
    await TestScheduler.loadTestsFromS3();
    await TestScheduler.loadHistoricalFromS3();
    const scheduledItems = Array.from((TestScheduler.scheduledTests || new Map<string, TestSchedulerItem>()).values())
    .map((testSchedulerItem: TestSchedulerItem) => {
      if (!testSchedulerItem.eventInput.url && testSchedulerItem.eventInput.id && typeof testSchedulerItem.eventInput.id === "string") {
        testSchedulerItem.eventInput.url = createEventUrl(testSchedulerItem.eventInput.id);
      }
      return testSchedulerItem.eventInput;
    });
    // TODO: Do we need to filter the historical to just recent ones? or clear them after 6 months?
    const historicalItems = Array.from(TestScheduler.historicalTests!.values());
    log("getCalendarEvents", LogLevel.DEBUG, {
      scheduledTests: TestScheduler.scheduledTests?.size,
      scheduledItems: scheduledItems.length,
      historicalTests: TestScheduler.historicalTests?.size,
      historicalItems: historicalItems.length
    });
    return [...scheduledItems, ...historicalItems];
  }

  /**
   * Gets the item if it's in the list or returns undefined
   * @param testId TestId to find
   */
  public static async getTestData (testId: string): Promise<ScheduledTestData | undefined> {
    await TestScheduler.loadTestsFromS3();
    const item: TestSchedulerItem | undefined = (TestScheduler.scheduledTests || new Map<string, TestSchedulerItem>()).get(testId);
    return item ? item.scheduledTestData : undefined;
  }

  /**
   * Returns all the testIds using the giving pewpewVersion
   * @param pewpewVersion string version of pewpew
   * @returns testIds using the version or undefined
   */
  public static async getTestIdsForPewPewVersion (pewpewVersion: string): Promise<string[] | undefined> {
    await TestScheduler.loadTestsFromS3();
    const testIds: string[] = Array.from((TestScheduler.scheduledTests || new Map<string, TestSchedulerItem>()).values())

    .filter((scheduledItem: TestSchedulerItem) => scheduledItem.scheduledTestData.testMessage.version === pewpewVersion)
    .map((scheduledItem: TestSchedulerItem) => scheduledItem.scheduledTestData.testMessage.testId);
    return testIds.length > 0 ? testIds : undefined;
  }

  protected static async runHistoricalSearch (): Promise<void> {
    try {
      // Load existing ones
      await TestScheduler.loadHistoricalFromS3();
      log("Starting Test Historical Search", LogLevel.INFO, { sizeBefore: TestScheduler.historicalTests!.size });
      // Create an ignore list
      const ignoreList: string[] = Array.from((TestScheduler.historicalTests || new Map<string, EventInput>()).keys());
      // Get X files, and parse them
      let foundStatusPromises: Promise<PpaasTestStatus | undefined>[] | undefined = await PpaasTestStatus.getAllStatus("", HISTORICAL_SEARCH_MAX_FILES, ignoreList);
      let iteration: number = 0;
      let parsedCount: number = 0;
      while (foundStatusPromises && foundStatusPromises.length > 0) {
        log("foundStatus iteration " + iteration++, LogLevel.DEBUG, { length: foundStatusPromises.length });
        const parsedPromises: Promise<void>[] = [];
        for (const foundStatusPromise of foundStatusPromises) {
          parsedPromises.push(foundStatusPromise.then(async (ppaasTestStatus: PpaasTestStatus | undefined) => {
            if (ppaasTestStatus === undefined) {
              log("ppaasTestStatus === undefined", LogLevel.DEBUG);
              return;
            }
            const testId: string = ppaasTestStatus.getTestId();
            if (ppaasTestStatus.status === TestStatus.Failed || ppaasTestStatus.status === TestStatus.Finished) {
              const yamlFile = PpaasTestId.getFromTestId(testId).yamlFile;
              const eventInput: EventInput = createHistoricalEvent(testId, yamlFile, ppaasTestStatus.startTime, ppaasTestStatus.endTime, ppaasTestStatus.status);
              log("Found Historical Test " + testId, LogLevel.INFO, eventInput);
              TestScheduler.historicalTests!.set(testId, eventInput);
            } else {
              log("Found Non Historical Test " + testId, LogLevel.DEBUG, ppaasTestStatus.sanitizedCopy());
            }
            // Ignore this one regardless on next loop
            ignoreList.push(testId);
            if (++parsedCount > 50) {
              parsedCount = 0; // Save to s3 every 50
              await TestScheduler.saveHistoricalToS3().catch(() => { /* noop, this already logs */ });
            }
          }).catch((error) => log("runHistoricalSearch: Error retrieving ppaas test status", LogLevel.ERROR, error)));
        }
        await Promise.all(parsedPromises);
        // After each batch of X, save them
        await TestScheduler.saveHistoricalToS3();
        // Get a new set of statuses (retrying failed ones since they weren't ignored)
        foundStatusPromises = await PpaasTestStatus.getAllStatus("", HISTORICAL_SEARCH_MAX_FILES, ignoreList);
      } // End loop
      log("foundStatus iterations " + iteration, LogLevel.DEBUG, { foundStatusPromises: JSON.stringify(foundStatusPromises) });
      log("Finished Test Historical Search", LogLevel.INFO, { sizeAfter: TestScheduler.historicalTests!.size });
    } catch (error) {
      log("Error running historical search", LogLevel.ERROR, error);
      throw error; // Throw for testing, but the loop will catch and noop
    }
  }

  protected static async runHistoricalDelete (deleteOldFilesDays: number = DELETE_OLD_FILES_DAYS): Promise<number> {
    let deletedCount: number = 0;
    try {
      // Load existing ones
      await TestScheduler.loadHistoricalFromS3();
      const oldDatetime: number = Date.now() - (deleteOldFilesDays * ONE_DAY);
      const sizeBefore = TestScheduler.historicalTests!.size;
      log("Starting Test Historical Delete", LogLevel.INFO, { sizeBefore, oldDatetime: new Date(oldDatetime), oldDatetimeTs: oldDatetime, deleteOldFilesDays });

      // Delete old ones off the historical Calendar. These will be cleaned up in S3 by Bucket Expiration Policy
      for (const [testId, eventInput] of TestScheduler.historicalTests!) {
        if ((typeof eventInput.end === "number" && eventInput.end < oldDatetime)
          || (eventInput.end instanceof Date && (eventInput as Date).getTime() < oldDatetime)) {
          log("Deleting Historical Test " + testId, LogLevel.INFO, eventInput);
          // Delete
          TestScheduler.historicalTests!.delete(testId);
          deletedCount++;
        }
      }
      await TestScheduler.saveHistoricalToS3();
      log("Finished Test Historical Delete", LogLevel.INFO, { deletedCount, sizeBefore, sizeAfter: TestScheduler.historicalTests!.size });
      return deletedCount;
    } catch (error) {
      log("Error running Historical Delete", LogLevel.ERROR, error, { deletedCount });
      throw error; // Throw for testing, but the loop will catch and noop
    }
  }

  protected static async loadHistoricalFromS3 (force?: boolean): Promise<void> {
    log("TestScheduler: loadHistoricalFromS3", LogLevel.DEBUG, {
      thisScheduledTests: (TestScheduler.historicalTests !== undefined)
    });
    if (TestScheduler.historicalTests !== undefined) {
      return;
    }
    // Load from S3
    try {
      const exists: boolean = await this.historicalEncryptFile.existsInS3();
      if (exists) {
        const fileContents: string | undefined = (await this.historicalEncryptFile.download(force)).getFileContents();
        // Debug only since it might have passwords
        log("TestScheduler: loadTestsFromS3 fileContents", LogLevel.DEBUG, fileContents);
        if (fileContents) {
          const json = JSON.parse(fileContents);
          log("TestScheduler: loadTestsFromS3 json", LogLevel.DEBUG, json);
          TestScheduler.historicalTests = new Map<string, TestSchedulerItem>(json);
          log("TestScheduler: loadTestsFromS3 historicalTests.size: " + TestScheduler.historicalTests.size, LogLevel.INFO, {
            testIds: Array.from(TestScheduler.historicalTests.keys())
          });
        } else {
          TestScheduler.historicalTests = new Map<string, TestSchedulerItem>();
        }
      } else {
        TestScheduler.historicalTests = new Map<string, TestSchedulerItem>();
      }
    } catch (error) {
      log(`Could not load /${ENCRYPTED_TEST_SCHEDULER_FOLDERNAME}/${TEST_HISTORY_FILENAME} from s3`, LogLevel.ERROR, error);
      throw error;
    }
  }

  protected static async saveHistoricalToS3 (force?: boolean): Promise<void> {
    log("TestScheduler: saveHistoricalToS3", LogLevel.DEBUG, {
      thisHistoricalTests: (TestScheduler.historicalTests !== undefined)
    });
    if (TestScheduler.historicalTests === undefined) {
      // Load it or get the global
      await this.loadHistoricalFromS3();
      // Make typescript happy
      if (TestScheduler.historicalTests === undefined) {
        return;
      }
    }
    try {
      const jsonText = JSON.stringify(Array.from(TestScheduler.historicalTests.entries()));
      log("saveHistoricalToS3", LogLevel.DEBUG, { force, contentsChanged: jsonText !== this.historicalEncryptFile.getFileContents() });
      if (force || jsonText !== this.historicalEncryptFile.getFileContents()) {
        this.historicalEncryptFile.setFileContents(jsonText);
        await this.historicalEncryptFile.upload(force, true);
      }
    } catch (error) {
      log(`Could not save /${ENCRYPTED_TEST_SCHEDULER_FOLDERNAME}/${TEST_HISTORY_FILENAME} to s3`, LogLevel.ERROR, error);
      throw error;
    }
  }
}

export default TestScheduler;
