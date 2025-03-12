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
  PpaasS3File,
  PpaasTestId,
  PpaasTestMessage,
  PpaasTestStatus,
  TestMessage,
  TestStatus,
  TestStatusMessage,
  log,
  s3,
  util
} from "@fs/ppaas-common";
import { TestScheduler, TestSchedulerItem } from "../pages/api/util/testscheduler";
import { EventInput } from "@fullcalendar/core";
import { expect } from "chai";
import { getHourMinuteFromTimestamp } from "../pages/api/util/clientutil";
import { getPewPewVersionsInS3 } from "../pages/api/util/pewpew";

const sleep = util.sleep;

// Re-create these here so we don't have to run yamlparser.spec by importing it
const localDirectory: string = process.env.UNIT_TEST_FOLDER || "test";
const BASIC_FILEPATH_WITH_FILES = "basicwithfiles.yaml";
const BASIC_FILEPATH_NOT_YAML = "text.txt";
const BASIC_FILEPATH_NOT_YAML2 = "text2.txt";
const THIRTY_MINUTES: number = 30 * 60000;
const ONE_DAY: number = 24 * 60 * 60000;
const ONE_WEEK: number = 7 * ONE_DAY;

class TestSchedulerIntegration extends TestScheduler {
  public constructor (scheduledTestData: ScheduledTestData, userId?: string | null) {
    super(scheduledTestData, userId);
  }

  public static getScheduledTests (): Map<string, TestSchedulerItem> | undefined {
    return TestScheduler.scheduledTests;
  }

  /** Sets both the class static and global scheduledTests */
  public static setScheduledTests (scheduledTests: Map<string, TestSchedulerItem> | undefined): void {
    global.scheduledTests = TestScheduler.scheduledTests = scheduledTests;
  }

  public static getGlobalScheduledTests (): Map<string, TestSchedulerItem> | undefined {
    return global.scheduledTests;
  }

  /** Only sets the global scheduledTests */
  public static setGlobalScheduledTests (scheduledTests: Map<string, TestSchedulerItem> | undefined): void {
    global.scheduledTests = scheduledTests;
  }

  public static getHistoricalTests (): Map<string, EventInput> | undefined {
    return TestScheduler.historicalTests;
  }

  /** Sets both the class static and global historicalTests */
  public static setHistoricalTests (historicalTests: Map<string, EventInput> | undefined): void {
    global.historicalTests = TestScheduler.historicalTests = historicalTests;
  }

  public static getGlobalHistoricalTests (): Map<string, EventInput> | undefined {
    return global.historicalTests;
  }

  /** Only sets the global historicalTests */
  public static setGlobalHistoricalTests (historicalTests: Map<string, EventInput> | undefined): void {
    global.historicalTests = historicalTests;
  }

  public static async loadTestsFromS3 (): Promise<void> {
    await TestScheduler.loadTestsFromS3();
  }

  public static async saveTestsToS3 (): Promise<void> {
    await TestScheduler.saveTestsToS3();
  }

  public static async startNewTest (testToRun: TestSchedulerItem, nextStart: number): Promise<TestData | undefined> {
    return await TestScheduler.startNewTest(testToRun, nextStart);
  }

  public static async startExistingTest (testToRun: TestSchedulerItem): Promise<TestData | undefined> {
    return await TestScheduler.startExistingTest(testToRun);
  }

  public static async startScheduledItem (testToRun: TestSchedulerItem): Promise<TestData | undefined> {
    return await TestScheduler.startScheduledItem(testToRun);
  }

  public static async runHistoricalSearch (): Promise<void> {
    return await TestScheduler.runHistoricalSearch();
  }

  public static async runHistoricalDelete (deleteOldFilesDays?: number): Promise<number> {
    return await TestScheduler.runHistoricalDelete(deleteOldFilesDays);
  }

  public static async loadHistoricalFromS3 (): Promise<void> {
    return await TestScheduler.loadHistoricalFromS3();
  }

  public static async saveHistoricalToS3 (): Promise<void> {
    return await TestScheduler.saveHistoricalToS3();
  }
}

