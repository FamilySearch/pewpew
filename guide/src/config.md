# Config file
A config file is a [YAML file](https://yaml.org/) which defines everything needed for Pewpew to execute a load test. This includes which HTTP endpoints are part of the test, how load should fluctuate over the duration of a test, how data "flows" in a test and more.

## Key concepts
Before creating a config file there are a few key concepts which are helpful to understand.

1) Everything in an HTTP load test is centered around endpoints, rather than "transactions".
2) Whenever some piece of data is needed to build an HTTP request, that data flows through a [provider](./config/providers-section.md). Similarly, when an HTTP response provides data needed for another request that data goes through a provider.
3) The amount of load generated is determined on a per-endpoint-basis termed in "hits per minute" or "hits per second", rather than number of "users".
4) Because a config file is used rather than an API with a scripting language, Pewpew includes a minimal, build-in "language" which allows the execution of very simple [expressions](./config/common-types/expressions.md).

Framing a load test with these concepts enables Pewpew to accomplish one of its goals of allowing a tester to create and maintain load tests with ease.

## Sections of a config file
A config file has five main sections, though not all are required:
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
  - linear:
      to: 100%
      over: 5m
  - linear:
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

## Har to Yaml Converter
If you are attempting to load test a specific web page or the resources on a web page, you can use the [Har to Yaml Converter](./results-viewer-react/yaml.html). First you need to create a [Har File](https://docs.microsoft.com/en-us/azure/azure-portal/capture-browser-trace) from the page load, then use the [Converter](./results-viewer-react/yaml.html) to generate a Yaml Config file.
