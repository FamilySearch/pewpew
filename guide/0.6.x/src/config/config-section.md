# config section

<pre>
config:
  client:
    [request_timeout: <i>duration</i>]
    [headers: <i>headers</i>]
    [keepalive: <i>duration</i>]
  general:
    [auto_buffer_start_size: <i>unsigned integer</i>]
    [bucket_size: <i>duration</i>]
    [log_provider_stats: <i>duration</i>]
    [watch_transition_time: <i>duration</i>]
</pre>

The `config` section provides a means of customizing different parameters for the test. Parameters are divided into two subsections:
`client` which pertains to customizations for the HTTP client and `general` which are other miscellaneous settings for the test.

## client
- **`request_timeout`** <sub><sup>*Optional*</sup></sub> - A [duration](./common-types.md#duration) signifying
    how long a request will wait for a response before it times out. Defaults to 60 seconds.
- **`headers`** <sub><sup>*Optional*</sup></sub> - [Headers](./common-types.md#headers) which will be sent in
    every request. A header specified in an endpoint will override a header specified here with the same key.
- **`keepalive`** <sub><sup>*Optional*</sup></sub> - The keepalive [duration](./common-types.md#duration) that
    will be used on TCP socket connections. This is different from the `Keep-Alive` HTTP header. Defaults to 90 seconds.

## general
- **`auto_buffer_start_size`** <sub><sup>*Optional*</sup></sub> - The starting size for provider buffers which
    are `auto` sized. Defaults to 5.
- **`bucket_size`** <sub><sup>*Optional*</sup></sub> - A [duration](./common-types.md#duration) specifying how
    big each bucket should be for endpoints' aggregated stats. This also affects how often summary stats will
    be printed to the console. Defaults to 60 seconds.
- **`log_provider_stats`** <sub><sup>*Optional*</sup></sub> - A boolean that enables/disabled logging to the
    console stats about the providers. Stats include the number of items in the provider, the limit of the
    provider, how many tasks are waiting to send into the provider and how many endpoints are waiting to receive
    from the provider. Logs data at the `bucket_size` interval. Set to `false` to turn off and not log provider
    stats. Defaults to `true`.
- **`watch_transition_time`** <sub><sup>*Optional*</sup></sub> - A [duration](./common-types.md#duration) specifying
    how long of a transition there should be when going from an old `load_pattern` to a new `load_pattern`. This
    option only has an affect when pewpew is running a load test with the `--watch` [command-line](../cli.md) flag
    enabled. If this is not specified there will be no transition when `load_pattern`s change.
