import { ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME, PpaasEncryptEnvironmentFile } from "../src/ppaasencryptenvfile";
import {
  LogLevel,
  PpaasS3File,
  PpaasTestId,
  log,
  s3
} from "@fs/ppaas-common";

const yamlFile = "RmsDelete.yaml";
export const FILES_TESTID = "rmsdeletestage20240617T193912876";
export let FILES_PPAAS_TESTID: PpaasTestId;
try {
  FILES_PPAAS_TESTID = PpaasTestId.getFromTestId(FILES_TESTID);
} catch (error: unknown) {
  log(`Could not convert ${FILES_TESTID} into a PPaasTestId`, LogLevel.ERROR, error);
  FILES_PPAAS_TESTID = PpaasTestId.makeTestId(yamlFile, { profile: "stage", dateString: "20240617T193912876" });
}
const { s3Folder } = FILES_PPAAS_TESTID;

export interface AcceptanceFiles {
  ppaasTestId: PpaasTestId;
  yamlFile: string;
  statusFile: string;
  resultsFile: string;
  stdoutFile: string;
  stderrFile: string;
  variablesFile: string;
}

const ACCEPTANCE_FOLDER = "integration/files";
const ACCEPTANCE_FILES: AcceptanceFiles = {
  ppaasTestId: FILES_PPAAS_TESTID,
  yamlFile,
  statusFile: "rmsdeletestage20240617T193912876.info",
  resultsFile: "stats-rmsdeletestage20240617T193912876.json",
  stdoutFile: "app-ppaas-pewpew-rmsdeletestage20240617T193912876-out.json",
  stderrFile: "app-ppaas-pewpew-rmsdeletestage20240617T193912876-error.json",
  variablesFile: ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME
};

// We want to re-use the PPaaSS3Files between acceptance tests so we don't re-upload them
const ACCEPTANCE_PPAASS3FILES: {
  yamlFile?: PpaasS3File;
  statusFile?: PpaasS3File;
  resultsFile?: PpaasS3File;
  stdoutFile?: PpaasS3File;
  stderrFile?: PpaasS3File;
  variablesFile?: PpaasS3File | PpaasEncryptEnvironmentFile;
} = {};

export async function uploadAcceptanceFiles (): Promise<AcceptanceFiles> {
  try {
    for (const [key, filename] of Object.entries(ACCEPTANCE_FILES)) {
      if (key === "ppaasTestId") { continue; } // No file for the ppaasTestId
      if (key === "variablesFile") {
        if (!filename) { continue; } // variablesFile is optional
         ACCEPTANCE_PPAASS3FILES.variablesFile = new PpaasEncryptEnvironmentFile({
          s3Folder,
          environmentVariablesFile: {
            EXAMPLE_VAR: "example value",
            ANOTHER_VAR: "another value"
          }
        });
      }
      // We want to re-use the PPaaSS3Files between acceptance tests so we don't re-upload them
      log("uploadAcceptanceFiles create PpaasS3File", LogLevel.DEBUG, { key, filename, s3File: ACCEPTANCE_PPAASS3FILES[key as keyof typeof ACCEPTANCE_PPAASS3FILES] !== undefined });
      if (!ACCEPTANCE_PPAASS3FILES[key as keyof typeof ACCEPTANCE_PPAASS3FILES]) {
        try {
          ACCEPTANCE_PPAASS3FILES[key as keyof typeof ACCEPTANCE_PPAASS3FILES] = new PpaasS3File({ filename, localDirectory: ACCEPTANCE_FOLDER, s3Folder });
        } catch (error: unknown) {
          log(`uploadAcceptanceFiles Could not create PpaasS3File for ${key} - ${filename}`, LogLevel.WARN, error);
          throw error;
        }
      }
    }
    await Promise.all(Object.entries(ACCEPTANCE_PPAASS3FILES).map(async ([filetype, s3File]) => {
      log("uploadAcceptanceFiles upload", LogLevel.DEBUG, { filetype, filename: s3File?.filename, s3File: s3File !== undefined });
      try {
        await s3File.upload(false, true);
        log(`uploadAcceptanceFiles uploaded ${filetype} - ${s3File.filename}`, LogLevel.INFO, { filetype, filename: s3File.filename, key: s3File.key });
        return s3File.key;
      } catch (error: unknown) {
        log(`uploadAcceptanceFiles failed to upload ${filetype} - ${s3File.filename}`, LogLevel.WARN, error);
        throw error;
      }
    }));
    return { ...ACCEPTANCE_FILES };
  } catch (error: unknown) {
    log("uploadAcceptanceFiles failed", LogLevel.ERROR, error);
    throw error;
  }
}

export async function cleanupAcceptanceFiles (): Promise<void> {
  try {
    await Promise.all(Object.entries(ACCEPTANCE_PPAASS3FILES).map(async ([filetype, s3File]) => {
      log("cleanupAcceptanceFiles cleanup", LogLevel.DEBUG, { filetype, filename: s3File?.filename, s3File: s3File !== undefined });
      try {
        await s3.deleteObject(s3File.key);
        log(`cleanupAcceptanceFiles deleted ${filetype} - ${s3File.filename}`, LogLevel.INFO, { filetype, filename: s3File.filename, key: s3File.key });
        delete ACCEPTANCE_PPAASS3FILES[filetype as keyof typeof ACCEPTANCE_PPAASS3FILES];
      } catch (error: unknown) {
        log(`cleanupAcceptanceFiles failed to delete ${filetype} - ${s3File.filename}`, LogLevel.WARN, error);
        throw error;
      }
    }));
  } catch (error: unknown) {
    log("cleanupAcceptanceFiles failed", LogLevel.ERROR, error);
    throw error;
  }
}