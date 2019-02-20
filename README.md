# Pewpew
Pewpew is an HTTP load test tool designed for ease of use and high performance. See the [guide](https://fs-eng.github.io/pewpew) for details on its use.

## Changelog
### v0.4.8
Bug fixes:
- Fixed error where a try run could try to use an endpoint which provides for a provider that it also depends on.

Changes:
- Add modulus `%` expression operator.
- Add `repeat` option for range providers.

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