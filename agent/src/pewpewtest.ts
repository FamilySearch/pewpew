import { ChildProcess, spawn } from "child_process";
import {
  LogLevel,
  MessageType,
  PpaasCommunicationsMessage,
  PpaasS3File,
  PpaasS3Message,
  PpaasTestId,
  PpaasTestMessage,
  PpaasTestStatus,
  TestMessage,
  TestStatus,
  TestStatusMessage,
  YamlParser,
  ec2,
  log,
  logger,
  s3,
  sqs,
  util
} from "@fs/ppaas-common";
import { WriteStream, createWriteStream } from "fs";
import fs from "fs/promises";
import { getHostname } from "./util/util";
import { join as pathJoin } from "path";
import { platform } from "os";
import semver from "semver";

logger.config.LogFileName = "ppaas-agent";
const logConfig = logger.config;
const { deleteTestScalingMessage, refreshTestScalingMessage } = sqs;
const { poll, sleep } = util;
const createStatsFileName = util.createStatsFileName;

const DEFAULT_PEWPEW_PARAMS = [
  "run",
  "-f", "json",
  "-w"
];

const PEWPEW_PATH: string = process.env.PEWPEW_PATH || "pewpew";
const DOWNLOAD_PEWPEW: boolean = (process.env.DOWNLOAD_PEWPEW || "false") === "true";
const LOCAL_FILE_LOCATION: string = process.env.LOCAL_FILE_LOCATION || process.env.TEMP || "/tmp";
const RESULTS_FILE_MAX_WAIT: number = parseInt(process.env.RESULTS_FILE_MAX_WAIT || "0", 10) || 5000; // S3_UPLOAD_INTERVAL + this Could take up to a minute
const KILL_MAX_WAIT: number = parseInt(process.env.KILL_MAX_WAIT || "0", 10) || 180000; // How long to wait between SIGINT (Ctrl-C) and SIGKILL
const ALLOW_TEST_OVERAGE: number = parseInt(process.env.ALLOW_TEST_OVERAGE || "0", 10) || 300000;
const SPLUNK_FORWARDER_EXTRA_TIME: number = parseInt(process.env.SPLUNK_FORWARDER_EXTRA_TIME || "0", 10) || 10000;
/** Have to run for at least 5 minutes for us to restart */
const MIN_RUNTIME_FOR_RETRY: number = parseInt(process.env.MIN_RUNTIME_FOR_RETRY || "0", 10) || 300000;
export const IS_RUNNING_IN_AWS: boolean = process.env.APPLICATION_NAME !== undefined && process.env.SYSTEM_NAME !== undefined;
/** Wait to start the test to make sure we don't scale in (ms) */
const TEST_START_DELAY_MIN_UPTIME: number = parseInt(process.env.TEST_START_DELAY_MIN_UPTIME || "0", 10) || (IS_RUNNING_IN_AWS ? 240000 : 30000);
/** Wait to start the test to make sure we don't scale in (ms) */
const TEST_START_DELAY_FOR_SCALE: number = parseInt(process.env.TEST_START_DELAY_FOR_SCALE || "0", 10) || (IS_RUNNING_IN_AWS ? 120000 : 3000);
/** Refresh our message on the queue (ms) */
const TEST_START_SLEEP_FOR_SCALE: number = parseInt(process.env.TEST_START_SLEEP_FOR_SCALE || "0", 10) || (IS_RUNNING_IN_AWS ? 30000 : 3000);
// How long should we sleep before we try to get another message if we get none and it comes back too fast
const COMMUCATION_NO_MESSAGE_DELAY: number = parseInt(process.env.COMMUCATION_NO_MESSAGE_DELAY || "0", 10) || (10 * 1000);
const VERSION_SPECIFIC_RESULTS_FILE: string = "0.5.4";
const VERSION_RESTART_TEST_AT_TIME: string = "0.5.5";
const TEN_MINUTES: number = 10 * 60000;

// Export for testing
export async function findYamlCreatedFiles (localPath: string, yamlFile: string, additionalFiles: string[] | undefined): Promise<string[] | undefined> {
  try {
    log(`findYamlCreatedFiles: ${localPath}}`, LogLevel.DEBUG);
    const files = await fs.readdir(localPath);
    log(`findYamlCreatedFiles files: ${files}}`, LogLevel.DEBUG);
    if (files) {
      additionalFiles = additionalFiles || [];
      // Find files that aren't the yamlFile or additionalFile, a results file, or the pewpew executable
      const YamlCreatedFiles = files.filter((file) => file !== yamlFile && !additionalFiles!.includes(file)
          && !(file.startsWith("stats-") && file.endsWith(".json")) && file !== "pewpew" && file !== "pewpew.exe");
      log(`YamlCreatedFiles: ${YamlCreatedFiles}}`, LogLevel.DEBUG);
      if (YamlCreatedFiles.length > 0) {
        return YamlCreatedFiles; // Don't return the joined path
      }
    }
    return undefined;
  } catch (error) {
    log("Could not Find Yaml Created Files", LogLevel.ERROR, error);
    throw error;
  }
}

// Export for testing
export function versionGreaterThan (currentVersion: string, compareVersion: string): boolean {
  // If the current version is latest then we're always greater than or equal to
  if (currentVersion === "latest") { return true; }
  // If the compareVersion is latest, then only currrentVersion=latest is greater
  if (compareVersion === "latest") { return false; }

  return semver.gt(currentVersion, compareVersion);
}

// Export for testing
export const getEndTime = (startTime: number, testRunTimeMn: number) => startTime + (testRunTimeMn * 60000);

// Export for testing
export function copyTestStatus (ppaasTestStatus: PpaasTestStatus, s3Status: TestStatusMessage | undefined, overwriteStatus: TestStatusMessage) {
  // Future proof if we add new things. Copy all properties over, then copy the new ones we created in.
  Object.assign(ppaasTestStatus, s3Status || {}, overwriteStatus);
}

