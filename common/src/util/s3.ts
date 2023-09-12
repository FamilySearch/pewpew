import * as path from "path";
import {
  AbortMultipartUploadCommandOutput,
  CompleteMultipartUploadCommandOutput,
  CopyObjectCommand,
  CopyObjectCommandInput,
  CopyObjectCommandOutput,
  DeleteObjectCommand,
  DeleteObjectCommandInput,
  DeleteObjectCommandOutput,
  GetObjectCommand,
  GetObjectCommandInput,
  GetObjectCommandOutput,
  GetObjectTaggingCommand,
  GetObjectTaggingCommandInput,
  GetObjectTaggingCommandOutput,
  ListObjectsV2Command,
  ListObjectsV2CommandInput,
  ListObjectsV2CommandOutput,
  PutObjectCommandInput,
  PutObjectTaggingCommand,
  PutObjectTaggingCommandInput,
  PutObjectTaggingCommandOutput,
  S3Client,
  _Object as S3Object,
  Tag as S3Tag
} from "@aws-sdk/client-s3";
import { LogLevel, log } from "./log";
import { createGzip, gunzip as zlibGunzip} from "zlib";
import { createReadStream, writeFile as fsWriteFile } from "fs";
import { S3File } from "../../types";
import { Upload } from "@aws-sdk/lib-storage";
import { constants as bufferConstants } from "node:buffer";
import { getPrefix } from "./util";
import { promisify } from "util";
import stream from "stream";
const { MAX_STRING_LENGTH } = bufferConstants;

export type { S3File };
const gunzip = promisify(zlibGunzip);
const writeFile = promisify(fsWriteFile);

export let BUCKET_NAME: string;
export let BUCKET_URL: string;
export let KEYSPACE_PREFIX: string;
// let REGION_ENDPOINT: string | undefined;
// Export for testing so we can reset s3
export const config: { s3Client: S3Client } = {
  s3Client: undefined as unknown as S3Client
};
/**
 * ADDITIONAL_TAGS_ON_ALL if set via environment variable is expected to be a comma delimited list of key=value pairs
 * which will be added to ALL s3 objects uploaded if the key isn't already passed in on the upload object call.
 * Example: process.env.ADDITIONAL_TAGS_ON_ALL="key1=value1,key2=value2" would put two tags on every upload. If an upload
 * has tags passed in of "key2=value3" then only key1=value1 would be added. WARNING: Is only initialized after s3.init() called.
 */
export const ADDITIONAL_TAGS_ON_ALL = new Map<string, string>();
// Don't export so that the original can't be modified
const TEST_FILE_TAGS_INTERNAL = new Map<string, string>([["test", "true"]]);
/** Returns a new copy of the Map each time so the original can't be modified */
export const defaultTestFileTags = (): Map<string, string> => new Map(TEST_FILE_TAGS_INTERNAL);

/**
 * Initializes the S3 object using environment variables. Runs later so it doesn't throw on start-up
 */
