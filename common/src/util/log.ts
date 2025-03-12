/* eslint-disable no-console */
import * as Logger from "bunyan";
import { LogLevel } from "../../types";
import { join as pathJoin } from "path";

export { LogLevel } ;

export const config = {
  LogFileName: process.env.LOG_FILE_NAME
    || process.env.LogFileName
    || process.env.APPLICATION_NAME?.toLowerCase().replace(/_/g, "-")
    || "ppaas-common",
  LoggingLevel: process.env.LOGGING_LEVEL as Logger.LogLevel || process.env.LoggingLevel as Logger.LogLevel || "info",
  LoggingLevelConsole: process.env.LOGGING_LEVEL_CONSOLE as Logger.LogLevel || process.env.LoggingLevelConsole as Logger.LogLevel || "warn",
  LogFileLocation: process.env.LOG_FILE_LOCATION || ""
};

export const pewpewStdOutFilename = (testId: string) => `app-ppaas-pewpew-${testId}-out.json`;
export const pewpewStdErrFilename = (testId: string) => `app-ppaas-pewpew-${testId}-error.json`;

export const PEWPEW_SPLUNK_INJECTED_VARIABLES: string[] = ["SPLUNK_PATH", "SPLUNK_FOLDER", "SPLUNK_LOCATION", "SPLUNK_LOGS"];

let logger: Logger;

export function getLogger (): Logger {
  if (!logger) {
    logger = Logger.createLogger({
      name: config.LogFileName,
      streams: [
        {
          level: config.LoggingLevelConsole,
          stream: process.stdout
        },
        {
          level: config.LoggingLevel,
          type: "rotating-file",
          path: pathJoin(config.LogFileLocation, `app-${config.LogFileName}.json`), // Must be named app*.json
          period: "1d", // daily rotation
          count: 2 // Keep 3 back copies
        }
      ]
    });
    logger.warn({ message: `Logging Level set to ${config.LoggingLevel} for app-${config.LogFileName}.json` });
    logger.warn({ message: `Console Logging Level set to ${config.LoggingLevelConsole}` });
    // Get the injected S3 and SQS environment variables starting with PEWPEWCONTROLLER or PEWPEWAGENT
    const injectedVariables = Object.fromEntries(
      Object.entries(process.env).filter(
        ([varaibleName, _]) => varaibleName && varaibleName.startsWith("PEWPEW")
      )
    );
    logger.info({ message: "Environment Variables",
      ...injectedVariables,
      APPLICATION_NAME: process.env.APPLICATION_NAME,
      SYSTEM_NAME: process.env.SYSTEM_NAME,
      SERVICE_NAME: process.env.SERVICE_NAME,
      NODE_ENV: process.env.NODE_ENV,
      AUTH_MODE: process.env.AUTH_MODE,
      CONTROLLER_ENV: process.env.CONTROLLER_ENV,
      CONTROLLER_ENV_S3: process.env.CONTROLLER_ENV_S3,
      AGENT_ENV: process.env.AGENT_ENV,
      AGENT_DESC: process.env.AGENT_DESC,
      KEYSPACE_PREFIX_OVERRIDE: process.env.KEYSPACE_PREFIX_OVERRIDE,
      BASE_PATH: process.env.BASE_PATH,
      DELETE_OLD_FILES_DAYS: process.env.DELETE_OLD_FILES_DAYS,
      RUN_HISTORICAL_SEARCH: process.env.RUN_HISTORICAL_SEARCH,
      RUN_HISTORICAL_DELETE: process.env.RUN_HISTORICAL_DELETE,
      variables: Object.keys(process.env).filter((variableName: string) => variableName && !variableName.startsWith("npm"))
    });
  }
  return logger;
}

/**
 * Takes a variable list of data and logs to the file and console based on
 * process.env.LoggingLevel and process.env.LoggingLevelConsole
 * @param message (String) primary message to log
 * @param level (LogLevel) default: INFO. The level to log this message at
 * @param datas (...any[]) Optional objects to log including a single error
 */
 export function log (message: string, level: LogLevel = LogLevel.INFO, ...datas: any[]) {
  const fullMessage: any = {
    message
  };
  let i = 0;
  if (datas && datas.length > 0) {
    for (const data of datas) {
      if (data) {
        if (data instanceof Error) {
          // Only allow one. Overwrite otherwise
          fullMessage.error = data.message || `${data}`;
          // console.error(data);
          if (!message && !data.message) { console.error(data.stack || new Error("Error with no stack")); }
          if (!message) { message = data.message; }
        } else if (data instanceof Map) {
          // Only allow one. Overwrite otherwise
          fullMessage.data = Object.assign(fullMessage.data || {}, { map: [...data] });
        } else if (typeof data === "string" || Array.isArray(data)) {
          // Object.assign doesn't work combining objects and arrays
          // instanceOf String didn't work and caused an object.assign
          if (datas.length > 1) {
            // If there's more than one, add a counter to differentiate
            // data0 will be different than data to avoid objects overwriting this
            fullMessage["data" + i++] = data;
          } else {
            fullMessage.data = data;
          }
        } else {
          // If we have a testId and/or yamlFile, put them in the main message and remove them.
          // We can't delete them from the real one passed in, so create a cloned copy
          const dataCopy = Object.assign({}, data);
          if (dataCopy.testId && typeof dataCopy.testId === "string") {
            fullMessage.testId = dataCopy.testId;
            delete dataCopy.testId;
          }
          if (dataCopy.yamlFile && typeof dataCopy.yamlFile === "string") {
            fullMessage.yamlFile = dataCopy.yamlFile;
            delete dataCopy.yamlFile;
          }
          if (dataCopy.userId && typeof dataCopy.userId === "string") {
            fullMessage.userId = dataCopy.userId;
            delete dataCopy.userId;
          }
          // If all we had was a testId and/or yamlFile it'll be an empty object. Don't log it
          if (Object.keys(dataCopy).length > 0) {
            // If there's already an object, do an Object.assign on top of it.
            // This will never be a string because of the length check above on typeof == string
            fullMessage.data = Object.assign(fullMessage.data || {} , dataCopy);
          }
        }
      }
    }
  }
  getLogger(); // Call this to initialize if it hasn't been
  switch (level) {
    case LogLevel.TRACE:
      logger.trace(fullMessage);
      break;
    case LogLevel.DEBUG:
      logger.debug(fullMessage);
      break;
    case LogLevel.INFO:
      logger.info(fullMessage);
      break;
    case LogLevel.WARN:
      logger.warn(fullMessage);
      break;
    case LogLevel.ERROR:
      logger.error(fullMessage);
      // eslint-disable-next-line eqeqeq
      if ((!fullMessage.message || fullMessage.message == "undefined") && !fullMessage.error) {
        console.error(new Error("Log Error with NO message or error"));
      }
      break;
    case LogLevel.FATAL:
      logger.fatal(fullMessage);
      console.error(new Error("Log Fatal Stack Trace"));
      break;
    default:
      logger.info(fullMessage);
      break;
  }
}