/** instanceId doesn't change, so we'll save it after the first call as the instanceId or an Error */
let globalInstanceId: string | Error | undefined;
async function getInstanceId (): Promise<string> {
  if (typeof globalInstanceId === "string") {
    log("instanceId string: " + globalInstanceId, LogLevel.DEBUG, globalInstanceId);
    return globalInstanceId;
  }
  if (globalInstanceId instanceof Error) {
    log("instanceId instanceof Error", LogLevel.DEBUG, globalInstanceId);
    throw globalInstanceId;
  }

  try {
    log("instanceId getInstanceId", LogLevel.DEBUG, globalInstanceId);
    globalInstanceId = await ec2.getInstanceId();
    log("instanceId new string: " + globalInstanceId, LogLevel.DEBUG, globalInstanceId);
  } catch (error) {
    globalInstanceId = error;
    log("instanceId new Error: " + globalInstanceId, LogLevel.DEBUG, globalInstanceId);
    throw globalInstanceId;
  }
  return globalInstanceId;
}
if (IS_RUNNING_IN_AWS) {
  getInstanceId().catch((error: unknown) => log("Could not retrieve instanceId", LogLevel.ERROR, error));
}

export class PewPewTest {
  protected resultsFileMaxWait: number;
  protected started: boolean = false;
  protected pewpewRunning: boolean = false;
  protected uploadRunning: boolean = false;
  protected communicationsRunning: boolean = false;
  protected stopCalled: boolean = false;
  protected testMessage: PpaasTestMessage;
  protected ppaasTestId: PpaasTestId;
  protected ppaasTestStatus: PpaasTestStatus;
  protected startTime: Date | undefined;
  protected testEnd: number | undefined;
  protected pewpewEnd: number | undefined;
  protected localPath: string;
  protected pewpewProcess: ChildProcess | undefined;
  protected iteration: number;
  protected yamlS3File: PpaasS3File;
  protected additionalS3Files: PpaasS3File[] | undefined;
  protected pewpewStdOutS3File: PpaasS3File | undefined;
  protected pewpewStdErrS3File: PpaasS3File | undefined;
  protected pewpewResultsS3File: PpaasS3File | undefined;
  public static readonly serverStart: Date = new Date();

  public constructor (testMessage: PpaasTestMessage) {
    if (!testMessage.testId || !testMessage.s3Folder || !testMessage.yamlFile || (!testMessage.testRunTimeMn && !testMessage.bypassParser)) {
      log("testData was missing data", LogLevel.ERROR, testMessage.sanitizedCopy());
      throw new Error("New Test Message was missing testId, s3Folder, yamlFile, or testRunTime");
    }
    this.resultsFileMaxWait = testMessage.bucketSizeMs + RESULTS_FILE_MAX_WAIT;
    this.testMessage = testMessage;
    // Remove any invalid file characters from testId, or just allow letters, numbers, and dash/underscore
    this.testMessage.testId = this.testMessage.testId.replace(/[^\w\d-_]/g, "");
    this.ppaasTestId = PpaasTestId.getFromTestId(this.testMessage.testId);
    let ipAddress: string | undefined;
    let hostname: string | undefined;
    try {
      ipAddress = util.getLocalIpAddress();
      hostname = getHostname();
    } catch (error) {
      log("Could not retrieve ipAddress", LogLevel.ERROR, error);
    }
    // Save this data to put back in after we read the current info from s3 on delay
    const newTestStatus: TestStatusMessage = {
      startTime: Date.now(),
      endTime: getEndTime(Date.now(), this.testMessage.testRunTimeMn || 60),
      resultsFilename: [],
      status: TestStatus.Created,
      queueName: PpaasTestMessage.getAvailableQueueNames()[0], // Length will be 1 on the agents
      version: testMessage.version,
      ipAddress,
      hostname,
      userId: testMessage.userId
    };
    this.ppaasTestStatus = new PpaasTestStatus(this.ppaasTestId, newTestStatus);
    const s3Folder = this.testMessage.s3Folder;
    const localDirectory = this.localPath = pathJoin(LOCAL_FILE_LOCATION, this.testMessage.testId);
    this.yamlS3File = new PpaasS3File({ filename: this.testMessage.yamlFile, s3Folder, localDirectory });
    if (testMessage.additionalFiles && testMessage.additionalFiles.length > 0) {
      this.additionalS3Files = testMessage.additionalFiles.map((filename: string) =>
        new PpaasS3File({ filename, s3Folder, localDirectory }));
    }
    this.iteration = 0;
    // Load future additions on delay so we don't overwrite with undefined
    PpaasTestStatus.getStatus(this.ppaasTestId)
    .then((s3TestStatus: PpaasTestStatus | undefined) => {
      if (s3TestStatus) {
        copyTestStatus(this.ppaasTestStatus, s3TestStatus.getTestStatusMessage(), newTestStatus);
        log(`PpaasTestStatus.getStatus(${this.testMessage.testId}) found status`, LogLevel.DEBUG, {
          s3TestStatus: s3TestStatus.getTestStatusMessage(),
          newTestStatus,
          ppaasTestStatus: this.ppaasTestStatus.getTestStatusMessage()
        });
      } else {
        throw new Error(`PpaasTestStatus.getStatus(${this.testMessage.testId}) returned undefined`);
      }
    })
    .catch((error: any) => log("Could not retrieve PpaasTestStatus from s3 to save previous data", LogLevel.ERROR, error));
    getInstanceId()
    .then((instanceId: string) => {
      log("instanceId: " + instanceId, LogLevel.DEBUG);
      newTestStatus.instanceId = this.ppaasTestStatus.instanceId = instanceId;
    })
    .catch((error: unknown) => log("Could not retrieve instanceId", LogLevel.INFO, error));
  }

