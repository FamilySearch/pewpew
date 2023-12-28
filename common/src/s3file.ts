import * as path from "path";
import {
  ADDITIONAL_TAGS_ON_ALL,
  BUCKET_URL,
  GetTagsOptions,
  KEYSPACE_PREFIX,
  copyFile,
  defaultTestFileTags,
  getFile,
  getTags,
  init as initS3,
  listFiles,
  putTags,
  uploadFile
} from "./util/s3";
import { LogLevel, log } from "./util/log";
import { PutObjectCommandInput, _Object as S3Object } from "@aws-sdk/client-s3";
import { access, stat } from "fs/promises";
import { S3File } from "../types";
import { Stats } from "fs";
import { URL } from "url";
import { sleep } from "./util/util";

const RESULTS_UPLOAD_RETRY: number = parseInt(process.env.RESULTS_UPLOAD_RETRY || "0", 10) || 5;

export interface PpaasS3FileOptions {
  filename: string | undefined;
  s3Folder: string | undefined;
  localDirectory: string | undefined;
  publicRead?: boolean;
  tags?: Map<string, string>;
}

export interface GetAllFilesInS3Options {
  s3Folder: string;
  localDirectory: string;
  extension?: string | string[];
  maxFiles?: number;
}

 export interface PpaasS3FileCopyOptions {
  /** Destination s3 folder */
  destinationS3Folder: string;
  /** Optional: Change the name of the file */
  destinationFilename?: string;
  /** Optional: If true, new file is publicly readable */
  publicRead?: boolean;
}

export class PpaasS3File implements S3File {
  public body: PutObjectCommandInput["Body"] | undefined;
  public key: string;
  public storageClass?: PutObjectCommandInput["StorageClass"];
  public contentType: string;
  public contentEncoding?: string;
  public publicRead?: boolean;
  public tags?: Map<string, string>;
  public readonly s3Folder: string;
  public readonly filename: string;
  public readonly localDirectory: string;
  public readonly localFilePath: string;
  public remoteUrl: string;
  protected lastModifiedLocal: number; // From fs.stats.mtimeMs
  protected lastModifiedRemote: Date;
  // Protected member so only unit tests that extend this class can set it.

  // The receiptHandle is not in the constructor since sending messages doesn't require it. Assign it separately
  public constructor ({ filename, s3Folder, localDirectory, publicRead, tags = defaultTestFileTags() }: PpaasS3FileOptions) {
    try {
      initS3();
    } catch (error: unknown) {
      log("Could not initialize s3", LogLevel.ERROR, error);
      throw error;
    }
    if (!filename || !s3Folder || localDirectory === undefined) {
      log("PpaasS3File was missing data", LogLevel.ERROR, { filename, s3Folder, localDirectory });
      throw new Error("New Test Message was missing filename, s3Folder, or localDirectory");
    }
    this.filename = filename;
    s3Folder = s3Folder.startsWith(KEYSPACE_PREFIX) ? s3Folder.slice(KEYSPACE_PREFIX.length) : s3Folder;
    this.s3Folder = s3Folder;
    this.localDirectory = localDirectory;
    this.key = `${s3Folder}/${filename}`;
    this.publicRead = publicRead;
    this.tags = tags;
    this.localFilePath = path.join(localDirectory, filename);
    this.lastModifiedLocal = 0; // It hasn't been uploaded yet
    this.lastModifiedRemote = new Date(0); // It hasn't been downloaded yet
    // Build the remoteUrl. It's usually only set on uploads
    this.remoteUrl = new URL(`${KEYSPACE_PREFIX}${this.key}`, BUCKET_URL).href;
    const extension: string = path.extname(filename);
    log(`extension: ${extension}`, LogLevel.DEBUG);
    // Check the file extension for type
    switch (extension) {
      case ".csv":
        this.contentType = "text/csv";
        break;
      case ".yaml":
        this.contentType = "text/x-yaml";
        break;
      case ".json":
        this.contentType = "application/json";
        break;
      default:
        this.contentType = "text/plain";
        break;
    }
    if (filename === "pewpew" || filename === "pewpew.exe") {
      this.contentType = "application/octet-stream";
    }
    log(`contentType: ${this.contentType}`, LogLevel.DEBUG);
  }

  protected static async getTags (functionName: string, { filename, s3Folder }: GetTagsOptions): Promise<Map<string, string> | undefined> {
    // Get prior tags
    try {
      const tags = await getTags({ filename, s3Folder });
      return tags;
    } catch (error: unknown) {
      log(functionName + " - Could not retrieve tags: " + filename, LogLevel.WARN, error);
    }
    return undefined;
  }

