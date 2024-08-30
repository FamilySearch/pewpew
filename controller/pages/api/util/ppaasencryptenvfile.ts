import { EnvironmentVariables, LogLevel, log, logger, s3 } from "@fs/ppaas-common";
import { EnvironmentVariablesFile, PreviousEnvironmentVariables } from "../../../types";
import { PpaasEncryptS3File } from "./ppaasencrypts3file";

logger.config.LogFileName = "ppaas-controller";

export const ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME = "environmentvariables.json";

export interface PpaasEncryptEnvironmentFileParams {
  s3Folder: string | undefined;
  environmentVariablesFile: EnvironmentVariablesFile | undefined;
  tags?: Map<string, string>;
}

export class PpaasEncryptEnvironmentFile extends PpaasEncryptS3File {
  protected environmentVariablesFile: EnvironmentVariablesFile | undefined;

  // The receiptHandle is not in the constructor since sending messages doesn't require it. Assign it separately
  public constructor ({
    s3Folder,
    environmentVariablesFile,
    // We need to tag this file with the default test tags
    tags = s3.defaultTestFileTags()
  }: PpaasEncryptEnvironmentFileParams) {
    try {
      super({
        filename: ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME,
        s3Folder,
        fileContents: environmentVariablesFile !== undefined ? JSON.stringify(environmentVariablesFile) : "",
        tags
      });
      // Stringify and parse so we create a copy
      this.environmentVariablesFile = environmentVariablesFile !== undefined ? JSON.parse(JSON.stringify(environmentVariablesFile)) : undefined;
    } catch (error) {
      log("PpaasEncryptEnvironmentFile throw parsing environmentVariablesFile", LogLevel.ERROR, error);
      throw error;
    }
  }

  public static async getAllFilesInS3 (s3Folder: string, _extension?: string, maxFiles?: number): Promise<PpaasEncryptEnvironmentFile[]> {
    try {
      const ppaasFiles: PpaasEncryptS3File[] = await super.getAllFilesInS3(s3Folder, ENCRYPTED_ENVIRONMENT_VARIABLES_FILENAME, maxFiles);
      return ppaasFiles.map((ppaasFile: PpaasEncryptS3File) => {
        // Turn empty string into undefined
        const environmentVariablesFile: EnvironmentVariablesFile | undefined = ppaasFile.getFileContents() ? JSON.parse(ppaasFile.getFileContents()) : undefined;
        const newFile = new PpaasEncryptEnvironmentFile({ s3Folder, environmentVariablesFile, tags: ppaasFile.tags });
        newFile.lastModifiedRemote = ppaasFile.getLastModifiedRemote();
        return newFile;
      });
    } catch (error) {
      log(`PpaasEncryptEnvironmentFile.getAllFilesInS3(${s3Folder}) failed`, LogLevel.ERROR, error);
      throw error;
    }
  }

  public setFileContents (_fileContents: string): void {
    throw new Error("Please use setPreviousEnvironmentVariablesFile. setFileContents not allowed");
  }

  public static getPreviousEnvironmentVariables (environmentVariablesFile: EnvironmentVariablesFile): PreviousEnvironmentVariables {
    const previousEnvironmentVariables: PreviousEnvironmentVariables = {};
    for (const [variableName, variableValue] of Object.entries(environmentVariablesFile)) {
      // Remove hidden or legacy (string), non-hidden to string
      log("getPreviousEnvironmentVariables", LogLevel.TRACE, { variableName, variableValue });
      if (typeof variableValue !== "string" && !variableValue?.hidden) {
        previousEnvironmentVariables[variableName] = variableValue.value;
      }
    }
    log("getPreviousEnvironmentVariables", LogLevel.DEBUG, { environmentVariablesFile: Object.keys(environmentVariablesFile), previousEnvironmentVariables: Object.keys(previousEnvironmentVariables) });
    return previousEnvironmentVariables;
  }