  // Create a sanitized copy which doesn't have the environment variables which may have passwords
  // eslint-disable-next-line @typescript-eslint/ban-types
  public sanitizedCopy (): {
    started: boolean,
    pewpewRunning: boolean,
    uploadRunning: boolean,
    communicationsRunning: boolean,
    stopCalled: boolean,
    testMessage: Omit<TestMessage, "envVariables"> & { envVariables: string[] },
    ppaasTestStatus: TestStatusMessage,
    startTime: Date | undefined,
    testEnd: number | undefined,
    pewpewEnd: number | undefined,
    localPath: string,
    pewpewProcess: ChildProcess | undefined,
    iteration: number,
    yamlS3File: string,
    additionalS3Files: string[] | undefined,
    pewpewStdOutS3File: string | undefined,
    pewpewStdErrS3File: string | undefined,
    pewpewResultsS3File: string | undefined,
    serverStart: Date
  } {
    return {
      started: this.started,
      pewpewRunning: this.pewpewRunning,
      uploadRunning: this.uploadRunning,
      communicationsRunning: this.communicationsRunning,
      stopCalled: this.stopCalled,
      testMessage: this.testMessage.sanitizedCopy(),
      ppaasTestStatus: this.ppaasTestStatus.sanitizedCopy(),
      startTime: this.startTime,
      testEnd: this.testEnd,
      pewpewEnd: this.pewpewEnd,
      localPath: this.localPath,
      pewpewProcess: this.pewpewProcess,
      iteration: this.iteration,
      yamlS3File: this.yamlS3File.remoteUrl,
      additionalS3Files: this.additionalS3Files ? this.additionalS3Files.map((file) => file.remoteUrl) : undefined,
      pewpewStdOutS3File: this.pewpewStdOutS3File?.remoteUrl,
      pewpewStdErrS3File: this.pewpewStdErrS3File?.remoteUrl,
      pewpewResultsS3File: this.pewpewResultsS3File?.remoteUrl,
      serverStart: PewPewTest.serverStart
    };
  }

  // Override toString so we can not log the environment variables which may have passwords
  public toString (): string {
    return JSON.stringify(this.sanitizedCopy());
  }

  public getStarted (): boolean {
    return this.started;
  }

  public getRunning (): boolean {
    return this.pewpewRunning;
  }

  public getTestId (): string | undefined {
    return this.testMessage.testId;
  }

  public getYamlFile (): string | undefined {
    return this.testMessage.yamlFile;
  }

  public getUserId (): string | undefined {
    return this.testMessage.userId || this.ppaasTestStatus.userId;
  }

  public getResultsFile (): string | undefined {
    return this.pewpewResultsS3File && this.pewpewResultsS3File.localFilePath;
  }

  public getResultsFileS3 (): string | undefined {
    return this.pewpewResultsS3File && this.pewpewResultsS3File.remoteUrl;
  }

  public getTestStatusMessage () {
    return this.ppaasTestStatus.getTestStatusMessage();
  }

  // Log wrapper that adds the testId
  protected log (message: string, level?: LogLevel, ...datas: any[]) {
    log(message, level, ...datas, { testId: this.testMessage.testId, yamlFile: this.testMessage.yamlFile });
  }

  protected async writeTestStatus () {
    try {
      await this.ppaasTestStatus.writeStatus();
    } catch (error) {
      this.log("Could not write ppaasTestStatus", LogLevel.ERROR, error, { ppaasTestStatus: this.ppaasTestStatus });
    }
  }

  protected async sendTestStatus (messageType: MessageType = MessageType.TestStatus) {
    const messageData: TestStatusMessage = this.ppaasTestStatus.getTestStatusMessage();
    try {
      const { testId } = this.testMessage;
      const messageId = await new PpaasCommunicationsMessage({ testId, messageType, messageData }).send();
      this.log(`Sent testStatus ${messageType}: " ${messageId}`, LogLevel.DEBUG, { messageData, messageId });
    } catch (error) {
      this.log("Could not send TestStatus", LogLevel.ERROR, error, { messageData });
    }
  }

  protected async refreshTestScalingMessage () {
    try {
      const messageId = await refreshTestScalingMessage();
      this.log(`Sent refreshTestScalingMessage: " ${messageId}`, LogLevel.DEBUG, {  messageId });
    } catch (error) {
      this.log("Error calling refreshTestScalingMessage", LogLevel.ERROR, error);
    }
  }

  protected async deleteTestScalingMessage () {
    try {
      const messageId = await deleteTestScalingMessage();
      this.log(`deleteTestScalingMessage: " ${messageId}`, LogLevel.DEBUG, {  messageId });
    } catch (error) {
      this.log("Error calling deleteTestScalingMessage", LogLevel.ERROR, error);
    }
  }

  /** * Retrieves a test from the SQS queue and returns a Test object ** */
  public static async retrieve (): Promise<PewPewTest | undefined> {
    const ppaasTestMessage: PpaasTestMessage | undefined = await PpaasTestMessage.getNewTestToRun();
    log(`getNewTestToRun() at ${Date.now()}`, LogLevel.DEBUG, ppaasTestMessage && ppaasTestMessage.sanitizedCopy());
    if (!ppaasTestMessage) { return undefined; }
    const newTest = new this(ppaasTestMessage);
    return newTest;
  }

