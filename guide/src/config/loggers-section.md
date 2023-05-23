# loggers section
<pre>
loggers:
  <i>logger_name</i>:
    [query: <i>query</i>]
    to: !file <i>template</i> | !stderr | !stdout
    [pretty: <i>boolean</i>]
    [limit: <i>integer</i>]
    [kill: <i>boolean</i>]
</pre>

Loggers provide a means of logging data to a file, stderr or stdout. Any string can be used for *logger_name*.

There are two types of loggers: plain loggers which have data logged to them by explicitly
referencing them within an `endpoints.log` subsection, and global loggers which are evaluated
for every HTTP response.

> TODO: check if `error` is being handled properly

In addition to the special variables "request", "response", and "stats", a logger also has access
to a variable "error" which represents an error which happens during the test. It can be helpful
to log such errors along with the request or response (if they are available) when diagnosing problems.

Loggers support the following parameters:
- **`query`** - A [query](./common-types/queries.md) to define how the sent data is structured.
- **`to`** - Specifies where this logger will send its data. Variants `!stderr` and `!stdout` will
  log data to the respective process streams and `!file` contains a
  [V-Template](./common-types/templates.md#template-types) that will log to a file with that name.
  When a file is specified, the file will be created if it does not exist or will be truncated if
  it already exists. When a relative path is specified it is interpreted as relative to the config
  file. Absolute paths are supported though discouraged as they prevent the config file from being
  platform agnostic.
- **`pretty`** <sub><sup>*Optional*</sup></sub> - A boolean that indicates the value logged will
  have added whitespace for readability. Defaults to `false`.
- **`limit`** <sub><sup>*Optional*</sup></sub> - An unsigned integer which indicates the logger
  will only log the first *n* values sent to it.
- **`kill`** <sub><sup>*Optional*</sup></sub> - A boolen that indicates the test will end when
  the `limit` is reached, or, if there is no limit, on the first message logged.

Example:
```yaml
loggers:
  httpErrors:
    query:
      select:
        request:
          - request["start-line"]
          - request.headers
          - request.body
        response:
          - response["start-line"]
          - response.headers
          - response.body
      where: response.status >= 400
    limit: 5
    to: !file http_err.log
    pretty: true
```

Creates a global logger named "httpErrors" which will log to the file "http_err.log" the request
and response of the first five requests which have an HTTP status of 400 or greater.
