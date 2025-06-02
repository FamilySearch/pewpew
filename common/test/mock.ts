import { AwsStub, mockClient } from "aws-sdk-client-mock";
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  GetQueueAttributesCommandOutput,
  MessageAttributeValue,
  ReceiveMessageCommand,
  ReceiveMessageCommandOutput,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  SQSClient,
  SQSClientResolvedConfig,
  Message as SQSMessage,
  ServiceInputTypes as SQSServiceInputTypes,
  ServiceOutputTypes as SQSServiceOutputTypes,
  SendMessageCommand,
  SendMessageCommandOutput
} from "@aws-sdk/client-sqs";
import {
  CompleteMultipartUploadCommand,
  CompleteMultipartUploadCommandOutput,
  CopyObjectCommand,
  CopyObjectCommandOutput,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  GetObjectTaggingCommandOutput,
  ListObjectsV2Command,
  PutObjectCommand,
  PutObjectTaggingCommand,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  S3Client,
  S3ClientResolvedConfig,
  _Object as S3Object,
  ServiceInputTypes as S3ServiceInputTypes,
  ServiceOutputTypes as S3ServiceOutputTypes,
  Tag as S3Tag,
  UploadPartCommand
} from "@aws-sdk/client-s3";
import { LogLevel, log, s3, sqs, util } from "../src/index.js";
import { Readable } from "stream";
import { constants as bufferConstants } from "node:buffer";
import { sdkStreamMixin } from "@smithy/util-stream";
const { MAX_STRING_LENGTH } = bufferConstants;

const {
  config: s3Config,
  init: initS3
} = s3;
const {
  config: sqsConfig,
  init: initSqs
} = sqs;

export const UNIT_TEST_KEY_PREFIX: string = process.env.UNIT_TEST_KEY_PREFIX || "unittest";
export const UNIT_TEST_FILENAME: string = process.env.UNIT_TEST_FILENAME || "s3test.txt";
export const UNIT_TEST_FILEPATH: string = process.env.UNIT_TEST_FILEPATH || ("test/" + UNIT_TEST_FILENAME);
export const UNIT_TEST_LOCAL_FILE_LOCATION: string = process.env.UNIT_TEST_LOCAL_FILE_LOCATION || process.env.TEMP || "/tmp";
export const MAX_POLL_WAIT: number = parseInt(process.env.MAX_POLL_WAIT || "0", 10) || 500;

export let UNIT_TEST_BUCKET_NAME: string = process.env.UNIT_TEST_BUCKET_NAME || "my-test-bucket";
export let UNIT_TEST_BUCKET_URL: string = `${UNIT_TEST_BUCKET_NAME}.s3.us-east-1.amazonaws.com`;
export let UNIT_TEST_KEYSPACE_PREFIX: string = "s3/pewpewcontroller-unittests-s3/";
export const createLocation = (filename: string = UNIT_TEST_FILENAME, folder: string = UNIT_TEST_KEY_PREFIX) =>
  `https://${UNIT_TEST_BUCKET_URL}/${UNIT_TEST_KEYSPACE_PREFIX}${folder}/${filename}`;

  // //////////////////////////////////////////////
  // /////////// S3 //////////////////////////////
  // //////////////////////////////////////////////

let _mockedS3Instance: AwsStub<S3ServiceInputTypes, S3ServiceOutputTypes, S3ClientResolvedConfig> | undefined;
export function mockS3 (): AwsStub<S3ServiceInputTypes, S3ServiceOutputTypes, S3ClientResolvedConfig> {
  if (_mockedS3Instance !== undefined) {
    return _mockedS3Instance;
  }
  // _mockedS3Instance = mockClient(S3Client);
  // Forced reset Create a new client instance
  s3Config.s3Client = undefined;
  const s3Client = initS3();
  _mockedS3Instance = mockClient(s3Client);
  // Instead of creating a new client each time, return this one that is mocked
  s3Config.s3Client = () => s3Client;
  UNIT_TEST_BUCKET_NAME = s3.BUCKET_NAME;
  UNIT_TEST_BUCKET_URL = `${UNIT_TEST_BUCKET_NAME}.s3.us-east-1.amazonaws.com`;
  UNIT_TEST_KEYSPACE_PREFIX = s3.KEYSPACE_PREFIX;
  _mockedS3Instance.on(DeleteObjectCommand).resolves({});
  // There's no parameters, so just mock it
  _mockedS3Instance.on(PutObjectTaggingCommand).resolves({});

  return _mockedS3Instance;
}

export function resetMockS3 (): void {
  if (_mockedS3Instance !== undefined) {
    _mockedS3Instance.reset();
    s3Config.s3Client = undefined;
    _mockedS3Instance = undefined;
  }
}

export function mockListObject (filename: string, folder: string, lastModified: Date = new Date()) {
  const s3Object: S3Object = {
    Key: `${folder}/${filename}`,
    LastModified: lastModified,
    Size: 1,
    StorageClass: "STANDARD"
  };
  mockListObjects([s3Object]);
}

