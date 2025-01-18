import { GetObjectCommand, GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { LogLevel, log, logger, s3 } from "@fs/ppaas-common";
import type { NextApiRequest, NextApiResponse } from "next";
import type { TestManagerError } from "../../../types";
import getConfig from "next/config";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { promisify } from "util";
import { gunzip as zlibGunzip} from "zlib";

// We have to set this before we make any log calls
logger.config.LogFileName = "ppaas-controller";

// Have to check for null on this since the tsc test compile it will be, but nextjs will have a publicRuntimeConfig
const publicRuntimeConfig: any = getConfig() && getConfig().publicRuntimeConfig ? getConfig().publicRuntimeConfig : process.env;

// If REDIRECT_TO_S3 is turned on, it must also be turned on for the acceptance tests
const REDIRECT_TO_S3: boolean = publicRuntimeConfig.REDIRECT_TO_S3 === "true";
const UNZIP_S3_FILES: boolean = publicRuntimeConfig.UNZIP_S3_FILES === "true";
// Next.js Max API size is 4MB
const MAX_API_SIZE = 4 * 1024 * 1024;

// We can't pull in BUCKET_URL and KEYSPACE_PREFIX here because they're not set until init
const { getObject, listFiles } = s3;
const gunzip = promisify(zlibGunzip);

/**
 * Retrieves the S3 Object and creates a NextApiResponse with that S3 Object or creates
 * @param req {NextApiRequest} request object
 * @param res {NextApiResponse} response object
 * @param filename {string} s3 filename
 * @param s3Folder {string} s3 folder
 * @returns true if object was found and response has been created. false if the object was not found
 */
export async function getS3Response ({ request, response, filename, s3Folder, redirectToS3 = REDIRECT_TO_S3, unzipS3Objects = UNZIP_S3_FILES }: {
  request: NextApiRequest,
  response: NextApiResponse<GetObjectCommandOutput["Body"] | Buffer | TestManagerError>,
  filename: string,
  s3Folder: string,
  redirectToS3?: boolean
  unzipS3Objects?: boolean;
}): Promise<boolean> {
  try {
    const key: string = `${s3Folder}/${filename}`;
    const files = await listFiles(key);
    if (files && files.length > 0 && files.some((file) => file.Key?.endsWith(key))) {
      // https://github.com/vercel/next.js/issues/49963
      // Next 13.4.x has a bug that stops this from working. 13.3.4 still works.
      // Possible options for going forward:
      //   1. Redirect to S3 via getSignedUrl from "@aws-sdk/s3-request-presigner" - REDIRECT_TO_S3=true
      //   2. Unzip the file ourselves and return text - UNZIP_S3_FILES=true
      // https://stackoverflow.com/questions/73872687/is-there-a-way-to-pipe-readablestreamuint8array-into-nextapiresponse
      // https://stackoverflow.com/questions/74699607/how-to-pipe-to-next-js-13-api-response
      if (redirectToS3) {
        try {
          const s3Client = s3.init();
          const command = new GetObjectCommand({
            Bucket: s3.BUCKET_NAME,
            Key: key.startsWith(s3.KEYSPACE_PREFIX) ? key : (s3.KEYSPACE_PREFIX + key)
          });
          const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 60 });
          log(`${key} presignedUrl: ${presignedUrl}`, LogLevel.DEBUG, presignedUrl);
          response.writeHead(302, { Location: presignedUrl });
          response.end();
          return true;
        } catch (error) {
          log(`Could not create presigned URL for ${key}`, LogLevel.ERROR, error, files.map((file) => file.Key));
          throw error;
        }
      }
      // Check for too large of file AFTER the redirect. Only limit on our own API. Redirect can bypass with auth
      if (files.length === 1 && files[0].Size && files[0].Size >= MAX_API_SIZE) {
        // Too Large
        response.status(413).json({ message: `Reponse is too large - Size: ${files[0].Size}, Max: ${MAX_API_SIZE}` });
        return true;
      }
      let s3Object: GetObjectCommandOutput | undefined;
      try {
        s3Object = await getObject(key);
      } catch (error) {
        log(`${key} not found in s3 after listFiles returned: ${files}`, LogLevel.ERROR, error, files.map((file) => file.Key));
      }
      if (s3Object && s3Object.Body) {
        // If listFiles somehow found more than 1 file, check size again here
        if (s3Object.ContentLength && s3Object.ContentLength >= MAX_API_SIZE) {
          // Too Large
          response.status(413).json({ message: `Reponse is too large - Size: ${s3Object.ContentLength}, Max: ${MAX_API_SIZE}` });
          return true;
        }
        let content: GetObjectCommandOutput["Body"] | Buffer = s3Object.Body;
        log("s3Object: " + s3Object, LogLevel.DEBUG, { ...s3Object, Body: !!s3Object.Body });
        // res.writeHead and res.send don't mix so we have to set each header separately
        response.status(200);
        response.setHeader("Content-Disposition", "inline");
        if (s3Object.CacheControl) { response.setHeader("Cache-Control", s3Object.CacheControl); }
        if (s3Object.ContentType) { response.setHeader("Content-Type", s3Object.ContentType); }
        if (s3Object.ETag) { response.setHeader("ETag", s3Object.ETag); }
        // https://github.com/vercel/next.js/issues/49310
        // https://github.com/vercel/next.js/issues/53737#issuecomment-1688709093
        // if (s3Object.ContentLength) { response.setHeader("Content-Length", s3Object.ContentLength); }
        if (s3Object.ContentEncoding) {
          if (unzipS3Objects) {
            if (s3Object.ContentEncoding === "gzip") {
              const bufferContent: Buffer = Buffer.from(await content.transformToByteArray());
              // response.removeHeader("Content-Length"); // remove the default one
              content = await gunzip(bufferContent);
              // response.setHeader("Content-Length", content.length);
            }
          } else {
            response.setHeader("Content-Encoding", s3Object.ContentEncoding);
          }
        }
        response.send(content);
        return true;
      }
    }

    // 404 - Not Found
    return false;
  } catch (error) {
    log(`${request.method} ${request.url} getS3Response failed: ${error}`, LogLevel.WARN, error, { filename, s3Folder });
    throw error; // Caller will create response
  }
}