  /** * Launches the pewpew process and waits for it to complete, throws on error ** */
  public async launch (): Promise<void> {
    try {
      // Keep alive
      await this.refreshTestScalingMessage();
      // Create Local Path
      try {
        await fs.mkdir(this.localPath); // What to do if it already exists?
      } catch (error) {
        if (!error || error.code !== "EEXIST") {
          throw error;
        }
      }
      this.log(`localPath created = ${this.localPath}`, LogLevel.DEBUG);

      // Download file(s)
      const yamlLocalPath: string = await this.yamlS3File.download(true);
      this.log(`getFile(${this.testMessage.yamlFile}) result = ${yamlLocalPath}`, LogLevel.DEBUG);
      // Always call this even if it isn't logged to make sure the file downloaded
      this.log(`fs.access(${yamlLocalPath}) stats = ${JSON.stringify(await fs.access(yamlLocalPath))}`, LogLevel.DEBUG);

      let pewpewPath = PEWPEW_PATH;
      // Download the pewpew executable if needed
      if (DOWNLOAD_PEWPEW) {
        // version check in the test message
        const version = this.testMessage.version || "latest";
        const localDirectory = this.localPath;
        const s3Folder = "pewpew/" + version;
        this.log(`os.platform() = ${platform()}`, LogLevel.DEBUG, { version, s3Folder });
        if (platform() === "win32") {
          const pewpewS3File: PpaasS3File = new PpaasS3File({
            filename: "pewpew.exe",
            s3Folder,
            localDirectory
          });
          pewpewPath = await pewpewS3File.download(true);
          this.log(`getFile(pewpew.exe) result = ${pewpewPath}`, LogLevel.DEBUG);
        } else {
          // If the version isn't there, this will throw (since we can't find it)
          const pewpewS3File: PpaasS3File = new PpaasS3File({
            filename: "pewpew",
            s3Folder,
            localDirectory
          });
          pewpewPath = await pewpewS3File.download(true);
          this.log(`getFile(pewpew) result = ${pewpewPath}`, LogLevel.DEBUG);
          // We need to make it executable
          await fs.chmod(pewpewPath, 0o775);
        }
        // Always call this even if it isn't logged to make sure the file downloaded
        this.log(`fs.stat(${pewpewPath}) access = ${JSON.stringify(await fs.access(pewpewPath))}`, LogLevel.DEBUG);
      }

      // Download Additional Files after pewpew so we can push custom pewpew binaries as part of our tests (if needed)
      if (this.additionalS3Files && this.additionalS3Files.length > 0) {
        for (const s3File of this.additionalS3Files) {
          const additionalFile: string = await s3File.download(true);
          this.log(`getFile(${s3File.localFilePath}) result = ${additionalFile}`, LogLevel.DEBUG);
          // Always call this even if it isn't logged to make sure the file downloaded
          this.log(`fs.access(${additionalFile}) stats = ${JSON.stringify(await fs.access(additionalFile))}`, LogLevel.DEBUG);
        }
      }

      // Create the log files
      const pewpewParams = [...DEFAULT_PEWPEW_PARAMS, "-d", this.localPath, yamlLocalPath];
      // Splunk log, Stdout, and Stderr going to S3. Write to Splunk directory then upload to S3
      // These must be named app*.json
      const s3Folder = this.testMessage.s3Folder;
      this.pewpewStdOutS3File = new PpaasS3File({
        filename: logger.pewpewStdOutFilename(this.testMessage.testId),
        s3Folder,
        localDirectory: logConfig.LogFileLocation,
        tags: s3.defaultTestExtraFileTags()
      });
      this.log(`pewpewStdOutFilename = ${this.pewpewStdOutS3File.localFilePath}`, LogLevel.DEBUG);
      this.pewpewStdErrS3File =  new PpaasS3File({
        filename: logger.pewpewStdErrFilename(this.testMessage.testId),
        s3Folder,
        localDirectory: logConfig.LogFileLocation,
        tags: s3.defaultTestExtraFileTags()
      });
      this.log(`pewpewStdErrS3File = ${this.pewpewStdErrS3File.localFilePath}`, LogLevel.DEBUG);

      // Don't clone the current environment for security. Create a new environment only with the test environment variables
      // Create a few variations of SPLUNK_PATH/SPLUNK_LOCATION for tests to use
      for (const splunkPath of logger.PEWPEW_SPLUNK_INJECTED_VARIABLES) {
        this.testMessage.envVariables[splunkPath] = logConfig.LogFileLocation;
      }
      if (this.testMessage.envVariables["RUST_BACKTRACE"] === undefined) {
        this.testMessage.envVariables.RUST_BACKTRACE = "1";
      }
      if (this.testMessage.envVariables["RUST_LOG"] === undefined) {
        this.testMessage.envVariables.RUST_LOG = "warn";
      }
      this.log("envVariables", LogLevel.DEBUG, Object.keys(this.testMessage.envVariables));
      this.log("envVariables", LogLevel.TRACE, this.testMessage.envVariables);
      // There is still a race condition where this ec2 instance is slated for scale in
      // But hasn't scaled in yet. We get like 30 seconds of run, then the instance dies.
      // We'll sleep for 90 seconds, but refresh our lockout every 30 seconds
      const testDelayStart: number = Date.now();
      const serverUptime: number = testDelayStart - PewPewTest.serverStart.getTime();
      // Check if the machine just came up and don't delay.
      log("testDelayStart", LogLevel.DEBUG, { testDelayStart, serverUptime, date: new Date(testDelayStart), serverStart: PewPewTest.serverStart, TEST_START_DELAY_MIN_UPTIME, TEST_START_DELAY_FOR_SCALE });
      let loopCount: number = 0;
      // If the server has been up less than 5 minutes/TEST_START_DELAY_MIN_UPTIME, don't wait
      // If the server has been up more than TEST_START_DELAY_MIN_UPTIME, then sleep (and refresh) TEST_START_DELAY_FOR_SCALE
      while (serverUptime > TEST_START_DELAY_MIN_UPTIME && Date.now() - testDelayStart < TEST_START_DELAY_FOR_SCALE) {
        await sleep(TEST_START_SLEEP_FOR_SCALE);
        await this.refreshTestScalingMessage();
        await this.testMessage.extendMessageLockout();
        log("refreshTestScalingMessage && extendMessageLockout loop " + loopCount++, LogLevel.DEBUG);
      }
      log("refreshTestScalingMessage && extendMessageLockout end", LogLevel.DEBUG, { testDelayStart, testDelayEnd: Date.now(), diff: Date.now() - testDelayStart});
      this.startTime = new Date();
      this.testEnd = getEndTime(this.startTime.getTime(), this.testMessage.testRunTimeMn || 60);
      this.ppaasTestStatus.startTime = this.startTime.getTime();
      this.ppaasTestStatus.endTime = this.testEnd;
      const minTimeForRetry = this.startTime.getTime() + MIN_RUNTIME_FOR_RETRY;
      this.started = true;
      let pewpewRestart;
      do {
        this.pewpewRunning = true;
        pewpewRestart = false;
        // Launch the test
        const pewpewPromise = new Promise<void>((resolve, reject) => {
          // Add named results file and restart at position
          const pewpewParamsThisRun: string[] = [...pewpewParams];
          if (versionGreaterThan(this.testMessage.version, VERSION_SPECIFIC_RESULTS_FILE)) {
            pewpewParamsThisRun.push("-o", createStatsFileName(this.testMessage.testId, this.iteration));
          }
          // If we're on a second run through, and we have a version that supports it, start at x seconds
          if (this.iteration > 0 && versionGreaterThan(this.testMessage.version, VERSION_RESTART_TEST_AT_TIME)) {
            pewpewParamsThisRun.push("-t", `${Math.round((Date.now() - this.startTime!.getTime()) / 1000)}s`);
          }
          const pewpewOutStream: WriteStream = createWriteStream(this.pewpewStdOutS3File!.localFilePath, { flags: "a" });
          const pewpewErrorStream: WriteStream = createWriteStream(this.pewpewStdErrS3File!.localFilePath, { flags: "a" });
          this.log(`Running ${this.iteration}: ${pewpewPath} ${pewpewParamsThisRun.join(" ")}`, LogLevel.DEBUG, pewpewParams);
          const pewpewProcess = spawn(pewpewPath, pewpewParamsThisRun, { cwd: this.localPath, env: this.testMessage.envVariables })
          .on("error", (e: any) => {
            this.log(`pewpew error: ${e instanceof Error ? e.message : e}`, LogLevel.ERROR, e);
            this.internalStop().catch((error) => this.log("error stopping", LogLevel.ERROR, error));
            reject(e);
          })
          .on("exit", (code: number, signal: string) => {
            this.pewpewRunning = false;
            this.pewpewEnd = Date.now();
            const message = `pewpew exited with code ${code} and signal ${signal}`;
            if (code !== 0) {
              this.ppaasTestStatus.errors = [...(this.ppaasTestStatus.errors || []), message];
            }
            if (code === 0 || signal === "SIGINT") {
              this.log(message, signal === "SIGINT" ? LogLevel.WARN : LogLevel.INFO);
              // We still want to resolve on SIGINT (stop called) so we don't get errors down the line. Just log one warning here
              resolve();
            } else {
              this.log(message, LogLevel.ERROR);
              reject(message);
            }
            this.pewpewProcess = undefined;
            try { // Close the streams
              pewpewOutStream.end();
              pewpewErrorStream.end();
            } catch (error) {
              this.log("stream.end() failed for pewpew out or error write file stream", LogLevel.ERROR, error);
            }
          });
          this.pewpewProcess = pewpewProcess;
          // Wait for open events
          pewpewOutStream.on("open", () => pewpewProcess.stdout.pipe(pewpewOutStream)); // To Splunk and S3
          pewpewErrorStream.on("open", () => pewpewProcess.stderr.pipe(pewpewErrorStream)); // To Splunk and S3
          // We want pewpew to die if we die. It's better to restart the test than to have an orphaned process that isn't being uploaded to s3
          // pewpewProcess.unref(); // Allows the parent (this) to exit without waiting for pewpew to exit
          this.log(`Removing Start Test Message from queue ${this.testMessage.receiptHandle}`, LogLevel.DEBUG);
          this.testMessage.deleteMessageFromQueue().catch((error) => this.log(`Could not remove Start Test message from from queue: ${this.testMessage.receiptHandle}`, LogLevel.ERROR, error));
        });
        const promises = [pewpewPromise, this.pollAndUploadResults(), this.pollCommunications()];
        try {
          await Promise.all(promises);
          if (!this.stopCalled && (Date.now() < this.testEnd - 60000) && !this.testMessage.bypassParser) {
            // If we're less than a minute before what should be the end and we exited gracefully, log it
            const message = "Pewpew exited gracefully early without stop being called. Check the loggers and providers.";
            this.ppaasTestStatus.errors = [...(this.ppaasTestStatus.errors || []), message];
            this.log(message, LogLevel.WARN);
          }
        } catch (error) {
          if (!this.stopCalled && this.testMessage.restartOnFailure && Date.now() > minTimeForRetry && (this.testMessage.bypassParser || Date.now() < this.testEnd)) {
            // log it, but continue
            const errorMessage = `launch test error: ${error && error.message ? error.message : error}, restartOnFailure: ${this.testMessage.restartOnFailure}`;
            this.log(errorMessage, LogLevel.ERROR, error);
            // Send error communications message
            this.ppaasTestStatus.errors = [...(this.ppaasTestStatus.errors || []), errorMessage];
            await Promise.all([
              this.sendTestStatus(MessageType.TestError),
              this.writeTestStatus() // write error status
            ]);
            if (this.pewpewRunning) {
              // Call stop and wait to restart
              await this.internalStop();
              // eslint-disable-next-line require-await
              await poll(async (): Promise<boolean | undefined> => {
                return !this.pewpewProcess || !this.pewpewRunning;
              }, 5000, (errMsg: string) => `${errMsg} Could not stop PewPew. Can't restartOnFailure`);
            }
            if (this.uploadRunning) {
              // Wait for it to finish
              // eslint-disable-next-line require-await
              await poll(async (): Promise<boolean> => {
                return !this.uploadRunning;
              }, this.testMessage.bucketSizeMs + 5000, (errMsg: string) => `${errMsg} pollAndUploadResults never completed. Can't restartOnFailure`);
            }
            if (this.communicationsRunning) {
              // Wait for it to finish
              // eslint-disable-next-line require-await
              await poll(async (): Promise<boolean> => {
                return !this.communicationsRunning;
              }, this.testMessage.bucketSizeMs + 5000, (errMsg: string) => `${errMsg} pollCommunications never completed. Can't restartOnFailure`);
            }
            if (this.testMessage.bypassParser || Date.now() < this.testEnd) {
              // If we're still less than the end after all the waits restart.
              pewpewRestart = true;
            }
          } else {
            // We're either still running, we don't have restart, we haven't run long enough, or too long. Throw away
            if (!this.stopCalled && this.testMessage.restartOnFailure && Date.now() < minTimeForRetry) {
              this.ppaasTestStatus.errors = [...(this.ppaasTestStatus.errors || []), `pewpew did not run for at least ${MIN_RUNTIME_FOR_RETRY / 1000} seconds. Test ran for ${Math.round((Date.now() - this.startTime.getTime()) / 1000)} seconds.`];
            }
            throw error;
          }
        }
        // Keep trying while we're not running, we haven't had stop called, we are supposed to restart, we've run for a minimum amount of time and we shouldn't be done
        this.iteration++;
      } while (!this.pewpewRunning && !this.uploadRunning && !this.communicationsRunning && !this.stopCalled && this.testMessage.restartOnFailure && pewpewRestart);
      // this is exiting gracefully
      // Send finished communications message and update teststatus
      this.ppaasTestStatus.status = TestStatus.Finished;
      this.ppaasTestStatus.endTime = this.pewpewEnd ? this.pewpewEnd + SPLUNK_FORWARDER_EXTRA_TIME : Date.now(); // Extra time for the splunk agent to write
      await Promise.all([
        this.sendTestStatus(MessageType.TestFinished),
        this.writeTestStatus() // Final write
      ]);
    } catch (error) {
      const errorMessage = `launch test error: ${error && error.message ? error.message : error}`;
      this.ppaasTestStatus.errors = [...(this.ppaasTestStatus.errors || []), errorMessage];
      this.log(errorMessage, LogLevel.ERROR, error);
      try {
        await this.internalStop();
      } catch (err) {
        this.log("Could not stop the pewpew process", LogLevel.ERROR, err);
      }
      // Send failed communications message and update teststatus
      this.ppaasTestStatus.status = TestStatus.Failed;
      this.ppaasTestStatus.endTime = this.pewpewEnd ? this.pewpewEnd + SPLUNK_FORWARDER_EXTRA_TIME : Date.now(); // Extra time for the splunk agent to write
      await Promise.all([
        this.sendTestStatus(MessageType.TestFailed),
        this.writeTestStatus() // Final write
      ]);
      throw error;
    } finally {
      // Let us scale back in
      await this.deleteTestScalingMessage();
    }
  }