export function init (): void {
  if (BUCKET_NAME && config.s3Client) {
    // If we've already set the BUCKET_NAME then we've done this already.
    return;
  }
  // Where <prefix> is your application name, system name, and service name concatenated with underscores, capitalized, and all dashes replaced with underscores.
  // The s3 service name is s3 in the application which is then capitalized to _S3_ below

  // We need to error check if we're running on application we don't fall back to the unittests on live
  const PREFIX: string = getPrefix(true); // Use the controller if we have one
  const bucketName: string | undefined = process.env[`${PREFIX}_S3_BUCKET_NAME`];
  log(`${PREFIX}_S3_BUCKET_NAME = ${bucketName}`, LogLevel.DEBUG);
  if (!bucketName) {
    log(`Could not load the environment variable ${PREFIX}_S3_BUCKET_NAME`, LogLevel.ERROR);
    throw new Error(`Could not load the environment variable ${PREFIX}_S3_BUCKET_NAME`);
  }
  const bucketUrl: string | undefined = process.env[`${PREFIX}_S3_BUCKET_URL`];
  log(`${PREFIX}_S3_BUCKET_URL = ${bucketUrl}`, LogLevel.DEBUG);
  if (!bucketUrl) {
    log(`Could not load the environment variable ${PREFIX}_S3_BUCKET_URL`, LogLevel.ERROR);
    throw new Error(`Could not load the environment variable ${PREFIX}_S3_BUCKET_URL`);
  }
  // Empty string should be allowed on a private bucket
  const keyspacePrefix: string = process.env[`${PREFIX}_S3_KEYSPACE_PREFIX`] || "";
  log(`${PREFIX}_S3_KEYSPACE_PREFIX = ${keyspacePrefix}`, LogLevel.DEBUG);
  BUCKET_NAME = bucketName;
  BUCKET_URL = bucketUrl;
  // Since we don't have a private s3 bucket. This will be populated. If we ever move to a private we don't want to tack on the trailing /
  KEYSPACE_PREFIX = keyspacePrefix.length > 0 && !keyspacePrefix.endsWith("/") ? (keyspacePrefix + "/") : keyspacePrefix;

  // Create an S3 service object
  config.s3Client = new S3Client({
    // params: { Bucket: BUCKET_NAME },
    region: "us-east-1"
  });

  if (process.env.ADDITIONAL_TAGS_ON_ALL && ADDITIONAL_TAGS_ON_ALL.size === 0) {
    try {
      for (const keyPair of process.env.ADDITIONAL_TAGS_ON_ALL.split(",")) {
        const split = keyPair.split("=");
        if (split.length !== 2 || split[0].trim() === "") { // Key can't be an empty string
          const errorMessage = "Invalid key_pair: " + keyPair;
          log(errorMessage, LogLevel.WARN, { keyPair, split });
          throw new Error(errorMessage);
        }
        ADDITIONAL_TAGS_ON_ALL.set(split[0], split[1]);
      }
      log("ADDITIONAL_TAGS_ON_ALL", LogLevel.INFO, ADDITIONAL_TAGS_ON_ALL);
    } catch (error) {
      log("Could not parse process.env.ADDITIONAL_TAGS_ON_ALL: " + process.env.ADDITIONAL_TAGS_ON_ALL, LogLevel.WARN, error);
      throw error;
    }
  }
}

let accessCallback: (date: Date) => void | undefined;

export function setAccessCallback (fn: (date: Date) => void) {
  accessCallback = fn;
}

function callAccessCallback (date: Date) {
  try {
    if (accessCallback) {
      accessCallback(date);
    } else {
      log("s3 setAccessCallback has not be set. Cannot call the accessCallback", LogLevel.WARN);
    }
  } catch(error) {
    log("Calling the Access Callback (set last s3 accessed failed", LogLevel.ERROR, error);
  }
}

export interface FileOptions {
  /** filename {string} filename to retrieve */
  filename: string;
  /** s3Folder {string} folder in s3 */
  s3Folder: string;
}

export interface ListFilesOptions {
  s3Folder: string;
  maxKeys?: number;
  extension?: string;
}

export async function listFiles ({ s3Folder, extension, maxKeys }: ListFilesOptions): Promise<S3Object[]>;
export async function listFiles (s3Folder: string): Promise<S3Object[]>;
export async function listFiles (options: string | ListFilesOptions): Promise<S3Object[]> {
  let s3Folder: string;
  let maxKeys: number | undefined;
  let extension: string | undefined;
  if (typeof options === "string") {
    s3Folder = options;
  } else {
    ({ s3Folder, maxKeys, extension } = options);
  }
  log(`listFiles(${s3Folder}, ${maxKeys}, ${extension})`, LogLevel.DEBUG);
  let result: ListObjectsV2CommandOutput | undefined;
  const files: S3Object[] = [];
  do {
    result = await listObjects({ prefix: s3Folder, maxKeys, continuationToken: result && result.NextContinuationToken});
    if (result.Contents) {
      if (extension && result.Contents.length > 0) {
        const filtered: S3Object[] = result.Contents.filter((s3File: S3Object) => s3File.Key!.endsWith(extension!));
        files.push(...filtered);
      } else {
        files.push(...(result.Contents));
      }
    }
  } while (result.IsTruncated && maxKeys !== undefined && files.length < maxKeys);

  return files;
}

