import {
  buildTest
} from "../src/tests.js";

describe("Integration Build Test", () => {
  it("Should run a build test", (done: Mocha.Done) => {
    buildTest({ unitTest: true }).then(() => done()).catch((error) => done(error));
  });
});
