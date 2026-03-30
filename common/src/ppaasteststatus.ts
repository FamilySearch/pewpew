import {
  KEYSPACE_PREFIX,
  SHARED_ENVIRONMENT_PREFIX,
  defaultTestFileTags,
  getFileContents as getFileContentsS3,
  getTags,
  init as initS3,
  listFiles,
  uploadFileContents
} from "./util/s3.js";
import { LogLevel, log } from "./util/log.js";
import { TestStatus, TestStatusMessage } from "../types/index.js";
import PpaasTestId from "./ppaastestid.js";
import { _Object as S3Object } from "@aws-sdk/client-s3";

export const createS3Filename = (ppaasTestId: PpaasTestId): string => `${ppaasTestId.testId}.info`;

export const getKey = (ppaasTestId: PpaasTestId): string => `${ppaasTestId.s3Folder}/${createS3Filename(ppaasTestId)}`;

export class PpaasTestStatus implements TestStatusMessage {
  public instanceId: string | undefined;
  public hostname: string | undefined;
  public ipAddress: string | undefined;
  public startTime: number;
  public endTime: number;
  public resultsFilename: string[];
  public status: TestStatus;
  public errors: string[] | undefined;
  public version?: string;
  public queueName?: string;
  public userId?: string;
  protected ppaasTestId: PpaasTestId;
  protected lastModifiedRemote: Date;
  protected url: string | undefined;
  public tags: Map<string, string> = defaultTestFileTags();

  // The receiptHandle is not in the constructor since sending messages doesn't require it. Assign it separately
  public constructor (ppaasTestId: PpaasTestId,
    testStatusMessage: TestStatusMessage) {
    try {
      initS3();
    } catch (error: unknown) {
      log("Could not initialize s3", LogLevel.WARN, error);
      throw error;
    }
    this.ppaasTestId = ppaasTestId;
    this.instanceId = testStatusMessage.instanceId;
    this.hostname = testStatusMessage.hostname;
    this.ipAddress = testStatusMessage.ipAddress;
    this.startTime = testStatusMessage.startTime;
    this.endTime = testStatusMessage.endTime;
    this.resultsFilename = testStatusMessage.resultsFilename;
    this.status = testStatusMessage.status;
    this.errors = testStatusMessage.errors;
    this.version = testStatusMessage.version;
    this.queueName = testStatusMessage.queueName;
    this.userId = testStatusMessage.userId;
    this.lastModifiedRemote = new Date(0); // It hasn't been downloaded yet
  }

  public getTestStatusMessage (): TestStatusMessage {
    const testStatus: TestStatusMessage = {
      instanceId: this.instanceId,
      hostname: this.hostname,
      ipAddress: this.ipAddress,
      startTime: this.startTime,
      endTime: this.endTime,
      resultsFilename: this.resultsFilename,
      status: this.status,
      errors: this.errors,
      version: this.version,
      queueName: this.queueName,
      userId: this.userId
    };
    return testStatus;
  }

  public sanitizedCopy (): TestStatusMessage & {
    testId: string,
    url: string | undefined,
    lastModifiedRemote: Date
  } {
    const returnObject: TestStatusMessage & {
      testId: string,
      url: string | undefined,
      lastModifiedRemote: Date
    } = {
      ...this.getTestStatusMessage(),
      testId: this.ppaasTestId.testId,
      url: this.url,
      lastModifiedRemote: this.lastModifiedRemote
    };
    return JSON.parse(JSON.stringify(returnObject));
  }

  // Override toString so we can not log the environment variables which may have passwords
  public toString (): string {
    return JSON.stringify(this.sanitizedCopy());
  }

  public getLastModifiedRemote () {
    return this.lastModifiedRemote;
  }

  public getTestId (): string {
    return this.ppaasTestId.testId;
  }

  public getS3Folder (): string {
    return this.ppaasTestId.s3Folder;
  }

  public getYamlFile (): string {
    return this.ppaasTestId.yamlFile;
  }