export interface GetFileOptions extends FileOptions {
  localDirectory: string;
  lastModified?: Date;
}

/** Returns the last modified date if downloaded, undefined on 304, or throws */
export async function getFile ({ filename, s3Folder, localDirectory, lastModified }: GetFileOptions): Promise<Date | undefined> {
  if (s3Folder === undefined || localDirectory === undefined) {
    throw new Error("localDirectory and s3Folder must be provided");
  }
  const key: string = `${s3Folder}/${filename}`;
  try {
    const localFile: string = path.join(localDirectory, filename);
    const result: GetObjectCommandOutput = await getObject(key, lastModified);
    if (!result || !result.Body) {
      throw new Error("S3 Get Object was empty");
    }
    let content: Buffer = Buffer.from(await result.Body.transformToByteArray());
    if (result.ContentEncoding === "gzip") {
      content = await gunzip(content);
    }
    // Write the file to disk
    await writeFile(localFile, content);
    return result.LastModified;
  } catch (error) {
    // Could be a 304. Swallow it
    if (error && (error?.name === "304" || error["$metadata"]?.httpStatusCode === 304)) {
      log("getFile not modified: " + filename, LogLevel.DEBUG, error);
      return undefined;
    } else {
      log(`getFile(${filename}, ${s3Folder}, ${localDirectory}, ${lastModified}) ERROR`, LogLevel.ERROR, error);
      throw error;
    }
  }
}

export interface GetFileContentsOptions extends FileOptions {
  lastModified?: Date;
  maxLength?: number
}

/**
 * Retrieves the file contents and returns it as a string
 * @param filename {string} filename to retrieve
 * @param s3Folder {string} folder in s3
 * @param lastModified {Date} (optional) last modified date from a prior request
 * @param maxLength {number} (optional) maximum string length to return
 * @returns file contents if downloaded, undefined on 304, or throws
 */
export async function getFileContents ({ filename, s3Folder, lastModified, maxLength = MAX_STRING_LENGTH }: GetFileContentsOptions): Promise<string | undefined> {
  if (s3Folder === undefined) {
    throw new Error("s3Folder must be provided");
  }
  const key: string = `${s3Folder}/${filename}`;
  try {
    const result: GetObjectCommandOutput | undefined = await getObject(key, lastModified);
    if (!result || !result.Body) {
      throw new Error("S3 Get Object was empty");
    }
    let content: Buffer = Buffer.from(await result.Body.transformToByteArray());
    if (result.ContentEncoding === "gzip") {
      content = await gunzip(content);
    }
    log("content.length: " + content.length, LogLevel.DEBUG, { maxLength, contentLength: content.length, MAX_STRING_LENGTH });
    // What should we do if the size of a buffer is larger than max string
    if (maxLength && content.length > maxLength) {
      log(`getFile(${filename}, ${s3Folder}, ${lastModified}) too long, truncating`, LogLevel.WARN, { length: content.length, maxLength, MAX_STRING_LENGTH });
    }
    return content.toString("utf-8", 0, maxLength);
  } catch (error) {
    // Could be a 304. Swallow it
    if (error && (error?.name === "304" || error["$metadata"]?.httpStatusCode === 304)) {
      log("getFile not modified: " + filename, LogLevel.DEBUG, error);
      return undefined;
    } else {
      log(`getFile(${filename}, ${s3Folder}, ${lastModified}) ERROR`, LogLevel.ERROR, error);
      throw error;
    }
  }
}

export interface UploadFileOptions {
  filepath: string;
  s3Folder: string;
  publicRead?: boolean;
  contentType?: string;
  tags?: Map<string, string>;
}