  protected async internalStop (): Promise<void> {
    // The exit command itself will set this back to undefined
    if (this.pewpewProcess && this.pewpewRunning) {
      try {
        this.log(`Stopping pewpew process with SIGINT ${this.pewpewProcess.pid}`, LogLevel.INFO);
        const intResult = this.pewpewProcess.kill("SIGINT"); // We be nice to them if they be nice to us.
        this.log(`pewpew process SIGINT result: ${intResult}`, intResult ? LogLevel.INFO : LogLevel.WARN);
        // Poll for the process to stop.
        // eslint-disable-next-line require-await
        await poll(async (): Promise<boolean | undefined> => {
          return !this.pewpewProcess || !this.pewpewRunning;
        }, KILL_MAX_WAIT, (errMsg: string) => `${errMsg} SIGINT did not stop pewpew. We gave it a chance, now it's personal.`)
        .catch((error) => this.log("SIGINT did not stop pewpew", LogLevel.ERROR, error));
        if (this.pewpewProcess && this.pewpewRunning) {
          await this.internalKill();
        } else {
          this.log("pewpew process stopped with SIGINT", LogLevel.INFO);
        }
      } catch (error) {
        this.log(`Caught error stopping pewpew ${error}`, LogLevel.ERROR, error);
      }
    } else {
      this.log("Stop called with no pewpew process", LogLevel.DEBUG);
    }
  }

