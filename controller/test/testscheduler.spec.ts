/* eslint-disable max-classes-per-file */
import {
  AuthPermission,
  AuthPermissions,
  ErrorResponse,
  ScheduledTestData,
  ScheduledTestRecurrence,
  TestData,
  TestDataResponse,
  TestManagerError
} from "../types";
import {
  LogLevel,
  PpaasTestId,
  PpaasTestStatus,
  TestMessage,
  TestStatus,
  log,
  logger,
  util
} from "@fs/ppaas-common";
import {
  TestScheduler,
  TestSchedulerItem,
  getNextStart,
  getTestsToRun
} from "../pages/api/util/testscheduler";
import { getHourMinuteFromTimestamp, latestPewPewVersion } from "../pages/api/util/clientutil";
import { EventInput } from "@fullcalendar/core";
import { expect } from "chai";

logger.config.LogFileName = "ppaas-controller";

// Re-create these here so we don't have to run yamlparser.spec by importing it
const BASIC_YAML_FILE: string = "basic.yaml";
const BASIC_FILEPATH_NOT_YAML = "text.txt";
const BASIC_FILEPATH_NOT_YAML2 = "text2.txt";

export class TestSchedulerIntegration extends TestScheduler {
  protected static loadTestsFromS3Original: (() => Promise<void>) | undefined;
  protected static saveTestsToS3Original: (() => Promise<void>) | undefined;
  protected static loadHistoricalFromS3Original: (() => Promise<void>) | undefined;
  protected static saveHistoricalToS3Original: (() => Promise<void>) | undefined;
  public constructor (scheduledTestData: ScheduledTestData, userId?: string | null) {
    super(scheduledTestData, userId);
  }

  // MOCK: Static constructor to mock the base class to not access s3
  public static mockFunctions () {
    if (TestSchedulerIntegration.loadTestsFromS3Original === undefined) {
      TestSchedulerIntegration.loadTestsFromS3Original = TestScheduler.loadTestsFromS3;
    }
    if (TestSchedulerIntegration.saveTestsToS3Original === undefined) {
      TestSchedulerIntegration.saveTestsToS3Original = TestScheduler.saveTestsToS3;
    }
    // eslint-disable-next-line require-await
    TestScheduler.loadTestsFromS3 = async () => {
      // console.log("override loadTestsFromS3 called");
      if (TestScheduler.scheduledTests !== undefined) {
        return;
      }
      // console.log("TestSchedulerIntegration.scheduledTests initialized");
      TestScheduler.scheduledTests = new Map<string, TestSchedulerItem>();
    };
    TestScheduler.saveTestsToS3 = async () => {
      // console.log("override saveTestsToS3 called");
    };
    if (TestSchedulerIntegration.loadHistoricalFromS3Original === undefined) {
      TestSchedulerIntegration.loadHistoricalFromS3Original = TestScheduler.loadHistoricalFromS3;
    }
    if (TestSchedulerIntegration.saveHistoricalToS3Original === undefined) {
      TestSchedulerIntegration.saveHistoricalToS3Original = TestScheduler.saveHistoricalToS3;
    }
    // eslint-disable-next-line require-await
    TestScheduler.loadHistoricalFromS3 = async () => {
      // console.log("override loadHistoricalFromS3 called");
      if (TestScheduler.historicalTests !== undefined) {
        return;
      }
      // eslint-disable-next-line no-console
      console.log("TestSchedulerIntegration.historicalTests initialized");
      TestScheduler.historicalTests = new Map<string, EventInput>();
    };
    TestScheduler.saveHistoricalToS3 = async () => {
      // console.log("override saveHistoricalToS3 called");
    };
  }

  // MOCK: Fix the Mock functions in case we need to run integration too
  public static restoreFunctions () {
    if (TestSchedulerIntegration.loadTestsFromS3Original !== undefined) {
      TestScheduler.loadTestsFromS3 = TestSchedulerIntegration.loadTestsFromS3Original;
      TestScheduler.scheduledTests = undefined;
    }
    if (TestSchedulerIntegration.saveTestsToS3Original !== undefined) {
      TestScheduler.saveTestsToS3 = TestSchedulerIntegration.saveTestsToS3Original;
    }
    if (TestSchedulerIntegration.loadHistoricalFromS3Original !== undefined) {
      TestScheduler.loadHistoricalFromS3 = TestSchedulerIntegration.loadHistoricalFromS3Original;
      TestScheduler.historicalTests = undefined;
    }
    if (TestSchedulerIntegration.saveHistoricalToS3Original !== undefined) {
      TestScheduler.saveHistoricalToS3 = TestSchedulerIntegration.saveHistoricalToS3Original;
    }
  }

  public static getScheduledTests (): Map<string, TestSchedulerItem> {
    TestScheduler.loadTestsFromS3();
    return TestScheduler.scheduledTests!;
  }

  public static setScheduledTests (value: Map<string, TestSchedulerItem> | undefined) {
    return TestScheduler.scheduledTests = value;
  }

  public static getHistoricalTests (): Map<string, EventInput> {
    TestScheduler.loadHistoricalFromS3();
    return TestScheduler.historicalTests!;
  }

  public static setHistoricalTests (value: Map<string, EventInput> | undefined) {
    TestScheduler.historicalTests = value;
  }

  // public so we can call our Overload so we don't hit s3
  public static async loadTestsFromS3 (): Promise<void> {
    await TestScheduler.loadTestsFromS3();
  }

  /** public so we can call it for testing */
  public static updateNextStart () {
    return TestScheduler.updateNextStart();
  }

  /** public so we can check the value after calling updateNextStart */
  public static getNextStart () {
    return TestScheduler.nextStart;
  }

  /** public so we can set the value before calling updateNextStart */
  public static setNextStart (nextStart: number | undefined) {
    TestScheduler.nextStart = nextStart;
  }

  /** public so we can call it for testing */
  public static runHistoricalDelete (deleteOldFilesDays?: number) {
    return TestScheduler.runHistoricalDelete(deleteOldFilesDays);
  }
}

class PpaasTestStatusIntegration extends PpaasTestStatus {
  protected static writeStatusOriginal: (() => Promise<string>) | undefined;

  // MOCK: Static to mock the base class to not access s3
  public static mockFunctions () {
    if (PpaasTestStatusIntegration.writeStatusOriginal === undefined) {
      PpaasTestStatusIntegration.writeStatusOriginal = PpaasTestStatus.prototype.writeStatus;
    }
    // eslint-disable-next-line require-await
    PpaasTestStatus.prototype.writeStatus = async () => {
      // eslint-disable-next-line no-console
      console.log("PpaasTestStatus.writeStatus called");
      return  "";
    };
  }

  // MOCK: Fix the Mock functions in case we need to run integration too
  public static restoreFunctions () {
    if (PpaasTestStatusIntegration.writeStatusOriginal !== undefined) {
      PpaasTestStatus.prototype.writeStatus = PpaasTestStatusIntegration.writeStatusOriginal;
    }
  }

}

const authUser1: AuthPermissions = {
  authPermission: AuthPermission.User,
  token: "user1token",
  userId: "user1"
};
const authUser2: AuthPermissions = {
  authPermission: AuthPermission.User,
  token: "user2token",
  userId: "user2"
};
const authAdmin1: AuthPermissions = {
  authPermission: AuthPermission.Admin,
  token: "admin1token",
  userId: "admin1"
};
const authAdmin2: AuthPermissions = {
  authPermission: AuthPermission.Admin,
  token: "admin2token",
  userId: "admin2"
};
const everyDayOfWeek: number[] = [0, 1, 2, 3, 4, 5, 6];
const ONE_HOUR: number = 60 * 60000;
const ONE_DAY: number = 24 * ONE_HOUR;
const ONE_WEEK: number = 7 * ONE_DAY;

