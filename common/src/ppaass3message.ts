import { CommunicationsMessage, MessageType } from "../types";
import { LogLevel, log } from "./util/log";
import {
  defaultTestExtraFileTags,
  deleteObject,
  getFileContents,
  init as initS3,
  listFiles,
  uploadFileContents
} from "./util/s3";
import { PpaasTestId } from "./ppaastestid";

// Due to issues with visibility 0 and multiple lockouts, The communications queue is only for talking to the controller
// Going to the agent will write to a file in the s3Folder
export const createS3Filename = (ppaasTestId: PpaasTestId) => `${ppaasTestId.testId}.msg`;

export const getKey = (ppaasTestId: PpaasTestId) => `${ppaasTestId.s3Folder}/${createS3Filename(ppaasTestId)}`;

export interface PpaasS3MessageOptions extends Omit<CommunicationsMessage, "testId"> {
  testId: string | PpaasTestId
}

/** Messages from the controller to the agent */
export class PpaasS3Message implements CommunicationsMessage {
  public testId: string;
  public messageType: MessageType;
  public messageData: any;
  protected ppaasTestId: PpaasTestId;
  protected inS3: boolean = false;

  // The receiptHandle is not in the constructor since sending messages doesn't require it. Assign it separately
  public constructor ({
    testId,
    messageType,
    messageData
  }: PpaasS3MessageOptions) {
    try {
      initS3();
    } catch (error: unknown) {
      log("Could not initialize s3", LogLevel.ERROR, error);
      throw error;
    }
    if (typeof testId === "string") {
      try {
        this.ppaasTestId = PpaasTestId.getFromTestId(testId);
        this.testId = this.ppaasTestId.testId;
      } catch (error: unknown) {
        log("Could not initialize s3", LogLevel.ERROR, error);
        throw error;
      }
    } else {
      this.testId = testId.testId;
      this.ppaasTestId = testId;
    }
    this.messageType = messageType;
    this.messageData = messageData;
  }

  public getCommunicationsMessage (): CommunicationsMessage {
    return {
      testId: this.testId,
      messageType: this.messageType,
      messageData: this.messageData
    };
  }

  // Create a sanitized copy which doesn't have the messageData which may have passwords
  public sanitizedCopy (): CommunicationsMessage & { inS3: boolean } {
    const returnObject: CommunicationsMessage & { inS3: boolean } = {
      ...this.getCommunicationsMessage(),
      messageData: undefined,
      inS3: this.inS3
    };
    return JSON.parse(JSON.stringify(returnObject));
  }

  // Override toString so we can not log the environment variables which may have passwords
  public toString (): string {
    return JSON.stringify(this.sanitizedCopy());
  }

  // Only used by the agents
  public static async getMessage (ppaasTestId: PpaasTestId): Promise<PpaasS3Message | undefined> {
    const key = getKey(ppaasTestId);
    try {
      const s3Filename = createS3Filename(ppaasTestId);
      const s3Files = await listFiles({ s3Folder: key, maxKeys: 1 });
      log(`listFiles(${key}, 1).length = ${s3Files.length}`, LogLevel.DEBUG);
      if (s3Files.length === 0) {
        return undefined;
      }
      const contents: string | undefined = await getFileContents({ filename: s3Filename, s3Folder: ppaasTestId.s3Folder });
      log(`getFileContents(${s3Filename}, ${ppaasTestId.s3Folder})`, LogLevel.DEBUG, { contents });
      if (!contents) {
        // File exists but is empty, delete it
        deleteObject(key).catch((error) => log(`Could not delete ${key}`, LogLevel.ERROR, error));
        return undefined;
      }
      log("We found a message for s3Folder " + ppaasTestId.s3Folder, LogLevel.DEBUG, { contents });
      try {
        const communicationsMessage: Partial<CommunicationsMessage> = JSON.parse(contents);
        if (!communicationsMessage || communicationsMessage.messageType === undefined) {
          log("PpaasS3Message.getMessage found invalid message for key: " + key, LogLevel.WARN, communicationsMessage);
          return undefined;
        }
        log(`getFileContents(${s3Filename}, ${s3Filename})`, LogLevel.DEBUG, { message: communicationsMessage });
        const newMessage = new PpaasS3Message({
          ...(communicationsMessage as CommunicationsMessage),
          testId: ppaasTestId
        });
        newMessage.inS3 = true; // Set this so we can delete it later
        return newMessage;
      } catch (error: unknown) {
        log(`Could not parse ${getKey(ppaasTestId)} contents: ` + contents, LogLevel.ERROR, error);
        throw error;
      }
    } catch (error: unknown) {
      log(`getMessage(${ppaasTestId.s3Folder}) ERROR`, LogLevel.ERROR, error);
      throw error;
    }
  }

  public async send (): Promise<string | undefined> {
    // Send the S3 Message
    const communicationsMessage: CommunicationsMessage = {
      testId: this.testId,
      messageType: this.messageType,
      messageData: this.messageData
    };
    if (this.messageData instanceof Map || this.messageData instanceof Set) {
      communicationsMessage.messageData = [...this.messageData]; // Need to cast it to an array
    }

    log("Sending new communications message to s3", LogLevel.DEBUG, this.sanitizedCopy());
    const url = await uploadFileContents({
      contents: JSON.stringify(communicationsMessage),
      filename: createS3Filename(this.ppaasTestId),
      s3Folder: this.ppaasTestId.s3Folder,
      publicRead: false,
      contentType: "application/json",
      tags: defaultTestExtraFileTags()
    });
    this.inS3 = true;
    log(`PpaasS3Message.send url: ${url}`, LogLevel.INFO, this.sanitizedCopy());
    return url;
  }

  public async deleteMessageFromS3 (): Promise<void> {
    if (this.inS3) {
      await deleteObject(getKey(this.ppaasTestId));
      this.inS3 = false;
    }
  }
}

export default PpaasS3Message;
