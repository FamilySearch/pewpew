import { DeleteObjectCommandOutput, _Object as S3Object } from "@aws-sdk/client-s3";
import {
  LogLevel,
  log,
  s3
} from "@fs/ppaas-common";
import { expect } from "chai";

const S3_KEYPATHS: string[] = (process.env.S3_KEYPATHS || "basic,scripting,settings").split(",");

// Clean-up for the integration/acceptance tests when run locally.
// On the real build environments they go away, but not on unittest
describe("S3Cleanup", () => {
  s3.setAccessCallback((date: Date) => log("S3Cleanup S3 Access Callback: " + date, LogLevel.DEBUG));
  before (async () => {
    for (const s3Folder of S3_KEYPATHS) {
      try {
        const foundFiles: S3Object[] = await s3.listFiles({ s3Folder, maxKeys: 1000 });
        const promises: Promise<void | DeleteObjectCommandOutput>[] = [];
        log("foundFiles", LogLevel.DEBUG, foundFiles);
        if (foundFiles && foundFiles.length > 0) {
          for (const foundFile of foundFiles) {
            log("foundFile", LogLevel.DEBUG, foundFile);
            promises.push(s3.deleteObject(foundFile.Key!).catch((error) => {
              log("Could not delete " + foundFile.Key!, LogLevel.WARN, error);
            }));
          }
        }
        await Promise.all(promises);
        log(`Deleted ${promises.length} tests from ${s3Folder}`, LogLevel.DEBUG, foundFiles.map((s3Object) => s3Object.Key));
        log(`Deleted ${promises.length} tests from ${s3Folder}`, LogLevel.WARN);
      } catch (error) {
        log(`deleteObject ${s3Folder} failed`, LogLevel.ERROR, error);
        throw error;
      }
    }
  });

  it("should run", (done: Mocha.Done) => {
    // Need at least one test so the before will fire.
    Promise.all(S3_KEYPATHS.map((s3Folder) => s3.listFiles({ s3Folder, maxKeys: 1000 })
    .then((foundFiles: S3Object[]) => {
      log("foundFiles: " + s3Folder, LogLevel.DEBUG, foundFiles);
      expect(foundFiles.length).to.be.equal(0);
    }))).then(() => done())
    .catch((error) => done(error));
  });
});