  protected async internalKill (): Promise<void> {
    // The exit command itself will set this back to undefined
    if (this.pewpewProcess && this.pewpewRunning) {
      try {
        this.log(`Stopping pewpew process with SIGKILL ${this.pewpewProcess.pid}`, LogLevel.WARN);
        const killResult = this.pewpewProcess.kill("SIGKILL"); // We gave it a chance, now it's personal.
        this.log(`pewpew process SIGKILL result: ${killResult}`, LogLevel.WARN);
        // Poll for the process to stop.
        // eslint-disable-next-line require-await
        await poll(async (): Promise<boolean | undefined> => {
          return !this.pewpewProcess || !this.pewpewRunning;
        }, KILL_MAX_WAIT, (errMsg: string) => `${errMsg} SIGINT did not stop pewpew. We gave it a chance, now it's personal.`)
        .catch((error) => this.log("SIGINT did not stop pewpew", LogLevel.ERROR, error));
      } catch (error) {
        this.log(`Caught error killing pewpew ${error}`, LogLevel.ERROR, error);
      }
    } else {
      this.log("Kill called with no pewpew process", LogLevel.DEBUG);
    }
  }

  // Public version to tell from when it's called internally
  /**
   * Stops the currently running test (if running). Does nothing if it's stopped
   * @param killTest {boolean} Optional: If true, a SIGKILL is immediately sent rather than a SIGINT
   * @returns {Promise<void>}
   */
  public stop (killTest?: boolean): Promise<void> {
    this.stopCalled = true;
    this.ppaasTestStatus.errors = [...(this.ppaasTestStatus.errors || []), `Received ${killTest ? "KillTest" : "StopTest"} message from controller`];
    return killTest ? this.internalKill() : this.internalStop();
  }

