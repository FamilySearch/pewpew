/* eslint-disable no-console */
export enum LogLevel {
  DEBUG = 20,
  INFO = 30,
  WARN = 40,
  ERROR = 50
}

const logDebug: boolean = true;

// Take a variable list of objects
export function log (message: string, level: LogLevel = LogLevel.INFO, ...datas: any[]) {
  const fullMessage: any = {
    time: new Date().toISOString(),
    level,
    message
  };
  let i = 0;
  if (datas && datas.length > 0) {
    for (const data of datas) {
      if (data) {
        if (data instanceof Error) {
          // Only allow one. Overwrite otherwise
          fullMessage.err = data.message;
          console.error(data.stack);
        } else if (data instanceof Map) {
          // Only allow one. Overwrite otherwise
          fullMessage.data = Object.assign(fullMessage.data || {}, { map: Array.from(data.entries()) });
        } else if (typeof data === "string") {
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
  switch (level) {
    case LogLevel.DEBUG:
      if (logDebug) { console.debug(JSON.stringify(fullMessage)); }
      break;
    case LogLevel.INFO:
      console.info(JSON.stringify(fullMessage));
      break;
    case LogLevel.WARN:
      console.warn(JSON.stringify(fullMessage));
      break;
    case LogLevel.ERROR:
      console.error(JSON.stringify(fullMessage));
      break;
    default:
      console.info(JSON.stringify(fullMessage));
      break;
  }
}

/**
 * Attempts to format an error that can be an `Error`, an `AxiosError`, or a promise reject
 * @param error caught error
 * @returns {string} formatted string from the error
 */
 export function formatError (error: unknown): string {
  return typeof (error as any)?.msg === "string"
    ? (error as any).msg
    : ((typeof (error as any)?.message === "string")
      ? (error as any).message
      : `${error}`);
}
