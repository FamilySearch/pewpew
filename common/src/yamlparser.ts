import { LogLevel, log, config as logConfig } from "./util/log";
import { Config } from "@fs/config-wasm";
import { EnvironmentVariables } from "../types";
import { readFile } from "fs/promises";

export function parseEnvVarFromError (error: any): string | undefined {
  if (typeof error === "string") {
    // Format is IndexingIntoJson\("VARIABLE", Null)
    // MissingEnvironmentVariable\("VARIABLE", Marker
    // Envs(MissingVar(MissingEnvVar("VARIABLE"))))
    const matchLegacy = error.match(/MissingEnvironmentVariable\("([^"]*)", Marker/);
    log("parseYamlFile match: " + JSON.stringify(matchLegacy), LogLevel.DEBUG, matchLegacy);
    if (matchLegacy && matchLegacy.length > 1) {
      const expectedVariable = matchLegacy[1];
      log("parseYamlFile missing legacy variable: " + expectedVariable, LogLevel.DEBUG);
      return expectedVariable;
    }
    const matchScripting = error.match(/MissingEnvVar\("([^"]*)"\)/);
    log("parseYamlFile match: " + JSON.stringify(matchScripting), LogLevel.DEBUG, matchScripting);
    if (matchScripting && matchScripting.length > 1) {
      const expectedVariable = matchScripting[1];
      log("parseYamlFile missing scripting variable: " + expectedVariable, LogLevel.DEBUG);
      return expectedVariable;
    }
  }
  return undefined;
}

export function parseDurationFromError (error: any): string | undefined {
  if (typeof error === "string") {
    // Format is InvalidDuration\("value"
    // error: DurationError(\"value\")
    const matchLegacy = error.match(/InvalidDuration\("([^"]*)"/);
    log("parseYamlFile match: " + JSON.stringify(matchLegacy), LogLevel.DEBUG, matchLegacy);
    if (matchLegacy && matchLegacy.length > 1) {
      const duration = matchLegacy[1];
      log("parseYamlFile InvalidDuration: " + duration, LogLevel.DEBUG);
      return duration;
    }
    const matchScripting = error.match(/DurationError\("([^"]*)"\)/);
    log("parseYamlFile match: " + JSON.stringify(matchScripting), LogLevel.DEBUG, matchScripting);
    if (matchScripting && matchScripting.length > 1) {
      const duration = matchScripting[1];
      log("parseYamlFile InvalidDuration: " + duration, LogLevel.DEBUG);
      return duration;
    }
  }
  return undefined;
}

