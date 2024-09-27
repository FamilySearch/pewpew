import { LogLevel, log, logger } from "@fs/ppaas-common";
import {
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  IV_LENGTH as SECRET_LENGTH,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  createSecret,
  decrypt,
  encrypt,
  getClientSecretOpenId,
  getEncryptionKey,
  getGlobalSecretsConfig,
  getKey,
  init as initSecrets,
  internalConfig as secretsConfig,
  waitForSecrets
} from "../pages/api/util/secrets";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import crypto from "crypto";
import { expect } from "chai";

logger.config.LogFileName = "ppaas-controller";

describe("Secrets Integration", () => {
  before(async () => {
    secretsConfig.secretsClient = undefined as any;
    getGlobalSecretsConfig().encryptionKey = undefined;
    getGlobalSecretsConfig().openIdClientSecret = undefined;
    initSecrets(); // Will throw if env variables are not set
    // try {
    //   // create and upload
    //   await putSecret(secretsConfig.encryptionKeyName, crypto.randomBytes(SECRET_LENGTH));
    //   await putSecret(secretsConfig.openIdClientSecret, crypto.randomBytes(20).toString("hex"));
    // } catch (error) {
    //   log("Could not create encryption key", LogLevel.ERROR, error);
    //   throw error;
    // }
    await waitForSecrets();
  });

  describe("getKey", () => {
    it("getKey encryption key should succeed", (done: Mocha.Done) => {
      getKey(secretsConfig.encryptionKeyName).then((key: string) => {
        log("getKey() = " + key, LogLevel.TRACE);
        expect(key.length).to.be.greaterThan(0);
        done();
      }).catch((error) => {
        log("getKey()", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("getKey openId Client Secret should succeed", (done: Mocha.Done) => {
      getKey(secretsConfig.openIdClientSecret).then((key: string) => {
        log("getKey() = " + key, LogLevel.TRACE);
        expect(key.length).to.be.greaterThan(0);
        done();
      }).catch((error) => {
        log("getKey()", LogLevel.ERROR, error);
        done(error);
      });
    });
  });

  describe("encrypt/decrypt", () => {
    const original: string = "It's the end of the world as we know it, and I feel fine.";
    let encrypted: string | undefined;

    before(() => {
      try {
        const actualKey = getEncryptionKey();
        expect(actualKey.toString("base64").length, "actualKey").to.be.greaterThan(0);
      } catch (error) {
        log("Could not get encryption key", LogLevel.WARN, error);
        throw error;
      }
    });

    it("getEncryptionKey should return an encryption key", (done: Mocha.Done) => {
      try {
        const encryptionKey: Buffer = getEncryptionKey();
        log("getEncryptionKey()", LogLevel.TRACE, encryptionKey);
        expect(encryptionKey, "encryptionKey").to.not.equal(undefined);
        expect(encryptionKey.toString("hex").length, "encryptionKey.length").to.equal(32); // 16 bytes
        done();
      } catch (error) {
        log("getEncryptionKey() error", LogLevel.ERROR, error);
        done(error);
      }
    });

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

  describe("getClientSecretOpenId", () => {
    before(() => {
      try {
        const actualKey = getClientSecretOpenId();
        expect(actualKey.length, "actualKey").to.be.greaterThan(0);
      } catch (error) {
        log("Could not get openId secret", LogLevel.WARN, error);
        throw error;
      }
    });

    it("getClientSecretOpenId should return a client secret", (done: Mocha.Done) => {
      try {
        const clientSecret: string = getClientSecretOpenId();
        log("getClientSecretOpenId()", LogLevel.TRACE, clientSecret);
        expect(clientSecret, "clientSecret").to.not.equal(undefined);
        expect(clientSecret.length, "clientSecret.length").to.equal(40);
        done();
      } catch (error) {
        log("getClientSecretOpenId() error", LogLevel.ERROR, error);
        done(error);
      }
    });
  });
});
