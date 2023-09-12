import { Body, LogLevel, log, logger, s3, util } from "@fs/ppaas-common";
import { decrypt, encrypt } from "./secrets";
import { _Object as S3Object } from "@aws-sdk/client-s3";

logger.config.LogFileName = "ppaas-controller";

const { getFileContents, getTags, init, KEYSPACE_PREFIX, listFiles, uploadFileContents } = s3;
const { sleep } = util;

const RESULTS_UPLOAD_RETRY: number = parseInt(process.env.RESULTS_UPLOAD_RETRY || "0", 10) || 5;

export interface PpaasEncryptS3FileParams {
  filename: string | undefined;
  s3Folder: string | undefined;
  fileContents: string | undefined;
  tags?: Map<string, string>
}

export class PpaasEncryptS3File implements s3.S3File {
  public body: Body | undefined;
  public key: string;
  public storageClass?: string;
  public contentType: string;
  public contentEncoding?: string;
  public publicRead?: boolean;
  // Only used for Test Scheduler. Don't set the test Tags
  public tags?: Map<string, string>;
  public readonly s3Folder: string;
  public readonly filename: string;
  protected fileContents: string;
  protected lastModifiedLocal: number; // From fs.stats.mtimeMs
  protected lastModifiedRemote: Date;
  // Protected member so only unit tests that extend this class can set it.

  // The receiptHandle is not in the constructor since sending messages doesn't require it. Assign it separately
  public constructor ({
    filename,
    s3Folder,
    fileContents,
    tags
  }: PpaasEncryptS3FileParams) {
    try {
      init();
    } catch (error) {
      log("Could not initialize s3", LogLevel.ERROR, error);
      throw error;
    }
    if (!filename || !s3Folder || fileContents === undefined ) {
      // Don't log the environment variables
      log("PpaasEncryptS3File was missing data", LogLevel.ERROR, { filename, s3Folder, fileContents });
      throw new Error("New Test Message was missing filename, s3Folder, or fileContents");
    }
    this.filename = filename;
    s3Folder = s3Folder.startsWith(KEYSPACE_PREFIX) ? s3Folder.slice(KEYSPACE_PREFIX.length) : s3Folder;
    this.s3Folder = s3Folder;
    this.key = `${s3Folder}/${filename}`;
    this.fileContents = fileContents;
    this.lastModifiedLocal = 0; // It hasn't been uploaded yet
    this.lastModifiedRemote = new Date(0); // It hasn't been downloaded yet
    // Since this is encrypted, it will ALWAYS be an octet stream
    this.contentType = "application/octet-stream";
    this.tags = tags;
  }

  public static async getAllFilesInS3 (s3Folder: string, extension?: string, maxFiles?: number): Promise<PpaasEncryptS3File[]> {
    log(`Finding in s3Folder: ${s3Folder}, extension: ${extension}, maxFiles: ${maxFiles}`, LogLevel.DEBUG);
    const s3Files: S3Object[] = await listFiles({ s3Folder, maxKeys: maxFiles, extension });
    if (s3Files.length === 0) {
      return [];
    }
    // Let the listFiles error throw above
    try {
      const downloadPromises: Promise<void>[] = [];
      const ppaasFiles: PpaasEncryptS3File[] = s3Files.filter((s3File: S3Object) => s3File && s3File.Key)
        .map((s3File: S3Object) => {
        // find the part after the s3Folder. We may have a prefix added to us so it may not be at the beginning
        // If s3Folder is part of a folder we need to split on the / not on the folder name
        const key: string = s3File.Key!.startsWith(KEYSPACE_PREFIX) ? s3File.Key!.slice(KEYSPACE_PREFIX.length) : s3File.Key!;
        const s3KeySplit = key.split("/");
        const realFolder = s3KeySplit.slice(0, -1).join("/");
        const filename = s3KeySplit[s3KeySplit.length - 1];
        log(`Found S3File ${filename} in ${realFolder}`, LogLevel.DEBUG, s3File);
        const ppaasEncryptS3File = new PpaasEncryptS3File({ filename, s3Folder: realFolder, fileContents: "" });
        downloadPromises.push(ppaasEncryptS3File.download(true).then(() => {
          if (s3File.LastModified) {
            ppaasEncryptS3File.lastModifiedRemote = s3File.LastModified;
          }
        }));
        return ppaasEncryptS3File;
      });
      await Promise.all(downloadPromises).catch((error) => log(`Could not download all files in ${s3Folder}`, LogLevel.ERROR, error));
      return ppaasFiles;
    } catch (error) {
      log(`getAllFilesInS3(${s3Folder}) failed`, LogLevel.ERROR, error);
      throw error;
    }
  }

