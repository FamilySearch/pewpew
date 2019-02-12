# loggers section
<pre>
loggers:
  <i>logger_name</i>:
    [select: <i>select</i>]
    [for_each: <i>for_each</i>]
    [where: <i>expression</i>]
    to: <i>template</i> | stderr | stdout
    [pretty: <i>boolean</i>]
    [limit: <i>integer</i>]
    [kill: <i>boolean</i>]
</pre>

Loggers provide a means of logging data to a file, stderr or stdout. Any string can be used for *logger_name*.

There are two types of loggers: plain loggers which have data logged to them by explicitly referencing them within an `endpoints.log` subsection, and global loggers which are evaluated for every HTTP response.

Loggers support the following parameters:
- **`select`** <sub><sup>*Optional*</sup></sub> - When specified, the logger becomes a global logger. See the [endpoints.provides subsection](./endpoints-section.md#provides-subsection) for details on how to define a *select*.
- **`for_each`** <sub><sup>*Optional*</sup></sub> - Used in conjunction with `select` on global loggers.  See the [endpoints.provides subsection](./endpoints-section.md#provides-subsection) for details on how to define a *for_each*.
- **`where`** <sub><sup>*Optional*</sup></sub> - Used in conjunction with `select` on global loggers.  See the [endpoints.provides subsection](./endpoints-section.md#provides-subsection) for details on how to define a where *expression*.
- **`to`** - A [template](./common-types.md#templates) specifying where this logger will send its data. Unlike templates which can be used elsewhere, only environment variables can be interopolated. Values of "stderr" and "stdout" will log data to the respective process streams and any other string will log to a file with that name. When a file is specified, the file will be created if it does not exist or will be truncated if it already exists. When a relative path is specified it is interpreted as relative to the config file. Absolute paths are supported though discouraged as they prevent the config file from being platform agnostic.
- **`pretty`** <sub><sup>*Optional*</sup></sub> - A boolean that indicates the value logged will have added whitespace for readability. Defaults to `false`.
- **`limit`** <sub><sup>*Optional*</sup></sub> - An unsigned integer which indicates the logger will only log the first *n* values sent to it.
- **`kill`** <sub><sup>*Optional*</sup></sub> - A boolen that indicates the test will end when the `limit` is reached, or, if there is no limit, on the first message logged.

Example:
```yaml
loggers:
  httpErrors:
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
    to: http_err.log
    pretty: true
```

Creates a global logger named "httpErrors" which will log to the file "http_err.log" the request and response of the first five requests which have an HTTP status of 400 or greater.