  public getPreviousEnvironmentVariables (): PreviousEnvironmentVariables | undefined {
    if (this.environmentVariablesFile === undefined) { return this.environmentVariablesFile; }
    return PpaasEncryptEnvironmentFile.getPreviousEnvironmentVariables(this.environmentVariablesFile);
  }

  public getEnvironmentVariablesFile (): EnvironmentVariablesFile | undefined {
    if (this.environmentVariablesFile === undefined) { return this.environmentVariablesFile; }
    // Create a copy so they can't modify the original
    return JSON.parse(JSON.stringify(this.environmentVariablesFile));
  }

  public static getEnvironmentVariables (environmentVariablesFile: EnvironmentVariablesFile): EnvironmentVariables {
    // Create a copy so they can't modify the original
    const environmentVariables: EnvironmentVariables = {};
    for (const [variableName, variableValue] of Object.entries(environmentVariablesFile)) {
      // Map hidden or legacy (string) to null, non-hidden to stringy
      environmentVariables[variableName] = typeof variableValue === "string"
        ? variableValue
        : variableValue.value || "";
    }
    return environmentVariables;
  }

  public getEnvironmentVariables (): EnvironmentVariables {
    if (this.environmentVariablesFile === undefined) { return {}; }
    return PpaasEncryptEnvironmentFile.getEnvironmentVariables(this.environmentVariablesFile);
  }

  public setPreviousEnvironmentVariablesFile (environmentVariablesFile: EnvironmentVariablesFile): void {
    this.environmentVariablesFile = environmentVariablesFile;
    this.fileContents = JSON.stringify(environmentVariablesFile);
    this.lastModifiedLocal = 0;
  }

  // Create a sanitized copy which doesn't have the environment variables which may have passwords
  public sanitizedCopy (): PpaasEncryptS3File {
    const sanitized = Object.assign(super.sanitizedCopy(), this, {
      body: undefined,
      fileContents: undefined,
      // Change the object into an array of just the keys (that can be JSON.stringified)
      environmentVariablesFile: this.environmentVariablesFile && Object.keys(this.environmentVariablesFile)
    });
    return sanitized;
  }

  // Returns itself
  public async download (force?: boolean): Promise<PpaasEncryptEnvironmentFile> {
    await super.download(force);
    if (this.fileContents) {
      try {
        this.environmentVariablesFile = JSON.parse(this.fileContents);
      } catch (error) {
        log(`Error download and parsing ${this.key}`, LogLevel.ERROR, error);
        throw error;
      }
    }
    return this;
  }

  // Public for testing
  public static filterEnvironmentVariables (environmentVariablesFile: EnvironmentVariablesFile): EnvironmentVariablesFile {
    const environmentVariablesFileCopy: EnvironmentVariablesFile = JSON.parse(JSON.stringify(environmentVariablesFile));
    for (const [name, value] of Object.entries(environmentVariablesFileCopy)) {
      if (typeof value === "string" || value.hidden) {
        environmentVariablesFileCopy[name] = { value: undefined, hidden: true }; // EnvironmentVariableStateHidden
      }
    }
    return environmentVariablesFileCopy;
  }

  // Override to filter hidden variables before we save
  public async upload (force?: boolean, retry?: boolean): Promise<void> {
    // Filter out passwords and don't save them
    const environmentVariablesFileSaved: EnvironmentVariablesFile | undefined = this.environmentVariablesFile;
    if (environmentVariablesFileSaved) {
      const environmentVariablesFileCopy = PpaasEncryptEnvironmentFile.filterEnvironmentVariables(environmentVariablesFileSaved);
      this.environmentVariablesFile = environmentVariablesFileCopy;
      this.fileContents = JSON.stringify(environmentVariablesFileCopy);
    }
    try {
      await super.upload(force, retry);
    } finally {
      if (environmentVariablesFileSaved) {
        // Put the originals back in case someone looks at it later
        this.environmentVariablesFile = environmentVariablesFileSaved;
        this.fileContents = JSON.stringify(environmentVariablesFileSaved);
      }
    }
  }
}

export default PpaasEncryptEnvironmentFile;
