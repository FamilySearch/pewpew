# Config file
A config file is a [YAML file](https://yaml.org/) which defines everything needed for Pewpew to execute a load test. This includes which HTTP endpoints are part of the test, how load should fluctuate over the duration of a test, how data "flows" in a test and more.

## Key concepts
Before creating a config file there are a few key concepts which are helpful to understand.

1) Everything in an HTTP load test is centered around endpoints, rather than "transactions".
2) Whenever some piece of data is needed to build an HTTP request, that data flows through a [provider](./config/providers-section.md). Similarly, when an HTTP response provides data needed for another request that data goes through a provider.
3) The amount of load generated is determined on a per-endpoint-basis termed in "hits per minute" or "hits per second", rather than number of "users".

Framing a load test with these concepts enables Pewpew to accomplish one of its goals of allowing a tester to create and maintain load tests with ease.

## Sections of a config file
A config file has five main sections, though not all are required:
- [lib_src](./config/lib_src-section.md) - Allows loading [Custom Javascript](./config/common-types/expressions.md#custom-javascript).
- [config](./config/config-section.md) - Allows customization of various test options.
- [load_pattern](./config/load_pattern-section.md) - Specifies how load fluctuates during a test.
- [vars](./config/vars-section.md) - Declare static variables which can be used in expressions.
- [providers](./config/providers-section.md) - Declares providers which will are used to manage the flow of data needed for a test.
- [loggers](./config/loggers-section.md) - Declares loggers which, as their name suggests, provide a means of logging data.
- [endpoints](./config/endpoints-section.md) - Specifies the HTTP endpoints which are part of a test and various parameters to build each request.


## Example
Here's a simple example config file:

```yaml
load_pattern:
  - !linear
      to: 100%
      over: 5m
  - !linear
      to: 100%
      over: 2m
endpoints:
  - method: GET
    url: http://localhost/foo
    peak_load: 42hpm
    headers:
      Accept: text/plain
  - method: GET
    url: http://localhost/bar
    headers:
      Accept-Language: en-us
      Accept: application/json
    peak_load: 15hps
```

## Yaml Creator
The [Yaml Creator](../viewer/yaml.html?version=0.6.x) provides a UI for generating a Pewpew config file. There are three ways to use it:

- **HAR file** — A HAR file captures all network requests made by your browser during a page load. If you are load testing a specific web page or its resources, [capture a HAR file](https://docs.microsoft.com/en-us/azure/azure-portal/capture-browser-trace) from the page and import it into the Yaml Creator to automatically generate a config file from the recorded requests.
- **Swagger / OpenAPI file** — Import a [Swagger / OpenAPI file](https://swagger.io/specification/) (2.x or 3.x) to generate a config file from the API specification.
- **Manual UI** — Build a config file from scratch using the Yaml Creator's form-based interface, with no import file required.