export function mockListObjects (contents?: S3Object[] | undefined, truncated?: boolean) {
  const mockedS3Instance: AwsStub<S3ServiceInputTypes, S3ServiceOutputTypes, S3ClientResolvedConfig> = mockS3();
  mockedS3Instance.on(ListObjectsV2Command).resolves({ Contents: contents, KeyCount: contents?.length || 0, IsTruncated: truncated });
}

export function mockUploadObject ({ filename = UNIT_TEST_FILENAME, folder = UNIT_TEST_KEY_PREFIX, duration }: {
  filename?: string,
  folder?: string,
  duration?: number
} = {}): string {
  const location = createLocation(filename, folder);
  const ETag = "etag";
  const mockedUploadResult: Partial<CompleteMultipartUploadCommandOutput> = {
    Location: location,
    ETag,
    Bucket: UNIT_TEST_BUCKET_NAME,
    Key: `${folder}/${filename}`
  };
  log("mockUploadObject", LogLevel.DEBUG, { location, mockedUploadResult });
  const result = (async () => {
      log("mockedUpload.promise mock called", LogLevel.DEBUG, mockedUploadResult);
      if (duration) {
        // We need a random duration so we don't get race conditions on the unlink
        await util.sleep(.1 + (Math.random() * duration));
      }
    return mockedUploadResult;
  })();
  const mockedS3Instance: AwsStub<S3ServiceInputTypes, S3ServiceOutputTypes, S3ClientResolvedConfig> = mockS3();
  mockedS3Instance.on(PutObjectCommand).resolves(result);
  mockedS3Instance.on(CreateMultipartUploadCommand).resolves({ UploadId: "1" });
  mockedS3Instance.on(UploadPartCommand).resolves({ ETag });
  mockedS3Instance.on(CompleteMultipartUploadCommand).resolves(result);

  return location;
}

export function mockGetObject (
  body: string | number | Buffer = "{\"message\":\"Test file to upload.\"}",
  contentType: string = "application/json",
  lastModified: Date = new Date()
) {
  const mockedS3Instance: AwsStub<S3ServiceInputTypes, S3ServiceOutputTypes, S3ClientResolvedConfig> = mockS3();
  if (typeof body === "number") {
    log("mockGetObject size: " + body, LogLevel.DEBUG, { body, MAX_STRING_LENGTH });
    const size = body;
    if (size < MAX_STRING_LENGTH) {
      body = Buffer.from("x".repeat(size));
    } else {
      const remainder = size - MAX_STRING_LENGTH;
      log("mockGetObject remainder: " + remainder, LogLevel.DEBUG, { remainder, size, MAX_STRING_LENGTH });
      body = Buffer.concat([
        Buffer.from("x".repeat(MAX_STRING_LENGTH)),
        Buffer.from("x".repeat(remainder))
      ]);
    }
    log("mockGetObject created size: " + body.length, LogLevel.DEBUG);
  }
  const stream = new Readable();
  stream.push(body);
  stream.push(null);
  const sdkStream = sdkStreamMixin(stream);
  mockedS3Instance.on(GetObjectCommand).resolves({
    Body: sdkStream,
    AcceptRanges: "bytes",
    LastModified: lastModified,
    ContentLength: 78,
    ETag: "etag",
    CacheControl: "max-age=60",
    ContentType: contentType,
    Metadata: {},
    TagCount: 1
  });
}

export function mockGetObjectError (statusCode: number = 304, code: string = "NotModified") {
  const mockedS3Instance: AwsStub<S3ServiceInputTypes, S3ServiceOutputTypes, S3ClientResolvedConfig> = mockS3();
  mockedS3Instance.on(GetObjectCommand).rejects({
    name: `${statusCode}`,
    Code: code,
    "$fault": "client"
  });
}

export function mockCopyObject (
  lastModified: Date = new Date()
) {
  const mockedS3Instance: AwsStub<S3ServiceInputTypes, S3ServiceOutputTypes, S3ClientResolvedConfig> = mockS3();
  const mockedCopyObjectResult: Partial<CopyObjectCommandOutput> = {
    CopyObjectResult: {
      LastModified: lastModified,
      ETag: "etag"
    }
  };
  mockedS3Instance.on(CopyObjectCommand).resolves(mockedCopyObjectResult);
}

export function mockGetObjectTagging (
  tags: Map<string, string> | undefined
) {
  const mockedS3Instance: AwsStub<S3ServiceInputTypes, S3ServiceOutputTypes, S3ClientResolvedConfig> = mockS3();
  const mockedGetObjectTaggingResult: Partial<GetObjectTaggingCommandOutput> = {
    TagSet: tags
      ? [...tags].map(([key, value]:[string, string]): S3Tag => ({ Key: key, Value: value }))
      : []
  };
  mockedS3Instance.on(GetObjectTaggingCommand).resolves(mockedGetObjectTaggingResult);
}

// //////////////////////////////////////////////
// /////////// SQS //////////////////////////////
// //////////////////////////////////////////////