  public static async existsInS3 (s3FilePath: string): Promise<boolean> {
    log("PpaasEncryptS3File.existsInS3", LogLevel.DEBUG, { s3FilePath });
    const s3Files: S3Object[] = await listFiles(s3FilePath);
    return s3Files.length > 0;
  }

  public async existsInS3 (): Promise<boolean> {
    log("PpaasEncryptS3File.existsInS3", LogLevel.DEBUG, { key: this.key });
    const s3Files: S3Object[] = await listFiles(this.key);
    return s3Files.length > 0;
  }

  public getFileContents (): string {
    return this.fileContents;
  }

  public setFileContents (fileContents: string): void {
    if (!fileContents) {
      throw new Error("fileContents cannot be an empty string");
    }
    this.fileContents = fileContents;
    this.lastModifiedLocal = 0;
  }

  public getLastModifiedRemote (): Date {
    return this.lastModifiedRemote;
  }

  // Create a sanitized copy which doesn't have the body which may have passwords
  public sanitizedCopy (): unknown {
    return Object.assign({}, this, { body: undefined, fileContents: undefined });
  }

  // Override toString so we can not log the body which may have passwords
  public toString (): string {
    return JSON.stringify(this.sanitizedCopy());
  }

  // Returns the local Filepath
  public async download (force?: boolean): Promise<PpaasEncryptS3File> {
    log(`PpaasEncryptS3File.download ${this.filename} old lastModified: ${this.lastModifiedLocal}, force: ${force}`, LogLevel.DEBUG);
    const fileContents: string | undefined = await getFileContents({
      filename: this.filename,
      s3Folder: this.s3Folder,
      lastModified: force ? undefined : this.lastModifiedRemote
    });
    // If we get undefined, the file didn't change
    if (fileContents !== undefined) {
      this.fileContents = decrypt(fileContents);
      // Update last modified remote
      this.lastModifiedRemote = new Date();
      // Download tags
      try {
        this.tags = await getTags({ filename: this.filename, s3Folder: this.s3Folder }) || this.tags;
      } catch (error) {
        log("PpaasEncryptS3File.download failed to retrieve tags", LogLevel.WARN, error, { filename: this.filename, s3Folder: this.s3Folder });
      }
    }
    return this;
  }

  public async upload (force?: boolean, retry?: boolean): Promise<void> {
    log(`PpaasEncryptS3File.upload ${this.filename} old lastModified: ${this.lastModifiedLocal}, force: ${force}`, LogLevel.DEBUG);
    // If we're not forcing it, check the last modified
    if (!force && this.lastModifiedLocal > 0) {
      return;
    }
    // If it's retry it's the last time, log it for real
    log(`Uploading ${this.filename}`, retry ? LogLevel.INFO : LogLevel.DEBUG);
    let retryCount: number = 0;
    let caughtError: any;
    let uploaded: boolean = false;
    do {
      try {
        if (retryCount > 0) {
          // Only sleep if we're on the 2nd time through or more
          await sleep((retryCount * 1000) + Math.floor(Math.random() * Math.floor(retryCount)));
        }
        log(`Uploading ${this.filename}: ${retryCount++}`, LogLevel.DEBUG);
        const fileContents: string = encrypt(this.fileContents);
        await uploadFileContents({
          contents: fileContents,
          filename: this.filename,
          s3Folder: this.s3Folder,
          publicRead: undefined,
          contentType: this.contentType,
          tags: this.tags
        });
        uploaded = true;
        // Update last modified local
        this.lastModifiedLocal = Date.now();
      } catch (error) {
        log(`Error uploading ${this.filename}`, LogLevel.ERROR, error);
        caughtError = error;
        // We'll throw it later after all retries
      }
    } while (!uploaded && retry && retryCount < RESULTS_UPLOAD_RETRY);
    if (!uploaded) {
      throw (caughtError || new Error("Could not upload " + this.filename));
    }
  }
}

export default PpaasEncryptS3File;
