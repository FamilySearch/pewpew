import { LogLevel, log } from "./log";
import { MetadataService } from "@aws-sdk/ec2-metadata-service";
import { exec as _exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
const exec = promisify(_exec);

export const INSTANCE_ID_FILE = "/var/lib/cloud/data/instance-id";
export const INSTANCE_ID_REGEX = /^i-[0-9a-z]+$/;
export const INSTANCE_FILE_REGEX = /^instance-id:\s*(i-[0-9a-z]+)$/;
export const INSTANCE_ID_COMMAND = "ec2-metadata --instance-id";

// Putting back code removed by https://github.com/fs-eng/ppaas-common/commit/397d38e31ebafa9551dec8d9a2082140e8d949ae#diff-b0083bb9a17262c7a014463e8dee3fd0489cad8cb220d19531f295b9592826a0L14
// AWS SDK V3 finally supports the MetadataService
const metadata: MetadataService = new MetadataService({
  // host: "169.254.169.254"
});

// Our current mocks do not support the metadata service. bypassMetaDataService to bypass so we don't timeout on integration tests
export async function getInstanceId (bypassMetaDataService?: boolean): Promise<string> {
  if (!bypassMetaDataService) {
    try {
      // curl http://169.254.169.254/latest/meta-data/instance-id -> "i-0cfd3309705a3ce79"
      const instanceId: string = await metadata.request("/latest/meta-data/instance-id", {});
      log("getInstanceId MetadataService /latest/meta-data/instance-id: " + instanceId, LogLevel.WARN, instanceId);
      if (!INSTANCE_ID_REGEX.test(instanceId)) {
        log(`InstanceId did not match regex [${instanceId}]`, LogLevel.WARN, { match: instanceId?.match(INSTANCE_ID_REGEX), INSTANCE_ID_REGEX });
        throw new Error("InstanceId did not match regex");
      }
      return instanceId;
    } catch (error: unknown) {
      log("Could not load instanceId metadata", LogLevel.WARN, error);
    }
  }
  // Try to load from file first
  // $ cat /var/lib/cloud/data/instance-id -> "i-0cfd3309705a3ce79"
  try {
    const instanceId: string = (await readFile(INSTANCE_ID_FILE, "utf-8")).trim();
    log(`${INSTANCE_ID_FILE} instanceId: [${instanceId}]`, LogLevel.DEBUG, { instanceId });
    if (!INSTANCE_ID_REGEX.test(instanceId)) {
      log(`InstanceId did not match regex [${instanceId}]`, LogLevel.WARN, { match: instanceId?.match(INSTANCE_ID_REGEX), INSTANCE_ID_REGEX });
      throw new Error("InstanceId did not match regex");
    }
    return instanceId;
  } catch (error: unknown) {
    log(`Could not load instanceId file "${INSTANCE_ID_FILE}"`, LogLevel.WARN, error);
  }
  // Then try ec2-metadata command
  // $ ec2-metadata --instance-id | cut -d " " -f 2
  // $ ec2-metadata --instance-id -> "instance-id: i-0cfd3309705a3ce79"
  try {
    const { stderr, stdout } = await exec(INSTANCE_ID_COMMAND);
    const match: RegExpMatchArray | null = stdout?.match(INSTANCE_FILE_REGEX);
    log(`${INSTANCE_ID_COMMAND}: [${stdout}]`, LogLevel.DEBUG, { stdout, stderr, match });
    if (!match || match.length !== 2) {
      log(`InstanceId did not match regex [${stdout}]`, LogLevel.WARN, { stderr, stdout, match, INSTANCE_ID_REGEX });
      throw new Error("InstanceId did not match regex");
    }
    const instanceId = match[1];
    log(`${INSTANCE_ID_COMMAND} instanceId: [${instanceId}]`, LogLevel.DEBUG, { instanceId, match });
    return instanceId;
  } catch (error: unknown) {
    log(`Could not load instanceId command "${INSTANCE_ID_COMMAND}"`, LogLevel.WARN, error);
  }
  throw new Error("Could not load instanceId");
}
