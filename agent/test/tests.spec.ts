import {
  PEWPEW_BINARY_FOLDER,
  PpaasTestId,
  PpaasTestStatus,
  TestStatus,
  TestStatusMessage,
  s3,
  sqs,
  util
} from "@fs/ppaas-common";
import {
  PEWPEW_PATH,
  buildTest,
  buildTestContents,
  version as buildTestPewpewVersion,
  yamlFile as buildTestYamlFile
} from "../src/tests";
import {
  createS3Filename as createS3FilenameTestStatus,
  getKey as getKeyTestStatus
} from "@fs/ppaas-common/dist/src/ppaasteststatus";
import {
  mockCopyObject,
  mockGetObject,
  mockGetObjectError,
  mockGetObjectTagging,
  mockListObject,
  mockListObjects,
  mockReceiveMessage,
  mockS3,
  mockSendMessage,
  mockSqs,
  mockUploadObject,
  resetMockS3,
  resetMockSqs
} from "../test/mock";
import { getKey as getKeyS3Message } from "@fs/ppaas-common/dist/src/ppaass3message";
import { readFile } from "fs/promises";

describe("Tests Build Test", () => {
  let ppaasTestId: PpaasTestId;

  before(() => {
    mockS3();
    mockSqs();
    mockSendMessage();
    mockUploadObject();
    mockCopyObject();
    mockGetObjectTagging();
  });

  after(() => {
    resetMockS3();
    resetMockSqs();
  });

  beforeEach(async () => {
    // Mock the pewpew file download each time to reset the stream
    mockGetObject({
      body: await readFile(PEWPEW_PATH),
      contentType: "application/octet-stream",
      keyMatch: `${s3.KEYSPACE_PREFIX}${PEWPEW_BINARY_FOLDER}/${buildTestPewpewVersion}/${util.PEWPEW_BINARY_EXECUTABLE}`
    });

    ppaasTestId = PpaasTestId.makeTestId(buildTestYamlFile);
    const s3Folder = ppaasTestId.s3Folder;
    // Yaml file
    mockGetObject({
      body: buildTestContents,
      contentType: "text/yaml",
      keyMatch: `${s3.KEYSPACE_PREFIX}${s3Folder}/${buildTestYamlFile}`
    });
    // .info
    const now = Date.now();
    const basicTestStatusMessage: TestStatusMessage = {
      startTime: now + 1,
      endTime: now + 2,
      resultsFilename: [],
      status: TestStatus.Created
    };
    const ppaasTestStatus: PpaasTestStatus = new PpaasTestStatus(ppaasTestId, basicTestStatusMessage);
    const testStatusKey = s3.KEYSPACE_PREFIX + getKeyTestStatus(ppaasTestId);
    mockListObject({ filename: createS3FilenameTestStatus(ppaasTestId), folder: s3Folder, keyMatch: testStatusKey });
    mockGetObject({ body: JSON.stringify(ppaasTestStatus.getTestStatusMessage()), contentType: "application/json", keyMatch: testStatusKey });
    // .msg
    const s3MessageKey = s3.KEYSPACE_PREFIX + getKeyS3Message(ppaasTestId);
    mockListObjects({ contents: undefined, keyMatch: s3MessageKey });
    mockGetObjectError({ statusCode: 404, code: "Not Found", keyMatch: s3MessageKey });

    // Auto scale message
    mockReceiveMessage({
      testId: ppaasTestId.testId,
      queueUrlMatch: sqs.QUEUE_URL_SCALE_IN.values().next().value
    });
  });

  it("Should run a build test", (done: Mocha.Done) => {
    buildTest({ unitTest: true, ppaasTestId }).then(() => done()).catch((error) => done(error));
  });
});