/** Returns the URL location in S3 */
export async function uploadFile ({ filepath, s3Folder, publicRead, contentType, tags }: UploadFileOptions): Promise<string> {
  if (s3Folder === undefined) {
    throw new Error("s3Folder must be provided");
  }
  if (publicRead === undefined) {
    publicRead = false;
  }
  if (contentType === undefined) {
    contentType = "text/plain";
  }
  const filename: string = path.basename(filepath);
  // Check the file extension for type
  const s3File: S3File = {
    body: createReadStream(filepath).pipe(createGzip()),
    key: `${s3Folder}/${filename}`,
    contentEncoding: "gzip",
    contentType,
    publicRead,
    tags
  };
  const uploadResult: CompleteMultipartUploadCommandOutput = await uploadObject(s3File);
  return uploadResult.Location!;
}

export interface UploadFileContentsOptions extends FileOptions {
  contents: string;
  publicRead?: boolean;
  contentType?: string;
  tags?: Map<string, string>;
}

/** Returns the URL location in S3 */
export async function uploadFileContents ({ contents, filename, s3Folder, publicRead, contentType, tags }: UploadFileContentsOptions): Promise<string> {
  if (filename === undefined || s3Folder === undefined) {
    throw new Error("filename and s3Folder must be provided");
  }
  if (publicRead === undefined) {
    publicRead = false;
  }
  if (contentType === undefined) {
    contentType = "text/plain";
  }
  const baseName: string = path.basename(filename);
  const bufferStream = new stream.PassThrough();
  bufferStream.end(Buffer.from(contents));
  const s3File: S3File = {
    body: bufferStream.pipe(createGzip()),
    key: `${s3Folder}/${baseName}`,
    contentEncoding: "gzip",
    contentType,
    publicRead,
    tags
  };
  const uploadResult: CompleteMultipartUploadCommandOutput = await uploadObject(s3File);
  return uploadResult.Location!;
}

/**
 * Interface/object for copying objects in S3
 */
export interface CopyFileOptions {
  /** source filename to be copied */
  filename: string;
  /** Source s3 folder to copy from */
  sourceS3Folder: string;
  /** Destination s3 folder */
  destinationS3Folder: string;
  /** Optional: Change the name of the file */
  destinationFilename?: string;
  /** Optional: If true, new file is publicly readable */
  publicRead?: boolean;
  /** Optional: tags to set on the new object. If not provided, the old tags will be copied */
  tags?: Map<string, string>;
}

/**
 * Copies the file from an s3 location to a new location
 * @param filename {string} source filename to be copied
 * @param sourceS3Folder {string} Source s3 folder to copy from
 * @param destinationS3Folder {string} Destination s3 folder
 * @param destinationFilename {string} Optional: Change the name of the file
 * @param publicRead {boolean} Optional: If true, new file is publicly readable
 * @returns The new last modified date
 */
export async function copyFile ({ filename, sourceS3Folder, destinationS3Folder, destinationFilename, publicRead = false, tags }: CopyFileOptions): Promise<Date | undefined> {
  if (destinationS3Folder === sourceS3Folder
    && (destinationFilename === undefined || destinationFilename === filename)) {
    // Can't copy to itself
    throw new Error("copyFile cannot copy to itself");
  }
  // Check the file extension for type
  const sourceFile: S3File = {
    key: `${sourceS3Folder}/${filename}`,
    contentEncoding: "gzip",
    contentType: "ignored",
    publicRead
  };
  const destinationFile: S3File = {
    key: `${destinationS3Folder}/${destinationFilename || filename}`,
    contentEncoding: "gzip",
    contentType: "ignored",
    publicRead
  };
  const result: CopyObjectCommandOutput = await copyObject({ sourceFile, destinationFile, tags });
  return result.CopyObjectResult?.LastModified;
}

export type DeleteFileOptions = FileOptions;

export async function deleteFile ({ filename, s3Folder }: DeleteFileOptions): Promise<void> {
  await deleteObject(`${s3Folder}/${filename}`);
}

export type GetTagsOptions = FileOptions;

/**
 * Retrieves the file contents and returns it as a string
 * @param filename {string} filename to retrieve
 * @param s3Folder {string} folder in s3
 * @returns file contents if downloaded, undefined on 304, or throws
 */
