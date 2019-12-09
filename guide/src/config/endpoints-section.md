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
- **`peak_load`** <sub><sup>*Optional**</sup></sub> - A [template](./common-types.md#templates]) representing what the "peak load" for this endpoint should be. The term "peak load" represents how much traffic is generated for this endpoint when the [load_pattern](./load_pattern-section.md) reaches `100%`. A `load_pattern` can go higher than `100%`, so a `load_pattern` of `200%`, for example, would mean it would go double the defined `peak_load`. Only variables defined in the [vars section](./vars-section.md) can be interpolated.

  \* While `peak_load` is marked as *optional* that is only true if the current endpoint has a *provides_subsection*, and in that case this endpoint is called only as frequently as needed to keep the buffers of the providers it feeds full.

  A valid `load_pattern` is an unsigned integer followed by an optional space and the string "hpm" (meaning "hits per minute") or "hps" (meaning "hits per second").

  Examples:

  `50hpm` - 50 hits per minute

  `300 hps` - 300 hits per second

- **`tags`** <sub><sup>*Optional*</sup></sub> - Key/value string/[template](./common-types.md#templates) pairs.

  Tags are a series of key/value pairs used to distinguish each endpoint. Tags can be used to include certain endpoints in a [`try` run](../cli.md#Command-line-options), and also make it possible for a single endpoint to have its results statistics aggregated in multiple groups. Because tag values are [templates](./common-types.md#templates) only tags which can be resolved statically at the beginning of a test can be used with the `include` flag of a `try` run. A reference to a provider can cause a single endpoint to have multiple groups of tags. Each one of these groups will have its own statistics in the results. For example if an endpoint had the following tags:

  ```
    tags:
      name: Subscribe
      status: ${response.status}
  ```

  A new group of aggregated stats will be created for every status code returned by the endpoint.
  
  All endpoints have the following implicitly defined tags:

  | Name | Description |
  | - | - |
  | `method` | The HTTP method for the endpoint. |
  | `url` | The endpoint's url with any dynamic pieces being replaced with an asterisk. |
  | `_id` | The index of this endpoint in the list of endpoints, starting with 0. |

  Of the implicitly defined tags only `url` can be overwritten which is helpful in cases such as when an entire url is dynamically generated and it would otherwise show up as `*`.
- **`url`** - A [template](./common-types.md#templates) specifying the fully qualified url to the endpoint which will be requested.
- **`provides`** <sub><sup>*Optional*</sup></sub> - See the [provides subsection](#provides-subsection)
- **`on_demand`** <sub><sup>*Optional*</sup></sub> - A boolean which indicates that this endpoint should only be called when another endpoint first needs data that this endpoint provides. If the endpoint has no `provides` it has no affect.
- **`logs`** <sub><sup>*Optional*</sup></sub> - See the [logs subsection](#logs-subsection)
- **`max_parallel_requests`** <sub><sup>*Optional*</sup></sub> - Limits how many requests can be "open" at any point for the endpoint. *WARNING*: this can cause coordinated omission, invalidating the test statistics.
- **`no_auto_returns`** <sub><sup>*Optional*</sup></sub> - A boolean which indicates that any `auto_return` providers referenced within this endpoint will have `auto_return` disabled--meaning values pulled from those providers will not be automatically pushed back to the provider after a response is received. Defaults to `false`.
- **`request_timeout`** <sub><sup>*Optional*</sup></sub> - A [duration](./common-types.md#duration) signifying how long a request will wait for a response before it times out. When not specified, the value from the [client config](./config-section.md#client) will be used.

## Using providers to build a request
Providers can be referenced anywhere [templates](./common-types.md#templates) can be used and also in the `declare` subsection.

## body subsection
<pre>
body: <i>template</i>
</pre>

<pre>
body:
  file: <i>template</i>
</pre>

<pre>
body:
  multipart: 
    <i>field_name</i>:
      [headers: <i>headers</i>]
      body: <i>template</i>
    <i>field_name</i>:
      [headers: <i>headers</i>]
      body:
        file: <i>template</i>
</pre>

A request body can be in one of three formats: a [template](./common-types.md#templates) to send a string as the body, a file which will send the contents of a file as the body, or a multipart body.

To send the contents of a file the body parameter should be an object with a single key of `file` and the value being a template. Relative paths resolve relative to the config file used to execute pewpew.

To send a multipart body, the body parameter should be an object with a single key of `multipart` and the value being an object of key/value pairs, where each key/value pair represents a piece of the multipart body. The keys represent the *field_name*s used in an HTML form and the values are objects with the following properties:
  - **`headers`** <sub><sup>*Optional*</sup></sub> - [Headers](./common-types.md#headers) that will be included with this piece of the multipart body. For example, it is not uncommon to include a `content-type` header with a piece of a multipart body which includes a file.
  - **`body`** - Either a [template](./common-types.md#templates) which will send a string value or an object with a single key of `file` and the value being a [template](./common-types.md#templates)--which will send the contents of a file.

When a multipart body is used for an endpoint each request will have the `content-type` header added with the value `multipart/form-data` and the necessary boundary. If there is already a `content-type` header set for the request it will be overwritten unless it is starts with `multipart/`--then the necessary boundary will be appended. If a `multipart/...` `content-type` is manually set with the request, make sure to not include a `boundary` parameter.

For any request which has a `content-type` of `multipart/form-data`, a `Content-Disposition` header will be added to each piece in the multipart body with a value of <code>form-data; name="<i>field_name</i>"</code> (where *field_name* is substituted with the piece's *field_name*). If a `Content-Disposition` header is explicitly specified for a piece it will not be overwritten.
  
File example:

```
body:
  file: a_file.txt
```

Multipart example:
```
body:
  multipart:
    foo:
      headers:
        Content-Type: image/jpeg
      body:
        file: foo.jpg
    bar:
      body: some text
```

## declare subsection
<pre>
declare:
  <i>name</i>: <i>expression</i>
</pre>

A *declare_subsection* provides the ability to select multiple values from a single provider. Without using a *declare_subsection*, multiple references to a provider will only select a single value. For example, in:

```yaml
endpoints:
  - method: PUT
    url: https://localhost/ship/${shipId}/speed
    body: '{"shipId":"${shipId}","kesselRunTime":75}'
```

both references to the provider `shipId` will resolve to the same value, which in many cases is desired.

The *declare_subsection* is in the format of key/value pairs where the value is an expression. Every key can function as a provider and can be interpolated just as a provider would be.

### Example 1
```yaml
endpoints:
  - declare:
      shipIds: collect(shipId, 3, 5)
    method: DELETE
    url: https://localhost/ships
    body: '{"shipIds":${shipIds}}'
```
Calls the endpoint `DELETE /ships` where the body is interpolated with an array of ship ids. `shipIds` will have a length between three and five.

### Example 2

```yaml
endpoints:
  - declare:
      destroyedShipId: shipId
    method: PUT
    url: https://localhost/ship/${shipId}/destroys/${destroyedShipId}
```
Calls `PUT` on an endpoint where `shipId` and `destroyedShipId` are interpolated to different values.


## provides subsection
<pre>
provides:
  <i>provider_name</i>:
    select: <i>select</i>
    [for_each: <i>for_each</i>]
    [where: <i>expression</i>]
    [send: block | force | if_not_full]
</pre>

The *provides_subsection* is how data can be sent to a provider from an HTTP response. *provider_name* is a reference to a provider which must be declared in the root [providers section](./providers-section.md). For every HTTP response that is received, zero or more values can be sent to the provider based upon the conditions specified.

Sending data to a provider is done with a SQL-like syntax. The `select`, `for_each` and `where` sections use [expressions](./common-types/expressions.md) to reference providers in addition to the special variables "request", "response" and "stats". "request" provides a means of accessing data that was sent with the request, "response" provides a means of accessing data returned with the response and "stats" give access to measurements about the request (currently only `rtt` meaning round-trip time).

The request object has the properties `start-line`, `method`, `url`, `headers` and `body` which provide access to the respective sections in the HTTP request. Similarly, the response object has the properties `start-line`, `headers`, and `body` in addition to `status` which indicates the HTTP response status code. See [this MDN article](https://developer.mozilla.org/en-US/docs/Web/HTTP/Messages) on HTTP messages for more details on the structure of HTTP requests and responses.

`start-line` is a string and `headers` is represented as a JSON object with key/value string pairs. Currently, `body` in the request is always a string and `body` in the response is parsed as a JSON value, when possible, otherwise it is a string. `status` is a number. `method` is a string and `url` is an object with the same properties as the web URL object (see [this MDN article](https://developer.mozilla.org/en-US/docs/Web/API/URL)). 

- **`select`** - Determines the shape of the data sent to the provider. `select` is interpreted as a JSON object where any string value is evaluated as an [expression](./common-types/expressions.md).

- **`for_each`** <sub><sup>*Optional*</sup></sub> - Evaluates `select` for each element in an array or arrays. This is specified as an array of [expressions](./common-types/expressions.md). Expressions can evaluate to any JSON data type, but those which evaluate to an array will have each of their elements iterated over and `select` is evaluated for each. When multiple expressions evaluate to an array then the cartesian product of the arrays is produced.

  The `select` and `where` parameters can access the elements provided by `for_each` through the value `for_each` just like accessing a value from a provider. Because a `for_each` can iterate over multiple arrays, each element can be accessed by indexing into the array. For example `for_each[1]` would access the element from the second array (indexes are referenced with zero based counting so `0` represents the element in the first array).
- **`where`** <sub><sup>*Optional*</sup></sub> - Allows conditionally sending data to a provider based on a predicate. This is an [expression](./common-types/expressions.md) which evaluates to a boolean value, indicating whether `select` should be evaluated for the current data set.
- **`send`** <sub><sup>*Optional*</sup></sub> - Specify the behavior that should be used when sending data to a provider. Valid options for this parameter are `block`, `force`, and `if_not_full`. Defaults to `if_not_full` if the endpoint has a `peak_load` otherwise `block`.

  `block` indicates that if the provider's buffer is full, further endpoint calls will be blocked until there's room in the provider's buffer for the value. If an endpoint has multiple provides which are `block`, then the blocking will only wait for at least one of the providers' buffers to have room.
  
  `force` indicates that the value will be sent to the provider regardless of whether its buffer is "full". This can make a provider's buffer exceed its soft limit.
  
  `if_not_full` indicates that the value will be sent to the provider only if the provider is not full.

### Example 1
With an HTTP response with the following body

```json
{ "session": "abc123" }
```

and a provides section defined as:

```yaml
provides:
  session:
    select: response.body.session
    where: response.status < 400
```

the `session` provider would be given the value `"abc123"` if the status code was less than 400 otherwise nothing would be sent to the `session` provider.

### Example 2
With an HTTP response with the following body:

```json
{
  "characters": [
    {
      "type": "Human",
      "id": "1000",
      "name": "Luke Skywalker",
      "friends": ["1002", "1003", "2000", "2001"],
      "appearsIn": [4, 5, 6],
      "homePlanet": "Tatooine",
    },
    {
      "type": "Human",
      "id": "1001",
      "name": "Darth Vader",
      "friends": ["1004"],
      "appearsIn": [4, 5, 6],
      "homePlanet": "Tatooine",
    },
    {
      "type": "Droid",
      "id": "2001",
      "name": "R2-D2",
      "friends": ["1000", "1002", "1003"],
      "appearsIn": [4, 5, 6],
      "primaryFunction": "Astromech",
    }
  ]
}
```

and our provides section is defined as:

```yaml
provides:
  names:
    select:
      name: for_each[0].name
    for_each:
      - response.body.characters
```

The `names` provider would be sent the following values: `{ "name": "Luke Skywalker" }`, `{ "name": "Darth Vader" }`, `{ "name": "R2-D2" }`.

### Example 3
It is also possible to access the length of an array by accessing the `length` property.

Using the same response data from example 2, with a provides section defined as:

```yaml
provides:
  friendsCount:
    select:
      id: for_each[0]
      count: for_each[0].friends.length
    for_each:
      - response.body.characters
```

The `friendsCount` provider would be sent the following values: `{ "id": 1000, "count": 4 }`, `{ "id": 1001, "count": 1 }`, `{ "id": 2001, "count": 3 }`.

## logs subsection
<pre>
logs:
  <i>logger_name</i>:
    select: <i>select</i>
    [for_each: <i>for_each</i>]
    [where: <i>expression</i>]
</pre>

The *logs_subsection* provides a means of sending data to a logger based on the result of an HTTP response. *logger_name* is a reference to a logger which must be declared in the root [loggers section](./loggers-section.md). It is structured in the same way as the [*provides_subsection*](#provides-subsection) except there is no explicit *send* parameter. When data is sent to a logger it has the same behavior as `send: block`, which means logging data can potentially block further requests from happening if a logger were to get "backed up". This is unlikely to be a problem unless a large amount of data was consistently logged. It is also possible to log to the same logger multiple times in a single endpoint by repeating the *logger_name* with a new `select`.

- **`select`** - Determines the shape of the data sent into the logger.
- **`for_each`** <sub><sup>*Optional*</sup></sub> - Evaluates `select` for each element in an array or arrays.
- **`where`** <sub><sup>*Optional*</sup></sub> - Allows conditionally sending data into a logger based on a predicate.