describe("TestScheduler", () => {
  const yamlFile: string = BASIC_YAML_FILE;
  const ppaasTestId: PpaasTestId = PpaasTestId.makeTestId(yamlFile);
  const testId: string = ppaasTestId.testId;
  const s3Folder: string = ppaasTestId.s3Folder;
  const testMessage: Required<TestMessage> = {
    testId,
    s3Folder,
    yamlFile,
    additionalFiles: [BASIC_FILEPATH_NOT_YAML, BASIC_FILEPATH_NOT_YAML2],
    testRunTimeMn: 30,
    version: latestPewPewVersion,
    envVariables: {},
    bucketSizeMs: 60000,
    userId: "testMessageUserId", // Different than auth userIds
    bypassParser: false,
    restartOnFailure: false
  };
  const scheduledTestData: ScheduledTestData = {
    queueName: "unittest",
    testMessage,
    environmentVariables: {},
    scheduleDate: Date.now() + 600000
  };
  const recurrence: ScheduledTestRecurrence = {
    endDate: scheduledTestData.scheduleDate + ONE_WEEK,
    daysOfWeek: everyDayOfWeek
  };
  const expectedEndDate: number = scheduledTestData.scheduleDate + (testMessage.testRunTimeMn * 60000);

  before(async () => {
    TestSchedulerIntegration.mockFunctions();
    PpaasTestStatusIntegration.mockFunctions();
    await TestSchedulerIntegration.loadTestsFromS3();
  });

  after(() => {
    // Fix the Mock functions in case we need to run integration too
    TestSchedulerIntegration.setScheduledTests(undefined);
    TestSchedulerIntegration.restoreFunctions();
    PpaasTestStatusIntegration.restoreFunctions();
  });

  describe("constructor", () => {
    it("Should work without userId", (done: Mocha.Done) => {
      try {
        const testScheduler: TestSchedulerIntegration = new TestSchedulerIntegration(scheduledTestData);
        expect(testScheduler.eventInput).to.not.equal(undefined);
        expect(testScheduler.scheduledTestData).to.not.equal(undefined);
        expect(testScheduler.nextStart, "nextStart").to.not.equal(undefined);
        expect(testScheduler.userId, "userId").to.equal(scheduledTestData.testMessage.userId);
        expect(testScheduler.eventInput.id, "id").to.equal(scheduledTestData.testMessage.testId);
        expect(testScheduler.eventInput.title, "title").to.equal(scheduledTestData.testMessage.yamlFile);
        expect(testScheduler.eventInput.start).to.equal(scheduledTestData.scheduleDate);
        expect(testScheduler.eventInput.end).to.equal(expectedEndDate);
        expect(testScheduler.nextStart, "nextStart").to.equal(scheduledTestData.scheduleDate);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("Should work with userId", (done: Mocha.Done) => {
      try {
        const testScheduler: TestSchedulerIntegration = new TestSchedulerIntegration(scheduledTestData, authUser1.userId);
        expect(testScheduler.eventInput).to.not.equal(undefined);
        expect(testScheduler.scheduledTestData).to.not.equal(undefined);
        expect(testScheduler.nextStart, "nextStart").to.not.equal(undefined);
        expect(testScheduler.userId, "userId").to.equal(authUser1.userId);
        expect(testScheduler.eventInput.id, "id").to.equal(scheduledTestData.testMessage.testId);
        expect(testScheduler.eventInput.title, "title").to.equal(scheduledTestData.testMessage.yamlFile);
        expect(testScheduler.eventInput.start).to.equal(scheduledTestData.scheduleDate);
        expect(testScheduler.eventInput.end).to.equal(expectedEndDate);
        expect(testScheduler.nextStart, "nextStart").to.equal(scheduledTestData.scheduleDate);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("Should fail with a past date", (done: Mocha.Done) => {
      try {
        const badSchedule: ScheduledTestData = { ...scheduledTestData, scheduleDate: (Date.now() - 600000) };
        new TestSchedulerIntegration(badSchedule);
        done(new Error("past date should not succeed"));
      } catch (error) {
        expect(`${error}`).to.include("past");
        done();
      }
    });

    it("Should succeed far in the future", (done: Mocha.Done) => {
      try {
        const futureSchedule: ScheduledTestData = { ...scheduledTestData, scheduleDate: (Date.now() + 157680000000) };
        const testScheduler: TestSchedulerIntegration = new TestSchedulerIntegration(futureSchedule, authUser2.userId);
        expect(testScheduler.eventInput).to.not.equal(undefined);
        expect(testScheduler.scheduledTestData).to.not.equal(undefined);
        expect(testScheduler.nextStart, "nextStart").to.not.equal(undefined);
        expect(testScheduler.userId, "userId").to.equal(authUser2.userId);
        expect(testScheduler.eventInput.start, "start").to.not.equal(undefined);
        expect(testScheduler.eventInput.id, "id").to.equal(futureSchedule.testMessage.testId);
        expect(testScheduler.eventInput.title, "title").to.equal(futureSchedule.testMessage.yamlFile);
        expect(testScheduler.eventInput.start, "start").to.equal(futureSchedule.scheduleDate);
        const expectedFutureEndDate: number = futureSchedule.scheduleDate + (testMessage.testRunTimeMn! * 60000);
        expect(testScheduler.eventInput.end, "end").to.equal(expectedFutureEndDate);
        expect(testScheduler.nextStart, "nextStart").to.equal(futureSchedule.scheduleDate);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("Should succeed with recurrence", (done: Mocha.Done) => {
      try {
        const recurrenceSchedule: ScheduledTestData = { ...scheduledTestData, recurrence };
        const testScheduler: TestSchedulerIntegration = new TestSchedulerIntegration(recurrenceSchedule);
        expect(testScheduler.eventInput).to.not.equal(undefined);
        expect(testScheduler.scheduledTestData).to.not.equal(undefined);
        expect(testScheduler.nextStart, "nextStart").to.not.equal(undefined);
        expect(testScheduler.userId, "userId").to.equal(recurrenceSchedule.testMessage.userId);
        expect(testScheduler.eventInput.start, "start").to.equal(undefined);
        expect(testScheduler.eventInput.end, "end").to.equal(undefined);
        expect(testScheduler.eventInput.id, "id").to.equal(recurrenceSchedule.testMessage.testId);
        expect(testScheduler.eventInput.title, "title").to.equal(recurrenceSchedule.testMessage.yamlFile);
        expect(testScheduler.eventInput.startRecur, "startRecur").to.equal(recurrenceSchedule.scheduleDate);
        expect(testScheduler.eventInput.endRecur, "endRecur").to.equal(recurrenceSchedule.recurrence!.endDate);
        expect(testScheduler.eventInput.startTime, "startTime").to.equal(getHourMinuteFromTimestamp(recurrenceSchedule.scheduleDate));
        expect(testScheduler.eventInput.endTime, "endTime").to.equal(getHourMinuteFromTimestamp(expectedEndDate));
        expect("" + testScheduler.eventInput.daysOfWeek, "daysOfWeek").to.equal("" + everyDayOfWeek);
        expect(testScheduler.nextStart, "nextStart").to.equal(recurrenceSchedule.scheduleDate);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("Should succeed with recurrence end date far in the future", (done: Mocha.Done) => {
      try {
        const futureSchedule: ScheduledTestData = { ...scheduledTestData, recurrence: { ...recurrence, endDate: (Date.now() + 157680000000) } };
        const testScheduler: TestSchedulerIntegration = new TestSchedulerIntegration(futureSchedule);
        expect(testScheduler.eventInput).to.not.equal(undefined);
        expect(testScheduler.scheduledTestData).to.not.equal(undefined);
        expect(testScheduler.nextStart, "nextStart").to.not.equal(undefined);
        expect(testScheduler.userId, "userId").to.equal(futureSchedule.testMessage.userId);
        expect(testScheduler.eventInput.start, "start").to.equal(undefined);
        expect(testScheduler.eventInput.end, "end").to.equal(undefined);
        expect(testScheduler.eventInput.id, "id").to.equal(futureSchedule.testMessage.testId);
        expect(testScheduler.eventInput.title, "title").to.equal(futureSchedule.testMessage.yamlFile);
        expect(testScheduler.eventInput.startRecur, "startRecur").to.equal(futureSchedule.scheduleDate);
        expect(testScheduler.eventInput.endRecur, "endRecur").to.equal(futureSchedule.recurrence!.endDate);
        expect(testScheduler.eventInput.startTime, "startTime").to.equal(getHourMinuteFromTimestamp(futureSchedule.scheduleDate));
        expect(testScheduler.eventInput.endTime, "endTime").to.equal(getHourMinuteFromTimestamp(expectedEndDate));
        expect("" + testScheduler.eventInput.daysOfWeek, "daysOfWeek").to.equal("" + everyDayOfWeek);
        expect(testScheduler.nextStart, "nextStart").to.equal(futureSchedule.scheduleDate);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("Should succeed with recurrence with duplicate days of week", (done: Mocha.Done) => {
      try {
        const recurrenceSchedule: ScheduledTestData = {
          ...scheduledTestData,
          recurrence: {
            endDate: scheduledTestData.scheduleDate + ONE_WEEK,
            daysOfWeek: [...everyDayOfWeek, ...everyDayOfWeek]
          }
        };
        const testScheduler: TestSchedulerIntegration = new TestSchedulerIntegration(recurrenceSchedule);
        expect(testScheduler.eventInput).to.not.equal(undefined);
        expect(testScheduler.scheduledTestData).to.not.equal(undefined);
        expect(testScheduler.nextStart, "nextStart").to.not.equal(undefined);
        expect(testScheduler.userId, "userId").to.equal(recurrenceSchedule.testMessage.userId);
        expect(testScheduler.eventInput.start, "start").to.equal(undefined);
        expect(testScheduler.eventInput.end, "end").to.equal(undefined);
        expect(testScheduler.eventInput.id, "id").to.equal(recurrenceSchedule.testMessage.testId);
        expect(testScheduler.eventInput.title, "title").to.equal(recurrenceSchedule.testMessage.yamlFile);
        expect(testScheduler.eventInput.startRecur, "startRecur").to.equal(recurrenceSchedule.scheduleDate);
        expect(testScheduler.eventInput.endRecur, "endRecur").to.equal(recurrenceSchedule.recurrence!.endDate);
        expect(testScheduler.eventInput.startTime, "startTime").to.equal(getHourMinuteFromTimestamp(recurrenceSchedule.scheduleDate));
        expect(testScheduler.eventInput.endTime, "endTime").to.equal(getHourMinuteFromTimestamp(expectedEndDate));
        expect("" + testScheduler.eventInput.daysOfWeek, "daysOfWeek").to.equal("" + everyDayOfWeek);
        expect(testScheduler.nextStart, "nextStart").to.equal(recurrenceSchedule.scheduleDate);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("Should succeed with only one days of week", (done: Mocha.Done) => {
      try {
        const today: Date = new Date(scheduledTestData.scheduleDate);
        const recurrenceSchedule: ScheduledTestData = {
          ...scheduledTestData,
          recurrence: {
            endDate: scheduledTestData.scheduleDate,
            daysOfWeek: [today.getDay()]
          }
        };
        const testScheduler: TestSchedulerIntegration = new TestSchedulerIntegration(recurrenceSchedule);
        expect(testScheduler.eventInput).to.not.equal(undefined);
        expect(testScheduler.scheduledTestData).to.not.equal(undefined);
        expect(testScheduler.nextStart, "nextStart").to.not.equal(undefined);
        expect(testScheduler.userId, "userId").to.equal(recurrenceSchedule.testMessage.userId);
        expect(testScheduler.eventInput.start, "start").to.equal(undefined);
        expect(testScheduler.eventInput.end, "end").to.equal(undefined);
        expect(testScheduler.eventInput.id, "id").to.equal(recurrenceSchedule.testMessage.testId);
        expect(testScheduler.eventInput.title, "title").to.equal(recurrenceSchedule.testMessage.yamlFile);
        expect(testScheduler.eventInput.startRecur, "startRecur").to.equal(recurrenceSchedule.scheduleDate);
        expect(testScheduler.eventInput.endRecur, "endRecur").to.equal(recurrenceSchedule.recurrence!.endDate);
        expect(testScheduler.eventInput.startTime, "startTime").to.equal(getHourMinuteFromTimestamp(recurrenceSchedule.scheduleDate));
        expect(testScheduler.eventInput.endTime, "endTime").to.equal(getHourMinuteFromTimestamp(expectedEndDate));
        expect("" + testScheduler.eventInput.daysOfWeek, "daysOfWeek").to.equal("" + recurrenceSchedule.recurrence!.daysOfWeek);
        expect(testScheduler.nextStart, "nextStart").to.equal(recurrenceSchedule.scheduleDate);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("Should fail without a queuename", (done: Mocha.Done) => {
      try {
        const badSchedule = { ...scheduledTestData, queueName: undefined };
        new TestSchedulerIntegration(badSchedule as any as ScheduledTestData);
        done(new Error("no queuename should not succeed"));
      } catch (error) {
        expect(`${error}`).to.include("missing");
        done();
      }
    });

    it("Should fail without a testMessage", (done: Mocha.Done) => {
      try {
        const badSchedule = { ...scheduledTestData, testMessage: undefined };
        new TestSchedulerIntegration(badSchedule as any as ScheduledTestData);
        done(new Error("no testMessage should not succeed"));
      } catch (error) {
        expect(`${error}`).to.include("missing");
        done();
      }
    });

    it("Should fail without a scheduleDate", (done: Mocha.Done) => {
      try {
        const badSchedule = { ...scheduledTestData, scheduleDate: undefined };
        new TestSchedulerIntegration(badSchedule as any as ScheduledTestData);
        done(new Error("no scheduleDate should not succeed"));
      } catch (error) {
        expect(`${error}`).to.include("missing");
        done();
      }
    });

    it("Should fail without a recurrence.endDate", (done: Mocha.Done) => {
      try {
        const badEndDate = { ...scheduledTestData, recurrence: { ...recurrence, endDate: undefined} };
        new TestSchedulerIntegration(badEndDate as any as ScheduledTestData);
        done(new Error("no endDate should not succeed"));
      } catch (error) {
        expect(`${error}`).to.include("endDate");
        done();
      }
    });

    it("Should fail with a recurrence.endDate before startDate", (done: Mocha.Done) => {
      try {
        const badEndDate = { ...scheduledTestData, recurrence: { ...recurrence, endDate: Date.now() } };
        new TestSchedulerIntegration(badEndDate as any as ScheduledTestData);
        done(new Error("past endDate should not succeed"));
      } catch (error) {
        expect(`${error}`).to.include("Invalid endDate");
        done();
      }
    });

    it("Should fail without a recurrence.daysOfWeek", (done: Mocha.Done) => {
      try {
        const badEndDate = { ...scheduledTestData, recurrence: { ...recurrence, daysOfWeek: undefined} };
        new TestSchedulerIntegration(badEndDate as any as ScheduledTestData);
        done(new Error("no daysOfWeek should not succeed"));
      } catch (error) {
        expect(`${error}`).to.include("daysOfWeek");
        done();
      }
    });

    it("Should fail with empty recurrence.daysOfWeek", (done: Mocha.Done) => {
      try {
        const badEndDate = { ...scheduledTestData, recurrence: { ...recurrence, daysOfWeek: []} };
        new TestSchedulerIntegration(badEndDate as any as ScheduledTestData);
        done(new Error("no endDate should not succeed"));
      } catch (error) {
        expect(`${error}`).to.include("daysOfWeek cannot be empty");
        done();
      }
    });

    it("Should fail with less than 0 recurrence.daysOfWeek", (done: Mocha.Done) => {
      try {
        const badEndDate = { ...scheduledTestData, recurrence: { ...recurrence, daysOfWeek: [...everyDayOfWeek, -1]} };
        new TestSchedulerIntegration(badEndDate as any as ScheduledTestData);
        done(new Error("no endDate should not succeed"));
      } catch (error) {
        expect(`${error}`).to.include("Only 0 - 6");
        done();
      }
    });

    it("Should fail with greater than 6 recurrence.daysOfWeek", (done: Mocha.Done) => {
      try {
        const badEndDate = { ...scheduledTestData, recurrence: { ...recurrence, daysOfWeek: [...everyDayOfWeek, 7]} };
        new TestSchedulerIntegration(badEndDate as any as ScheduledTestData);
        done(new Error("no endDate should not succeed"));
      } catch (error) {
        expect(`${error}`).to.include("Only 0 - 6");
        done();
      }
    });
  });

  describe("getCalendarEvents", () => {
    it("should succeed even if empty", (done: Mocha.Done) => {
      try {
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
        scheduledTests.clear();
        TestSchedulerIntegration.getCalendarEvents().then((events: EventInput[]) => {
          expect(events).to.not.equal(undefined);
          expect(events.length, "events.length").to.equal(0);
          done();
        }).catch((error) => done(error));
      } catch (error) {
        done(error);
      }
    });

    it("should return events", (done: Mocha.Done) => {
      try {
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
        scheduledTests.clear();
        const scheduleItem: TestSchedulerItem = new TestSchedulerIntegration(scheduledTestData);
        for (let i: number = 0; i < 5; i++) {
          scheduledTests.set("testId" + i, scheduleItem);
        }
        const sizeBefore: number = scheduledTests.size;
        expect(sizeBefore).to.be.greaterThan(0);
        TestSchedulerIntegration.getCalendarEvents().then((events: EventInput[]) => {
          expect(events).to.not.equal(undefined);
          expect(events.length, "events.length").to.equal(sizeBefore);
          for (const event of events) {
            expect(event.id).to.equal(testId);
            expect(event.title).to.equal(yamlFile);
            expect(event.start).to.equal(scheduledTestData.scheduleDate);
          }
          done();
        }).catch((error) => done(error));
      } catch (error) {
        done(error);
      }
    });
  });

  describe("getTestData", () => {
    it("should return undefined if empty", (done: Mocha.Done) => {
      try {
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
        scheduledTests.clear();
        TestSchedulerIntegration.getTestData(testId).then((item: ScheduledTestData | undefined) => {
          expect(item).to.equal(undefined);
          done();
        }).catch((error) => done(error));
      } catch (error) {
        done(error);
      }
    });

    it("should return undefined if not found", (done: Mocha.Done) => {
      try {
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
        scheduledTests.clear();
        const scheduleItem: TestSchedulerItem = new TestSchedulerIntegration(scheduledTestData);
        for (let i: number = 0; i < 5; i++) {
          scheduledTests.set("testId" + i, scheduleItem);
        }
        TestSchedulerIntegration.getTestData(testId).then((item: ScheduledTestData | undefined) => {
          expect(item).to.equal(undefined);
          done();
        }).catch((error) => done(error));
      } catch (error) {
        done(error);
      }
    });

    it("should return item if only", (done: Mocha.Done) => {
      try {
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
        scheduledTests.clear();
        const scheduleItem: TestSchedulerItem = new TestSchedulerIntegration(scheduledTestData);
        scheduledTests.set(testId, scheduleItem);
        TestSchedulerIntegration.getTestData(testId).then((item: ScheduledTestData | undefined) => {
          expect(item, "item").to.not.equal(undefined);
          expect(item!.queueName, "queueName").to.equal(scheduledTestData.queueName);
          expect(item!.testMessage, "testMessage").to.not.equal(undefined);
          expect(item!.testMessage.testId, "testId").to.equal(scheduledTestData.testMessage.testId);
          expect(item!.testMessage.yamlFile, "yamlFile").to.equal(scheduledTestData.testMessage.yamlFile);
          expect(item!.scheduleDate, "scheduleDate").to.equal(scheduledTestData.scheduleDate);
          done();
        }).catch((error) => done(error));
      } catch (error) {
        done(error);
      }
    });

    it("should return item among many", (done: Mocha.Done) => {
      try {
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
        scheduledTests.clear();
        const scheduleItem: TestSchedulerItem = new TestSchedulerIntegration(scheduledTestData);
        for (let i: number = 0; i < 5; i++) {
          scheduledTests.set("testId" + i, scheduleItem);
        }
        scheduledTests.set(testId, scheduleItem);
        TestSchedulerIntegration.getTestData(testId).then((item: ScheduledTestData | undefined) => {
          expect(item, "item").to.not.equal(undefined);
          expect(item!.queueName, "queueName").to.equal(scheduledTestData.queueName);
          expect(item!.testMessage, "testMessage").to.not.equal(undefined);
          expect(item!.testMessage.testId, "testId").to.equal(scheduledTestData.testMessage.testId);
          expect(item!.testMessage.yamlFile, "yamlFile").to.equal(scheduledTestData.testMessage.yamlFile);
          expect(item!.scheduleDate, "scheduleDate").to.equal(scheduledTestData.scheduleDate);
          done();
        }).catch((error) => done(error));
      } catch (error) {
        done(error);
      }
    });
  });

  describe("getTestIdsForPewPewVersion", () => {
    const version1TestId: string = "version1TestId";
    const version1TestId1: string = version1TestId + "1";
    const version1TestId2: string = version1TestId + "2";
    const version2TestId: string = "version2TestId";
    const versionLatestTestId: string = "versionLatestTestId";
    const version1: string = "0.1.0";
    const version2: string = "0.2.0";
    const version3: string = "0.3.0";

    before(() => {
      const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
      scheduledTests.clear();
      const addItem = (versionTestId: string, version: string) => {
        const versionTestData: ScheduledTestData = {
          queueName: "unittest",
          testMessage: { ...testMessage, testId: versionTestId, version },
          environmentVariables: testMessage.envVariables,
          scheduleDate: Date.now() + 600000
        };
        const versionItem: TestSchedulerItem = new TestSchedulerIntegration(versionTestData);
        scheduledTests.set(versionTestId, versionItem);
      };
      addItem(version1TestId1, version1);
      addItem(version1TestId2, version1);
      addItem(version2TestId, version2);
      addItem(versionLatestTestId, latestPewPewVersion);
    });

    it("should find version 1 with 2 entries", (done: Mocha.Done) => {
      TestScheduler.getTestIdsForPewPewVersion(version1).then((result: string[] | undefined) => {
        expect(result).to.not.equal(undefined);
        expect(result!.length).to.equal(2);
        expect(result![0]).to.include(version1TestId);
        expect(result![1]).to.include(version1TestId);
        done();
      }).catch((error) => {
        log("getTestIdsForPewPewVersion error version1", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("should find version 2 with 1 entry", (done: Mocha.Done) => {
      TestScheduler.getTestIdsForPewPewVersion(version2).then((result: string[] | undefined) => {
        expect(result).to.not.equal(undefined);
        expect(result!.length).to.equal(1);
        expect(result![0]).to.equal(version2TestId);
        done();
      }).catch((error) => {
        log("getTestIdsForPewPewVersion error version1", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("should find version latest with 1 entry", (done: Mocha.Done) => {
      TestScheduler.getTestIdsForPewPewVersion(latestPewPewVersion).then((result: string[] | undefined) => {
        expect(result).to.not.equal(undefined);
        expect(result!.length).to.equal(1);
        expect(result![0]).to.include(versionLatestTestId);
        done();
      }).catch((error) => {
        log("getTestIdsForPewPewVersion error version1", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("should not find version 3", (done: Mocha.Done) => {
      TestScheduler.getTestIdsForPewPewVersion(version3).then((result: string[] | undefined) => {
        expect(result).to.equal(undefined);
        done();
      }).catch((error) => {
        log("getTestIdsForPewPewVersion error version1", LogLevel.ERROR, error);
        done(error);
      });
    });
  });

  describe("addTest", () => {
    it("should add a test and return 200", (done: Mocha.Done) => {
      expect(scheduledTestData).to.not.equal(undefined);
      expect(ppaasTestId).to.not.equal(undefined);
      const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
      if (scheduledTests.has(testId)) {
        scheduledTests.delete(testId);
      }
      const sizeBefore: number = scheduledTests.size;
      // Clone it
      const newTest: ScheduledTestData = JSON.parse(JSON.stringify(scheduledTestData));
      log("newTest", LogLevel.DEBUG, { authUser1, newTest });
      TestSchedulerIntegration.addTest(newTest, authUser1)
      .then((result: ErrorResponse | TestDataResponse) => {
        log("result", LogLevel.DEBUG, { result });
        expect(result).to.not.equal(undefined);
        expect(result.json).to.not.equal(undefined);
        expect(result.status).to.equal(200);
        // If it's a 200 it's TestData
        const testData: TestData = result.json as TestData;
        expect(testData.testId).to.equal(newTest.testMessage.testId);
        expect(testData.startTime).to.equal(newTest.scheduleDate);
        expect(testData.userId, "userId").to.not.equal(undefined);
        // Response is the testMessage UserId, not the AuthPermissions passed in
        expect(testData.userId, "userId").to.equal(newTest.testMessage.userId);
        expect(scheduledTests.size).to.equal(sizeBefore + 1);
        expect(scheduledTests.has(newTest.testMessage.testId)).to.equal(true);
        const addedTest: TestSchedulerItem = scheduledTests.get(newTest.testMessage.testId)!;
        expect(addedTest.nextStart, "nextStart").to.equal(newTest.scheduleDate);
        expect(addedTest.userId, "addedTest.userId").to.equal(authUser1.userId);
        expect(addedTest.scheduledTestData.testMessage.userId, "testMessage.userId").to.equal(newTest.testMessage.userId);
        done();
      }).catch((error) => done(error));
    });

    it("in the past should return 400", (done: Mocha.Done) => {
      expect(scheduledTestData).to.not.equal(undefined);
      const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
      const sizeBefore: number = scheduledTests.size;
      // Clone it
      const newTest: ScheduledTestData = JSON.parse(JSON.stringify(scheduledTestData));
      newTest.testMessage.testId = newTest.testMessage.testId + 2;
      newTest.scheduleDate = Date.now() - 600000;
      TestSchedulerIntegration.addTest(newTest, authUser1)
      .then((result: ErrorResponse | TestDataResponse) => {
        expect(result).to.not.equal(undefined);
        expect(result.json).to.not.equal(undefined);
        expect(result.status).to.equal(400);
        // If it's a 400 it's TestManagerError
        const testManagerError: TestManagerError = result.json as TestManagerError;
        expect(testManagerError.message).to.not.equal(undefined);
        expect(testManagerError.message).to.include("Could not addTest");
        expect(testManagerError.error).to.not.equal(undefined);
        expect(testManagerError.error).to.include("past");
        expect(scheduledTests.size).to.equal(sizeBefore);
        expect(scheduledTests.has(newTest.testMessage.testId)).to.equal(false);
        done();
      }).catch((error) => done(error));
    });

    it("addTest different user should return 403", (done: Mocha.Done) => {
      expect(scheduledTestData).to.not.equal(undefined);
      const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
      const previousSchedule: TestSchedulerIntegration = new TestSchedulerIntegration(scheduledTestData, authUser1.userId);
      scheduledTests.set(testId, previousSchedule);
      const sizeBefore: number = scheduledTests.size;
      // Clone it
      const newTest: ScheduledTestData = JSON.parse(JSON.stringify(scheduledTestData));
      newTest.scheduleDate = newTest.scheduleDate + 600000;
      TestSchedulerIntegration.addTest(newTest, authUser2)
      .then((result: ErrorResponse | TestDataResponse) => {
        expect(result).to.not.equal(undefined);
        expect(result.json).to.not.equal(undefined);
        expect(result.status).to.equal(403);
        // If it's a 400 it's TestManagerError
        const testManagerError: TestManagerError = result.json as TestManagerError;
        expect(testManagerError.message).to.not.equal(undefined);
        expect(testManagerError.message).to.include("Only the original user can modify");
        expect(scheduledTests.size).to.equal(sizeBefore);
        expect(scheduledTests.has(newTest.testMessage.testId)).to.equal(true);
        done();
      }).catch((error) => done(error));
    });

    it("addTest Admin should add and return 200", (done: Mocha.Done) => {
      expect(scheduledTestData).to.not.equal(undefined);
      const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
      const previousSchedule: TestSchedulerIntegration = new TestSchedulerIntegration(scheduledTestData, authUser1.userId);
      scheduledTests.set(testId, previousSchedule);
      const sizeBefore: number = scheduledTests.size;
      // Clone it
      const newTest: ScheduledTestData = JSON.parse(JSON.stringify(scheduledTestData));
      newTest.scheduleDate = newTest.scheduleDate + 600000;
      TestSchedulerIntegration.addTest(newTest, authAdmin1)
      .then((result: ErrorResponse | TestDataResponse) => {
        expect(result).to.not.equal(undefined);
        expect(result.json).to.not.equal(undefined);
        expect(result.status).to.equal(200);
        // If it's a 200 it's TestData
        const testData: TestData = result.json as TestData;
        expect(testData.testId).to.equal(newTest.testMessage.testId);
        expect(testData.startTime).to.equal(newTest.scheduleDate);
        expect(testData.userId, "userId").to.not.equal(undefined);
        // Response is the testMessage UserId, not the AuthPermissions passed in
        expect(testData.userId, "userId").to.equal(newTest.testMessage.userId);
        expect(scheduledTests.size).to.equal(sizeBefore);
        expect(scheduledTests.has(newTest.testMessage.testId)).to.equal(true);
        const addedTest: TestSchedulerItem = scheduledTests.get(newTest.testMessage.testId)!;
        expect(addedTest.nextStart, "nextStart").to.equal(newTest.scheduleDate);
        expect(addedTest.userId, "addedTest.userId").to.equal(authAdmin1.userId);
        expect(addedTest.scheduledTestData.testMessage.userId, "testMessage.userId").to.equal(newTest.testMessage.userId);
        done();
      }).catch((error) => done(error));
    });
  });

  describe("removeTest", () => {
    beforeEach(() => {
      if (!scheduledTestData) { throw new Error("scheduledTestData not initialized"); }
      try {
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
        const testScheduler: TestSchedulerIntegration = new TestSchedulerIntegration(scheduledTestData, authUser1.userId);
        scheduledTests.set(testId, testScheduler);
      } catch (error) {
        log("Error loading tests from s3", LogLevel.ERROR, error);
        throw error;
      }
    });

    afterEach(() => {
      try {
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
        scheduledTests.clear();
      } catch (error) {
        log("Error clearing scheduledTests", LogLevel.ERROR, error);
        throw error;
      }
    });

    it("same user should remove a test", (done: Mocha.Done) => {
      try {
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
        const sizeBefore: number = scheduledTests.size;
        expect(sizeBefore).to.be.greaterThan(0);
        expect(scheduledTests.has(testId)).to.equal(true);
        TestSchedulerIntegration.removeTest(testId, authUser1)
        .then((errorResponse: ErrorResponse) => {
          expect(scheduledTests.size, "scheduledTests.size").to.equal(sizeBefore - 1);
          expect(scheduledTests.has(testId)).to.equal(false);
          expect(errorResponse).to.not.equal(undefined);
          expect(errorResponse.status).to.equal(200);
          done();
        }).catch((error) => done(error));
      } catch (error) {
        done(error);
      }
    });

    it("different user should not remove a test", (done: Mocha.Done) => {
      try {
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
        const sizeBefore: number = scheduledTests.size;
        expect(sizeBefore).to.be.greaterThan(0);
        expect(scheduledTests.has(testId)).to.equal(true);
        TestSchedulerIntegration.removeTest(testId, authUser2)
        .then((errorResponse: ErrorResponse) => {
          expect(scheduledTests.size, "scheduledTests.size").to.equal(sizeBefore);
          expect(scheduledTests.has(testId)).to.equal(true);
          expect(errorResponse).to.not.equal(undefined);
          expect(errorResponse.status).to.equal(403);
          expect(errorResponse.json.message).to.not.equal(undefined);
          expect(errorResponse.json.message).to.include("Only the original user can modify");
          done();
        }).catch((error) => {
          done(error);
        });
      } catch (error) {
        done(error);
      }
    });

    it("admin user should remove a test", (done: Mocha.Done) => {
      try {
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
        const sizeBefore: number = scheduledTests.size;
        expect(sizeBefore).to.be.greaterThan(0);
        expect(scheduledTests.has(testId)).to.equal(true);
        TestSchedulerIntegration.removeTest(testId, authAdmin1)
        .then((errorResponse: ErrorResponse) => {
          expect(scheduledTests.size, "scheduledTests.size").to.equal(sizeBefore - 1);
          expect(scheduledTests.has(testId)).to.equal(false);
          expect(errorResponse).to.not.equal(undefined);
          expect(errorResponse.status).to.equal(200);
          done();
        }).catch((error) => done(error));
      } catch (error) {
        done(error);
      }
    });

    it("different admin user should remove a test", (done: Mocha.Done) => {
      try {
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
        const sizeBefore: number = scheduledTests.size;
        expect(sizeBefore).to.be.greaterThan(0);
        expect(scheduledTests.has(testId)).to.equal(true);
        scheduledTests.get(testId)!.userId = authAdmin2.userId;
        TestSchedulerIntegration.removeTest(testId, authAdmin1)
        .then((errorResponse: ErrorResponse) => {
          expect(scheduledTests.size, "scheduledTests.size").to.equal(sizeBefore - 1);
          expect(scheduledTests.has(testId)).to.equal(false);
          expect(errorResponse).to.not.equal(undefined);
          expect(errorResponse.status).to.equal(200);
          done();
        }).catch((error) => done(error));
      } catch (error) {
        done(error);
      }
    });

    it("Not found should not remove a test", (done: Mocha.Done) => {
      try {
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
        const sizeBefore: number = scheduledTests.size;
        expect(sizeBefore).to.be.greaterThan(0);
        TestSchedulerIntegration.removeTest("bogus", authAdmin1)
        .then((errorResponse: ErrorResponse) => {
          expect(scheduledTests.size, "scheduledTests.size").to.equal(sizeBefore);
          expect(errorResponse).to.not.equal(undefined);
          expect(errorResponse.status).to.equal(404);
          done();
        }).catch((error) => done(error));
      } catch (error) {
        done(error);
      }
    });
  });

  describe("updateNextStart", () => {
    it("empty should set undefined", (done: Mocha.Done) => {
      try {
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
        scheduledTests.clear();
        TestSchedulerIntegration.setNextStart(Date.now());
        // const newTest: TestSchedulerIntegration = new TestSchedulerIntegration(scheduledTestData, authUser1.userId);
        TestSchedulerIntegration.updateNextStart();
        const nextStart: number | undefined = TestSchedulerIntegration.getNextStart();
        expect(nextStart, "nextStart").to.equal(undefined);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("one should set value", (done: Mocha.Done) => {
      try {
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
        scheduledTests.clear();
        // Set it to an older time than scheduledTestData
        TestSchedulerIntegration.setNextStart(scheduledTestData.scheduleDate - 1000);
        const newTest: TestSchedulerIntegration = new TestSchedulerIntegration(scheduledTestData, authUser1.userId);
        scheduledTests.set(testId, newTest);
        TestSchedulerIntegration.updateNextStart();
        const nextStart: number | undefined = TestSchedulerIntegration.getNextStart();
        expect(nextStart, "nextStart").to.equal(scheduledTestData.scheduleDate);
        done();
      } catch (error) {
        done(error);
      }
    });

    it("multiple should set earliest", (done: Mocha.Done) => {
      try {
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests();
        scheduledTests.clear();
        const scheduleDate: number = scheduledTestData.scheduleDate;
        TestSchedulerIntegration.setNextStart(scheduleDate);
        scheduledTests.set(testId + 1, new TestSchedulerIntegration(scheduledTestData, authUser1.userId));
        scheduledTests.set(testId + 2, new TestSchedulerIntegration({ ...scheduledTestData, scheduleDate: scheduleDate - 1000 }, authUser2.userId));
        scheduledTests.set(testId + 3, new TestSchedulerIntegration({ ...scheduledTestData, scheduleDate: scheduleDate - 2000 }, authAdmin1.userId));
        scheduledTests.set(testId + 4, new TestSchedulerIntegration({ ...scheduledTestData, scheduleDate: scheduleDate + 1000 }, authAdmin2.userId));
        TestSchedulerIntegration.updateNextStart();
        const nextStart: number | undefined = TestSchedulerIntegration.getNextStart();
        expect(nextStart, "nextStart").to.equal(scheduleDate - 2000);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  describe("getTestsToRun", () => {
    let counter = 0;
    const makeTestSchedulerItem = (inputScheduledTestData: ScheduledTestData, scheduleDate: number): [string, TestSchedulerItem] => {
      const newPpaasTestId: PpaasTestId = PpaasTestId.makeTestId(`t${counter++}${yamlFile}`);
      const newTestId: string = newPpaasTestId.testId;
      const newS3Folder: string = newPpaasTestId.s3Folder;
      const newTestData: ScheduledTestData = {
        queueName: inputScheduledTestData.queueName,
        scheduleDate: Date.now() + 60000, // We have to use a future date initially or it will fail the constructor
        environmentVariables: inputScheduledTestData.testMessage.envVariables,
        testMessage: {
          ...inputScheduledTestData.testMessage,
          testId: newTestId,
          s3Folder: newS3Folder
        }
      };
      const testSchedulerItem: TestSchedulerItem = new TestSchedulerIntegration(newTestData);
      testSchedulerItem.nextStart = testSchedulerItem.scheduledTestData.scheduleDate = scheduleDate;
      return [newTestId, testSchedulerItem];
    };
    const pastTest1: [string, TestSchedulerItem] = makeTestSchedulerItem(scheduledTestData, Date.now() - 600000);
    const pastTest2: [string, TestSchedulerItem] = makeTestSchedulerItem(scheduledTestData, Date.now() - 600000);
    const nowTest1: [string, TestSchedulerItem] = makeTestSchedulerItem(scheduledTestData, Date.now());
    const nowTest2: [string, TestSchedulerItem] = makeTestSchedulerItem(scheduledTestData, Date.now());
    const futureTest1: [string, TestSchedulerItem] = makeTestSchedulerItem(scheduledTestData, Date.now() + 600000);
    const futureTest2: [string, TestSchedulerItem] = makeTestSchedulerItem(scheduledTestData, Date.now() + 600000);

    it("should return empty for undefined tests", (done: Mocha.Done) => {
      const results: TestSchedulerItem[] = getTestsToRun(undefined);
      expect(results).to.not.equal(undefined);
      expect(Array.isArray(results)).to.equal(true);
      expect(results.length).to.equal(0);
      done();
    });

    it("should return empty for empty tests", (done: Mocha.Done) => {
      const results: TestSchedulerItem[] = getTestsToRun(new Map<string, TestSchedulerItem>());
      expect(results).to.not.equal(undefined);
      expect(Array.isArray(results)).to.equal(true);
      expect(results.length).to.equal(0);
      done();
    });

    it("should return one now test", (done: Mocha.Done) => {
      const results: TestSchedulerItem[] = getTestsToRun(new Map<string, TestSchedulerItem>([nowTest1]));
      expect(results).to.not.equal(undefined);
      expect(Array.isArray(results)).to.equal(true);
      expect(results.length).to.equal(1);
      expect(results[0].scheduledTestData.testMessage.testId).to.equal(nowTest1[0]);
      done();
    });

    it("should return two now test", (done: Mocha.Done) => {
      const inputMap = new Map<string, TestSchedulerItem>([nowTest1, nowTest2]);
      const validTestIds: string[] = Array.from(inputMap.keys());
      const results: TestSchedulerItem[] = getTestsToRun(inputMap);
      expect(results).to.not.equal(undefined);
      expect(Array.isArray(results)).to.equal(true);
      expect(results.length).to.equal(inputMap.size);
      for (const result of results) {
        expect(result.scheduledTestData.testMessage.testId).to.be.oneOf(validTestIds);
      }
      done();
    });

    it("should return now and past tests", (done: Mocha.Done) => {
      const inputMap = new Map<string, TestSchedulerItem>([pastTest1, nowTest1, nowTest2, pastTest2]);
      const validTestIds: string[] = Array.from(inputMap.keys());
      const results: TestSchedulerItem[] = getTestsToRun(inputMap);
      expect(results).to.not.equal(undefined);
      expect(Array.isArray(results)).to.equal(true);
      expect(results.length).to.equal(inputMap.size);
      for (const result of results) {
        expect(result.scheduledTestData.testMessage.testId).to.be.oneOf(validTestIds);
      }
      done();
    });

    it("with future should return now and past tests", (done: Mocha.Done) => {
      const inputMap = new Map<string, TestSchedulerItem>([pastTest1, nowTest1, nowTest2, pastTest2]);
      const validTestIds: string[] = Array.from(inputMap.keys());
      inputMap.set(futureTest1[0], futureTest1[1]);
      inputMap.set(futureTest2[0], futureTest2[1]);
      const results: TestSchedulerItem[] = getTestsToRun(inputMap);
      expect(results, "results").to.not.equal(undefined);
      expect(Array.isArray(results), "isArray").to.equal(true);
      expect(results.length, "results.length").to.equal(validTestIds.length);
      for (const result of results) {
        expect(result.scheduledTestData.testMessage.testId).to.be.oneOf(validTestIds);
      }
      done();
    });
  });

  describe("getNextStart", () => {
    it("should return now for every day", (done: Mocha.Done) => {
      try {
        const startTime: number = Date.now();
        const nextStart: number | undefined = getNextStart(startTime, startTime, everyDayOfWeek);
        expect(nextStart).to.equal(startTime);
        done();
      } catch (error) {
        log("getNextStart error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("should return tomorrow for tomorrow start and every day of week", (done: Mocha.Done) => {
      try {
        const tomorrow: number = Date.now() + ONE_DAY;
        const nextStart: number | undefined = getNextStart(tomorrow, tomorrow, everyDayOfWeek);
        expect(nextStart).to.equal(tomorrow);
        done();
      } catch (error) {
        log("getNextStart error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("should return tomorrow for tomorrow day of week", (done: Mocha.Done) => {
      try {
        const nowDate: Date = new Date();
        const startTime: number = nowDate.getTime();
        const tomorrow: number = startTime + ONE_DAY;
        const daysOfWeek: number[] = [nowDate.getDay() === 6 ? 0 : (nowDate.getDay() + 1)];
        const nextStart: number | undefined = getNextStart(startTime, tomorrow, daysOfWeek);
        expect(nextStart).to.equal(tomorrow);
        done();
      } catch (error) {
        log("getNextStart error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("should return next week today for tomorrow start day and today day of week", (done: Mocha.Done) => {
      try {
        const nowDate: Date = new Date();
        const nowTime: number = nowDate.getTime();
        const tomorrow: number = nowTime + ONE_DAY;
        const nextWeek: number = tomorrow + ONE_WEEK;
        const daysOfWeek: number[] = [nowDate.getDay()];
        const nextStart: number | undefined = getNextStart(tomorrow, nextWeek, daysOfWeek);
        expect(nextStart).to.equal(nowTime + ONE_WEEK);
        done();
      } catch (error) {
        log("getNextStart error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("should return this week Saturday for Saturday start day and every day of week", (done: Mocha.Done) => {
      try {
        const nowDate: Date = new Date();
        const startTime: number = nowDate.getTime() + (6 - nowDate.getDay()) * ONE_DAY;
        expect(new Date(startTime).getDay()).to.equal(6);
        const nextWeek: number = startTime + ONE_WEEK;
        const nextStart: number | undefined = getNextStart(startTime, nextWeek, everyDayOfWeek);
        expect(nextStart).to.equal(startTime);
        done();
      } catch (error) {
        log("getNextStart error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("should return next week Sunday for Sunday start day and every day of week", (done: Mocha.Done) => {
      try {
        const nowDate: Date = new Date();
        const startTime: number = nowDate.getTime() + (nowDate.getDay() === 0 ? 0 : (7 - nowDate.getDay())) * ONE_DAY;
        expect(new Date(startTime).getDay()).to.equal(0);
        const nextWeek: number = startTime + ONE_WEEK;
        const nextStart: number | undefined = getNextStart(startTime, nextWeek, everyDayOfWeek);
        expect(nextStart).to.equal(startTime);
        done();
      } catch (error) {
        log("getNextStart error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("should return this week Saturday for today start day and Saturday day of week", (done: Mocha.Done) => {
      try {
        const nowDate: Date = new Date();
        const startTime: number = nowDate.getTime();
        const nextWeek: number = startTime + ONE_WEEK;
        const daysOfWeek: number[] = [6];
        const nextStart: number | undefined = getNextStart(startTime, nextWeek, daysOfWeek);
        const expectedNextStart: number = nowDate.getTime() + (6 - nowDate.getDay()) * ONE_DAY;
        expect(new Date(expectedNextStart).getDay()).to.equal(6); // Saturday
        expect(nextStart).to.equal(expectedNextStart);
        done();
      } catch (error) {
        log("getNextStart error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("should return next week Sunday for today start day and Sunday day of week", (done: Mocha.Done) => {
      try {
        const nowDate: Date = new Date();
        const startTime: number = nowDate.getTime();
        const nextWeek: number = startTime + ONE_WEEK;
        const daysOfWeek: number[] = [0];
        const nextStart: number | undefined = getNextStart(startTime, nextWeek, daysOfWeek);
        const expectedNextStart: number = nowDate.getTime() + (nowDate.getDay() === 0 ? 0 : (7 - nowDate.getDay())) * ONE_DAY;
        expect(new Date(expectedNextStart).getDay()).to.equal(0); // Sunday
        expect(nextStart).to.equal(expectedNextStart);
        done();
      } catch (error) {
        log("getNextStart error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("should return undefined for tomorrow start day and today day of week", (done: Mocha.Done) => {
      try {
        const nowDate: Date = new Date();
        const startTime: number = nowDate.getTime();
        const tomorrow: number = startTime + ONE_DAY;
        const daysOfWeek: number[] = [nowDate.getDay()];
        const nextStart: number | undefined = getNextStart(tomorrow, tomorrow, daysOfWeek);
        expect(nextStart).to.equal(undefined);
        done();
      } catch (error) {
        log("getNextStart error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("should return undefined for end before start", (done: Mocha.Done) => {
      try {
        const nowDate: Date = new Date();
        const startTime: number = nowDate.getTime();
        const tomorrow: number = startTime + ONE_DAY;
        const nextStart: number | undefined = getNextStart(tomorrow, startTime, everyDayOfWeek);
        expect(nextStart).to.equal(undefined);
        done();
      } catch (error) {
        log("getNextStart error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("should return undefined for empty daysOfWeek", (done: Mocha.Done) => {
      try {
        const nowDate: Date = new Date();
        const startTime: number = nowDate.getTime();
        const daysOfWeek: number[] = [];
        const nextStart: number | undefined = getNextStart(startTime, startTime, daysOfWeek);
        expect(nextStart).to.equal(undefined);
        done();
      } catch (error) {
        log("getNextStart error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("should return undefined for negative daysOfWeek", (done: Mocha.Done) => {
      try {
        const nowDate: Date = new Date();
        const startTime: number = nowDate.getTime();
        const daysOfWeek: number[] = [...everyDayOfWeek, -1];
        const nextStart: number | undefined = getNextStart(startTime, startTime, daysOfWeek);
        expect(nextStart).to.equal(undefined);
        done();
      } catch (error) {
        log("getNextStart error", LogLevel.ERROR, error);
        done(error);
      }
    });

    it("should return undefined for greater than 6 daysOfWeek", (done: Mocha.Done) => {
      try {
        const nowDate: Date = new Date();
        const startTime: number = nowDate.getTime();
        const daysOfWeek: number[] = [...everyDayOfWeek, 7];
        const nextStart: number | undefined = getNextStart(startTime, startTime, daysOfWeek);
        expect(nextStart).to.equal(undefined);
        done();
      } catch (error) {
        log("getNextStart error", LogLevel.ERROR, error);
        done(error);
      }
    });
  });

  describe("runHistoricalDelete", () => {
    const deleteOldFilesDays = 7;

    // Empty
    it("should succeed even if empty", async () => {
      try {
        const historicalTests: Map<string, EventInput> = TestSchedulerIntegration.getHistoricalTests();
        historicalTests.clear();
        const deletedCount: number = await TestSchedulerIntegration.runHistoricalDelete(deleteOldFilesDays);
        expect(deletedCount).to.equal(0);
        expect(historicalTests.size, "historicalTests.size").to.equal(0);
      } catch (error) {
        log("should succeed even if empty error", LogLevel.ERROR, error);
        throw error;
      }
    });

    // One today should not be deleted
    it("should not remove new", async () => {
      try {
        const historicalTests: Map<string, EventInput> = TestSchedulerIntegration.getHistoricalTests();
        historicalTests.clear();
        const startTime = Date.now() - (2 * ONE_HOUR);
        const endTime = Date.now() - ONE_HOUR;
        await TestSchedulerIntegration.addHistoricalTest(testId, yamlFile, startTime, endTime, TestStatus.Finished);
        const deletedCount: number = await TestSchedulerIntegration.runHistoricalDelete(deleteOldFilesDays);
        expect(deletedCount, "deletedCount").to.equal(0);
        expect(historicalTests.size, "historicalTests.size").to.equal(1);
      } catch (error) {
        log("should not remove new error", LogLevel.ERROR, error);
        throw error;
      }
    });

    // One last week should be deleted
    it("should remove old", async () => {
      try {
        const historicalTests: Map<string, EventInput> = TestSchedulerIntegration.getHistoricalTests();
        historicalTests.clear();
        const startTime = Date.now() - (2 * ONE_HOUR + ONE_WEEK);
        const endTime = Date.now() - (ONE_HOUR + ONE_WEEK);
        await TestSchedulerIntegration.addHistoricalTest(testId, yamlFile, startTime, endTime, TestStatus.Finished);
        const deletedCount: number = await TestSchedulerIntegration.runHistoricalDelete(deleteOldFilesDays);
        expect(deletedCount, "deletedCount").to.equal(1);
        expect(historicalTests.size, "historicalTests.size").to.equal(0);
      } catch (error) {
        log("should remove old error", LogLevel.ERROR, error);
        throw error;
      }
    });

    // One today, one yesterday, one 1 week ago, delete one week
    it("should remove old, but not new", async () => {
      try {
        const historicalTests: Map<string, EventInput> = TestSchedulerIntegration.getHistoricalTests();
        historicalTests.clear();
        const startTime = Date.now() - (2 * ONE_HOUR);
        const endTime = Date.now() - ONE_HOUR;
        // Today
        await TestSchedulerIntegration.addHistoricalTest(testId, yamlFile, startTime, endTime, TestStatus.Finished);
        // Yesterday
        await TestSchedulerIntegration.addHistoricalTest(PpaasTestId.makeTestId(yamlFile).testId, yamlFile, startTime - ONE_DAY, endTime - ONE_DAY, TestStatus.Finished);
        await util.sleep(5); // Need to get a different timestamp for this next test.
        // Last week
        await TestSchedulerIntegration.addHistoricalTest(PpaasTestId.makeTestId(yamlFile).testId, yamlFile, startTime - ONE_WEEK, endTime - ONE_WEEK, TestStatus.Finished);
        expect(historicalTests.size, "historicalTests.size before").to.equal(3);
        const deletedCount: number = await TestSchedulerIntegration.runHistoricalDelete(deleteOldFilesDays);
        expect(deletedCount, "deletedCount").to.equal(1);
        expect(historicalTests.size, "historicalTests.size").to.equal(2);
      } catch (error) {
        log("should remove old, but not new error", LogLevel.ERROR, error);
        throw error;
      }
    });
  });
});
