# Command-line options

There are two ways that Pewpew can execute: either a full load test or a try run. For reference here's the output of `pewpew --help`:
<br/><br/>

```
USAGE:
    pewpew <SUBCOMMAND>

FLAGS:
    -h, --help       Prints help information
    -V, --version    Prints version information

SUBCOMMANDS:
    run    Runs a full load test
    try    Runs the specified endpoint(s) a single time for testing purposes
```

As signified in the above help output, there are two subcommands `run` and `try`.
<br/><br/>
Here's the output of `pewpew run --help`:
<br/><br/>

```
USAGE:
    pewpew run <CONFIG>

OPTIONS:
    -h, --help                             Prints help information
    -f, --output-format <FORMAT>           Formatting for stats printed to stdout [default: human]  [possible values:
                                           human, json]
    -d, --results-directory <DIRECTORY>    Directory to store results and logs
    -t, --start-at <START_AT>              Specify the time the test should start at
    -o, --stats-file <STATS_FILE>          Specify the filename for the stats file
    -s, --stats-file-format <FORMAT>       Format for the stats file [default: json]  [possible values: json]
    -w, --watch                            Watch the config file for changes and update the test accordingly

ARGS:
    <CONFIG>    Load test config file to use

ARGS:
    <CONFIG>    Load test config file to use
```

The `-f`, `--output-format` parameter allows changing the formatting of the stats which are printed to stdout.

The `-d`, `--results-directory` parameter will store the results file and any output logs in the specified directory. If the directory does not exist it is created.

The `-w`, `--watch` parameter makes pewpew watch the config file for changes. The `watch_transition_time` [general config option](./config/config-section.md#general) allows specifying a transition time for switching to the new `load_pattern`s and `peak_load`s.

While any part of a test can be updated, special care should be made when modifying or removing endpoints. This is because the aggregation of statistics happens based upon the numerical index of where it appears in the config file. If, for example, the first endpoint is no longer needed and it is simply removed from the test, that means what was the second endpoint is now the first and all of the statistics for that endpoint will begin aggregating in with the first endpoint's statistics. An alternative approach to removing the endpoint would be to set the `peak_load` on the first endpoint to `0hpm`.
<br/><br/>
Here's the output of `pewpew try --help`:
<br/><br/>

```
USAGE:
    pewpew try [OPTIONS] <CONFIG>

OPTIONS:
    -o, --file <FILE>                      Send results to the specified file instead of stdout
    -f, --format <FORMAT>                  Specify the format for the try run output [default: human]  [possible values:
                                           human, json]
    -h, --help                             Prints help information
    -i, --include <INCLUDE>...             Filter which endpoints are included in the try run. Filters work based on an
                                           endpoint's tags. Filters are specified in the format "key=value" where "*" is
                                           a wildcard. Any endpoint matching the filter is included in the test
    -l, --loggers                          Enable loggers defined in the config file
    -d, --results-directory <DIRECTORY>    Directory to store logs (if enabled with --loggers)

ARGS:
    <CONFIG>    Load test config file to use
```

A try run will run one or more endpoints a single time and print out the raw HTTP requests and responses to stdout. By default all endpoints are included in the try run. This is useful for testing out a [config file](./config.md) before running a full load test. When the `--include` parameter is used, pewpew will automatically include any other endpoints needed to provide data for the explicitly included endpoints.

The `-i`, `--include` parameter allows the filtering of which endpoints are included in the try run. Filtering works based on an endpoint's `tags` (see the `tags` parameter in the [endpoints](./config/endpoints-section.md) section). The `INCLUDE` pattern is specified in the format `key=value` or `key!=value` and an asterisk `*` can be used as a wildcard. This parameter can be used multiple times to specify multiple patterns. An endpoint which matches any of the patterns is included in the try run.

The `-l`, `--loggers` flag specifies that any loggers defined in the config file should be enabled. By default, during a try run, loggers are disabled.

The `-d`, `--results-directory` parameter will store any log files (if the `--loggers` flag is used) in the specified directory. If the directory does not exist it is created.
<br/><br/>

In both the `run` and `try` subcommands a [config file](./config.md) is required.

## environment variables
While most environment variables are passed on to the [vars](./config/vars-section.md) section of the [config](./config.md) file, there are a few that affect the pewpew executable.

- **`RUST_BACKTRACE`** <sub><sup>*Optional*</sup></sub> - Enable display of the stack backtrace on errors. Providing any parameter (other than falsey/0) will enable this. Examples. `RUST_BACKTRACE=1` or `RUST_BACKTRACE=full`.
- **`RUST_LOG`** <sub><sup>*Optional*</sup></sub> - A [LevelFilter](https://github.com/rust-lang/log/blob/master/src/lib.rs#L575) specifying what level for pewpew to log at. Allowed values are `Off`, `Error`, `Warn`, `Info`, `Debug`, and `Trace`. Default is `Error`. See [Enable Logging](https://docs.rs/env_logger/0.9.0/env_logger/#enabling-logging) for more complex options for `RUST_LOG`.
