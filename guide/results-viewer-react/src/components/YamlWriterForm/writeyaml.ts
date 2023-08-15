import {
  PewPewAPI,
  PewPewLoadPattern,
  PewPewLogger,
  PewPewProvider,
  PewPewVars
} from "../../util/yamlwriter";
import { load_test_yaml_from_js as loadTestYamlFromJs } from "@fs/config-gen";
import { log } from "../../util/log";
import { saveAs } from "file-saver";


export interface PewPewYamlFile {
  vars?: Record<string, string>;
  config?: Record<string, any>;
  // We have to disable this because this must be named load_pattern for pew pew
  load_pattern?: Record<string, any>;
  loggers?: Record<string, any>;
  providers?: Record<string, any>;
  endpoints?: Record<string, any>;
}

export interface WriteFileParam {
  urls: PewPewAPI[];
  patterns: PewPewLoadPattern[];
  vars: PewPewVars[];
  providers: PewPewProvider[];
  loggers: PewPewLogger[];
  filename: string;
}

// Writes endpoints to one object, and then uses js-yaml to write as a yaml
export const createYamlJson = ({ urls, patterns, vars, providers, loggers }: Omit<WriteFileParam, "filename">): PewPewYamlFile => {
  const myYaml: PewPewYamlFile = {};

  // Vars that have been selected
  if (vars.length > 0) {
    myYaml.vars = {};

    for (const pewpewVar of vars) {
      myYaml.vars[pewpewVar.name] = pewpewVar.value;
    }
  }

  // Default config
  myYaml.config = {};
  myYaml.config.client = {};
  myYaml.config.client.headers = { "User-Agent": "Pewpew Performance Load Test" };
  // eslint-disable-next-line camelcase
  myYaml.config.general = { bucket_size: "1m" };

  // Patterns that have been selected
  if (patterns.length > 0) {
    // eslint-disable-next-line camelcase
    myYaml.load_pattern = [];
    for (const pattern of patterns) {
      if (myYaml.load_pattern) {
        myYaml.load_pattern.push((pattern.from ? ({ linear: { from: `${pattern.from}%`, to: `${pattern.to}%`, over: `${pattern.over}` } }) : ({ linear: { to: `${pattern.to}%`, over: `${pattern.over}` } })));
      }
    }
  }

  // Loggers that have been selected
  if (loggers.length > 0) {
    myYaml.loggers = {};
    for (const logger of loggers) {
      const loggerName = logger.name.toString();
      myYaml.loggers[loggerName] = {};
      myYaml.loggers[loggerName].query = {};
      myYaml.loggers[loggerName].query.select = {};
      for (const select of logger.select) {
        myYaml.loggers[loggerName].query.select[select.name] = select.value;
      }
      if (logger.where) { myYaml.loggers[loggerName].query.where = logger.where; }
      if (logger.to) { myYaml.loggers[loggerName].to = logger.to; }
      if (logger.limit) { myYaml.loggers[loggerName].limit = logger.limit; }
      if (logger.pretty) { myYaml.loggers[loggerName].pretty = logger.pretty; }
      if (logger.kill) { myYaml.loggers[loggerName].kill = logger.kill; }
    }
  }

  // Providers that have been selected
  if (providers.length > 0) {
    myYaml.providers = {};
    for (const provider of providers) {
      const providerName = provider.name.toString();
      if (provider.type === "file") {
        myYaml.providers[providerName] = {
          file: { path: provider.file, repeat: provider.repeat, random: provider.random }
        };
      }
      else if (provider.type === "response") {
        myYaml.providers[providerName] = { response: provider.response ? provider.response : {} };
      }
      else if (provider.type === "range") {
        myYaml.providers[providerName] = {
          range: {
            start: provider.start,
            end: provider.end || undefined, // turn empty string into undefined
            step: provider.step || undefined, // turn empty string into undefined
            repeat: provider.repeat
          }
        };
      } else if (provider.type === "list" && provider.list) {
        const list: string[] = provider.list.map((listEntry) => listEntry.value);
        if (provider.repeat || provider.random) {
          myYaml.providers[providerName] = { list: { values: list, repeat: provider.repeat, random: provider.random } };
        } else {
          myYaml.providers[providerName] = { list };
        }
      }
    }
  }

  // Endpoints that have been selected
  if (urls.length > 0) {
    myYaml.endpoints = [];
    for (const url of urls) {
      if (myYaml.endpoints) {
        myYaml.endpoints.push({ method: url.method, url: url.url });
        if (url.headers.length > 0) {
          myYaml.endpoints[myYaml.endpoints.length - 1].headers = {};
        }
        for (const header of url.headers) {
          if (header.name && header.value) {
            if (myYaml.endpoints) {
              myYaml.endpoints[myYaml.endpoints.length - 1].headers[header.name.toString()] = `${header.value.toString()}`;
            }
          }
        }
        // eslint-disable-next-line camelcase
        myYaml.endpoints[myYaml.endpoints.length - 1].peak_load = url.hitRate;
      }
    }
  }

  return myYaml;
};

export function createYamlString ({ urls, patterns, vars, providers, loggers }: Omit<WriteFileParam, "filename">): string {
  const myYaml: PewPewYamlFile = createYamlJson({ urls, patterns, vars, providers, loggers });
  const myYamlString = JSON.stringify(myYaml);

  log(myYamlString);
  return loadTestYamlFromJs(myYamlString);
}

// Writes endpoints to one object, and then uses js-yaml to write as a yaml
export function writeFile ({ urls, patterns, vars, providers, loggers, filename }: WriteFileParam) {
  const myYaml: string = createYamlString({ urls, patterns, vars, providers, loggers });

  // Here we add the name of test and the date to the top of file
  const today = new Date();
  let yamlParsed = "# " + filename + " Load Test, " + today.toLocaleString() + " \n";
  // Here we change everything back from an array into a string
  yamlParsed += myYaml;
  // Here we save that string as a Blob called file
  const file = new Blob([yamlParsed], { type: "text/yaml" });

  saveAs(file, filename + ".yaml");
}
