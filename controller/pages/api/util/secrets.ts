import {
  CreateSecretCommand,
  CreateSecretCommandInput,
  CreateSecretCommandOutput,
  DeleteSecretCommand,
  DeleteSecretCommandInput,
  DeleteSecretCommandOutput,
  GetSecretValueCommand,
  GetSecretValueCommandInput,
  GetSecretValueCommandOutput,
  SecretsManagerClient,
  TagResourceCommand,
  TagResourceCommandInput,
  TagResourceCommandOutput
} from "@aws-sdk/client-secrets-manager";
import { LogLevel, log, logger, s3, util } from "@fs/ppaas-common";
import { IS_RUNNING_IN_AWS } from "./authclient";
import crypto from "crypto";
import { readFile } from "fs/promises";

logger.config.LogFileName = "ppaas-controller";

export const OVERRIDE = "_OVERRIDE";

export interface SecretsConfig {
  encryptionKey: Buffer | undefined;
  openIdClientSecret: Buffer | undefined;
}

// https://stackoverflow.com/questions/70260701/how-to-share-data-between-api-route-and-getserversideprops
declare global {
  // https://stackoverflow.com/questions/68481686/type-typeof-globalthis-has-no-index-signature
  // https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-4.html#type-checking-for-globalthis
  // Note that global variables declared with let and const don’t show up on globalThis.
  // eslint-disable-next-line no-var
  var secretsConfig: SecretsConfig | undefined;
}

// Export for testing
export function getGlobalSecretsConfig (): SecretsConfig {
  if (global.secretsConfig === undefined) {
    global.secretsConfig = { encryptionKey: undefined, openIdClientSecret: undefined };
  }
  return global.secretsConfig;
}

// Export for testing so we can reset and mock secretsClient
/**
 * Secrets Manager configuration. Exported for testing so we can reset and mock secretsClient.
 * Or alter the encryptionKeyName/secretKeyName after the fact
 */
export const config: {
  /** Aws SDK client for secrets-manager */
  secretsClient: SecretsManagerClient,
  /** Can be overriden by environment variable SECRETS_ENCRYPTION_KEY_NAME */
  encryptionKeyName: string;
  /** Can be overriden by environment variable SECRETS_OPENID_CLIENT_SECRET_NAME */
  openIdClientSecret: string;
} = {
  secretsClient: undefined as unknown as SecretsManagerClient,
  encryptionKeyName: process.env.SECRETS_ENCRYPTION_KEY_NAME || "pewpew-encryption-key",
  openIdClientSecret: process.env.SECRETS_OPENID_CLIENT_SECRET_NAME || "pewpew-openid-secret"
};

export function init (): void {
  if (config.secretsClient) {
    // If we've already set the secretsClient then we've done this already.
    return;
  }
  config.secretsClient = new SecretsManagerClient({
    region: "us-east-1"
  });
}

// Export for testing so we can set secretsClient values
export async function createSecret (secretKeyName: string, value: string | Buffer): Promise<void> {
  init();
  // Create it
  try {
    const input: CreateSecretCommandInput = {
      Name: secretKeyName,
      Description: "Testing Secrets Manager for PerformanceQA/Pewpew",
      SecretString: typeof value === "string" ? value : undefined,
      SecretBinary: typeof value !== "string" ? new Uint8Array(value.buffer) : undefined
    };
    log("CreateSecretCommand request", LogLevel.TRACE, input);
    log("CreateSecretCommand request", LogLevel.DEBUG, {
      ...input,
      SecretString: typeof input.SecretString,
      SecrSecretBinary: typeof input.SecretBinary
    });
    const response: CreateSecretCommandOutput = await config.secretsClient.send(new CreateSecretCommand(input));
    log("CreateSecretCommand succeeded", LogLevel.TRACE, response);
    log("CreateSecretCommand succeeded", LogLevel.DEBUG, {
      ...response,
      "$metadata": undefined
    }); // will have passwords
  } catch (error) {
    log("CreateSecretCommand failed", LogLevel.WARN, error, { secretKeyName });
    throw error;
  }
  // Tag it
  try {
    s3.init();
    const input: TagResourceCommandInput = {
      SecretId: secretKeyName,
      // Tags: s3.ADDITIONAL_TAGS_ON_ALL
      Tags: [...s3.ADDITIONAL_TAGS_ON_ALL].map(([Key, Value]) => ({ Key, Value }))
    };
    log("TagResourceCommand request", LogLevel.DEBUG, input);
    const response: TagResourceCommandOutput = await config.secretsClient.send(new TagResourceCommand(input));
    log("TagResourceCommand succeeded", LogLevel.DEBUG, {
      ...response,
      "$metadata": undefined
    }); // will have passwords
  } catch (error) {
    log("TagResourceCommand failed", LogLevel.WARN, error, { secretKeyName });
    return;
  }
}

