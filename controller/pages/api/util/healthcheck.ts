import { LogLevel, ec2, log, s3, sqs } from "@fs/ppaas-common";
import { waitForSecrets as _waitForSecrets, getClientSecretOpenId, getEncryptionKey } from "./secrets";

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
s3.setAccessCallback(lastS3AccessCallBack);
sqs.setAccessCallback(lastSQSAccessCallBack);

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
    log("accessEncryptionKeyPass", LogLevel.WARN, error, { keyPass: false });
    return false;
  }
}

export function accessOpenIdSecretPass (): boolean {
  try {
    const secretPass: boolean = getClientSecretOpenId() ? true : false;
    log("accessOpenIdSecretPass", LogLevel.DEBUG, { secretPass });
    return secretPass;
  } catch (error) {
    log("accessOpenIdSecretPass", LogLevel.WARN, error, { secretPass: false });
    return false;
  }
}

// See if we can get the instanceId
ec2.getInstanceId().then((instanceId: string) => {
  getGlobalHealthcheckConfig().instanceId = instanceId;
  log("getGlobalHealthcheckConfig instanceId", LogLevel.DEBUG, { instanceId, globalInstanceId: getGlobalHealthcheckConfig().instanceId });
}).catch((error) => log("Could not get instanceId", LogLevel.WARN, error));

// Shared function for the normal healthcheck if accessEncryptionKeyPass fails
export async function waitForSecrets (): Promise<boolean> {
  log("Waiting for Secrets at " + new Date(), LogLevel.DEBUG);
  try {
    await _waitForSecrets({ retries: 1, delay: 100 });
    return true;
  } catch (error) {
    log("waitForSecrets failed", LogLevel.WARN, error);
    // DO NOT REJECT. Just return false
    return false;
  }
}
