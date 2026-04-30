import { basename, join } from "path";
import { integrationUrl } from "../util.js";
import { tmpdir } from "os";

const SCREENSHOTS_PATH = process.env.RESULTS_PATH || join(tmpdir(), "screenshots");

export const config = {
  runner: "local",

  tsConfigPath: "./acceptance/wdio/tsconfig.json",

  specs: [
    "./**/*.spec.ts"
  ],

  maxInstances: 1,

  capabilities: [{
    browserName: "chrome",
    "goog:chromeOptions": {
      args: ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=1920,1080"]
    }
  }],

  logLevel: "warn",

  baseUrl: integrationUrl,

  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 30000
  },

  reporters: ["spec"],

  afterTest: async (
    { file, title, parent }: { file: string; title: string; parent: string },
    _context: unknown,
    { passed }: { passed: boolean }
  ) => {
    if (!passed) {
      const filename = basename(file, ".spec.ts");
      const safeName = `${parent}-${title}`.replace(/[/\\?%*:|"<>]/g, "-");
      const screenshot = join(SCREENSHOTS_PATH, `${filename}-${safeName}-${new Date().toISOString().replace(/[-:.Z]/g, "")}.png`);
      // eslint-disable-next-line no-console
      console.log("Test Failed - Saving Screenshot: " + screenshot);
      // eslint-disable-next-line no-console
      await browser.saveScreenshot(screenshot).catch((error) => console.error("Could not save screenshot " + screenshot, error));
    }
  }
};