  public static async getAllFilesInS3 ({ s3Folder, localDirectory, extension, maxFiles }: GetAllFilesInS3Options): Promise<PpaasS3File[]> {
    log(`PpaasS3File Finding in s3Folder: ${s3Folder}, extension: ${extension}, maxFiles: ${maxFiles}`, LogLevel.DEBUG);
    const s3Files: S3Object[] = await listFiles({ s3Folder, maxKeys: maxFiles, extension });
    log(`Found S3Files: ${s3Folder}, extension: ${extension}, maxFiles: ${maxFiles}`, LogLevel.DEBUG, s3Files.map((s3File) => s3File.Key));
    if (s3Files.length === 0) {
      return [];
    }
    // Let the listFiles error throw above
    try {
      const ppaasFiles: PpaasS3File[] = await Promise.all(s3Files.filter((s3File: S3Object) => s3File && s3File.Key)
        .map(async (s3File: S3Object) => {
        // find the part after the s3Folder. We may have a prefix added to us so it may not be at the beginning
        // If s3Folder is part of a folder we need to split on the / not on the folder name
        const key: string = KEYSPACE_PREFIX && s3File.Key!.startsWith(KEYSPACE_PREFIX) ? s3File.Key!.slice(KEYSPACE_PREFIX.length) : s3File.Key!;
        const s3KeySplit = key.split("/");
        const realFolder = s3KeySplit.slice(0, -1).join("/");
        const filename = s3KeySplit[s3KeySplit.length - 1];
        log(`Found S3File ${filename} in ${realFolder}`, LogLevel.DEBUG, s3File);
        // Get prior tags
        const tags: Map<string, string> | undefined = await this.getTags("getAllFilesInS3", { filename, s3Folder: realFolder });
        const ppaasS3File = new PpaasS3File({ filename, s3Folder: realFolder, localDirectory, tags });
        // We need to get and Store the LastModified so we can sort and get the latest
        if (s3File.LastModified) {
          ppaasS3File.lastModifiedRemote = s3File.LastModified;
        }
        return ppaasS3File;
      }));
      return ppaasFiles;
    } catch (error: unknown) {
      log(`getAllFilesInS3(${s3Folder}, ${localDirectory}) failed`, LogLevel.ERROR, error);
      throw error;
    }
  }

  public static async existsInS3 (s3FilePath: string): Promise<boolean> {
    const s3Files: S3Object[] = await listFiles(s3FilePath);
    return s3Files.length > 0;
  }

  public async existsInS3 (): Promise<boolean> {
    const s3Files: S3Object[] = await listFiles(this.key);
    return s3Files.length > 0;
  }

  public async existsLocal (): Promise<boolean> {
    try {
      await access(this.localFilePath);
      return true;
    } catch (error: unknown) {
      return false;
    }
  }

  public getLastModifiedRemote (): Date {
    return this.lastModifiedRemote;
  }

  public getS3File () : S3File {
    return {
      body: this.body,
      key: this.key,
      storageClass: this.storageClass,
      contentType: this.contentType,
      contentEncoding: this.contentEncoding,
      publicRead: this.publicRead,
      tags: this.tags
    };
  }

  // Create a sanitized copy which doesn't have the environment variables which may have passwords
  public sanitizedCopy (): S3File & {
    s3Folder: string,
    filename: string,
    localDirectory: string,
    localFilePath: string,
    remoteUrl: string,
    lastModifiedLocal: number,
    lastModifiedRemote: Date
  } {
    const returnObject: S3File & {
      s3Folder: string,
      filename: string,
      localDirectory: string,
      localFilePath: string,
      remoteUrl: string,
      lastModifiedLocal: number,
      lastModifiedRemote: Date
    } = {
      ...this.getS3File(),
      body: undefined,
      s3Folder: this.s3Folder,
      filename: this.filename,
      localDirectory: this.localDirectory,
      localFilePath: this.localFilePath,
      remoteUrl: this.remoteUrl,
      lastModifiedLocal: this.lastModifiedLocal,
      lastModifiedRemote: this.lastModifiedRemote
    };
    return JSON.parse(JSON.stringify(returnObject));
  }

  // Override toString so we can not log the environment variables which may have passwords
  public toString (): string {
    return JSON.stringify(this.sanitizedCopy());
  }

