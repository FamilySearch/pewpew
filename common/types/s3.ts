import { PutObjectCommandInput } from "@aws-sdk/client-s3";
import {Readable} from "stream";

export type Body = Buffer|Uint8Array|Blob|string|Readable;

export interface S3File {
  /**
   * The object body. Must be a PutObjectCommandInput["Body"]
   */
  body?: PutObjectCommandInput["Body"] | Body;
   /**
    * The s3 key for the object. Will automatically be prepended with the KEYSPACE_PREFIX if we have a shared bucket
    */
  key: string;
   /**
    * Optional: The storage class for the object. Defaults to standard
    */
  storageClass?: PutObjectCommandInput["StorageClass"];
   /**
    * The Content-Type tag for the object. Defaults to text/plain
    */
  contentType: string;
   /**
    * Optional: The Content-Encoding tag for the object. Defaults to none
    */
  contentEncoding?: string;
   /**
    * Optional: Whether the object is public readable without authorization
    */
  publicRead?: boolean;
   /**
    * Optional: Tags to be applied to the object
    */
  tags?: Map<string, string>;
}
