# endpoints section

<pre>
endpoints:
  - [declare: <i>declare_subsection</i>]
    [headers: <i>headers</i>]
    [body: <i>body</i>]
    [load_pattern: <i>load_pattern_subsection</i>]
    [method: <i>method</i>]
    [peak_load: <i>peak_load</i>]
    [stats_id: <i>stats_id</i>]
    url: <i>template</i>
    [provides: <i>provides_subsection</i>]
    [logs: <i>logs_subsection</i>]
    [alias: <i>string</i>]
    [max_parallel_requests: <i>unsigned integer</i>]
</pre>

The `endpoints` section declares what HTTP endpoints will be called during a test.

- **`declare`** <sub><sup>*Optional*</sup></sub> - See the [declare subsection](#declare-subsection)
- **`headers`** <sub><sup>*Optional*</sup></sub> - See [headers](./common-types.md#headers)
- **`body`** <sub><sup>*Optional*</sup></sub> - Either a [template](./common-types.md#templates) indicating a string that should be sent as the request body, or an object with a key `file` and a value of a [template](./common-types.md#templates) which will evaluate to the name of a file to send as the request body. When a relative path is specified it is interpreted as relative to the config file.
- **`load_pattern`** <sub><sup>*Optional*</sup></sub> - See the [load_pattern section](./load_pattern-section.md)
- **`method`** <sub><sup>*Optional*</sup></sub> - A string representation for a valid HTTP method verb. Defaults to `GET`
- **`peak_load`** <sub><sup>*Optional**</sup></sub> - A string representing what the "peak load" for this endpoint should be. The term "peak load" represents how much traffic is generated for this endpoint when the [load_pattern](./load_pattern-section.md) reaches `100%`. A `load_pattern` can go higher than `100%`, so a `load_pattern` of `200%`, for example, would mean it would go double the defined `peak_load`.

  \* While `peak_load` is marked as *optional* that is only true if the current endpoint has a *provides_subsection*, and in that case this endpoint is called only as frequently as needed to keep the buffers of the providers it feeds full.

  A valid `load_pattern` is an unsigned integer followed by an optional space and the string "hpm" (meaning "hits per minute") or "hps" (meaning "hits per second").

  Examples:

  `50hpm` - 50 hits per minute

  `300 hps` - 300 hits per second

- **`stats_id`** <sub><sup>*Optional*</sup></sub> - Key/value string/[template](./common-types.md#templates) pairs indicating additional keys which will be added to an endpoint's stats identifier. Unlike templates in other places only static providers and environment variables can be interpolated.

  A stats identifier is a series of key/value pairs used to identify each endpoint. This makes it easier to distinguish endpoints in a test with several endpoints. By default every endpoint has a stats identifier of the HTTP method and the url (with the dynamic pieces being replaces with an asterisk).

  In most cases it is not nececessary to specify additional key/value pairs for the `stats_id`, but it can be helpful if multiple endpoints have the same url and method pair and the default `stats_id` is not descriptive enough.
- **`url`** - A [template](./common-types.md#templates) specifying the fully qualified url to the endpoint which will be requested.
- **`provides`** <sub><sup>*Optional*</sup></sub> - See the [provides subsection](#provides-subsection)
- **`logs`** <sub><sup>*Optional*</sup></sub> - See the [logs subsection](#logs-subsection)
- **`alias`** <sub><sup>*Optional*</sup></sub> - Gives this endpoint an alias for the purpose of "try runs". See the [command-line options](../cli.md).
- **`max_parallel_requests`** <sub><sup>*Optional*</sup></sub> - Limits how many requests can be "open" at any point for the endpoint. *WARNING*: this can cause coordinated omission, invalidating the test statistics.

## Using providers to build a request
Providers can be referenced anywhere [templates](./common-types.md#templates) can be used and also in the `declare` subsection.

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

Sending data to a provider is done with a SQL-like syntax. The `select`, `for_each` and `where` sections use [expressions](./common-types/expressions.md) to reference providers in addition to the specially provided values "request", "response" and "stats". "request" provides a means of accessing data that was sent with the request, "response" provides a means of accessing data returned with the response and "stats" give access to measurements about the request (currently only `rtt` meaning round-trip time).

The request object has the properties `start-line`, `method`, `url`, `headers` and `body` which provide access to the respective sections in the HTTP request. Similarly, the response object has the properties `start-line`, `headers`, and `body` in addition to `status` which indicates the HTTP response status code. See [this MDN article](https://developer.mozilla.org/en-US/docs/Web/HTTP/Messages) on HTTP messages for more details on the structure of HTTP requests and responses.

`start-line` is a string and `headers` is represented as a JSON object with key/value string pairs. Currently, `body` in the request is always a string and `body` in the response is parsed as a JSON value, when possible, otherwise it is a string. `status` is a number. `method` is a string and `url` is an object with the same properties as the web URL object (see [this MDN article](https://developer.mozilla.org/en-US/docs/Web/API/URL)). 

- **`select`** - Determines the shape of the data sent to the provider. `select` is interpreted as a JSON object where any string value is evaluated as an [expression](./common-types/expressions.md).

- **`for_each`** <sub><sup>*Optional*</sup></sub> - Evaluates `select` for each element in an array or arrays. This is specified as an array of [expressions](./common-types/expressions.md). Expressions can evaluate to any JSON data type, but those which evaluate to an array will have each of their elements iterated over and `select` is evaluated for each. When multiple expressions evaluate to an array then the cartesian product of the arrays is produced.

  The `select` and `where` parameters can access the elements provided by `for_each` through the value `for_each` just like accessing a value from a provider. Because a `for_each` can iterate over multiple arrays, each element can be accessed by indexing into the array. For example `for_each[1]` would access the element from the second array (indexes are referenced with zero based counting so `0` represents the element in the first array).
- **`where`** <sub><sup>*Optional*</sup></sub> - Allows conditionally sending data to a provider based on a predicate. This is an [expression](./common-types/expressions.md) which evaluates to a boolean value, indicating whether `select` should be evaluated for the current data set.
- **`send`** <sub><sup>*Optional*</sup></sub> - Specify the behavior that should be used when sending data to a provider. Valid options for this parameter are `block`, `force`, and `if_not_full`.

  `block` indicates that if the provider's buffer is full, further endpoint calls will be blocked until there's room in the provider's buffer for the value.
  
  `force` indicates that the value will be returned to the provider regardless of whether its buffer is "full". This can make a provider's buffer exceed its soft limit.
  
  `if_not_full` indicates that the value will be returned to the provider only if the provider is not full.

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