# config section

<pre>
config:
  client:
    request_timeout: <i>duration</i>
    headers: <i>headers</i>
    keepalive: <i>duration</i>
  general:
    auto_buffer_start_size: <i>unsized integer</i>
    bucket_size: <i>duration</i>
    summary_output_format: pretty | json
</pre>

The `config` section provides a means of customizing different parameters for the test. Parameters are divided into two subsections: `client` which pertains to customizations for the HTTP client and `general` which are other miscellaneous settings for the test.

## client
- **`request_timeout`** <sub><sup>*Optional*</sup></sub> - A [duration](./common-types.md#duration) signifying how long a request will wait before it times out. Defaults to 60 seconds.
- **`headers`** <sub><sup>*Optional*</sup></sub> - [Headers](./common-types.md#headers) which will be sent in every request. A header specified in an endpoint will override a header specified here with the same key.
- **`keepalive`** <sub><sup>*Optional*</sup></sub> - The keepalive [duration](./common-types.md#duration) that will be used on TCP socket connections. This is different from the `Keep-Alive` HTTP header. Defaults to 90 seconds.

## general
- **`auto_buffer_start_size`** <sub><sup>*Optional*</sup></sub> - The starting size for provider buffers which are `auto` sized. Defaults to 5.
- **`bucket_size`** <sub><sup>*Optional*</sup></sub> - A [duration](./common-types.md#duration) specifying how big each bucket should be for endpoints' aggregated stats. This also affects how often summary stats will be printed to the console. Defaults to 60 seconds.
- **`summary_output_format`** <sub><sup>*Optional*</sup></sub> - The format that the summary stats will be when they are printed to the console. Can be either `pretty` or `json`. Defaults to `pretty`.
