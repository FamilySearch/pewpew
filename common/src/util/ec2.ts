import { LogLevel, log } from "./log";
import {
  EC2Client
} from "@aws-sdk/client-ec2";
import { exec as _exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
const exec = promisify(_exec);

// Create these later so the profile can be set dynamically
let ec2Client: EC2Client;

// Init function to initialize these after we've started but on first access
export function init (): void {
  if (!ec2Client) {
    ec2Client = new EC2Client({
      region: "us-east-1"
    });
  }
}

export const INSTANCE_ID_FILE = "/var/lib/cloud/data/instance-id";
export const INSTANCE_ID_REGEX = /^i-[0-9a-z]+$/;
export const INSTANCE_FILE_REGEX = /^instance-id:\s*(i-[0-9a-z]+)$/;
export const INSTANCE_ID_COMMAND = "ec2-metadata --instance-id";
export async function getInstanceId (): Promise<string> {
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
