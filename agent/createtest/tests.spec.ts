import {
  buildTest
} from "../src/tests";
import { logger } from "@fs/ppaas-common";

logger.config.LogFileName = "ppaas-agent";

describe("Tests Build Test", () => {
  it("Should run a build test", (done: Mocha.Done) => {
    buildTest({ unitTest: true }).then(() => done()).catch((error) => done(error));
  });
});