function updateNextStart (testToRun: TestSchedulerItem, nextStart: number) {
  testToRun.nextStart = nextStart;
  testToRun.scheduledTestData.scheduleDate = nextStart;
  const { eventInput, scheduledTestData } = testToRun;
  const { testRunTimeMn }: TestMessage = scheduledTestData.testMessage;
  if (scheduledTestData.recurrence) {
    eventInput.startRecur = nextStart;
    eventInput.startTime = getHourMinuteFromTimestamp(nextStart);
    if (testRunTimeMn) {
      eventInput.endTime = getHourMinuteFromTimestamp(eventInput.startRecur + (60000 * testRunTimeMn));
    }
  } else {
    scheduledTestData.scheduleDate = nextStart;
    eventInput.start = nextStart;
    if (testRunTimeMn) {
      eventInput.end = scheduledTestData.scheduleDate + (60000 * testRunTimeMn);
    }
  }
}

const authUser1: AuthPermissions = {
  authPermission: AuthPermission.User,
  token: "user1token",
  userId: "user1"
};

describe("TestScheduler Integration", () => {
  let initialized: boolean = false;
  let testAdded: boolean = false;
  let scheduledTestData: ScheduledTestData;
  let testSchedulerItem: TestSchedulerItem;
  let recurringSchedulerItem: TestSchedulerItem;
  let historicalEvent: EventInput;
  let ppaasTestId: PpaasTestId;
  let historicalTestId: PpaasTestId;
  let originalScheduledTests: Map<string, TestSchedulerItem> | undefined;
  let originalHistoricalTests: Map<string, EventInput> | undefined;
  let file: PpaasS3File;
  let file1: PpaasS3File;
  let file2: PpaasS3File;

  before(async () => {
    let yamlFile: string;
    try {
      const sharedQueueNames: string[] = PpaasTestMessage.getAvailableQueueNames();
      log("sharedQueueNames", LogLevel.DEBUG, sharedQueueNames);
      expect(sharedQueueNames).to.not.equal(undefined);
      expect(sharedQueueNames.length).to.be.greaterThan(0);
      const sharedPewPewVersions = await getPewPewVersionsInS3();
      log("sharedPewPewVersions", LogLevel.DEBUG, sharedPewPewVersions);
      expect(sharedPewPewVersions).to.not.equal(undefined);
      expect(sharedPewPewVersions.length).to.be.greaterThan(0);
      yamlFile = BASIC_FILEPATH_WITH_FILES;
      ppaasTestId = PpaasTestId.makeTestId(yamlFile);
      const s3Folder: string = ppaasTestId.s3Folder;
      file = new PpaasS3File({ filename: yamlFile, s3Folder, localDirectory });
      file1 = new PpaasS3File({ filename: BASIC_FILEPATH_NOT_YAML, s3Folder, localDirectory, tags: s3.defaultTestExtraFileTags() });
      file2 = new PpaasS3File({ filename: BASIC_FILEPATH_NOT_YAML2, s3Folder, localDirectory, tags: s3.defaultTestExtraFileTags() });
      await Promise.all([file.upload(), file1.upload(), file2.upload()]);
      const testId: string = ppaasTestId.testId;
      const testMessage: Required<TestMessage> = {
        testId,
        s3Folder,
        yamlFile,
        additionalFiles: [BASIC_FILEPATH_NOT_YAML, BASIC_FILEPATH_NOT_YAML2],
        testRunTimeMn: 30,
        version: sharedPewPewVersions[0],
        envVariables: {},
        bucketSizeMs: 60000,
        userId: "testMessageUserId",
        bypassParser: false,
        restartOnFailure: false
      };
      scheduledTestData = {
        queueName: sharedQueueNames[0],
        testMessage,
        environmentVariables: {},
        scheduleDate: Date.now() + 600000
      };
      testSchedulerItem = new TestSchedulerIntegration(scheduledTestData, authUser1.userId);
      const recurrence: ScheduledTestRecurrence = {
        daysOfWeek: [0,1,2,3,4,5,6],
        endDate: scheduledTestData.scheduleDate + ONE_WEEK
      };
      recurringSchedulerItem = new TestSchedulerIntegration({ ...scheduledTestData, recurrence }, authUser1.userId);
      historicalTestId = PpaasTestId.makeTestId(yamlFile);
      const historicalStartTime: number = Date.now() - 600000;
      const testStatusMessage: TestStatusMessage = {
        startTime: historicalStartTime,
        endTime: historicalStartTime + THIRTY_MINUTES,
        resultsFilename: ["bogus"],
        status: TestStatus.Finished
      };
      const historicalTestStatus = new PpaasTestStatus(historicalTestId, testStatusMessage);
      await historicalTestStatus.writeStatus();
      historicalEvent = {
        /** String or Integer. Will uniquely identify your event. Useful for getEventById. */
        id: historicalTestId.testId,
        /** String. A URL that will be visited when this event is clicked by the user. For more information on controlling this behavior, see the eventClick callback. */
        /** String. The text that will appear on an event. */
        title: yamlFile,
        start: historicalStartTime,
        end: historicalStartTime + THIRTY_MINUTES
      };

      await Promise.all([file.existsInS3(), file1.existsInS3(), file2.existsInS3()])
      .then(([fileExists, file1Exists, file2Exists]) => {
        expect(fileExists, "fileExists").to.equal(true);
        expect(file1Exists, "file1Exists").to.equal(true);
        expect(file2Exists, "file2Exists").to.equal(true);
      });
    } catch (error) {
      log("TestScheduler before", LogLevel.ERROR, error);
      throw error;
    }
    // Back up the current file
    try {
      TestSchedulerIntegration.setScheduledTests(undefined);
      await TestSchedulerIntegration.loadTestsFromS3();
      originalScheduledTests = TestSchedulerIntegration.getScheduledTests();
    } catch (error) {
      log("Backup original TestScheduler failed", LogLevel.ERROR, error);
      throw error;
    }
    // Back up the current file
    try {
      TestSchedulerIntegration.setHistoricalTests(undefined);
      await TestSchedulerIntegration.loadHistoricalFromS3();
      originalHistoricalTests = TestSchedulerIntegration.getHistoricalTests();
    } catch (error) {
      log("Backup original HistoricalTests failed", LogLevel.ERROR, error);
      throw error;
    }
  });

  after(async () => {
    if (originalScheduledTests) {
      try {
        TestSchedulerIntegration.setScheduledTests(originalScheduledTests);
        await TestSchedulerIntegration.saveTestsToS3();
      } catch (error) {
        log("Restore original TestScheduler failed", LogLevel.ERROR, error);
        throw error;
      }
    }
    if (originalHistoricalTests) {
      try {
        TestSchedulerIntegration.setHistoricalTests(originalHistoricalTests);
        await TestSchedulerIntegration.saveHistoricalToS3();
      } catch (error) {
        log("Restore original HistoricalTests failed", LogLevel.ERROR, error);
        throw error;
      }
    }
  });

  describe("loadTestsFromS3", () => {
    let s3TestId: string;

    before(async () => {
      const s3ScheduledItem = recurringSchedulerItem;
      initialized = false;
      // We want different data between s3 and global
      const s3ScheduledTests: Map<string, TestSchedulerItem> = new Map<string, TestSchedulerItem>();
      s3TestId = s3ScheduledItem!.scheduledTestData.testMessage.testId;
      s3ScheduledTests.set(s3TestId, s3ScheduledItem);
      const s3HistoricalTests: Map<string, EventInput> = new Map<string, EventInput>();
      s3HistoricalTests.set(s3TestId, s3ScheduledItem.eventInput);

      TestSchedulerIntegration.setScheduledTests(s3ScheduledTests);
      TestSchedulerIntegration.setHistoricalTests(s3HistoricalTests);
      await TestSchedulerIntegration.saveTestsToS3();
      await TestSchedulerIntegration.saveHistoricalToS3();
    });

    beforeEach(() => {
      TestSchedulerIntegration.setScheduledTests(undefined);
      TestSchedulerIntegration.setHistoricalTests(undefined);
    });

    after(async () => {
      TestSchedulerIntegration.setScheduledTests(new Map());
      TestSchedulerIntegration.setHistoricalTests(new Map());
      initialized = true;
      await TestSchedulerIntegration.saveTestsToS3();
      await TestSchedulerIntegration.saveHistoricalToS3();
    });

    it("should load the data from S3", (done: Mocha.Done) => {
      TestSchedulerIntegration.setScheduledTests(undefined);
      initialized = false;
      TestSchedulerIntegration.loadTestsFromS3()
      .then(() => {
        expect(TestSchedulerIntegration.getScheduledTests(), "getScheduledTests").to.not.equal(undefined);
        expect(TestSchedulerIntegration.getGlobalScheduledTests(), "getGlobalScheduledTests").to.not.equal(undefined);
        const actualScheduledTests = TestSchedulerIntegration.getScheduledTests()!;
        expect(actualScheduledTests.size, "actualScheduledTests.size").to.equal(1);
        expect(actualScheduledTests.has(s3TestId), "actualScheduledTests.has(testId)").to.equal(true);
        initialized = true;
        done();
      })
      .catch((error) => done(error));
    });

    it("should load the data from global", (done: Mocha.Done) => {
      TestSchedulerIntegration.setScheduledTests(undefined);
      initialized = false;
      // We want different data between s3 and global
      const expectedScheduledTests: Map<string, TestSchedulerItem> = new Map<string, TestSchedulerItem>();
      const testId: string = testSchedulerItem!.scheduledTestData.testMessage.testId;
      expectedScheduledTests.set(testId, testSchedulerItem);
      TestSchedulerIntegration.setGlobalScheduledTests(expectedScheduledTests);
      TestSchedulerIntegration.loadTestsFromS3()
      .then(() => {
        expect(TestSchedulerIntegration.getScheduledTests(), "getScheduledTests").to.not.equal(undefined);
        const actualScheduledTests = TestSchedulerIntegration.getScheduledTests()!;
        expect(actualScheduledTests.size, "actualScheduledTests.size").to.equal(1);
        expect(actualScheduledTests.has(testId), "actualScheduledTests.has(testId)").to.equal(true);
        initialized = true;
        done();
      })
      .catch((error) => done(error));
    });

    it("should load the historical data from S3", (done: Mocha.Done) => {
      TestSchedulerIntegration.setHistoricalTests(undefined);
      TestSchedulerIntegration.loadHistoricalFromS3()
      .then(() => {
        expect(TestSchedulerIntegration.getHistoricalTests(), "getHistoricalTests").to.not.equal(undefined);
        expect(TestSchedulerIntegration.getGlobalHistoricalTests(), "getGlobalHistoricalTests").to.not.equal(undefined);
        const actualHistoricalTests = TestSchedulerIntegration.getHistoricalTests()!;
        expect(actualHistoricalTests.size, "actualHistoricalTests.size").to.equal(1);
        expect(actualHistoricalTests.has(s3TestId), "actualHistoricalTests.has(testId)").to.equal(true);
        done();
      })
      .catch((error) => done(error));
    });

    it("should load the historical data from global", (done: Mocha.Done) => {
      TestSchedulerIntegration.setHistoricalTests(undefined);
      const expectedHistoricalTests: Map<string, EventInput> = new Map<string, EventInput>();
      const testId: string = historicalEvent!.id as string;
      expectedHistoricalTests.set(testId, historicalEvent!);
      TestSchedulerIntegration.setGlobalHistoricalTests(expectedHistoricalTests);
      TestSchedulerIntegration.loadHistoricalFromS3()
      .then(() => {
        expect(TestSchedulerIntegration.getHistoricalTests(), "getHistoricalTests").to.not.equal(undefined);
        const actualHistoricalTests = TestSchedulerIntegration.getHistoricalTests()!;
        expect(actualHistoricalTests.size, "actualHistoricalTests.size").to.equal(1);
        expect(actualHistoricalTests.has(testId), "actualHistoricalTests.has(testId)").to.equal(true);
        done();
      })
      .catch((error) => done(error));
    });
  });

  it("should save populated data to S3", (done: Mocha.Done) => {
    expect(scheduledTestData).to.not.equal(undefined);
    const scheduledTests: Map<string, TestSchedulerItem> = new Map<string, TestSchedulerItem>();
    TestSchedulerIntegration.setScheduledTests(scheduledTests);
    const testId: string = scheduledTestData!.testMessage.testId;
    scheduledTests.set(testId, new TestSchedulerIntegration(scheduledTestData!, authUser1.userId));
    TestSchedulerIntegration.saveTestsToS3()
    .then(() => {
      TestSchedulerIntegration.setScheduledTests(undefined);
      initialized = false;
      sleep(2000).then(() =>
      TestSchedulerIntegration.loadTestsFromS3()
      .then(() => {
        const newScheduledTests: Map<string, TestSchedulerItem> | undefined = TestSchedulerIntegration.getScheduledTests();
        expect(newScheduledTests, "newScheduledTests").to.not.equal(undefined);
        expect(newScheduledTests!.size, "newScheduledTests.size").to.equal(1);
        expect(newScheduledTests!.has(testId), "newScheduledTests.has(testId)").to.equal(true);
        expect(JSON.stringify(newScheduledTests!.get(testId)!.scheduledTestData)).to.equal(JSON.stringify(scheduledTestData!));
        initialized = true;
        done();
      })
      ).catch((error) => done(error));
    })
    .catch((error) => done(error));
  });

  it("should save empty data to S3", (done: Mocha.Done) => {
    expect(scheduledTestData).to.not.equal(undefined);
    const scheduledTests: Map<string, TestSchedulerItem> = new Map<string, TestSchedulerItem>();
    TestSchedulerIntegration.setScheduledTests(scheduledTests);
    TestSchedulerIntegration.saveTestsToS3()
    .then(() => {
      TestSchedulerIntegration.setScheduledTests(undefined);
      initialized = false;
      TestSchedulerIntegration.loadTestsFromS3()
      .then(() => {
        const newScheduledTests: Map<string, TestSchedulerItem> | undefined = TestSchedulerIntegration.getScheduledTests();
        expect(newScheduledTests).to.not.equal(undefined);
        expect(newScheduledTests!.size).to.equal(0);
        initialized = true;
        done();
      })
      .catch((error) => done(error));
    })
    .catch((error) => done(error));
  });

  describe("addTest", () => {
    it("should add a test and return 200", (done: Mocha.Done) => {
      expect(initialized, "loadTestsFromS3 failed. Can't run add").to.equal(true);
      expect(scheduledTestData).to.not.equal(undefined);
      expect(ppaasTestId).to.not.equal(undefined);
      const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests()!;
      const sizeBefore: number = scheduledTests.size;
      // Clone it
      const newTest: ScheduledTestData = JSON.parse(JSON.stringify(scheduledTestData));
      TestSchedulerIntegration.addTest(newTest, authUser1)
      .then((result: ErrorResponse | TestDataResponse) => {
        expect(result).to.not.equal(undefined);
        expect(result.json).to.not.equal(undefined);
        expect(result.status).to.equal(200);
        // If it's a 200 it's TestData
        const testData: TestData = result.json as TestData;
        expect(testData.testId, "testId").to.equal(newTest.testMessage.testId);
        expect(testData.startTime, "startTime").to.equal(newTest.scheduleDate);
        expect(testData.userId, "userId").to.not.equal(undefined);
        // Response is the testMessage UserId, not the AuthPermissions passed in
        expect(testData.userId, "userId").to.equal(newTest.testMessage.userId);
        expect(scheduledTests.size).to.equal(sizeBefore + 1);
        expect(scheduledTests.has(newTest.testMessage.testId)).to.equal(true);
        const addedTest: TestSchedulerItem = scheduledTests.get(newTest.testMessage.testId)!;
        expect(addedTest.nextStart, "nextStart").to.equal(newTest.scheduleDate);
        expect(addedTest.userId, "addedTest.userId").to.equal(authUser1.userId);
        expect(addedTest.scheduledTestData.testMessage.userId, "testMessage.userId").to.equal(newTest.testMessage.userId);
        PpaasTestStatus.getStatus(ppaasTestId!)
        .then((ppaasTestStatus: PpaasTestStatus | undefined) => {
          expect(ppaasTestStatus).to.not.equal(undefined);
          expect(ppaasTestStatus!.status, "ppaasTestStatus.status").to.equal(TestStatus.Scheduled);
          expect(ppaasTestStatus!.startTime, "ppaasTestStatus.startTime").to.equal(newTest.scheduleDate);
          expect(ppaasTestStatus!.userId, "ppaasTestStatus.userId").to.equal(authUser1.userId);
          testAdded = true;
          done();
        }).catch((error) => done(error));
      }).catch((error) => done(error));
    });

    it("in the past should return 400", (done: Mocha.Done) => {
      expect(initialized, "loadTestsFromS3 failed. Can't run add").to.equal(true);
      expect(scheduledTestData).to.not.equal(undefined);
      const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests()!;
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
  });

  describe("startScheduledItem", () => {
    let lastMinute: number;

    beforeEach(async () => {
      // round down to last minute
      lastMinute = new Date(Math.floor(Date.now() / 60000) * 60000).getTime();
      if (!initialized) {
        await TestSchedulerIntegration.loadTestsFromS3();
        initialized = true;
      }
    });

    it("should startExistingTest and remove from schedule", (done: Mocha.Done) => {
      try {
        expect(initialized, "loadTestsFromS3 failed. Can't run remove").to.equal(true);
        expect(testSchedulerItem, "testSchedulerItem").to.not.equal(undefined);
        const timeBefore: number = Date.now();
        const testId: string = testSchedulerItem!.scheduledTestData.testMessage.testId;
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests()!;
        scheduledTests.set(testId, testSchedulerItem!);
        const sizeBefore: number = scheduledTests.size;
        updateNextStart(testSchedulerItem!, lastMinute);
        TestSchedulerIntegration.startScheduledItem(testSchedulerItem!)
        .then((testData: TestData | undefined) => {
          expect(testData).to.not.equal(undefined);
          expect(testData!.testId, "testId").to.equal(testId);
          expect(testData!.s3Folder, "s3Folder").to.equal(testSchedulerItem!.scheduledTestData.testMessage.s3Folder);
          expect(testData!.startTime, "startTime").to.not.equal(undefined);
          expect(testData!.startTime, "startTime").to.be.greaterThanOrEqual(timeBefore);
          expect(testData!.endTime, "endTime").to.not.equal(undefined);
          expect(testData!.status, "status").to.equal(TestStatus.Created);
          expect(testData!.userId, "userId").to.equal(testSchedulerItem!.userId);
          expect(scheduledTests.size, "size").to.equal(sizeBefore - 1);
          expect(scheduledTests.has(testId), `scheduledTests.has(${testId})`).to.equal(false);
          done();
        }).catch((error) => done(error));
      } catch (error) {
        done(error);
      }
    });

    it("should startNewTest recurring and update next start", (done: Mocha.Done) => {
      try {
        expect(initialized, "loadTestsFromS3 failed. Can't run startScheduledItem").to.equal(true);
        expect(recurringSchedulerItem).to.not.equal(undefined);
        const testId: string = recurringSchedulerItem!.scheduledTestData.testMessage.testId;
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests()!;
        scheduledTests.set(testId, recurringSchedulerItem!);
        const sizeBefore: number = scheduledTests.size;
        const timeBefore: number = lastMinute;
        const nextStart: number = lastMinute + ONE_DAY;
        updateNextStart(recurringSchedulerItem!, lastMinute);
        recurringSchedulerItem!.scheduledTestData.recurrence!.endDate = lastMinute + ONE_WEEK;
        recurringSchedulerItem!.eventInput.endRecur = lastMinute + ONE_WEEK;
        TestSchedulerIntegration.startScheduledItem(recurringSchedulerItem!)
        .then((testData: TestData | undefined) => {
          expect(testData).to.not.equal(undefined);
          expect(testData!.testId, "testId").to.not.equal(testId);
          expect(testData!.s3Folder, "s3Folder").to.not.equal(recurringSchedulerItem!.scheduledTestData.testMessage.s3Folder);
          expect(testData!.startTime, "startTime").to.not.equal(undefined);
          expect(testData!.startTime, "startTime").to.be.greaterThanOrEqual(timeBefore);
          expect(testData!.endTime, "endTime").to.not.equal(undefined);
          expect(testData!.status, "status").to.equal(TestStatus.Created);
          expect(testData!.userId, "userId").to.equal(recurringSchedulerItem!.userId);
          expect(scheduledTests.size, "size").to.equal(sizeBefore);
          expect(scheduledTests.has(testId), `scheduledTests.has(${testId})`).to.equal(true);
          expect(recurringSchedulerItem!.nextStart, "nextStart").to.equal(nextStart);
          // startRecur needs to be updated or it will still show int he past on the calendar
          expect(recurringSchedulerItem!.eventInput.startRecur, "startRecur").to.equal(nextStart);
          // scheduleDate needs to be updated or it won't be delete-able
          expect(recurringSchedulerItem!.scheduledTestData.scheduleDate, "scheduleDate").to.equal(nextStart);
          done();
        }).catch((error) => done(error));
      } catch (error) {
        done(error);
      }
    });

    it("should startExistingTest recurring and remove from schedule", (done: Mocha.Done) => {
      try {
        expect(initialized, "loadTestsFromS3 failed. Can't run startScheduledItem").to.equal(true);
        expect(recurringSchedulerItem).to.not.equal(undefined);
        const timeBefore: number = Date.now();
        const testId: string = recurringSchedulerItem!.scheduledTestData.testMessage.testId;
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests()!;
        scheduledTests.set(testId, recurringSchedulerItem!);
        const sizeBefore: number = scheduledTests.size;
        updateNextStart(recurringSchedulerItem!, lastMinute);
        recurringSchedulerItem!.scheduledTestData.recurrence!.endDate = lastMinute;
        recurringSchedulerItem!.eventInput.endRecur = lastMinute;
        TestSchedulerIntegration.startScheduledItem(recurringSchedulerItem!)
        .then((testData: TestData | undefined) => {
          expect(testData).to.not.equal(undefined);
          expect(testData!.testId, "testId").to.equal(testId);
          expect(testData!.s3Folder, "s3Folder").to.equal(recurringSchedulerItem!.scheduledTestData.testMessage.s3Folder);
          expect(testData!.startTime, "startTime").to.not.equal(undefined);
          expect(testData!.startTime, "startTime").to.be.greaterThanOrEqual(timeBefore);
          expect(testData!.endTime, "endTime").to.not.equal(undefined);
          expect(testData!.status, "status").to.equal(TestStatus.Created);
          expect(testData!.userId, "userId").to.equal(recurringSchedulerItem!.userId);
          expect(scheduledTests.size, "size").to.equal(sizeBefore - 1);
          expect(scheduledTests.has(testId), `scheduledTests.has(${testId})`).to.equal(false);
          done();
        }).catch((error) => done(error));
      } catch (error) {
        done(error);
      }
    });
  });

  it("should save populated historical data to S3", (done: Mocha.Done) => {
    expect(historicalEvent).to.not.equal(undefined);
    const historicalTests: Map<string, EventInput> = new Map<string, EventInput>();
    TestSchedulerIntegration.setHistoricalTests(historicalTests);
    const testId: string = historicalEvent!.id as string;
    historicalTests.set(testId, historicalEvent!);
    TestSchedulerIntegration.saveHistoricalToS3()
    .then(() => {
      TestSchedulerIntegration.setHistoricalTests(undefined);
      sleep(2000).then(() =>
      TestSchedulerIntegration.loadHistoricalFromS3()
      .then(() => {
        const newHistoricalTests: Map<string, EventInput> | undefined = TestSchedulerIntegration.getHistoricalTests();
        expect(newHistoricalTests, "newHistoricalTests").to.not.equal(undefined);
        expect(newHistoricalTests!.size, "newHistoricalTests.size").to.equal(1);
        expect(newHistoricalTests!.has(testId), "newHistoricalTests.has(testId)").to.equal(true);
        expect(JSON.stringify(newHistoricalTests!.get(testId))).to.equal(JSON.stringify(historicalEvent!));
        done();
      })
      ).catch((error) => done(error));
    })
    .catch((error) => done(error));
  });

  it("should runHistoricalDelete and remove old HistoricalTests", (done: Mocha.Done) => {
    const historicalTests: Map<string, EventInput> = new Map<string, EventInput>();
    TestSchedulerIntegration.setHistoricalTests(historicalTests);
    const yamlFile = historicalEvent.title!;
    const historicalStartTime: number = Date.now() - ONE_WEEK;
    const oldHistoricalTestId = PpaasTestId.makeTestId(yamlFile).testId;
    const oldHistoricalEvent = {
      id: oldHistoricalTestId,
      title: yamlFile,
      start: historicalStartTime,
      end: historicalStartTime + THIRTY_MINUTES
    };
    const testId: string = historicalEvent.id!;
    expect(typeof testId, "typeof testId").to.equal("string");
    historicalTests.set(testId, historicalEvent);
    historicalTests.set(oldHistoricalTestId, oldHistoricalEvent);
    TestSchedulerIntegration.runHistoricalDelete(1)
    .then((historicalDeleted: number) => {
      log("runHistoricalDelete result: " + historicalDeleted, LogLevel.WARN, { historicalDeleted });
      expect(historicalDeleted).to.equal(1); // Should be just the one week ago removed
      const newHistoricalTests: Map<string, EventInput> | undefined = TestSchedulerIntegration.getHistoricalTests();
      expect(newHistoricalTests, "newHistoricalTests").to.not.equal(undefined);
      expect(newHistoricalTests!.size, "newHistoricalTests.size").to.equal(1);
      expect(newHistoricalTests!.has(testId), "newHistoricalTests.has(testId)").to.equal(true);
      expect(JSON.stringify(newHistoricalTests!.get(testId))).to.equal(JSON.stringify(historicalEvent!));
      done();
    })
    .catch((error) => done(error));
  });

  it("should save empty historical data to S3", (done: Mocha.Done) => {
    const historicalTests: Map<string, EventInput> = new Map<string, EventInput>();
    TestSchedulerIntegration.setHistoricalTests(historicalTests);
    TestSchedulerIntegration.saveHistoricalToS3()
    .then(() => {
      TestSchedulerIntegration.setHistoricalTests(undefined);
      TestSchedulerIntegration.loadHistoricalFromS3()
      .then(() => {
        const newHistoricalTests: Map<string, EventInput> | undefined = TestSchedulerIntegration.getHistoricalTests();
        expect(newHistoricalTests).to.not.equal(undefined);
        expect(newHistoricalTests!.size).to.equal(0);
        done();
      })
      .catch((error) => done(error));
    })
    .catch((error) => done(error));
  });

  it("should runHistoricalSearch and populate the HistoricalTests", (done: Mocha.Done) => {
    const historicalTests: Map<string, EventInput> = new Map<string, EventInput>();
    TestSchedulerIntegration.setHistoricalTests(historicalTests);
    TestSchedulerIntegration.runHistoricalSearch()
    .then(() => {
      const newHistoricalTests: Map<string, EventInput> | undefined = TestSchedulerIntegration.getHistoricalTests();
      expect(newHistoricalTests).to.not.equal(undefined);
      expect(newHistoricalTests!.size).to.be.greaterThan(0);
      log("newHistoricalTests.size: " + newHistoricalTests!.size, LogLevel.DEBUG, Array.from(newHistoricalTests!.keys()));
      expect(newHistoricalTests!.has(historicalTestId!.testId)).to.equal(true);
      expect(newHistoricalTests!.has(ppaasTestId!.testId)).to.equal(false);
      done();
    })
    .catch((error) => done(error));
  });

  // Must be run last since we'll delete the files
  describe("removeTest", () => {
    beforeEach(async () => {
      if (!scheduledTestData) { throw new Error("scheduledTestData not initialized"); }
      try {
        await TestSchedulerIntegration.loadTestsFromS3();
        initialized = true;
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests()!;
        if (scheduledTestData.scheduleDate < Date.now()) {
          scheduledTestData.scheduleDate = Date.now() + 600000;
        }
        const testScheduler: TestSchedulerIntegration = new TestSchedulerIntegration(scheduledTestData, authUser1.userId);
        scheduledTests.set(scheduledTestData.testMessage.testId, testScheduler);
        testAdded = true;
      } catch (error) {
        log("Error loading tests from s3", LogLevel.ERROR, error);
        throw error;
      }
    });

    afterEach(async () => {
      try {
        await TestSchedulerIntegration.loadTestsFromS3();
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests()!;
        scheduledTests.clear();
        testAdded = false;
      } catch (error) {
        log("Error clearing scheduledTests", LogLevel.ERROR, error);
        throw error;
      }
    });

    it("should remove a test", (done: Mocha.Done) => {
      try {
        expect(initialized, "loadTestsFromS3 failed. Can't run remove").to.equal(true);
        expect(testAdded, "Test Added failed. Can't run remove").to.equal(true); // Make sure the add succeeded
        expect(scheduledTestData).to.not.equal(undefined);
        const scheduledTests: Map<string, TestSchedulerItem> = TestSchedulerIntegration.getScheduledTests()!;
        const sizeBefore: number = scheduledTests.size;
        expect(sizeBefore).to.be.greaterThan(0);
        expect(scheduledTests.has(scheduledTestData!.testMessage.testId)).to.equal(true);
        TestSchedulerIntegration.removeTest(scheduledTestData!.testMessage.testId, authUser1, true)
        .then((errorResponse: ErrorResponse) => {
          expect(scheduledTests.size, "scheduledTests.size").to.equal(sizeBefore - 1);
          expect(scheduledTests.has(scheduledTestData!.testMessage.testId)).to.equal(false);
          expect(errorResponse).to.not.equal(undefined);
          expect(errorResponse.status).to.equal(200);
          Promise.all([file.existsInS3(), file1.existsInS3(), file2.existsInS3()])
          .then(([fileExists, file1Exists, file2Exists]) => {
            expect(fileExists, "fileExists").to.equal(false);
            expect(file1Exists, "file1Exists").to.equal(false);
            expect(file2Exists, "file2Exists").to.equal(false);
            done();
          }).catch((error) => done(error));
        }).catch((error) => done(error));
      } catch (error) {
        done(error);
      }
    });
  });
});
