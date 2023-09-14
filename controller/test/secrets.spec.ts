import { LogLevel, log, logger, util } from "@fs/ppaas-common";
import {
  IV_LENGTH as SECRET_LENGTH,
  decrypt,
  encrypt,
  getClientSecretOpenId,
  getEncryptionKey,
  getGlobalSecretsConfig,
  getKey,
  getOverrideName
} from "../pages/api/util/secrets";
import { mockGetSecretValue, mockSecrets, resetMockSecrets } from "./mock";
import crypto from "crypto";
import { expect } from "chai";

logger.config.LogFileName = "ppaas-controller";

const ENVIRONMENT_OVERRIDE_KEY = "test-override-key";
const ENVIRONMENT_OVERRIDE_VALUE = "test-override-value";

describe("Secrets", () => {

  before (() => {
    mockSecrets();
    mockGetSecretValue();

    const overrideName = getOverrideName(ENVIRONMENT_OVERRIDE_KEY);
    process.env[overrideName] = ENVIRONMENT_OVERRIDE_VALUE;
  });

  after(() => {
    resetMockSecrets();
  });

  describe("Encryption Key", () => {
    let expectedKey: Buffer | undefined;

    before (async () => {
      try {
        expectedKey = crypto.randomBytes(SECRET_LENGTH);
        log(`key: ${SECRET_LENGTH}`, LogLevel.TRACE, { hex: expectedKey.toString("hex"), base64: expectedKey.toString("base64") });
        // Needs to be a buffer/binary
        mockGetSecretValue(expectedKey);
        getGlobalSecretsConfig().encryptionKey = undefined;
      } catch (error) {
        log("Could not create encryption key", LogLevel.ERROR, error);
        throw error;
      }

      expect(expectedKey).to.not.equal(undefined);
      let retryCount = 0;
      do {
        try {
          const actualKey = getEncryptionKey();
          expect(actualKey.toString("base64"), "actualKey").to.equal(expectedKey.toString("base64"));
          break; // If it doesn't throw, we got it
        } catch (error) {
          log("Could not get encryption key, retrying: " + retryCount, LogLevel.WARN, error);
          await util.sleep(100);
        }
      } while (retryCount++ < 5);
    });

    it("getKey EncryptionKey should succeed", (done: Mocha.Done) => {
      // Don't use the real key name or the environment variable override will fire
      getKey("my-buffer-key").then((key: string) => {
        log("getKey() = " + key, LogLevel.TRACE);
        expect(key).to.not.equal(undefined);
        // Should be hex
        expect(key).to.equal(expectedKey?.toString("hex"));
        done();
      }).catch((error) => {
        log("getKey()", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("getKey Environment Override should succeed", (done: Mocha.Done) => {
      // Don't use the real key name or the environment variable override will fire
      getKey(ENVIRONMENT_OVERRIDE_KEY).then((key: string) => {
        log("getKey() = " + key, LogLevel.TRACE);
        expect(key).to.not.equal(undefined);
        // Should override the mock
        expect(key).to.equal(ENVIRONMENT_OVERRIDE_VALUE);
        done();
      }).catch((error) => {
        log("getKey()", LogLevel.ERROR, error);
        done(error);
      });
    });

    describe("encrypt/decrypt", () => {
      const original: string = "It's the end of the world as we know it, and I feel fine.";
      let encrypted: string | undefined;

      it("encrypted should be different from original", (done: Mocha.Done) => {
        encrypted = encrypt(original);
        log(`encrypted=${encrypted}`, LogLevel.TRACE);
        expect(encrypted).to.not.equal(original);
        done();
      });

      it("decrypt should equal original", (done: Mocha.Done) => {
        if (encrypted === undefined) {
          done(new Error("encrypted was undefined"));
          return; // To make the typescript compiler happy
        }
        const decrypted = decrypt(encrypted);
        expect(decrypted).to.equal(original);
        done();
      });
    });
  });

  describe("OpenId Client Secret", () => {
    let expectedKey: string | undefined;

    before (async () => {
      try {
        expectedKey = crypto.randomBytes(20).toString("hex");
        log(`key: ${20}`, LogLevel.TRACE, { expectedKey });
        // Needs to be a string at least 40 characters long (20 bytes x 2 hex per byte)
        mockGetSecretValue(expectedKey);
        getGlobalSecretsConfig().openIdClientSecret = undefined;
      } catch (error) {
        log("Could not create encryption key", LogLevel.ERROR, error);
        throw error;
      }

      expect(expectedKey).to.not.equal(undefined);
      let retryCount = 0;
      do {
        try {
          const actualKey = getClientSecretOpenId();
          expect(actualKey, "actualKey").to.equal(expectedKey);
          break; // If it doesn't throw, we got it
        } catch (error) {
          log("Could not get openId secret, retrying: " + retryCount, LogLevel.WARN, error);
          await util.sleep(100);
        }
      } while (retryCount++ < 5);
    });

    it("getKey OpenId Client Secret should succeed", (done: Mocha.Done) => {
      // Don't use the real key name or the environment variable override will fire
      getKey("my-string-key").then((key: string) => {
        log("getKey() = " + key, LogLevel.TRACE);
        expect(key).to.not.equal(undefined);
        expect(key).to.equal(expectedKey);
        done();
      }).catch((error) => {
        log("getKey()", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("getKey Environment Override should succeed", (done: Mocha.Done) => {
      // Don't use the real key name or the environment variable override will fire
      getKey(ENVIRONMENT_OVERRIDE_KEY).then((key: string) => {
        log("getKey() = " + key, LogLevel.TRACE);
        expect(key).to.not.equal(undefined);
        // Should override the mock
        expect(key).to.equal(ENVIRONMENT_OVERRIDE_VALUE);
        done();
      }).catch((error) => {
        log("getKey()", LogLevel.ERROR, error);
        done(error);
      });
    });
  });
});