export async function getTags ({ filename, s3Folder }: GetTagsOptions): Promise<Map<string, string> | undefined> {
  const key: string = `${s3Folder}/${filename}`;
  try {
    const result: GetObjectTaggingCommandOutput = await getObjectTagging(key);
    let tags: Map<string, string> | undefined;
    for (const tag of result.TagSet || []) {
      if (tags === undefined) { tags = new Map(); }
      log("Adding tag for: " + key, LogLevel.DEBUG, tag);
      if (tag.Key && tag.Value) { tags.set(tag.Key, tag.Value); }
    }
    return tags;
  } catch (error) {
    log(`getTags(${filename}, ${s3Folder}) ERROR`, LogLevel.ERROR, error);
    throw error;
  }
}

export interface PutTagsOptions extends FileOptions {
  tags: Map<string, string>;
}

/**
 * Retrieves the file contents and returns it as a string
 * @param filename {string} filename to retrieve
 * @param s3Folder {string} folder in s3
 * @returns file contents if downloaded, undefined on 304, or throws
 */
export async function putTags ({ filename, s3Folder, tags }: PutTagsOptions): Promise<void> {
  const key: string = `${s3Folder}/${filename}`;
  try {
    await putObjectTagging({ key, tags });
  } catch (error) {
    log(`putTags(${filename}, ${s3Folder}) ERROR`, LogLevel.ERROR, error);
    throw error;
  }
}

// NOTE: Only the low level functions getObject, uploadObject, and listObjects will prepend the KEYSPACE_PREFIX

export interface ListObjectsOptions {
  prefix?: string;
  maxKeys?: number;
  continuationToken?: string;
}

// export for testing
export async function listObjects (prefix?: string): Promise<ListObjectsV2CommandOutput>;
export async function listObjects (options?: ListObjectsOptions): Promise<ListObjectsV2CommandOutput>;
export async function listObjects (options?: string | ListObjectsOptions): Promise<ListObjectsV2CommandOutput> {
  let prefix: string | undefined;
  let maxKeys: number | undefined;
  let continuationToken: string | undefined;
  if (typeof options === "string") {
    prefix = options;
  } else {
    ({ prefix, maxKeys, continuationToken } = options || {});
  }
  log(`listObjects(${prefix}, ${maxKeys}, ${continuationToken})`, LogLevel.DEBUG);
  init();
  if (!prefix || !prefix.startsWith(KEYSPACE_PREFIX)) {
    prefix = KEYSPACE_PREFIX + (prefix || "");
  }
  const params: ListObjectsV2CommandInput = {
    Bucket: BUCKET_NAME,
    Prefix: prefix,
    ContinuationToken: continuationToken,
    MaxKeys: maxKeys || 50
  };
  try {
    log("listObjects request", LogLevel.DEBUG, params);
    const result: ListObjectsV2CommandOutput = await config.s3Client.send(new ListObjectsV2Command(params));
    log("listObjects succeeded", LogLevel.DEBUG, result);
    callAccessCallback(new Date()); // Update the last timestamp
    return result;
  } catch (error) {
    log("listObjects failed on prefix: " + prefix, LogLevel.ERROR, error);
    throw error;
  }
}

// export for testing
export async function getObject (key: string, lastModified?: Date): Promise<GetObjectCommandOutput> {
  init();
  if (!key || !key.startsWith(KEYSPACE_PREFIX)) {
    key = KEYSPACE_PREFIX + (key || "");
  }
  const params: GetObjectCommandInput = {
    Bucket: BUCKET_NAME,
    Key: key,
    IfModifiedSince: lastModified
  };
  try {
    log("getObject request", LogLevel.DEBUG, params);
    const result: GetObjectCommandOutput = await config.s3Client.send(new GetObjectCommand(params));
    log("getObject succeeded", LogLevel.DEBUG, Object.assign({}, result, { Body: undefined })); // Log it without the body
    callAccessCallback(new Date()); // Update the last timestamp
    return result;
  } catch (error) {
    // Can return "Not Modified", don't log it
    if (error && (error?.name === "304" || error["$metadata"]?.httpStatusCode === 304)) {
      callAccessCallback(new Date()); // Update the last timestamp
      log("getObject not modified", LogLevel.DEBUG, error);
    } else {
      log("getObject failed", LogLevel.WARN, error);
    }
    throw error;
  }
}

