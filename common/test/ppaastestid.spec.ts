import { PpaasTestId } from "../src/index";
import { expect } from "chai";

describe("TestId", () => {
  it("Default should convert there and back", (done: Mocha.Done) => {
    const origTestId = PpaasTestId.makeTestId("test.yaml");
    const testId: string | undefined = origTestId.testId;
    expect(testId).to.not.equal(undefined);
    const newTestId = PpaasTestId.getFromTestId(origTestId.testId);
    expect(origTestId.dateString).to.equal(newTestId.dateString);
    expect(testId).to.equal(newTestId.testId);
    expect(origTestId.date.getTime()).to.equal(newTestId.date.getTime());
    done();
  });

  it("Specified should convert there and back", (done: Mocha.Done) => {
    const origDate = new Date();
    const dateString = PpaasTestId.getDateString(origDate);
    const origTestId = PpaasTestId.makeTestId("test.yaml", { dateString });
    const testId: string | undefined = origTestId.testId;
    expect(testId).to.not.equal(undefined);
    const newTestId = PpaasTestId.getFromTestId(origTestId.testId);
    expect(origTestId.dateString).to.equal(newTestId.dateString);
    expect(testId).to.equal(newTestId.testId);
    expect(origDate.getTime()).to.equal(newTestId.date.getTime());
    done();
  });

  it("Profile should be appended", (done: Mocha.Done) => {
    const origTestId = PpaasTestId.makeTestId("test.yaml", { profile: "dev" });
    const testId: string | undefined = origTestId.testId;
    expect(testId).to.not.equal(undefined);
    expect(testId).to.include("testdev");
    done();
  });

  it("PewPew should fail", (done: Mocha.Done) => {
    try {
      PpaasTestId.makeTestId("pewpew.yaml");
      done(new Error("PewPew should not be a valid testId"));
    } catch (error) {
      expect(`${error}`).to.include("Yaml File cannot be named PewPew");
      done();
    }
  });

  it("Everything should be lowercaseed", (done: Mocha.Done) => {
    const origTestId = PpaasTestId.makeTestId("TEST.yaml", { profile: "DEV" });
    const testId: string | undefined = origTestId.testId;
    expect(testId).to.not.equal(undefined);
    expect(testId).to.include("testdev");
    done();
  });

  it("Non-characters and numbers should be removed", (done: Mocha.Done) => {
    const origTestId = PpaasTestId.makeTestId("Test5-3_0.6.yaml", { profile: "DEV-Aux" });
    const testId: string | undefined = origTestId.testId;
    expect(testId).to.not.equal(undefined);
    expect(testId).to.include("test5306devaux");
    done();
  });
});