// Export for testing so we can set secretsClient values
export async function deleteSecret (secretKeyName: string, force?: boolean): Promise<void> {
  init();
  try {
    const input: DeleteSecretCommandInput = {
      SecretId: secretKeyName,
      ForceDeleteWithoutRecovery: force
    };
    log("DeleteSecretCommand request", LogLevel.DEBUG, input);
    const response: DeleteSecretCommandOutput = await config.secretsClient.send(new DeleteSecretCommand(input));
    log("DeleteSecretCommand succeeded", LogLevel.DEBUG, {
      ...response,
      "$metadata": undefined
    }); // will have passwords
  } catch (error) {
    log("DeleteSecretCommand failed", LogLevel.WARN, error, { secretKeyName });
    throw error;
  }
}

export async function getSecretValue (secretKeyName: string): Promise<string> {
  log(`getKey(${secretKeyName})`, LogLevel.DEBUG);
  try {
    // Try secrets manager first
    init();
    const input: GetSecretValueCommandInput = {
      SecretId: secretKeyName
    };
    log("GetSecretValueCommand request", LogLevel.DEBUG, input);
    const response: GetSecretValueCommandOutput = await config.secretsClient.send(new GetSecretValueCommand(input));
    log("GetSecretValueCommand succeeded", LogLevel.TRACE, response);
    log("GetSecretValueCommand succeeded", LogLevel.DEBUG, {
      ...response,
      SecretString: typeof response.SecretString,
      SecrSecretBinary: typeof response.SecretBinary,
      "$metadata": undefined
    }); // will have passwords
    if (response.SecretString) {
      return response.SecretString;
    } else if (response.SecretBinary) {
      return Buffer.from(response.SecretBinary).toString("hex");
    }
    throw new Error("Key was undefined for " + secretKeyName);
  } catch (error) {
    log("GetSecretValueCommand failed", LogLevel.WARN, error, { secretKeyName });
    throw error;
  }
}

export function getOverrideName (secretKeyName: string): string {
  return secretKeyName.toUpperCase().replaceAll("-", "_") + OVERRIDE;
}

/**
 * Retrieves the specified key from Secrets Manager. Can be overridden with environment variables.
 * To override: Create an environment variable with the name of the key in all uppercase,
 * replacing dashes with underscores and adding "_OVERRIDE". Ex. If `secretKeyName` == "test-key",
 * you would override it with environment variable `TEST_KEY_OVERRIDE` to bypass secrets manager
 * @param secretKeyName Name of the secret to retrieve. Can be SECRETS_ENCRYPTION_KEY_NAME
 * @returns The specified key if found, or throws
 */
export async function getKey (secretKeyName: string): Promise<string> {
  /** Allows us to override the value from an environment variable to bypass secrets-manager */
  let key: string | undefined;
  const overrideName = getOverrideName(secretKeyName);
  if (!IS_RUNNING_IN_AWS && process.env[overrideName] !== undefined) {
    key = process.env[overrideName]!;
  } else {
    key = await getSecretValue(secretKeyName);
  }
  log(`${secretKeyName} key: ${key}`, LogLevel.TRACE, key);
  return key;
}

/** Async function that loads and waits for the encryption key */
async function getAndSetEncryptionKey (): Promise<Buffer> {
  if (!config.encryptionKeyName) {
    throw new Error("SECRETS_ENCRYPTION_KEY_NAME environment variable not set");
  }
  if (getGlobalSecretsConfig().encryptionKey === undefined) {
    // Keep trying to get the key
    try {
      log("getAndSetEncryptionKey start", LogLevel.DEBUG);
      const key: string = await getKey(config.encryptionKeyName);
      log("getAndSetEncryptionKey finished", LogLevel.DEBUG);
      getGlobalSecretsConfig().encryptionKey = Buffer.from(key, "hex");
    } catch (error) {
      log("Could not retrieve encryption key", LogLevel.ERROR, error);
      throw error;
    }
  }
  return getGlobalSecretsConfig().encryptionKey!;
}
// Call it on start-up to set it
getAndSetEncryptionKey()
.catch(() => false);