// export for testing
export async function uploadObject (file: S3File): Promise<CompleteMultipartUploadCommandOutput> {
  init();
  if (!file.key || !file.key.startsWith(KEYSPACE_PREFIX)) {
    file.key = KEYSPACE_PREFIX + (file.key || "");
  }
  let tags: Map<string, string>;
  if (!file.tags) {
    tags = new Map<string, string>();
  } else {
    // Create a copy so we don't modify the original if we add more tags
    tags = new Map<string, string>(file.tags);
  }
  for (const [tagKey, tagValue] of ADDITIONAL_TAGS_ON_ALL) {
    if (!tags.has(tagKey)) {
      tags.set(tagKey, tagValue);
    }
  }
  // Must be url encoded `testing=Moo&testing2=Baa`
  let taggingString: string = "";
  for (const [key, value] of tags.entries()) {
    const formattedPair = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    taggingString += (taggingString.length > 0 ? "&" : "") + formattedPair;
  }
  const params: PutObjectCommandInput = {
    ACL: file.publicRead ? "public-read" : "authenticated-read",
    Body: file.body,
    Bucket: BUCKET_NAME,
    CacheControl: "max-age=60",
    ContentType: file.contentType,
    ContentEncoding: file.contentEncoding,
    Key: file.key,
    StorageClass: file.storageClass,
    Tagging: taggingString
  };
  try {
    log("uploadObject request", LogLevel.DEBUG, Object.assign({}, params, { Body: undefined })); // Log it without the body
    const upload = new Upload({
      client: config.s3Client,
      // tags: file.tags && [...file.tags].map(([Key, Value]) => ({ Key, Value })),
      params
    });
    upload.on("httpUploadProgress", (progress) => {
      log("uploadObject httpUploadProgress", LogLevel.DEBUG, { ...params, Body: undefined, progress }); // Log it without the body
    });
    const result: CompleteMultipartUploadCommandOutput | AbortMultipartUploadCommandOutput = await upload.done();
    // const result: S3.ManagedUpload.SendData = await config.s3.upload(params).promise();
    if (!("Location" in result) || !result.Location) {
      log("uploadObject failed", LogLevel.WARN, { ...params, Body: undefined, result });
      throw new Error("Upload failed, no Location returned");
    }
    log("uploadObject succeeded", LogLevel.DEBUG, result);
    callAccessCallback(new Date()); // Update the last timestamp
    return result;
  } catch (error) {
    log("uploadObject failed", LogLevel.WARN, error);
    throw error;
  }
}

export interface CopyObjectOptions {
  sourceFile: S3File;
  destinationFile: S3File;
  tags?: Map<string, string>;
}
/**
 * Copies the s3 object to the new location copying the metadata and tags. The only properties that
 * can be changed is the `publicRead` property.
 * @param param0 {CopyObjectOptions}
 * @returns {CopyObjectCommandOutput}
 */
export async function copyObject ({ sourceFile, destinationFile, tags }: CopyObjectOptions): Promise<CopyObjectCommandOutput> {
  init();
  if (!sourceFile.key || !sourceFile.key.startsWith(KEYSPACE_PREFIX)) {
    sourceFile.key = KEYSPACE_PREFIX + (sourceFile.key || "");
  }
  if (!destinationFile.key || !destinationFile.key.startsWith(KEYSPACE_PREFIX)) {
    destinationFile.key = KEYSPACE_PREFIX + (destinationFile.key || "");
  }
  let taggingString: string = "";
  for (const [key, value] of (tags || [])) {
    const formattedPair = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    taggingString += (taggingString.length > 0 ? "&" : "") + formattedPair;
  }
  const params: CopyObjectCommandInput = {
    ACL: destinationFile.publicRead ? "public-read" : "authenticated-read",
    CopySource: `${BUCKET_NAME}/${sourceFile.key}`,
    Bucket: BUCKET_NAME,
    Key: destinationFile.key,
    MetadataDirective: "COPY",
    TaggingDirective: tags ? "REPLACE" : "COPY",
    Tagging: tags && taggingString
  };
  try {
    log("copyObject request", LogLevel.DEBUG, Object.assign({}, params, { Body: undefined })); // Log it without the body
    const result: CopyObjectCommandOutput = await config.s3Client.send(new CopyObjectCommand(params));
    log("copyObject succeeded", LogLevel.DEBUG, result);
    callAccessCallback(new Date()); // Update the last timestamp
    return result;
  } catch (error) {
    log("copyObject failed", LogLevel.WARN, error);
    throw error;
  }
}