  // Returns the local Filepath
  public async download (force?: boolean): Promise<string> {
    // Update last modified remote
    const downloadedDate: Date | undefined = await getFile({
      filename: this.filename,
      s3Folder: this.s3Folder,
      localDirectory: this.localDirectory,
      lastModified: force ? undefined : this.lastModifiedRemote
    });
    if (downloadedDate) {
      this.lastModifiedRemote = downloadedDate;
      const tags: Map<string, string> | undefined = await PpaasS3File.getTags("copy", { filename: this.filename, s3Folder: this.s3Folder });
      if (tags && tags.size > 0) {
        this.tags = tags;
      }
    }
    return this.localFilePath;
  }

  public async upload (force?: boolean, retry?: boolean): Promise<void> {
    const stats: Stats = await stat(this.localFilePath);
    log(`${this.filename} old lastModified: ${this.lastModifiedLocal}, forice: ${force}`, LogLevel.DEBUG, stats);
    // If we're not forcing it, check the last modified
    if (!force && stats.mtimeMs === this.lastModifiedLocal) {
      return;
    }
    // If it's retry it's the last time, log it for real
    log(`Uploading ${this.filename}`, LogLevel.DEBUG);
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
        this.remoteUrl = await uploadFile({
          filepath: this.localFilePath,
          s3Folder: this.s3Folder,
          publicRead: this.publicRead,
          contentType: this.contentType,
          tags: this.tags
        });
        uploaded = true;
        // Update last modified local
        this.lastModifiedLocal = stats.mtimeMs;
      } catch (error: unknown) {
        log(`Error uploading ${this.filename}`, LogLevel.ERROR, error);
        caughtError = error;
        // We'll throw it later after all retries
      }
    } while (!uploaded && retry && retryCount < RESULTS_UPLOAD_RETRY);
    if (!uploaded) {
      throw (caughtError || new Error("Could not upload " + this.filename));
    }
  }

  /**
   * Copies the PpaasS3File to a new location in S3 (or a new filename)
   * @param param0 {PpaasS3FileCopyOptions} parameters
   * @returns A new PpaasS3File that represents the copied object
   */
  public async copy ({ destinationS3Folder, destinationFilename, publicRead }: PpaasS3FileCopyOptions): Promise<PpaasS3File> {
    const lastModified: Date | undefined = await copyFile({
      filename: this.filename,
      sourceS3Folder: this.s3Folder,
      destinationS3Folder,
      destinationFilename,
      publicRead
    });
    // Get prior tags
    const tags: Map<string, string> | undefined = await PpaasS3File.getTags("copy", { filename: this.filename, s3Folder: this.s3Folder });
    const copiedS3File: PpaasS3File = new PpaasS3File({
      filename: destinationFilename || this.filename,
      s3Folder: destinationS3Folder,
      localDirectory: this.localDirectory,
      publicRead: publicRead || this.publicRead,
      tags: this.tags || tags
    });
    if (lastModified) {
      copiedS3File.lastModifiedRemote = lastModified;
    }
    return copiedS3File;
  }

  public async updateTags (): Promise<void> {
    if (this.tags === undefined) {
      // No tags to update. Use an empty Map to clear them out
      return;
    }
    const currentTags: Map<string, string> | undefined = await PpaasS3File.getTags("updateTags", { filename: this.filename, s3Folder: this.s3Folder });
    // All all the ADDITIONAL_TAGS_ON_ALL to make sure we have them all
    for (const [key, value] of ADDITIONAL_TAGS_ON_ALL) {
      if (!this.tags.has(key)) {
        // If it doesn't have it add it, but don't overwrite an existing value
        this.tags.set(key, currentTags?.get(key) || value);
      }
    }
    // If we don't currently have tags or the size are different, we need to update
    if (currentTags && currentTags.size === this.tags.size) {
      const allEqual = Array.from(currentTags.entries()).every(([key, currentValue]) => this.tags?.get(key) === currentValue);
      log("updateTags allEqual: " + allEqual, LogLevel.DEBUG, { allEqual, currentTags: [...currentTags], newTags: [...this.tags] });
      if (allEqual) {
        return;
      }
    } else {
      log("updateTags tag size different", LogLevel.DEBUG, { currentTags: currentTags ? [...currentTags] : "undefined", newTags: [...this.tags] });
    }
    return await putTags({ filename: this.filename, s3Folder: this.s3Folder, tags: this.tags });
  }
}

export default PpaasS3File;