/** Async function that loads and waits for the client secret */
async function getAndSetOpenIdClientSecret (): Promise<Buffer> {
  if (!config.openIdClientSecret) {
    throw new Error("SECRETS_OPENID_CLIENT_SECRET_NAME environment variable not set");
  }
  if (getGlobalSecretsConfig().openIdClientSecret === undefined) {
    // Keep trying to get the key
    try {
      log("getAndSetOpenIdClientSecret start", LogLevel.DEBUG);

      const key: string = await getKey(config.openIdClientSecret);
      getGlobalSecretsConfig().openIdClientSecret = Buffer.from(key, "ascii"); // OpenId is an ascii password
      log("getAndSetOpenIdClientSecret finished", LogLevel.DEBUG);
    } catch (error) {
      log("Could not retrieve OpenId Client Secret", LogLevel.ERROR, error);
      throw error;
    }
  }
  return getGlobalSecretsConfig().openIdClientSecret!;
}
// Call it on start-up to set it
getAndSetOpenIdClientSecret()
.catch(() => false);

export function getEncryptionKey (): Buffer {
  if (getGlobalSecretsConfig().encryptionKey === undefined) {
    // Keep trying to get the key
    getAndSetEncryptionKey()
    .catch(() => false);
    throw new Error("Encryption Key not initialized");
  }
  return getGlobalSecretsConfig().encryptionKey!;
}

const ENCRYPTION_ALGORITHM = "aes-128-cbc";
export const IV_LENGTH = 16; // For AES, this is always 16
export function encrypt (text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, Buffer.from(getEncryptionKey()), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decrypt (text: string): string {
  const textParts = text.split(":");
  const iv = Buffer.from(textParts.shift()!, "hex");
  const encryptedText = Buffer.from(textParts.join(":"), "hex");
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, Buffer.from(getEncryptionKey()), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

export async function decryptFile (encryptedFilePath: string, decryptedFilePath?: string): Promise<string> {
  try {
    const encryptedFileContents: string = await readFile(encryptedFilePath, "utf8");
    // Make sure we have a key first
    await getAndSetEncryptionKey();
    // log(`encryptedFileContents: ${encryptedFileContents}`, LogLevel.DEBUG, { encryptedFileContents });
    let decryptedFileContents: string | undefined;
    // If we're running locally and the background Secrets stuff couldn't read the key, see if there's a local file
    if (!IS_RUNNING_IN_AWS && decryptedFilePath !== undefined) {
      log("Trying to fall back to the " + decryptedFilePath, LogLevel.WARN);
      try {
        decryptedFileContents = await readFile(decryptedFilePath, "utf8");
        log("Using the fallback " + decryptedFilePath, LogLevel.WARN);
      } catch (error) {
        log(`Could load ${decryptedFilePath}, encryptionKey === undefined && BLUEPRINT_SET === false`, LogLevel.ERROR, error);
        log(`Please see the README for setting up a Secrets Key override file or create the ${decryptedFilePath} from the template`, LogLevel.ERROR);
      }
    }
    // Under blueprint this won't be set yet
    if (decryptedFileContents === undefined) {
      decryptedFileContents = decrypt(encryptedFileContents);
    }
    // log(`decryptedFileContents: ${decryptedFileContents}`, LogLevel.DEBUG, { decryptedFileContents });
    return decryptedFileContents;
  } catch (error) {
    log(`Could not decrypt ${encryptedFilePath}`, LogLevel.ERROR, error);
    throw error;
  }
}

export function getClientSecretOpenId (): string {
  if (getGlobalSecretsConfig().openIdClientSecret === undefined) {
    // Keep trying to get the key
    getAndSetOpenIdClientSecret()
    .catch(() => false);
    throw new Error("OpenId Client Secret not initialized");
  }
  return getGlobalSecretsConfig().openIdClientSecret!.toString();
}

const SECRETS_RETRY_MAX_TRIES = 5;
const SECRETS_RETRY_DELAY = 500;

export async function waitForSecrets (): Promise<void> {
  log("waitForSecrets start", LogLevel.DEBUG);
  let loop = 0;
  do {
    loop++;
    try {
      const result = await Promise.all([
        getAndSetEncryptionKey(),
        getAndSetOpenIdClientSecret()
      ]);
      if (result.some((value) => value === undefined)) {
        throw new Error("Secrets key undefined");
      }
      log("waitForSecrets success", LogLevel.DEBUG, { loop });
      return; // Success!
    } catch (error) {
      log("Could not Load Secrets keys", LogLevel.DEBUG, error);
      await util.sleep(SECRETS_RETRY_DELAY);
    }
  } while (loop < SECRETS_RETRY_MAX_TRIES);
  log("waitForSecrets fail", LogLevel.DEBUG, { loop });
  throw new Error(`Could not load Secrets Keys after ${loop} retries`);
}