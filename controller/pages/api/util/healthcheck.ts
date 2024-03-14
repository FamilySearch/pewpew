import { LogLevel, ec2, log, logger, s3, sqs } from "@fs/ppaas-common";
import { getClientSecretOpenId, getEncryptionKey } from "./secrets";

// We have to set this before we make any log calls
logger.config.LogFileName = "ppaas-controller";

const listObjects = s3.listObjects;
const setS3AccessCallback = s3.setAccessCallback;
const setSqsAccessCallback = sqs.setAccessCallback;

// Export these for testing
export const S3_ALLOWED_LAST_ACCESS_MS: number = parseInt(process.env.S3_ALLOWED_LAST_ACCESS_MS || "0", 10) || 90000;
export const SQS_ALLOWED_LAST_ACCESS_MS: number = parseInt(process.env.SQS_ALLOWED_LAST_ACCESS_MS || "0", 10) || 90000;

export interface HealthCheckConfig {
  lastS3Access: Date;
  lastSQSAccess: Date;
  failHealthCheck: boolean;
  failHealthCheckMessage?: string;
  instanceId?: string;
}

// https://stackoverflow.com/questions/70260701/how-to-share-data-between-api-route-and-getserversideprops
declare global {
  // https://stackoverflow.com/questions/68481686/type-typeof-globalthis-has-no-index-signature
  // https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-4.html#type-checking-for-globalthis
  // Note that global variables declared with let and const don’t show up on globalThis.
  // eslint-disable-next-line no-var
  var healthcheckConfig: HealthCheckConfig | undefined;
}

// Export for testing
export function getGlobalHealthcheckConfig (): HealthCheckConfig {
  if (global.healthcheckConfig === undefined) {
    global.healthcheckConfig = { lastS3Access: new Date(0), lastSQSAccess: new Date(0), failHealthCheck: false };
  }
  return global.healthcheckConfig;
}

const lastS3AccessCallBack = (date: Date) => {
  getGlobalHealthcheckConfig().lastS3Access = date;
  log("lastS3AccessCallBack", LogLevel.DEBUG, { date, ts: date.getTime(), ...getGlobalHealthcheckConfig() });
};
const lastSQSAccessCallBack = (date: Date) => {
  getGlobalHealthcheckConfig().lastSQSAccess = date;
  log("lastSQSAccessCallBack", LogLevel.DEBUG, { date, ts: date.getTime(), ...getGlobalHealthcheckConfig() });
};
setS3AccessCallback(lastS3AccessCallBack);
setSqsAccessCallback(lastSQSAccessCallBack);

// These are in separate export functions for test purposes
export function accessS3Pass (lastS3Access: Date = getGlobalHealthcheckConfig().lastS3Access): boolean {
  const date = new Date();
  const s3Pass: boolean = ((date.getTime() - lastS3Access.getTime()) < S3_ALLOWED_LAST_ACCESS_MS);
  log("accessS3Pass", LogLevel.DEBUG, { date, now: date.getTime(), lastS3Access, lastS3AccessTs: lastS3Access.getTime(), s3Pass });
  return s3Pass;
}

export function accessSqsPass (lastSQSAccess: Date = getGlobalHealthcheckConfig().lastSQSAccess): boolean {
  const date = new Date();
  const sqsPass: boolean = ((date.getTime() - lastSQSAccess.getTime()) < SQS_ALLOWED_LAST_ACCESS_MS);
  log("accessSqsPass", LogLevel.DEBUG, { date, now: date.getTime(), lastSQSAccess, lastSQSAccessTs: lastSQSAccess.getTime(), sqsPass });
  return sqsPass;
}

export function accessEncryptionKeyPass (): boolean {
  try {
    const keyPass: boolean = getEncryptionKey() ? true : false;
    log("accessEncryptionKeyPass", LogLevel.DEBUG, { keyPass });
    return keyPass;
  } catch (error) {
    log("accessEncryptionKeyPass", LogLevel.WARN, { keyPass: false });
    return false;
  }
}

export function accessOpenIdSecretPass (): boolean {
  try {
    const secretPass: boolean = getClientSecretOpenId() ? true : false;
    log("accessOpenIdSecretPass", LogLevel.DEBUG, { secretPass });
    return secretPass;
  } catch (error) {
    log("accessOpenIdSecretPass", LogLevel.WARN, { secretPass: false });
    return false;
  }
}

// See if we can get the instanceId
ec2.getInstanceId().then((instanceId: string) => {
  getGlobalHealthcheckConfig().instanceId = instanceId;
  log("getGlobalHealthcheckConfig instanceId", LogLevel.DEBUG, { instanceId, globalInstanceId: getGlobalHealthcheckConfig().instanceId });
}).catch((error) => log("Could not get instanceId", LogLevel.WARN, error));

// Shared function for the S3 healthcheck and normal healthcheck if accessS3Pass fails
export async function pingS3 (): Promise<boolean> {
  log("Pinging S3 at " + new Date(), LogLevel.DEBUG);
  // Ping S3 and update the lastS3Access if it works
  try {
    await listObjects({ prefix: "ping", maxKeys: 1 }); // Limit 1 so we can get back fast
    log("Pinging S3 succeeded at " + new Date(), LogLevel.DEBUG);
    return true;
  } catch (error) {
    log("pingS3 failed", LogLevel.ERROR, error);
    // DO NOT REJECT. Just return false
    return false;
  }
}