let _mockedSqsInstance: AwsStub<SQSServiceInputTypes, SQSServiceOutputTypes, SQSClientResolvedConfig> | undefined;
export function mockSqs (): AwsStub<SQSServiceInputTypes, SQSServiceOutputTypes, SQSClientResolvedConfig> {
  log("mockSqs enter", LogLevel.DEBUG);
  if (_mockedSqsInstance !== undefined) {
    log("mockSqs exists", LogLevel.DEBUG);
    return _mockedSqsInstance;
  }
  // _mockedSqsInstance = mockClient(SQSClient);
  // Forced reset Create a new client instance
  sqsConfig.sqsClient = undefined;
  const sqsClient = initSqs();
  _mockedSqsInstance = mockClient(sqsClient);
  // Instead of creating a new client each time, return this one that is mocked
  sqsConfig.sqsClient = () => sqsClient;
  log("mockSqs created", LogLevel.DEBUG, { mockedSqsInstance: _mockedSqsInstance, sqs: sqsConfig.sqsClient });
  // Always mock deleteMessage so we don't accidentally call it behind the scenes. Don't expose the call like the others
  _mockedSqsInstance.on(DeleteMessageCommand).resolves({});
  // Always mock changeMessageVisibility
  _mockedSqsInstance.on(ChangeMessageVisibilityCommand).resolves({});

  return _mockedSqsInstance;
}

export function resetMockSqs (): void {
  if (_mockedSqsInstance !== undefined) {
    _mockedSqsInstance.reset();
    _mockedSqsInstance.restore();
    sqsConfig.sqsClient = undefined;
    _mockedSqsInstance = undefined;
  }
}

export function mockGetQueueAttributes (
  queueArn: string = "arn:aws:sqs:us-east-1:unittests:testqueue"
) {
  const mockedSqsInstance: AwsStub<SQSServiceInputTypes, SQSServiceOutputTypes, SQSClientResolvedConfig> = mockSqs();

  const mockedGetQueueAttributeResult: Partial<GetQueueAttributesCommandOutput> = {
    Attributes: {
      QueueArn: queueArn,
      ApproximateNumberOfMessages: "0",
      ApproximateNumberOfMessagesNotVisible: "0",
      ApproximateNumberOfMessagesDelayed: "0",
      CreatedTimestamp: "1570468375",
      LastModifiedTimestamp: "1600956723",
      VisibilityTimeout: "60",
      MaximumMessageSize: "262144",
      MessageRetentionPeriod: "900",
      DelaySeconds: "0",
      ReceiveMessageWaitTimeSeconds: "20"
    }
  };
  mockedSqsInstance.on(GetQueueAttributesCommand).resolves(mockedGetQueueAttributeResult);
  log("mockGetQueueAttributes", LogLevel.DEBUG, { mockedGetQueueAttributes: mockedGetQueueAttributeResult, sqs: sqsConfig.sqsClient });
}

export function mockSendMessage () {
  const mockedSendMessageResult: Partial<SendMessageCommandOutput> = {
    MD5OfMessageBody: "testmd5",
    MD5OfMessageAttributes: "testmd5",
    MessageId: "unit-test-message-id"
  };
  const mockedSqsInstance: AwsStub<SQSServiceInputTypes, SQSServiceOutputTypes, SQSClientResolvedConfig> = mockSqs();
  mockedSqsInstance.on(SendMessageCommand).resolves(mockedSendMessageResult);
  log("mockSendMessage", LogLevel.DEBUG, { mockedSendMessage: mockedSendMessageResult, sqs: sqsConfig.sqsClient });
}

export function mockReceiveMessage (
  testId: string = "UnitTest" + Date.now(),
  body: string = "Sending Message to the unittests Queue",
  testMessage: string = ""
) {
  const message: SQSMessage =       {
    MessageId: "unit-test-message-id",
    ReceiptHandle: "unit-test-receipt-handle",
    Body: body,
    MessageAttributes: {
      TestId: {
        StringValue: testId,
        DataType: "String"
      },
      TestMessage: {
        BinaryValue: Buffer.from(testMessage),
        DataType: "Binary"
      },
      UnitTestMessage: {
        StringValue: "true",
        DataType: "String"
      }
    }
  };
  mockReceiveMessages([message]);
}

export function mockReceiveMessageAttributes (
  messageBodyAttributeMap: Record<string, MessageAttributeValue>,
  body: string = "Sending Message to the unittests Queue"
) {
  const message: SQSMessage =       {
    MessageId: "unit-test-message-id",
    ReceiptHandle: "unit-test-receipt-handle",
    Body: body,
    MessageAttributes: messageBodyAttributeMap
  };
  mockReceiveMessages([message]);
}

export function mockReceiveMessages (messages?: SQSMessage[]) {
  const mockedSqsInstance: AwsStub<SQSServiceInputTypes, SQSServiceOutputTypes, SQSClientResolvedConfig> = mockSqs();

  const mockedReceiveMessageResult: Partial<ReceiveMessageCommandOutput> = {
    Messages: messages
  };
  mockedSqsInstance.on(ReceiveMessageCommand).resolves(mockedReceiveMessageResult);

  log("mockReceiveMessages", LogLevel.DEBUG, { mockedReceiveMessage: mockedReceiveMessageResult, sqs: sqsConfig.sqsClient });
}