  /**
   * Internal function to get the latest TestStatusMessage
   * @param ppaasTestId testId to retrieve
   * @param lastModified if provided will only get changes
   * @returns false if not found, true if unchanged, or the object
   */
  protected static async getStatusInternal (ppaasTestId: PpaasTestId, lastModified?: Date): Promise<PpaasTestStatus | boolean> {
    const key = getKey(ppaasTestId);
    try {
      const s3Filename = createS3Filename(ppaasTestId);
      const s3Files = await listFiles({ s3Folder: key, maxKeys: 1 });
      log(`PpaasTestStatus listFiles(${key}, 1).length = ${s3Files.length}`, LogLevel.DEBUG);
      if (s3Files.length === 0) {
        return false; // Not found
      }
      const contents: string | undefined = await getFileContentsS3({
        filename: s3Filename,
        s3Folder: ppaasTestId.s3Folder,
        lastModified
      });
      log(`PpaasTestStatus getFileContents(${s3Filename}, ${ppaasTestId.s3Folder})`, LogLevel.DEBUG, { contents });
      if (!contents) {
        return true; // Unchanged since lastModified
      }
      log("PpaasTestStatus Status found in s3Folder " + ppaasTestId.s3Folder, LogLevel.DEBUG, { contents });
      try {
        const testStatusMessage: TestStatusMessage = JSON.parse(contents);
        log(`PpaasTestStatus getFileContents(${s3Filename}, ${ppaasTestId.s3Folder})`, LogLevel.DEBUG, { testStatusMessage });
        const newMessage = new PpaasTestStatus(ppaasTestId, testStatusMessage);
        const tags = await getTags({ filename: s3Filename, s3Folder: ppaasTestId.s3Folder });
        log(`PpaasTestStatus getTags(${s3Filename}, ${ppaasTestId.s3Folder})`, LogLevel.DEBUG, { tags });
        if (tags) { newMessage.tags = tags; }
        const s3File = s3Files[0];
        // We have to return a PpaasTestStatus instead of a TestStatusMessage so we can return the lastModifiedRemote
        if (s3File.LastModified) {
          newMessage.lastModifiedRemote = s3File.LastModified;
        }
        log(`PpaasTestStatus.getStatus(${ppaasTestId.s3Folder})`, LogLevel.DEBUG, { newMessage: newMessage.sanitizedCopy() });
        return newMessage;
      } catch (error: unknown) {
        log(`PpaasTestStatus Could not parse ${getKey(ppaasTestId)} contents: ` + contents, LogLevel.WARN, error);
        throw error;
      }
    } catch (error: unknown) {
      log(`PpaasTestStatus.getMessage(${ppaasTestId.s3Folder}) ERROR`, LogLevel.WARN, error);
      throw error;
    }
  }

  public static async getStatus (ppaasTestId: PpaasTestId): Promise<PpaasTestStatus | undefined> {
    const updatedStatus: PpaasTestStatus | boolean = await PpaasTestStatus.getStatusInternal(ppaasTestId);
    // It will never actually be "true" since we don't pass in a last modified
    if (updatedStatus === true || updatedStatus === false) {
      return undefined;
    } else {
      return updatedStatus;
    }
  }