  /** * Polls for the results file then uploads it every minute ** */
  protected async pollAndUploadResults (): Promise<void> {
    this.uploadRunning = true;
    try {
      let pewpewResultsFilename: string;
      if (versionGreaterThan(this.testMessage.version, VERSION_SPECIFIC_RESULTS_FILE)) {
        pewpewResultsFilename = createStatsFileName(this.testMessage.testId, this.iteration);
        this.log(`Checking for results file: ${pewpewResultsFilename}`, LogLevel.DEBUG);
        await poll(async (): Promise<boolean> => {
          const files = await fs.readdir(this.localPath);
          return files && files.includes(pewpewResultsFilename);
        }, this.resultsFileMaxWait, (errMsg: string) => `${errMsg} Could not find the pewpew results file: ${pewpewResultsFilename}`);
      } else {
        this.log(`Checking for results file in: ${this.localPath}`, LogLevel.DEBUG);
        pewpewResultsFilename = await poll(async (): Promise<string> => {
          const files = await fs.readdir(this.localPath);
          if (files) {
            // Ignore previous runs from restartOnFailure
            const jsonFiles = files.filter((file) => file.startsWith("stats-") && file.endsWith(".json") && !this.ppaasTestStatus.resultsFilename.includes(file)).sort();
            if (jsonFiles.length > 0) {
              return jsonFiles[jsonFiles.length - 1]; // We need to return the full joined path
            }
          }
          return "";
        }, this.resultsFileMaxWait, (errMsg: string) => `${errMsg} Could not find the pewpew results file in: ${this.localPath}`);
      }
      // If we never get results we can throw here, but otherwise should swallow it until we're done and upload the final results
      this.ppaasTestStatus.resultsFilename.push(pewpewResultsFilename); // Save it in case we have restartOnFailure
      this.pewpewResultsS3File = new PpaasS3File({
        filename: pewpewResultsFilename,
        s3Folder: this.testMessage.s3Folder,
        localDirectory: this.localPath,
        publicRead: true
      });
      this.log(`${this.testMessage.yamlFile} New Result File Found: ${pewpewResultsFilename}`, LogLevel.INFO, { pewpewResultsFilename });
      // Send status communications message and update teststatus
      this.ppaasTestStatus.status = TestStatus.Running;
      await Promise.all([
        this.sendTestStatus(),
        this.writeTestStatus()
      ]);

      let iteration = 0;
      // Initially we want them all to upload, so zero out the last upload time
      const yamlCreatedFiles: Map<string, PpaasS3File> = new Map<string, PpaasS3File>();
      // Keep running until the pewpew process ends, or we're more than the allowed overrage. Then upload everything regardless and exit
      while (this.pewpewRunning && (this.testMessage.bypassParser || (Date.now() < this.testEnd! + ALLOW_TEST_OVERAGE))) {
        const endLoop: number = Date.now() + this.testMessage.bucketSizeMs;
        try {
          this.log(`Polling PewPew Results. iteration: ${iteration++}`, LogLevel.DEBUG);
          // Only upload the file if it's changed. Only the results file should be public
          await this.pewpewResultsS3File.upload();
          if (iteration === 1) {
            this.log(`${this.testMessage.yamlFile} Result URL: ${this.pewpewResultsS3File.remoteUrl}`, LogLevel.INFO, { url: this.pewpewResultsS3File.remoteUrl });
          }
          await this.pewpewStdOutS3File!.upload();
          await this.pewpewStdErrS3File!.upload();

          // Check for additional files created in the localPath
          const foundFiles = await findYamlCreatedFiles(this.localPath, this.testMessage.yamlFile, this.testMessage.additionalFiles);
          if (foundFiles) {
            for (const foundFile of foundFiles) {
              if (!yamlCreatedFiles.has(foundFile)) {
                // Initially we want them all to upload, so zero out the last upload time
                const foundS3File: PpaasS3File = new PpaasS3File({
                  filename: foundFile,
                  s3Folder: this.testMessage.s3Folder,
                  localDirectory: this.localPath,
                  tags: s3.defaultTestExtraFileTags()
                });
                yamlCreatedFiles.set(foundFile, foundS3File);
              }
            }
          }
          // If we found additional files, upload them!
          if (yamlCreatedFiles.size > 0) {
            for (const s3File of yamlCreatedFiles.values()) {
              await s3File.upload();
            }
          }
          // If we are bypassing the config parser we need to constantly push out the endtimes if we are longer than an hour.
          if (this.testMessage.bypassParser && (Date.now() + TEN_MINUTES > this.ppaasTestStatus.endTime)) {
            this.ppaasTestStatus.endTime = this.testEnd = Date.now() + TEN_MINUTES;
          }
          // Send status communications message every loop
          await this.sendTestStatus();
          // Keep alive every loop
          await this.refreshTestScalingMessage();
        } catch (error) {
          this.log(`Polling PewPew Results Error. iteration: ${iteration}`, LogLevel.ERROR, error);
        }
        if (Date.now() < endLoop) {
          // Sleep up to testData.bucketSizeMs seconds for next bucket, but return early if pewpew isn't running
          // eslint-disable-next-line require-await
          await poll(async (): Promise<boolean> => {
            return !this.pewpewRunning || Date.now() > endLoop;
          }, endLoop - Date.now() + 5000) // Poll needs a duration, so 5 seconds longer than the poll should exit
          .catch((error) => this.log("Poll and Upload Loop Sleep failed", LogLevel.ERROR, error));
        }
      }
      this.log(`Polling PewPew Results Loop ended. this.running: ${this.pewpewRunning}`, LogLevel.DEBUG);

      // Test should be done or went over
      // Communications loop should stop the test
      if (this.pewpewRunning) {
        // Wait for the process to exit, but upload even if it doesn't stop
        try {
          // eslint-disable-next-line require-await
          await poll(async (): Promise<boolean | undefined> => {
            return !this.pewpewProcess || !this.pewpewRunning;
          }, 60000, (errMsg: string) => `${errMsg} PewPew never exited. Uploading final results anyway.`);
        } catch (error) {
          this.log("Pewpew never exited.", LogLevel.ERROR, error);
          // Send error communications message
          this.ppaasTestStatus.errors = [...(this.ppaasTestStatus.errors || []), "Pewpew never exited."];
          await this.sendTestStatus(MessageType.TestError);
        }
      }
      // Upload the final results. Only the results file should be public
      const fileUploads = [
        this.pewpewResultsS3File.upload(true, true),
        this.pewpewStdOutS3File!.upload(true, true),
        this.pewpewStdErrS3File!.upload(true, true)
      ];
      // If we found additional files, upload them!
      if (yamlCreatedFiles.size > 0) {
        for (const s3File of yamlCreatedFiles.values()) {
          fileUploads.push(s3File.upload(true, true));
        }
      }
      await Promise.all(fileUploads);
      if (this.pewpewRunning) {
        throw new Error("pollAndUploadResults exited, but pewpew still running");
      }
    } finally {
      this.uploadRunning = false;
    }
  }

