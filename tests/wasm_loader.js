const _fs = require("fs");
const { promisify } = require("util");
const { Config } = require("../lib/config-wasm/pkg/config_wasm.js");

const  readFile = promisify(_fs.readFile);

if (process.argv.length < 3) {
  console.error(`Must pass a file to parse: "${process.argv.join(" ")}"`)
  process.exit(1);
}
const filepath = process.argv[2];
console.log(`filepath: "${filepath}"`);

(async () => {
  let config;
  try {
    const fileBuffer = await readFile(filepath);
    const varMap = new Map();
    config = new Config(fileBuffer, varMap);
    console.log("config loaded");
    config.checkOk();
    console.log("config.checkOk()");
    console.log(`config.getBucketSize(): ${config.getBucketSize()}`);
    console.log(`config.getDuration(): ${config.getDuration()}`);
    console.log(`config.getInputFiles(): ${JSON.stringify(config.getInputFiles())}`);
    console.log(`config.getLoggerFiles(): ${JSON.stringify(config.getLoggerFiles())}`);

  } catch (error) {
    console.error("Error loading config", error);
    process.exit(1);
  } finally {
    if (config) {
      config.free();
    }
  }
})().catch((error) => console.error("Global Catch", error));