  public static async getAllStatus (
    s3FolderPartial: string,
    maxFiles?: number,
    ignoreList?: string[]
  ): Promise<Promise<PpaasTestStatus | undefined>[] | undefined> {
    const s3Files: S3Object[] = await listFiles({ s3Folder: s3FolderPartial, maxKeys: maxFiles, extension: "info" });
    if (s3Files.length > 0) {
      interface TestIdContents {
        ppaasTestId: PpaasTestId;
        s3File: S3Object;
        contents: string | undefined;
      }
      const isSharedS3Environment: boolean =  KEYSPACE_PREFIX.startsWith(SHARED_ENVIRONMENT_PREFIX);
      const ppaasTestIds: TestIdContents[] = s3Files.map((s3File: S3Object) => {
        try {
          if (!s3File.Key) { return undefined; }
          // Check if it's an /s3-environment/* and we're prefix ""
          // Fixed Bug: We were having issues with non-dev environments finding the old runs from /s3-environment/*
          // This code would then try to load those tests from the root and can't find them and would error
          // If we're prefix "" then filter out tests that are under /s3-environment/*
          if (!isSharedS3Environment && s3File.Key.startsWith(SHARED_ENVIRONMENT_PREFIX)) {
            return undefined;
          }
          const testId: string = s3File.Key.slice(s3File.Key.lastIndexOf("/") + 1, s3File.Key.lastIndexOf("."));
          log(`Parsed testId ${testId} from ${s3File.Key}`, LogLevel.DEBUG);
          if (ignoreList && ignoreList.includes(testId)) {
            return undefined;
          }
          const ppaasTestId: PpaasTestId = PpaasTestId.getFromTestId(testId);
          log(`Parsed ppaasTestId from ${testId}`, LogLevel.DEBUG, ppaasTestId);
          return { ppaasTestId, s3File, contents: undefined };
        } catch (error: unknown) {
          log(`Could not parse testId from ${s3File.Key}`, LogLevel.ERROR, error);
          return undefined;
        }
      }).filter((testIdContents: TestIdContents | undefined): boolean => testIdContents !== undefined) as TestIdContents[];
      if (ppaasTestIds.length === 0) {
        return undefined;
      }
      const promises: Promise<PpaasTestStatus | undefined>[] = ppaasTestIds.map((testIdContents: TestIdContents) =>
        getFileContentsS3({
          filename: createS3Filename(testIdContents.ppaasTestId),
          s3Folder: testIdContents.ppaasTestId.s3Folder
        })
        .then((contents: string | undefined) => ({ ...testIdContents, contents }))
        .then((testIdContentsRead: TestIdContents) => {
          if (!testIdContentsRead.contents) { return undefined; }
          const testStatusMessage: TestStatusMessage = JSON.parse(testIdContentsRead.contents);
          log(`PpaasTestStatus getFileContents(${testIdContentsRead.s3File.Key})`, LogLevel.DEBUG, { testStatusMessage });
          const newMessage = new PpaasTestStatus(testIdContentsRead.ppaasTestId, testStatusMessage);
          const s3File = s3Files[0];
          // We have to return a PpaasTestStatus instead of a TestStatusMessage so we can return the lastModifiedRemote
          if (s3File.LastModified) {
            newMessage.lastModifiedRemote = s3File.LastModified;
          }
          log(`PpaasTestStatus.getStatus(${testIdContentsRead.ppaasTestId.s3Folder})`, LogLevel.DEBUG, { newMessage: newMessage.sanitizedCopy() });
          return newMessage;
        }).catch((error) => {
          log(`Could not retrieve statuses for s3Folder ${testIdContents.ppaasTestId.s3Folder}`, LogLevel.WARN, error);
          throw error;
        })
      );
      return promises;
    }
    return undefined;
  }

  /**
   * Reads the updated TestStatusMessage from S3 and returns the last modified date
   * @param force Optional parameter to force redownloading
   * @returns The date of the last modified of the file in S3
   */
  public async readStatus (force?: boolean): Promise<Date> {
    const updatedStatus: PpaasTestStatus | boolean = await PpaasTestStatus.getStatusInternal(
      this.ppaasTestId,
      force ? undefined : this.lastModifiedRemote
    );
    if (updatedStatus === false) {
      throw new Error(`PpaasTestStatus Could not find ${createS3Filename(this.ppaasTestId)} in S3`);
    } else if (updatedStatus === true) {
      log(`PpaasTestStatus.readStatus(${this.ppaasTestId.s3Folder}) not modified`, LogLevel.DEBUG, { updatedStatus, lastModifiedRemote: this.lastModifiedRemote });
      return this.lastModifiedRemote;
    }
    Object.assign(this, updatedStatus.getTestStatusMessage());
    this.lastModifiedRemote = updatedStatus.lastModifiedRemote;
    log(`PpaasTestStatus.readStatus(${this.ppaasTestId.s3Folder})`, LogLevel.DEBUG, { PpaasTestStatus: this.sanitizedCopy() });
    return this.lastModifiedRemote;
  }

  public async writeStatus (): Promise<string> {
    // Send the S3 Message
    const testStatus: TestStatusMessage = this.getTestStatusMessage();

    log("PpaasTestStatus Sending new status message to s3", LogLevel.DEBUG, this.sanitizedCopy());
    const newDate = new Date();
    this.url = await uploadFileContents({
      contents: JSON.stringify(testStatus),
      filename: createS3Filename(this.ppaasTestId),
      s3Folder: this.ppaasTestId.s3Folder,
      publicRead: true,
      contentType: "application/json",
      tags: this.tags
    });
    this.lastModifiedRemote = newDate; // Update the last modified
    log(`PpaasTestStatus PpaasTestStatus.send url: ${this.url}`, LogLevel.DEBUG, this.sanitizedCopy());
    return this.url;
  }
  // Unlike messages, we don't want to delete this
}

export default PpaasTestStatus;