  /** * Polls the communications queue for messages from the controller ** */
  protected async pollCommunications (): Promise<void> {
    this.communicationsRunning = true;
    log("Starting Communications Loop", LogLevel.INFO);
    try {
      let iteration = 0;
      // Keep running until the pewpew process ends, or we're more than the allowed overrage. Then upload everything regardless and exit
      while (this.pewpewRunning && (this.testMessage.bypassParser || (Date.now() < this.testEnd! + ALLOW_TEST_OVERAGE))) {
        this.log(`Polling PewPew Communications. iteration: ${iteration++}`, LogLevel.DEBUG);
        // Normally the getAnyMessageForController should take 20 seconds if there is no message in the queue.
        // If there are messages (even if they're not for us) it will return immediately. We should have a sleep time if we don't get a message
        let messageToHandle: PpaasS3Message | undefined;
        const endLoop: number = Date.now() + COMMUCATION_NO_MESSAGE_DELAY;
        try {
          messageToHandle = await PpaasS3Message.getMessage(this.ppaasTestId);
        } catch (error) {
          this.log("Error trying to get communications message", LogLevel.ERROR, error);
          await sleep(5000);
        }
        if (messageToHandle) {
          this.log(`New message received at ${new Date()}: ${messageToHandle.messageType}`, LogLevel.DEBUG, messageToHandle.sanitizedCopy());
          // Process message and start a test
          try {
            switch (messageToHandle.messageType) {
              case MessageType.StopTest:
                this.log(`Received ${messageToHandle.messageType} for ${this.testMessage.testId}. Stopping test.`, LogLevel.INFO);
                // Call the external, not internal stop
                this.stop().catch(() => { /* logs automatically */ });
                this.log(`handleMessage Complete ${messageToHandle.messageType}`, LogLevel.DEBUG, messageToHandle);
                break;
                case MessageType.KillTest:
                  this.log(`Received ${messageToHandle.messageType} for ${this.testMessage.testId}. Killing test.`, LogLevel.WARN);
                  this.stop(true).catch(() => { /* logs automatically */ });
                  this.log(`handleMessage Complete ${messageToHandle.messageType}`, LogLevel.DEBUG, messageToHandle);
                break;
              case MessageType.UpdateYaml:
                this.log(`Received ${messageToHandle.messageType} for ${this.testMessage.testId}. Updating Yaml.`, LogLevel.INFO);
                // Download the new file
                await this.yamlS3File.download();
                // Check and edit the new run time
                // Check the bypass parser.
                if (!this.testMessage.bypassParser) {
                  try {
                    const yamlParser: YamlParser = await YamlParser.parseYamlFile(this.yamlS3File.localFilePath, this.testMessage.envVariables);
                    const newRuntime = yamlParser.getTestRunTimeMn();
                    this.log(`${this.getYamlFile()} testRunTimeMn ${newRuntime}. Old testRunTimeMn ${this.testMessage.testRunTimeMn}.`, LogLevel.DEBUG);
                    if (newRuntime !== this.testMessage.testRunTimeMn && this.startTime) {
                      this.testMessage.testRunTimeMn = newRuntime;
                      this.testEnd = getEndTime(this.startTime.getTime(), this.testMessage.testRunTimeMn);
                      this.log(`${this.getYamlFile()} new testRunTimeMn ${newRuntime}. Updating.`, LogLevel.INFO,
                        { testRunTimeMn: this.testMessage.testRunTimeMn, startTime: this.startTime.getTime(), testEnd: this.testEnd });
                      this.ppaasTestStatus.endTime = this.testEnd;
                      await this.writeTestStatus();
                    }
                  } catch (error) {
                    const message: string = `Could not parse new yaml file ${this.getYamlFile()}`;
                    this.log(message, LogLevel.ERROR, error);
                    // Send error to communications queue
                    const errorMessage = new PpaasCommunicationsMessage({
                      testId: this.testMessage.testId,
                      messageType: MessageType.TestError,
                      messageData: { message, error }
                    });
                    errorMessage.send().catch((sendError) => this.log("Could not send error communications message to controller", LogLevel.ERROR, sendError));
                  }
                }
                this.log(`handleMessage Complete ${messageToHandle.messageType}`, LogLevel.DEBUG, messageToHandle);
                break;
              default:
                this.log(`The agent cannot handle messages of this type at this time. Removing from queue: ${messageToHandle.messageType}`, LogLevel.WARN, messageToHandle.sanitizedCopy());
                break;
            }
            await messageToHandle.deleteMessageFromS3();
          } catch (error) {
            this.log("Error handling message", LogLevel.ERROR, error, messageToHandle && messageToHandle.sanitizedCopy());
            // Report to Controller
            messageToHandle = undefined;
          }
        } else {
          this.log(`No message received at ${new Date()}`, LogLevel.DEBUG);
        }
        if (Date.now() < endLoop) {
          // PpaasS3Message.getMessage() is instant so we want to sleep until we need to recheck.
          // Sleep up to COMMUCATION_NO_MESSAGE_DELAY seconds for next check, but return early if pewpew isn't running
          // eslint-disable-next-line require-await
          await poll(async (): Promise<boolean> => {
            return !this.pewpewRunning || Date.now() > endLoop;
          }, endLoop - Date.now() + 5000) // Poll needs a duration, so 5 seconds longer than the poll should exit
          .catch((error) => this.log("Communications Loop Sleep failed", LogLevel.ERROR, error));
        }
      }
      this.log(`Polling PewPew Communications Loop ended. this.running: ${this.pewpewRunning}`, LogLevel.DEBUG);

      // Test should be done or went over
      // Stop the test
      if (this.pewpewRunning) {
        try {
          // Send error communications message
          const errorMessage = `Pewpew still running after estimated end time: ${this.testEnd}. Stopping Test`;
          this.log(errorMessage, LogLevel.WARN, { testEnd: this.testEnd });
          this.ppaasTestStatus.errors = [...(this.ppaasTestStatus.errors || []), errorMessage];
          await Promise.all([
            this.sendTestStatus(MessageType.TestError),
            this.writeTestStatus(),
            this.internalStop()
          ]);
        } catch (err) {
          this.log("Could not stop the pewpew process", LogLevel.ERROR, err);
        }
        // Keep trying to check and kill the pewpew process?
        while (this.pewpewProcess && this.pewpewRunning) {
          try {
            // Send error communications message
            const errorMessage = `Pewpew still running after estimated end time: ${this.testEnd}. Stopping Test`;
            this.log(errorMessage, LogLevel.ERROR, { testEnd: this.testEnd });
            await this.internalStop();
            if (this.pewpewRunning) {
              await sleep(10000);
            }
          } catch (err) {
            this.log("Could not stop the pewpew process", LogLevel.ERROR, err);
          }
        }
      }
    } finally {
      this.communicationsRunning = false;
    }
  }
}
