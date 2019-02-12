# Command-line options

There are two ways that Pewpew can execute a test from the command-line: either a full load test or a "try run". For reference here's the output of `pewpew --help`:

```
USAGE:
    pewpew.exe <CONFIG> [TRY]

FLAGS:
    -h, --help       Prints help information
    -V, --version    Prints version information

ARGS:
    <CONFIG>    the load test config file to use [default: loadtest.yaml]
    <TRY>       the alias name of a single endpoint which will be run a single time with the raw http request and
                response printed to STDOUT
```

In both cases a [config file](./config.md) is specified. The try run option will run a single endpoint a single time and print out the raw HTTP request and response to stdout. This is useful for testing things out before running a full load test. Pewpew will automatically determine and execute any other endpoints needed to provide data for the desired endpoint.

To execute a try run specify the config file and the alias for the endpoint to be run. By default every endpoint has an alias of its numerical index in the config file, starting with endpoint `1`. An explicit alias can also be provided to an endpoint by using the optional `alias` property within the [endpoint's definition](./config/endpoints-section.md) in the config file.

**Example** If your config file were named `loadtest.yaml` and you wanted to do a try run of the third endpoint, whose alias was `3` (the default), you would run `pewpew loadtest.yaml 3`.