# endpoints section

<pre>
endpoints:
  - [declare: <i>declare_subsection</i>]
    [headers: <i>headers</i>]
    [body: <i>body</i>]
    [load_pattern: <i>load_pattern_subsection</i>]
    [method: <i>method</i>]
    [peak_load: <i>peak_load</i>]
    [tags: <i>tags</i>]
    url: <i>template</i>
    [provides: <i>provides_subsection</i>]
    [on_demand: <i>boolean</i>]
    [logs: <i>logs_subsection</i>]
    [max_parallel_requests: <i>unsigned integer</i>]
    [no_auto_returns: <i>boolean</i>]
    [request_timeout: <i>duration</i>]
</pre>

The `endpoints` section declares what HTTP endpoints will be called during a test.

- **`declare`** <sub><sup>*Optional*</sup></sub> - See the [declare subsection](#declare-subsection)
- **`headers`** <sub><sup>*Optional*</sup></sub> - See [headers](./common-types.md#headers)
- **`body`** <sub><sup>*Optional*</sup></sub> - See the [body subsection](#body-subsection)
- **`load_pattern`** <sub><sup>*Optional*</sup></sub> - See the [load_pattern section](./load_pattern-section.md)
- **`method`** <sub><sup>*Optional*</sup></sub> - A string representation for a valid HTTP method verb. Defaults to `GET`
- **`peak_load`** <sub><sup>*Optional*</sup></sub> - A [V-Template](./common-types/templates.md#template-types)
  representing what the "peak load" for this endpoint should be. The term "peak load" represents
  how much traffic is generated for this endpoint when the [load_pattern](./load_pattern-section.md)
  reaches `100%`. A `load_pattern` can go higher than `100%`, so a `load_pattern` of `200%`, for
  example, would mean it would go double the defined `peak_load`.

  > While `peak_load` is marked as *optional* that is only true if the current endpoint has a
  > *provides_subsection*, and in that case this endpoint is called only as frequently as needed
  > to keep the buffers of the providers it feeds full.

  A valid `peak_load` is a number--integer or decimal--followed by an optional space and the
  string "hpm" (meaning "hits per minute") or "hps" (meaning "hits per second").

  Examples:

  `50hpm` - 50 hits per minute

  `300 hps` - 300 hits per second

- **`tags`** <sub><sup>*Optional*</sup></sub> - Key/value string/[R-Template](./common-types/templates.md#template-types) pairs.

  Tags are a series of key/value pairs used to distinguish each endpoint. Tags can be used to
  include certain endpoints in a [`try`](../cli.md#Command-line-options) run, and also make
  it possible for a single endpoint to have its results statistics aggregated in multiple
  groups. Only tags which can be resolved statically at the beginning of a test (i.e. equivalent
  to a [V-Template](./common-types/templates.md#template-types)) can be used with the `include`
  flag of a `try` run. A reference to a provider can cause a single endpoint to have multiple
  groups of tags. Each one of these groups will have its own statistics in the results. For
  example if an endpoint had the following tags:

  ```yaml
    tags:
      name: Subscribe
      status: ${x:${p:response}.status}
  ```

  A new group of aggregated stats will be created for every status code returned by the endpoint.

  All endpoints have the following implicitly defined tags:

  | Name | Description |
  | - | - |
  | `method` | The HTTP method for the endpoint. |
  | `url` | The endpoint's url with any dynamic pieces being replaced with an asterisk. |
  | `_id` | The index of this endpoint in the list of endpoints, starting with 0. |

  Of the implicitly defined tags only `url` can be overwritten which is helpful in cases such as
  when an entire url is dynamically generated and it would otherwise show up as `*`.

- **`url`** - An [R-Template](./common-types/templates.md#template-types) specifying the fully
  qualified url to the endpoint which will be requested.
- **`provides`** <sub><sup>*Optional*</sup></sub> - See the [provides subsection](#provides-subsection)
- **`on_demand`** <sub><sup>*Optional*</sup></sub> - A boolean which indicates that this endpoint
  should only be called when another endpoint first needs data that this endpoint provides. If the
  endpoint has no `provides` it has no affect.

- **`logs`** <sub><sup>*Optional*</sup></sub> - See the [logs subsection](#logs-subsection)
- **`max_parallel_requests`** <sub><sup>*Optional*</sup></sub> - Limits how many requests can be
  "open" at any point for the endpoint. *WARNING*: this can cause coordinated omission,
  invalidating the test statistics.
- **`no_auto_returns`** <sub><sup>*Optional*</sup></sub> - A boolean which indicates that any
  `auto_return` providers referenced within this endpoint will have `auto_return` disabled--meaning
  values pulled from those providers will not be automatically pushed back to the provider after a response is received. Defaults to `false`.
- **`request_timeout`** <sub><sup>*Optional*</sup></sub> - A [duration](./common-types.md#duration)
  signifying how long a request will wait for a response before it times out. When not specified,
  the value from the [client config](./config-section.md#client) will be used.

## Using providers to build a request
Providers can be referenced anywhere [R-Templates](./common-types/templates.md#template-types) can be used and also in the `declare` subsection.

## body subsection
<pre>
body: !str <i>template</i>
</pre>

<pre>
body: !file <i>template</i>
</pre>

<pre>
body:
  !multipart
    <i>field_name</i>:
      [headers: <i>headers</i>]
      body: !str <i>template</i>
    <i>field_name</i>:
      [headers: <i>headers</i>]
      body: !file <i>template</i>
</pre>

A request can be in one of the following three variants:

- `!str`: Contains an [R-Template](./common-types/templates.md#template-types) to send the
  resulting string as the body.
- `!file`: Contains an [R-Template](./common-types/templates.md#template-types) to send the
  contents of the file at the resulting path.
- `!multipart`: Contains an Object of key/value pairs, where each key/value pair represents a
  piece of the multipart body. The keys represent the *field_name*s used in an HTML form and the
  values are objects with the following properties:
  - **`headers`** <sub><sup>*Optional*</sup></sub> - [Headers](./common-types.md#headers) that
    will be included with this piece of the multipart body. For example, it is not uncommon to
    include a `content-type` header with a piece of a multipart body which includes a file.
  - **`body`** - Either a `!str` or `!file` variant as described above.

When a multipart body is used for an endpoint each request will have the `content-type` header
added with the value `multipart/form-data` and the necessary boundary. If there is already a
`content-type` header set for the request it will be overwritten unless it is starts with
`multipart/`--then the necessary boundary will be appended. If a `multipart/...` `content-type`
is manually set with the request, make sure to not include a `boundary` parameter.

For any request which has a `content-type` of `multipart/form-data`, a `Content-Disposition`
header will be added to each piece in the multipart body with a value of
<code>form-data; name="<i>field_name</i>"</code> (where *field_name* is substituted with the
piece's *field_name*). If a `Content-Disposition` header is explicitly specified for a piece
it will not be overwritten.

File example:

```yaml
body: !file a_file.txt
```

Multipart example:
```yaml
body:
  !multipart
    foo:
      headers:
        Content-Type: image/jpeg
      body: !file foo.jpg
    bar:
      body: !str some text
```

## declare subsection
<pre>
declare:
  <i>name</i>: !x <i>expression</i>
  <i>name</i>: !c <i>collects</i>
</pre>

A *declare_subsection* provides the ability to preprocess provider or variable data, as well as select
multiple values from a single provider or var. Without using a *declare_subsection*, multiple references
to a provider will only select a single value. For example, in:

```yaml
endpoints:
  - method: PUT
    url: https://localhost/ship/${p:shipId}/speed
    body: !str '{"shipId":"${p:shipId}","kesselRunTime":75}'
```

both references to the provider `shipId` will resolve to the same value, which in many cases is desired.

The *declare_subsection* is in the format of key/value pairs where the value is in one of two forms.

- A single [R-Template](./common-types/templates.md#template-types). this can be used to process a
  value once, then use that same value multiple times in the endpoint call.
- A `collects` subsection. Can be used to take multiple values from providers.

<pre>
collects:
  - take: <i>take</i>
    from: <i>template</i>
    as: <i>name</i>
then: <i>template</i>
</pre>

`collects` is an array of maps with the following keys:

- `take`: define how many values to take from this provider. Can either be a single number, or a
  pair of two numbers defining a random range.
- `from`: An [R-Template](./common-types/templates.md#template-types) that defines the value
  source to be repeated.
- `as`: set a name for this collection. This name can be used to interpolate the collection
  in the `then` entry

`then` is an [R-Template](./common-types/templates.md#template-types) that can use the `as`
values defined in the `collects` as providers.

Every key can function as a provider and can be interpolated just as a provider would be.

### Example 1
```yaml
endpoints:
  - declare:
      shidIds: !c
        collects:
          - take: [3, 5]
            from: ${p:shipId}
            as: _ids
        then: ${p:_ids}
    method: DELETE
    url: https://localhost/ships
    body: '{"shipIds":${p:shipIds}}'
```
Calls the endpoint `DELETE /ships` where the body is interpolated with an array of ship ids. `shipIds`
will have a length between three and five.

### Example 2

```yaml
endpoints:
  - declare:
      destroyedShipId: !x ${p:shipId}
    method: PUT
    url: https://localhost/ship/${p:shipId}/destroys/${p:destroyedShipId}
```
Calls `PUT` on an endpoint where `shipId` and `destroyedShipId` are interpolated to different values.

> R-Templates in the `declare` section will be treated as JSON values, if the resulting string is valid JSON

## provides subsection
<pre>
provides:
  <i>provider_name</i>:
    query: <i>query</i>
    [send: block | force | if_not_full]
</pre>

The *provides_subsection* is how data can be sent to a provider from an HTTP response.
*provider_name* is a reference to a provider which must be declared in the root
[providers section](./providers-section.md). For every HTTP response that is received, zero or
more values can be sent to the provider based upon the conditions specified.

- **`query`** - A [query](./common-types/queries.md) to define how the sent data is structured.
- **`send`** <sub><sup>*Optional*</sup></sub> - Specify the behavior that should be used when
  sending data to a provider. Valid options for this parameter are `block`, `force`, and
  `if_not_full`.

  `block` indicates that if the provider's buffer is full, further endpoint calls will be blocked
  until there's room in the provider's buffer for the value. If an endpoint has multiple provides
  which are `block`, then the blocking will only wait for at least one of the providers' buffers
  to have room.

  `force` indicates that the value will be sent to the provider regardless of whether its buffer
  is "full". This can make a provider's buffer exceed its soft limit.

  `if_not_full` indicates that the value will be sent to the provider only if the provider is not
  full.

## logs subsection
<pre>
logs:
  <i>logger_name</i>:
    select: <i>select</i>
    [for_each: <i>for_each</i>]
    [where: <i>expression</i>]
</pre>

The *logs_subsection* provides a means of sending data to a logger based on the result of an HTTP
response. *logger_name* is a reference to a logger which must be declared in the root
[loggers section](./loggers-section.md). It is structured in the same way as a
[Query](./common-types/queries.md). When data is sent to a logger it has the same behavior as
`send: block`, which means logging data can potentially block further requests from happening if
a logger were to get "backed up". This is unlikely to be a problem unless a large amount of data
was consistently logged. It is also possible to log to the same logger multiple times in a single
endpoint by repeating the *logger_name* with a new `select`.
