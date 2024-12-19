import { LogLevel, ec2, log } from "../src/index";
import { expect } from "chai";

describe("EC2 Integration", () => {
  it("getInstanceId should get instanceId", (done: Mocha.Done) => {
    // Our current mocks do not support the metadata service. bypassMetaDataService to bypass so we don't timeout on integration tests
    ec2.getInstanceId(true).then((result: string) => {
      log("getInstanceId", LogLevel.INFO, { result });
      expect(result, "result").to.not.equal(undefined);
      expect(ec2.INSTANCE_ID_REGEX.test(result), `${ec2.INSTANCE_ID_REGEX}.test("${result}")`).to.equal(true);
      done();
    }).catch ((error) => {
      log("getInstanceId error", LogLevel.WARN, error);
      log(`Please create the ${ec2.INSTANCE_ID_FILE} on your local computer to run integration tests`, LogLevel.WARN, error);
      log(`${ec2.INSTANCE_ID_FILE} should have a single line with an instanceId like 'i-<username>' with only letters and numbers`, LogLevel.WARN, error);
      done(error);
    });
  });
});