// export for testing
export async function deleteObject (s3FileKey: string): Promise<DeleteObjectCommandOutput> {
  init();
  if (!s3FileKey || !s3FileKey.startsWith(KEYSPACE_PREFIX)) {
    s3FileKey = KEYSPACE_PREFIX + (s3FileKey || "");
  }
  const params: DeleteObjectCommandInput = {
    Bucket: BUCKET_NAME,
    Key: s3FileKey
  };
  try {
    log("deleteObject request", LogLevel.DEBUG, params);
    const result: DeleteObjectCommandOutput = await config.s3Client.send(new DeleteObjectCommand(params));
    log(`deleteObject ${s3FileKey} succeeded`, LogLevel.DEBUG, result);
    callAccessCallback(new Date()); // Update the last timestamp
    return result;
  } catch (error) {
    log("deleteObject failed", LogLevel.WARN, error);
    throw error;
  }
}

export async function getObjectTagging (s3FileKey: string): Promise<GetObjectTaggingCommandOutput> {
  init();
  if (!s3FileKey || !s3FileKey.startsWith(KEYSPACE_PREFIX)) {
    s3FileKey = KEYSPACE_PREFIX + (s3FileKey || "");
  }
  const params: GetObjectTaggingCommandInput = {
    Bucket: BUCKET_NAME,
    Key: s3FileKey
  };
  try {
    log("getObjectTagging request", LogLevel.DEBUG, params);
    const result: GetObjectTaggingCommandOutput = await config.s3Client.send(new GetObjectTaggingCommand(params));
    log(`getObjectTagging ${s3FileKey} succeeded`, LogLevel.DEBUG, result);
    callAccessCallback(new Date()); // Update the last timestamp
    return result;
  } catch (error) {
    log("getObjectTagging failed", LogLevel.WARN, error);
    throw error;
  }
}

export interface PutObjectTaggingOptions {
  key: string;
  tags: Map<string, string>;
}

export async function putObjectTagging ({ key, tags }: PutObjectTaggingOptions): Promise<PutObjectTaggingCommandOutput> {
  init();
  if (!key || !key.startsWith(KEYSPACE_PREFIX)) {
    key = KEYSPACE_PREFIX + (key || "");
  }
  if (ADDITIONAL_TAGS_ON_ALL.size > 0) {
    // Create a copy so we don't modify the original if we add more tags
    tags = new Map<string, string>(tags);
    for (const [tagKey, tagValue] of ADDITIONAL_TAGS_ON_ALL) {
      if (!tags.has(tagKey)) {
        tags.set(tagKey, tagValue);
      }
    }
  }
  const TagSet: S3Tag[] = [...tags].map(([Key, Value]: [string, string]) => ({ Key, Value }));
  const params: PutObjectTaggingCommandInput = {
    Bucket: BUCKET_NAME,
    Key: key,
    Tagging: { TagSet }
  };
  try {
    log("putObjectTagging request", LogLevel.DEBUG, params);
    const result: PutObjectTaggingCommandOutput = await config.s3Client.send(new PutObjectTaggingCommand(params));
    log(`putObjectTagging ${key} succeeded`, LogLevel.DEBUG, result);
    callAccessCallback(new Date()); // Update the last timestamp
    return result;
  } catch (error) {
    log("putObjectTagging failed", LogLevel.WARN, error);
    throw error;
  }
}