export function parsePeakLoadFromError (error: any): string | undefined {
  if (typeof error === "string") {
    // Format is InvalidPeakLoad\("VALUE"
    // HitsPerMinute\", from: \"VALUE\", error: Invalid
    const matchLegacy = error.match(/InvalidPeakLoad\("([^"]*)"/);
    log("parseYamlFile match: " + JSON.stringify(matchLegacy), LogLevel.DEBUG, matchLegacy);
    if (matchLegacy && matchLegacy.length > 1) {
      const peakLoad = matchLegacy[1];
      log("parseYamlFile InvalidPeakLoad: " + peakLoad, LogLevel.DEBUG);
      return peakLoad;
    }
    const matchScripting = error.match(/HitsPerMinute", from: "([^"]*)", error: Invalid/);
    log("parseYamlFile match: " + JSON.stringify(matchScripting), LogLevel.DEBUG, matchScripting);
    if (matchScripting && matchScripting.length > 1) {
      const peakLoad = matchScripting[1];
      log("parseYamlFile InvalidPeakLoad: " + peakLoad, LogLevel.DEBUG);
      return peakLoad;
    }
  }
  return undefined;
}

export class YamlParser {
  protected bucketSizeMs: number;
  protected testRunTimeMn: number;
  protected inputFileNames: string[];
  protected loggerFileNames: string[];

  private constructor (bucketSizeMs: number,
      testRunTimeMn: number,
      inputFileNames: string[],
      loggerFileNames: string[]) {
    this.bucketSizeMs = bucketSizeMs;
    this.testRunTimeMn = testRunTimeMn;
    this.inputFileNames = inputFileNames;
    this.loggerFileNames = loggerFileNames;
  }

  public static async parseYamlFile (filepath: string, environmentVariables: EnvironmentVariables, validateLegacyOnly?: boolean): Promise<YamlParser> {
    let config: Config | undefined;
    try {
      const fileBuffer: Buffer = await readFile(filepath);
      const varMap: Map<string, string> = new Map<string, string>();
      for (const [key, value] of Object.entries(environmentVariables)) {
        varMap.set(key, value);
      }
      let yamlValid = false;
      let counter = 0;
      const missingVariables: EnvironmentVariables = {};
      // If we're missing variables, Parse them all by passing dummy values in.
      do {
        counter++;
        try {
          // Pass these into the constructor for validation that we have them all
          config = new Config(
            fileBuffer,
            varMap,
            typeof logConfig.LoggingLevel === "number" ? undefined : logConfig.LoggingLevel,
            validateLegacyOnly
          );
          yamlValid = true;
        } catch (error: unknown) {
          log("Could not parse yaml file: " + filepath, LogLevel.DEBUG, error);
          if (counter > 50) {
            throw error;
          }
          // See if we're missing a variable
          const missingVariable: string | undefined = parseEnvVarFromError(error);
          const badDuration: string | undefined = parseDurationFromError(error);
          const badPeakLoad: string | undefined = parsePeakLoadFromError(error);
          log("missingVariable: " + missingVariable, LogLevel.DEBUG);
          log("badDuration: " + badDuration, LogLevel.DEBUG);
          log("badPeakLoad: " + badPeakLoad, LogLevel.DEBUG);
          if (missingVariable) {
            // Add it to the list and the varMap and retry
            // Use a number since it will work even for strings.
            // Possible values: string, number, duration, peak_load
            missingVariables[missingVariable] = "" + counter;
            varMap.set(missingVariable, missingVariables[missingVariable]); // We have to use a duration here in case they ask for a
          } else if (typeof error === "string" && badDuration && Object.values(missingVariables).includes(badDuration)) {
            // We accidentally stuck a random number in a duration field. Find which one it was
            const entry: [string, string] | undefined = Object.entries(missingVariables).find((missingVar: [string, string]) => missingVar[1] === badDuration);
            log("entry: " + entry, LogLevel.DEBUG);
            if (entry) {
              // Change it to a duration
              missingVariables[entry[0]] = entry[1] + "m";
              varMap.set(entry[0], missingVariables[entry[0]]);
              log("missingVariables after: " + missingVariables, LogLevel.DEBUG, missingVariables);
            } else {
              // It wasn't one of our variables that caused the issue
              throw error;
            }
          } else if (typeof error === "string" && badPeakLoad && Object.values(missingVariables).includes(badPeakLoad)) {
            // We accidentally stuck a random number in a peak_load field. Find which one it was
            const entry: [string, string] | undefined = Object.entries(missingVariables).find((missingVar: [string, string]) => missingVar[1] === badPeakLoad);
            log("entry: " + entry, LogLevel.DEBUG);
            if (entry) {
              // Change it to a peak_load
              missingVariables[entry[0]] = entry[1] + "hpm";
              varMap.set(entry[0], missingVariables[entry[0]]);
              log("missingVariables after: " + missingVariables, LogLevel.DEBUG, missingVariables);
            } else {
              // It wasn't one of our variables that caused the issue
              throw error;
            }
          } else {
            // It's something else, throw it and let the final catch return it.
            throw error;
          }
        }
      } while (!yamlValid);
      // typescript can't figure out that config won't be null here, add a null check
      if (Object.keys(missingVariables).length > 0 || !config) {
        throw new Error("missingEnvironmentVariables=" + Object.keys(missingVariables));
      }

      // Just let this throw. There's no reason to let a config parse happen if the checkOk fails
      config.checkOk();

      // BucketSize comes in as seconds, convert it to MS for the agents
      const bucketSizeMs: number = Number(config.getBucketSize()) * 1000;
      // testRunTime comes in as seconds, convert it to minutes for the agents
      const testRunTimeMn: number = Math.round(Number(config.getDuration()) / 60);
      const inputFiles: string[] = config.getInputFiles();
      const loggerFiles: string[] = config.getLoggerFiles();
      log(`parseYamlFile(${filepath})`, LogLevel.DEBUG, { bucketSizeMs, testRunTimeMn, inputFiles, loggerFiles });
      const yamlParser = new YamlParser(bucketSizeMs, testRunTimeMn, inputFiles, loggerFiles);
      return yamlParser;
    } catch (error: unknown) {
      // We don't want to log a lot of errors to splunk, but it could be helpful to debug
      log("Could not parse yaml file: " + filepath, LogLevel.WARN, error);
      throw error;
    } finally {
      if (config) {
        config.free();
      }
    }
  }

  public getBucketSizeMs (): number {
    return this.bucketSizeMs;
  }

  public getTestRunTimeMn (): number {
    return this.testRunTimeMn;
  }

  public getInputFileNames (): string[] {
    return this.inputFileNames;
  }

  public getLoggerFileNames (): string[] {
    return this.loggerFileNames;
  }
}

export default YamlParser;
