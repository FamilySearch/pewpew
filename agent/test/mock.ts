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
  GetObjectCommandOutput,
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
import { LogLevel, log, s3, sqs, util } from "@fs/ppaas-common";
import { Readable } from "stream";
import { constants as bufferConstants } from "node:buffer";
import { sdkStreamMixin } from "@aws-sdk/util-stream-node";
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
  log("mockS3 enter", LogLevel.DEBUG);
  if (_mockedS3Instance !== undefined) {
    log("mockS3 exists", LogLevel.DEBUG);
    return _mockedS3Instance;
  }
  // _mockedS3Instance = mockClient(S3Client);
  // Forced reset Create a new client instance
  s3Config.s3Client = undefined;
  const s3Client = initS3();
  _mockedS3Instance = mockClient(s3Client);
  // Instead of creating a new client each time, return this one that is mocked
  s3Config.s3Client = () => s3Client;
  log("mockS3 created", LogLevel.DEBUG, { mockedS3Instance: _mockedS3Instance, s3: s3Config.s3Client });
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

export function mockListObject ({
  filename, folder, lastModified = new Date(), keyMatch, once
}: {
  filename: string, folder: string, lastModified?: Date, keyMatch?: string, once?: boolean
}) {
  const s3Object: S3Object = {
    Key: `${folder}/${filename}`,
    LastModified: lastModified,
    Size: 1,
    StorageClass: "STANDARD"
  };
  mockListObjects({ contents: [s3Object], keyMatch, once });
}

export function mockListObjects ({
  contents, truncated, keyMatch, once
}: {
  contents?: S3Object[], truncated?: boolean, keyMatch?: string, once?: boolean
} = {}) {
  log("mockListObjects", LogLevel.DEBUG, { contents, truncated, keyMatch });
  const mockedS3Instance: AwsStub<S3ServiceInputTypes, S3ServiceOutputTypes, S3ClientResolvedConfig> = mockS3();
  mockedS3Instance.on(ListObjectsV2Command, { Prefix: keyMatch }).callsFake(() => {
    log("mockListObjects.promise mock called", LogLevel.DEBUG, { contents, truncated, keyMatch });
    if (once) {
      mockedS3Instance.on(ListObjectsV2Command, { Prefix: keyMatch }).resolves({ Contents: undefined });
    }
    return { Contents: contents, IsTruncated: truncated };
  });
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
  const result = async () => {
      log("mockedUpload.promise mock called", LogLevel.DEBUG, mockedUploadResult);
      if (duration) {
        // We need a random duration so we don't get race conditions on the unlink
        await util.sleep(.1 + (Math.random() * duration));
      }
    return mockedUploadResult;
  };
  const mockedS3Instance: AwsStub<S3ServiceInputTypes, S3ServiceOutputTypes, S3ClientResolvedConfig> = mockS3();
  mockedS3Instance.on(PutObjectCommand).callsFake(result);
  mockedS3Instance.on(CreateMultipartUploadCommand).resolves({ UploadId: "1" });
  mockedS3Instance.on(UploadPartCommand).resolves({ ETag });
  mockedS3Instance.on(CompleteMultipartUploadCommand).callsFake(result);

  return location;
}

export function mockGetObject ({
  body = "{\"message\":\"Test file to upload.\"}",
  contentType = "application/json",
  lastModified = new Date(),
  keyMatch
}: {
  body?: string | number | Buffer,
  contentType?: string,
  lastModified?: Date,
  keyMatch?: string
} = {}) {
  log("mockGetObject: " + typeof body, LogLevel.DEBUG, { body: typeof body === "object" ? "buffer" : body, contentType, lastModified, keyMatch, MAX_STRING_LENGTH });
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
  const mockedGetObjectResult: Partial<GetObjectCommandOutput> = {
    Body: sdkStream,
    AcceptRanges: "bytes",
    LastModified: lastModified,
    ContentLength: 78,
    ETag: "etag",
    CacheControl: "max-age=60",
    ContentType: contentType,
    Metadata: {},
    TagCount: 1
  };
  // eslint-disable-next-line require-await
  const result = async () => {
    log("mockedGetObject.promise mock called", LogLevel.DEBUG, { keyMatch, mockedGetObjectResult });
    return mockedGetObjectResult;
  };
  mockedS3Instance.on(GetObjectCommand, { Key: keyMatch }).callsFake(result);
}

export function mockGetObjectError ({
  statusCode = 304,
  code = "NotModified",
  keyMatch
}: { statusCode?: number, code?: string, keyMatch?: string } =  {}) {
  const mockedS3Instance: AwsStub<S3ServiceInputTypes, S3ServiceOutputTypes, S3ClientResolvedConfig> = mockS3();
  mockedS3Instance.on(GetObjectCommand, { Key: keyMatch }).rejects({
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
  tags?: Map<string, string> | undefined
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

  log("mockSqs exit", LogLevel.DEBUG);
  return _mockedSqsInstance;
}

export function resetMockSqs (): void {
  log("resetMockSqs enter", LogLevel.DEBUG);
  if (_mockedSqsInstance !== undefined) {
    _mockedSqsInstance.reset();
    _mockedSqsInstance.restore();
    sqsConfig.sqsClient = undefined;
    _mockedSqsInstance = undefined;
  }
  log("resetMockSqs exit", LogLevel.DEBUG);
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

export function mockReceiveMessage ({
  testId = "UnitTest" + Date.now(),
  body = "Sending Message to the unittests Queue",
  testMessage = "",
  queueUrlMatch
}: { testId?: string, body?: string, testMessage?: string, queueUrlMatch?: string } = {}) {
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
      }
    }
  };
  mockReceiveMessages([message], queueUrlMatch);
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

export function mockReceiveMessages (messages?: SQSMessage[], queueUrlMatch?: string) {
  const mockedSqsInstance: AwsStub<SQSServiceInputTypes, SQSServiceOutputTypes, SQSClientResolvedConfig> = mockSqs();

  const mockedReceiveMessageResult: Partial<ReceiveMessageCommandOutput> = {
    Messages: messages
  };
  mockedSqsInstance.on(ReceiveMessageCommand, { QueueUrl: queueUrlMatch }).callsFake(() => {
    log("mockReceiveMessages.promise mock called", LogLevel.DEBUG, { queueUrlMatch, mockedReceiveMessageResult });
    return mockedReceiveMessageResult;
  });

  log("mockReceiveMessages", LogLevel.DEBUG, { queueUrlMatch, mockedReceiveMessage: mockedReceiveMessageResult });
}
