import type { Meta, StoryFn } from "@storybook/react";
import { YamlViewer, YamlViewerProps } from ".";
import { GlobalStyle } from "../Global";
import React from "react";

/**
 * Developing and visually testing components in isolation before composing them in your app is useful.
 * This file shows an example of that for the Layout component.
 * Source: https://storybook.js.org
 */

const yamlContents = `vars:
rampTime: 1m
loadTime: 1m
serviceUrlAgent: \${SERVICE_URL_AGENT}
load_pattern:
- linear:
    from: 1%
    to: 100%
    over: \${rampTime}
config:
client:
  # request_timeout: { secs: 10, nanos: 0 }
  # request_timeout: 10s
  headers:
    TestTime: '\${epoch("ms")}'
    Accept: application/json
    User-Agent: Pewpew Agent Performance Test
general:
  bucket_size: 1m
  log_provider_stats: 1m
endpoints:
- method: GET
  url: http://\${serviceUrlAgent}/healthcheck
  peak_load: 30hpm`;

const yamlContentsLarge = `vars:
rampTime: 1m
loadTime: 1m
logDir: \${SPLUNK_PATH}
load_pattern:
- linear:
    from: 1%
    to: 100%
    over: \${rampTime}
- linear:
    from: 100%
    to: 100%
    over: \${loadTime}
config:
client:
  # request_timeout: { secs: 10, nanos: 0 }
  # request_timeout: 10s
  headers:
    TestTime: '\${epoch("ms")}'
    Accept: application/json
    User-Agent: Pewpew Agent Performance Test
general:
  bucket_size: 1m
  log_provider_stats: 1m
loggers:
remote_logger:
  select:
    timestamp: epoch("ms")
    request: request["start-line"]
    method: request.method
    url: request.url
    response: response["start-line"]
    status: response.status
  where: response.status >= 400
  limit: 1000
  to: '\${logDir}/http-err.json'
  pretty: false
local_logger:
  select: '\`\${request["start-line"]},\${response["start-line"]},\${request.method},\${response.status}\`'
  where: response.status >= 400
  limit: 1000
  to: 'errors.csv'
  pretty: false
providers:
sessionId:
  response:
    # buffer: 100
    auto_return: force
localFile:
  file:
    path: 'text.txt'
    repeat: true
    random: true
localFile2:
  file:
    path: 'text2.txt'
    repeat: true
    random: true
endpoints:
- method: GET
  url: http://127.0.0.1:8080/healthcheck
  peak_load: 30hpm`;

const props: YamlViewerProps = {
  yamlFilename: "Basic.yaml"
};

const propsWithContents: YamlViewerProps = {
  ...props, yamlContents
};
const propsWithContentsLarge: YamlViewerProps = {
  ...props, yamlContents: yamlContentsLarge
};

const propsWithLoading: YamlViewerProps = {
  ...props, loading: true
};

const propsWithError: YamlViewerProps = {
  ...props, error: "Error loading Yaml file"
};

const propsWithAll: YamlViewerProps = {
  ...props,
  yamlContents,
  loading: true,
  error: "Error loading Yaml file"
};

export default {
  title: "YamlViewer"
} as Meta<typeof YamlViewer>;

export const Default: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <YamlViewer { ...props } />
  </React.Fragment>
  );

export const Contents: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <YamlViewer { ...propsWithContents } />
  </React.Fragment>
  );

export const ContentsLarge: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <YamlViewer { ...propsWithContentsLarge } />
  </React.Fragment>
  );

ContentsLarge.story = {
  name: "ContentsLarge"
};

export const Loading: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <YamlViewer { ...propsWithLoading } />
  </React.Fragment>
  );

export const Error: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <YamlViewer { ...propsWithError } />
  </React.Fragment>
  );
export const All: StoryFn = () => (
  <React.Fragment>
    <GlobalStyle />
    <YamlViewer { ...propsWithAll } />
  </React.Fragment>
  );
