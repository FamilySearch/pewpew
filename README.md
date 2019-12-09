# Pewpew
Pewpew is an HTTP load test tool designed for ease of use and high performance. See the [guide](https://fs-eng.github.io/pewpew) for details on its use.

## Changelog
### v0.5.5
Changes:
- Add an error message into the stats when an endpoint is delayed waiting for a provider.
- Adjust the way auto-sized buffers grow to be less aggressive. Now they have to be filled and then emptied before they will grow.
- Short circuit a `for_each` when a `where` does not reference `for_each`.
- Add a command-line argument, `start-at`, to start the test at a given time.
- Add optional `request_timeout` option to `endpoints`.

Bugfix:
- Fix regression where certain errors which should be handled during a test were causing the test to crash.
- Fix bug where a load_pattern did not work when doing `from: 0%` and `to: 0%`.

### v0.5.4
Changes:
- Add `stats-file` command-line flag to specify the name of the stats file.

Bugfix:
- Fix bug where a `logs` expression would get `null` for `response` and `request` fields unless they were also references within a `provides`.
- Fix bug where tests would crash if a response header was a not UTF8 encoded.

### v0.5.3
Changes:
- Add a `days` unit to durations.
- Expand cases when an endpoint can have no `peak_load` to include the case when the endpoint depends upon a `response` provider.
- Swap out the JSONPath library for one that supports more JSONPath expressions.

Bugfix:
- Raise an error if `for_each` is referenced but not defined.
- Fix bug where the config parser would erroneously say there was a recursive `for_each`.

### v0.5.2
Changes:
- Allow an unquoted number to be used when indexing into an object within an expression.
- Change stats to go through stdout instead of stderr.
- Print stats for an endpoint even if it only experienced errors.

Bugfix:
- Fix issue where `request.body` would display the wrong file name when the request body was a file.
- Fix message displayed as `request.body` when the request body is a file to be consistent with other similar messages and have double braces as delimiters.
- Fix issue where the `config.client.request_timeout` and `config.client.keepalive` were not being parsed properly from the config file.
- Fix issue where an endpoint which provides for a provider it also depends on could cause a try run to hang.

### v0.5.1
Changes:
- Tags can now reference providers. Add an additional implicit tag of `_id` which is the index of the endpoint in the list of endpoints.

### v0.5.0
Breaking changes:
- Merge the aggregate stats "connection errors" into "test errors".
- Change the `collect` and `repeat` expression functions to make the optional `max` parameter exclusive.
- For endpoints which have `provides` change the default `send` behavior to `if_not_full` if the endpoint has a `peak_load` otherwise `block`.
- When an endpoint has multiple `provides` which are `send: block` the blocking will only wait for there to be room in at least one of the providers' buffers.
- Moved the `config.general` `summary_output_format` option to be a command-line argument.
- Change the command-line interface to have two sub-commands: `run` and `try`. With this change is the ability to select more than one endpoint for a try run and specifying a directory for test results.
- Dropped the `alias` parameter for an endpoint and renamed `stats_id` to `tags`.
- Split `static` providers out to their own section, `vars`, and make it so environment variables can only be referenced from within a variable defined in `vars`. This includes no longer requiring environment variables to be prefaced with a `$`.
- Rename the `static_list` provider type to `list`.
- Allow the same header name to be used multiple times in a request (in compliance with HTTP specs). Headers which are set through `config.client.headers` can be unset in the `endpoints.headers` sub-section by setting the value to `null`.

Bugfix:
- Fix an issue where loggers would not log for a request if a warning level error happened.
- Fix performance regression introduced in v0.4.9.
- Fix performance regression introduced in v0.4.10.
- Fix bug where `auto_buffer_start_size` was not working for `response` providers.
- Fix bug where some json outputs would have `\n` at the end.

Changes:
- Allow a logger to log test errors. This is done by making another variable available to loggers--`error` (in addition to `request`, `response` and `stats`). A logger can no longer have an error "indexing into json", instead it will resolve to `null`. This enables a logger which logs test errors along with the `request` and `response` if they are available.
- Add the `watch` command-line flag for the `run` subcommand, along with the `watch_transition_time` general config option to allow `load_pattern`s and `peak_load`s to change while a test is running. This enables the duration of a test to change and the amount of load generated.
- Allow a global header to be unset with a `null` value in the `endpoints.headers` sub-section.
- Better handle Ctrl-c killing of the test and persist any unsaved data to disk.
- Add in `replace` expression function which replaces any occurances of a string in a JSON value with another string.
- Add in `base64` option for the `encode` function.
- For response bodies which cannot first be parsed as utf8 strings the response body will be set to the string "<\<binary data>>".
- Add in `file` and `format` command-line options to `try` subcommand.
- For multipart requests include the `content-length` header instead of sending a chunked request.
- For multipart requests which have file pieces, include the `filename` section with the `content-disposition` sub-header.
- Allow the selecting of bodies from multipart or file requests. Sections coming from a file are replaced with the string "<\<contents of file: \"filename\">>".

### v0.4.11
Changes:
- Print a summary at the end of a try run.
- Allow `duration`s, `percent`s and `peak_load` to be templates which can interpolate environment variables.
- Add an `entries` expression function which allows iterating over the key/value pairs in an object.
- Add the stem part of the config file to the name of the stats output file.

### v0.4.10
Bug fixes:
- Fix issue where endpoints without a `peak_load` would run infintely if targeted in a try run.
- Enforce that an endpoint without a `peak_load` must have at least one provides with `send: block`.
- Fix issue where warnings (like an invalid url), were not being logged during a try run.
- Fix hang up that would happen with `on_demand` if the "demander" executed before the `on_demand` endpoint.
- Fix hang up that could happen when a large amount of data was logged.
- Fix issue where requests would be double counted in the stats if there was a warning level error.

Changes:
- Add `no_auto_returns` endpoint option.
- In a try run include all endpoints which can provide data to a response provider needed by the target endpoint.

### v0.4.9
Bug fixes:
- Fix issue with `on_demand` where things would hang if the endpoint did not provide a value.
- Fix issue where a logger causes a fatal test error if writing to the underlying resource causes a blocking call.

Changes:
- Add in `random` and `repeat` parameters for `static_list` providers.
- Persists aggregate stats to disk every time they are printed to the console.
- Add in ability to have multipart request bodies.

### v0.4.8
Bug fixes:
- Fixed error where a try run could try to use an endpoint which provides for a provider that it also depends on.
- Prevent errors from arising due to boolean operators not being evaluated lazily.
- Fixed error where logger limits only worked when used in conjunction with `kill`.

Changes:
- Add modulus `%` expression operator.
- Add `repeat` option for range providers.
- Disabled `load_pattern`s during try runs.
- Have the process return an error code on a fatal error.
- Add console message when test ends early due to a provider ending.
- Add `random` expression function.
- Change RTTs to be stored with microsecond precision but still display as milliseconds (with decimal).
- Make some errors which may occur during a test run just print warnings.
- Add `log_provider_stats` config option to log statistics about providers.
- Add in ability to specify a file as the request body.
- Add `on_demand` endpoint option.

### v0.4.7
Bug fixes:
- Fixed memory leak introduced in v0.4.6.
- Fixed error where order of operations were not being executed correctly--introduced in v0.4.6.
- Fixed off-by-one bug for loggers killing a test.
- Fixed bug where loggers would not log to stdout or stderr.

### v0.4.6
Bug fixes:
- Fixed bug where `auto_return`s were getting blocked waiting for provides to finish.

Changes:
- Add `max_parallel_requests` endpoint parameter.
- Add the ability to reference environment variables using templates within a static provider.
- Add basic math operators to expressions: `+`, `-`, `*`, `/`.

### v0.4.5:
Changes:
- Refactored the way the code handles errors on the backend. The end result for users is cleaner error messages when things go wrong.
- Added in a "try run" option to the command line. This gives the ability to run one endpoint a single time. Based on the provider needs of the endpoint pewpew will automatically pick any other endpoints needed as dependencies to provide the data. Currently raw request output is automatically printed to stdout.
- Added in a three argument version of the `join` expression function which enables the string formatting of an object.

### v0.4.4:
Changes:
- Add in proper handling of compressed response bodies. Brotli, gzip and deflate are supported.

### v0.4.3:
Changes:
- Add `range` function which creates an array of numbers. See docs for details.
- Added `min` and `max` functions which select the smallest or largest numbers respectively in a series of numbers.

### v0.4.2:
Bug fixes:
- Fixed bug where when a request failed `auto_return` values were not being sent back to their provider.

Changes:
- `stats_id` can now have templates as the values.
- Previously as a test progressed, the url printed in the stats output could change because dynamic parts of the url were replaced by a star (`*`). Now we detect the dynamic parts of a url at the beginning of a test so it should start out with the stars.

### v0.4.1:
Bug fixes:
- Fixed bug where variables in declare were not being recognized as providers in an expression.
- Fixed bug where bucket stats were sometimes printed in the middle of test summary stats.

### v0.4.0: 
Breaking changes:
- Templates no longer use `{{ }}` and now use `${ }`.
- All helper functions use the more familiar parenthesis as part of the calling syntax and commas to separate arguments. Ex: what was `{{join foo "-"}}` is now `${join(foo, "-")}`.
- There is no longer an `environment` provider. Instead environment variables can be referenced in any expression using `$ENV_VAR` syntax. If you previously referenced an environment variable in a file path, make sure you change it to have the `$` before the variable name.
- The `declare` section now supports any valid expression.
- The order of `collect` function's arguments has changed.