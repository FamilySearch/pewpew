import type { File, Files } from "formidable";
import { LogLevel, log, logger } from "@fs/ppaas-common";
import { createFormidableFile, parseZip, unzipFile } from "../pages/api/util/util";
import { expect } from "chai";
import fs from "fs/promises";
import path from "path";

logger.config.LogFileName = "ppaas-controller";

// Re-create these here so we don't have to run yamlparser.spec by importing it
const UNIT_TEST_FOLDER: string = process.env.UNIT_TEST_FOLDER || "test";
const BASIC_YAML_FILE: string = "basic.yaml";
const BASIC_FILEPATH_NOT_YAML = path.join(UNIT_TEST_FOLDER, "text.txt");
const ZIP_TEST_DIR: string = "testdir.zip";
const ZIP_TEST_FILE: string = "testfile.zip";
const ZIP_TEST_FILES: string = "testfiles.zip";
const ZIP_TEST_FILES_11: string = "testfiles11.zip";
const ZIP_TEST_INVALID: string = "testinvalid.zip";
const ZIP_TEST_YAML: string = "testyaml.zip";
const ZIP_TEST_YAMLS: string = "testyamls.zip";

describe("Util", () => {
  describe("unzipFile", () => {
    const testnotzip: string = BASIC_YAML_FILE;

    afterEach(async ()=> {
      try {
        const files: string[] = await fs.readdir(UNIT_TEST_FOLDER);
        log("clean-up files: " + files, LogLevel.DEBUG, files);
        for (const filename of files) {
          if (filename.startsWith("file") && filename.endsWith(".txt")) {
            const filepath: string = path.join(UNIT_TEST_FOLDER, filename);
            log("clean-up deleting file: " + filepath, LogLevel.DEBUG);
            await fs.unlink(filepath).catch((error) => log("Could not delete unzipped file " + filename, LogLevel.ERROR, error));
          }
        }
      } catch (error) {
        log("Could not clean-up unzipped files", LogLevel.ERROR, error);
      }
    });

    it("should not unzip a directory file", (done: Mocha.Done) => {
      const file: File = createFormidableFile(ZIP_TEST_DIR, path.join(UNIT_TEST_FOLDER, ZIP_TEST_DIR), null, 0, null);
      unzipFile(file)
      .then((_files: File[]) => {
        done(new Error("Directories should not unzip"));
      }).catch((error) => {
        expect(`${error}`).to.include("Zip files with directories are not supported");
        done();
      });
    });

    it("should unzip a single file", (done: Mocha.Done) => {
      const file: File = createFormidableFile(ZIP_TEST_FILE, path.join(UNIT_TEST_FOLDER, ZIP_TEST_FILE), null, 0, null);
      unzipFile(file)
      .then((files: File[]) => {
        expect(files.length).to.equal(1);
        done();
      }).catch((error) => {
        log("Error unzipping single file", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("should unzip a multiple files", (done: Mocha.Done) => {
      const file: File = createFormidableFile(ZIP_TEST_FILES, path.join(UNIT_TEST_FOLDER, ZIP_TEST_FILES), null, 0, null);
      unzipFile(file)
      .then((files: File[]) => {
        expect(files.length).to.equal(2);
        done();
      }).catch((error) => {
        log("Error unzipping multiple files", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("should not unzip more than 10 files", (done: Mocha.Done) => {
      const file: File = createFormidableFile(ZIP_TEST_FILES_11, path.join(UNIT_TEST_FOLDER, ZIP_TEST_FILES_11), null, 0, null);
      unzipFile(file)
      .then((_files: File[]) => {
        done(new Error("More than 10 files should not unzip"));
      }).catch((error) => {
        expect(`${error}`).to.include("has more than 10 files");
        done();
      });
    });

    it("should not unzip non-zip files", (done: Mocha.Done) => {
      const file: File = createFormidableFile(testnotzip, path.join(UNIT_TEST_FOLDER, testnotzip), null, 0, null);
      unzipFile(file)
      .then((_files: File[]) => {
        done(new Error(testnotzip + " should not unzip"));
      }).catch((error) => {
        expect(`${error}`).to.include("checkUnzipFile called with a non-zip file");
        done();
      });
    });

    it("should not unzip invalid zip files", (done: Mocha.Done) => {
      const file: File = createFormidableFile(ZIP_TEST_INVALID, path.join(UNIT_TEST_FOLDER, ZIP_TEST_INVALID), null, 0, null);
      unzipFile(file)
      .then((_files: File[]) => {
        done(new Error(ZIP_TEST_INVALID + " should not unzip"));
      }).catch((error) => {
        log("should not unzip invalid zip files error", LogLevel.DEBUG, error);
        try {
          expect(`${error}`).to.include("End of central directory record signature not found");
          done();
        } catch (error2) {
          log("should not unzip invalid zip files error", LogLevel.ERROR, error2);
          done(error2);
        }
      });
    });
  });

  describe("parseZip", () => {
    const emptyFile: File = createFormidableFile("", "", "", 0, null);
    const createFile = (filename: string): File => ({ ...emptyFile, originalFilename: filename, filepath: path.join(UNIT_TEST_FOLDER, filename) });
    const basicYamlFile: File = createFile(BASIC_YAML_FILE);
    const basicNotYamlFile: File = createFile(BASIC_FILEPATH_NOT_YAML);
    const zipfile: File = createFile(ZIP_TEST_FILE);
    const zipfiles: File = createFile(ZIP_TEST_FILES);
    const zipyaml: File = createFile(ZIP_TEST_YAML);
    const zipyamls: File = createFile(ZIP_TEST_YAMLS);

    afterEach(async ()=> {
      try {
        const files: string[] = await fs.readdir(UNIT_TEST_FOLDER);
        log("clean-up files: " + files, LogLevel.DEBUG, files);
        for (const filename of files) {
          if (filename.startsWith("file") && filename.endsWith(".txt")) {
            const filepath: string = path.join(UNIT_TEST_FOLDER, filename);
            log("clean-up deleting file: " + filepath, LogLevel.DEBUG);
            await fs.unlink(filepath).catch((error) => log("Could not delete unzipped file " + filename, LogLevel.ERROR, error));
          }
        }
      } catch (error) {
        log("Could not clean-up unzipped files", LogLevel.ERROR, error);
      }
    });

    it("unzip a yaml and make it yaml", (done: Mocha.Done) => {
      const formFiles: Files = { additionalFiles: zipyaml };
      parseZip(formFiles)
      .then(() => {
        expect(formFiles.yamlFile).to.not.equal(undefined);
        expect(formFiles.additionalFiles).to.equal(undefined);
        expect(Array.isArray(formFiles.yamlFile)).to.equal(false);
        expect((formFiles.yamlFile as any as File).originalFilename).to.equal(BASIC_YAML_FILE);
        done();
      }).catch((error) => {
        log("Error parseZip yaml", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("unzip two yaml zip and make it two yaml", (done: Mocha.Done) => {
      const formFiles: Files = { additionalFiles: zipyamls };
      parseZip(formFiles)
      .then(() => {
        expect(formFiles.yamlFile).to.not.equal(undefined);
        expect(formFiles.additionalFiles).to.equal(undefined);
        expect(Array.isArray(formFiles.yamlFile)).to.equal(true);
        expect((formFiles.yamlFile as any as File[]).length).to.equal(2);
        done();
      }).catch((error) => {
        log("Error parseZip yaml", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("unzip to file zip and make it files", (done: Mocha.Done) => {
      const formFiles: Files = { additionalFiles: zipfiles };
      parseZip(formFiles)
      .then(() => {
        expect(formFiles.yamlFile).to.equal(undefined);
        expect(formFiles.additionalFiles).to.not.equal(undefined);
        expect(Array.isArray(formFiles.additionalFiles)).to.equal(true);
        expect((formFiles.additionalFiles as any as File[]).length).to.equal(2);
        done();
      }).catch((error) => {
        log("Error parseZip yaml", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("unzip a yaml and file and make it yaml and file", (done: Mocha.Done) => {
      const formFiles: Files = { additionalFiles: ([zipyaml, zipfile] as any) };
      parseZip(formFiles)
      .then(() => {
        expect(formFiles.yamlFile).to.not.equal(undefined);
        expect(formFiles.additionalFiles).to.not.equal(undefined);
        expect(Array.isArray(formFiles.yamlFile)).to.equal(false);
        expect((formFiles.yamlFile as any as File).originalFilename).to.equal(BASIC_YAML_FILE);
        expect(Array.isArray(formFiles.additionalFiles)).to.equal(true);
        expect((formFiles.additionalFiles as any as File[]).length).to.equal(1);
        done();
      }).catch((error) => {
        log("Error parseZip yaml", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("unzip a yaml when there's already a yaml", (done: Mocha.Done) => {
      const formFiles: Files = { yamlFile: basicYamlFile, additionalFiles: zipyaml };
      parseZip(formFiles)
      .then(() => {
        expect(formFiles.yamlFile).to.not.equal(undefined);
        expect(formFiles.additionalFiles).to.equal(undefined);
        expect(Array.isArray(formFiles.yamlFile)).to.equal(true);
        expect((formFiles.yamlFile as any as File[]).length).to.equal(2);
        done();
      }).catch((error) => {
        log("Error parseZip yaml", LogLevel.ERROR, error);
        done(error);
      });
    });

    it("unzip a bunch of stuff and parse it all", (done: Mocha.Done) => {
      const formFiles: Files = {
        yamlFile: basicYamlFile,
        additionalFiles: ([basicNotYamlFile, zipyamls, zipfiles] as any)
      };
      parseZip(formFiles)
      .then(() => {
        expect(formFiles.yamlFile).to.not.equal(undefined);
        expect(formFiles.additionalFiles).to.not.equal(undefined);
        expect(Array.isArray(formFiles.yamlFile)).to.equal(true);
        expect((formFiles.yamlFile as any as File[]).length).to.equal(3);
        expect(Array.isArray(formFiles.additionalFiles)).to.equal(true);
        expect((formFiles.additionalFiles as any as File[]).length).to.equal(3);
        done();
      }).catch((error) => {
        log("Error parseZip yaml", LogLevel.ERROR, error);
        done(error);
      });
    });
  });
});
