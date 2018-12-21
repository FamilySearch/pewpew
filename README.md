# Pewpew
## Getting started
1) Grab the latest binary from the release tab, or [go here](https://github.com/fs-eng/SystemTestTools/releases/latest).
2) Create your config file.
3) Execute your test from the command line with `./pewpew loadtest.yaml` (Linux) or `pewpew.exe loadtest.yaml` (Windows).
4) View the results using the viewer (found in the [pewpew-results-viewer/dist/](../pewpew-results-viewer/dist)) by opening index.html from your local machine in your browser and dragging the results file onto the page, or by using the file selector button.

## Linux tuning
To get maximum throughput on Linux consider the following tweaks. (These have been tested in Ubuntu 18.04 and may be different in other distributions).

Append the following to `/etc/sysctl.conf`:

```
fs.file-max = 999999
net.ipv4.tcp_rmem = 4096 4096 16777216
net.ipv4.tcp_wmem = 4096 4096 16777216
net.ipv4.ip_local_port_range = 1024 65535
```

Append the following to `/etc/security/limits.conf`:
```
*               -       nofile         999999
```

## Config file
The pewpew executable requires a single parameter specifying the path to a load test config file. A config file is yaml with a particular schema. Here's a simple example:

```yaml
load_pattern:
  - linear:
      to: 100%
      over: 5m
  - linear:
      to: 100%
      over: 2m
endpoints:
  - method: GET
    url: http://localhost/foo
    peak_load: 42hpm
    headers:
      Accept: text/plain
  - method: GET
    url: http://localhost/bar
    headers:
      Accept-Language: en-us
      Accept: application/json
    peak_load: 15hps
```

The above config file tells pewpew to hit two HTTP endpoints with particular loads. The entire test will last seven minutes where the first five minutes will be scaling up to "100%" and the last two minutes will stay steady at "100%". For the first endpoint "100%" means 42 hits per minute and for the second it means 15 hits per second.

A config file can have five main sections.

### config <sub><sup>*Optional**</sup></sub>
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

The `config` section provides a means of customizing different parameters for the test. Parameters are broken up into two separate sections, `client` which pertain to customizations for the HTTP client and `general` which are other miscelaneous settings for the test.

#### client
- **`request_timeout`** <sub><sup>*Optional*</sup></sub> - A [duration](#Duration) signifying how long a request will wait before it times out. Defaults to 60 seconds.
- **`headers`** <sub><sup>*Optional*</sup></sub> - [Headers](#Headers) which will be sent in every request. A header specified in an endpoint will override a header specified here with the same key.
- **`keepalive`** <sub><sup>*Optional*</sup></sub> - The keepalive [duration](#Duration) that will be used on TCP socket connections. This is different from the `Keep-Alive` HTTP header. Defaults to 90 seconds.

#### general
- **`auto_buffer_start_size`** <sub><sup>*Optional*</sup></sub> - The starting size for provider buffers which are `auto` sized. Defaults to 5.
- **`bucket_size`** <sub><sup>*Optional*</sup></sub> - A [duration](#Duration) specifying how big each bucket should be for endpoints' aggregated stats. This also affects how often summary stats will be printed to the console. Defaults to 60 seconds.
- **`summary_output_format`** <sub><sup>*Optional*</sup></sub> - The format that the summary stats will be when they are printed to the console. Can be either `pretty` or `json`. Defaults to `pretty`.

### load_pattern <sub><sup>*Optional**</sup></sub>
---
<pre>
load_pattern:
  - <i>load_pattern_type</i>
      [parameters]
</pre>

\* If a root level `load_pattern` is not specified then each endpoint *must* specify its own `load_pattern`.

This section defines the "shape" that the generated traffic will take over the course of the test. Individual endpoints can choose to specify their own `load_pattern` (see the [`endpoints` section](#endpoints)).

`load_pattern` is an array of *load_pattern_type*s specifying how generated traffic for a segment of the test will scale up, down or remain steady. Currently the only *load_pattern_type* supported is `linear`.

Example:
```yaml
load_pattern:
  - linear:
      to: 100%
      over: 5m
  - linear:
      to: 100%
      over: 2m
```

#### linear
---
The linear *load_pattern_type* allows generated traffic to increase or decrease linearly. There are three parameters which can be specified for each linear segment:

- **`from`** <sub><sup>*Optional*</sup></sub> - The starting point this segment will scale from, specified as a percentage. Defaults to `0%` if the current segment is the first entry in `load_pattern`, or the `to` value in the previous segment.

  A valid percentage is any unsigned number, integer or decimal, immediately followed by the percent symbol (`%`). Percentages can exceed `100%` but cannot be negative. For example `15.25%` or `150%`. 
- **`to`** - The end point this segment should scale to, specified as a percentage.
- **`over`** - The [duration](#Duration) for how long this segment should last.
  

### providers <sub><sup>*Optional*</sup></sub>
---
<pre>
providers:
  <i>provider_name</i>:
    <i>provider_type</i>:
      [parameters]
</pre>

Providers are the means of providing data to an endpoint, including using data from the response of one endpoint in the request of another. The way providers handle data can be thought of as a FIFO queue. Every provider has an internal buffer which has a soft limit on how many items can be stored.

A *provider_name* is any string except for "request", "response", "stats" and "for_each", which are reserved.

Example:
```yaml
providers:
  - session:
    - endpoint:
        auto_return: force
  - username:
    - file:
      path: "usernames.csv"
      repeat: true
```
There are six *provider_type*s:

#### file
The `file` *provider_type* reads data from a file. Every line in the file is read as a value. In the future, the ability to specify the format of the data (csv, json, etc) may be implemented. A `file` provider has the following parameters:

- **`path`** - A string value indicating the path to the file on the file system. Currently, a relative path is interpreted as being relative to the current working directory where `pewpew` was executed from. In the future this may be changed to be relative to the location of the config file.
- **`repeat`** - <sub><sup>*Optional*</sup></sub> A boolean value which when `true` indicates when the provider `file` provider gets to the end of the file it should start back at the beginning. Defaults to `false`.
- **`auto_return`** <sub><sup>*Optional*</sup></sub> - This parameter specifies that when this provider is used and an individual endpoint call concludes, the value it got from this provider should be sent back to the provider. Valid options for this parameter are `block`, `force`, and `if_not_full`. See the `send` parameter under the [provides section](#provides) for details on the effect of these options.
- **`buffer`** <sub><sup>*Optional*</sup></sub> - Specifies the soft limit for a provider's buffer. This can be indicated with an integer greater than zero or the value `auto`. The value `auto` indicates that if the provider's buffer becomes empty it will automatically increase the buffer size to help prevent the provider from being empty. Defaults to `auto`.
- **`format`** <sub><sup>*Optional*</sup></sub> - Specifies the format for the file. The format can be one of `line` (the default), `json`, or `csv`.
  
  The `line` format will read the file one line at a time with each line ending in a newline (`\n`) or a carriage return and a newline (`\r\n`). Every line will attempt to be parsed as JSON, but if it is not valid JSON it will be a string. Note that a JSON object which spans multiple lines in the file, for example, will not parse into a single object.

  The `json` format will read the file as a stream of JSON values. Every JSON value must be self-delineating (an object, array or string), or must be separated by whitespace or a self-delineating value. For example, the following:

  ```json
  {"a":1}{"foo":"bar"}47[1,2,3]"some text"true 56
  ```

  Would parse into separate JSON values of `{"a": 1}`, `{"foo": "bar"}`, `47`, `[1, 2, 3]`, `"some text"`, `true`, and `56`.

  The `csv` format will read the file as a CSV file. Every non-header column will attempt to be parsed as JSON, but if it is not valid JSON it will be a string. The `csv` parameter allows customization over how the file should be parsed.
- **`csv`** <sub><sup>*Optional*</sup></sub> - When parsing a file using the `csv` format, this parameter provides extra customization on how the file should be parsed. This parameter is in the format of an object with key/value pairs. If the format is not `csv` and this property is provided, it will be ignored.
  The following sub-parameters are available:

  <table>
  <thead>
  <tr>
  <th>Sub-parameter</th>
  <th>Description</th>
  </tr>
  </thead>
  <tbody>
  <tr>
  <td>

  comment <sub><sup>*Optional*</sup></sub>

  </td>
  <td>

  Specifies a single-byte character which will mark a CSV record as a comment (ex. `#`). When not specified, no character is treated as a comment.

  </td>
  </tr>
  <tr>
  <td>

  delimiter <sub><sup>*Optional*</sup></sub>
  </td>
  <td>

  Specifies a single-byte character used to separate columns in a record. Defaults to comma (`,`).

  </td>
  </tr>
  <tr>
  <td>

  double_quote <sub><sup>*Optional*</sup></sub>

  </td>
  <td>

  A boolean that when enabled makes it so two quote characters can be used to escape quotes within a column. Defaults to `true`.

  </td>
  </tr>
  <tr>
  <td>

  escape <sub><sup>*Optional*</sup></sub>

  </td>
  <td>

  Specifies a single-byte character which will be used to escape nested quote characters (ex. `\`). When not specified, escapes are disabled.

  </td>
  </tr>
  <tr>
  <td>

  headers <sub><sup>*Optional*</sup></sub>

  </td>
  <td>

  Specifies a single-byte character which will be used to escape nested quote characters (ex. `\`). When not specified, escapes are disabled.

  Can be either a boolean value or a string. When a boolean, it indicates whether the first row in the file should be interpreted as column headers. When a string, the specified string is interpreted as a CSV record which is used for the column headers.

  When headers are specified, each record served from the file will use the headers as keys for each column. When no headers are specified (the default), then each record will be returned as an array of values.

  For example, with the following CSV file:

  ```csv
  id,name
  0,Fred
  1,Wilma
  2,Pebbles
  ```

  If `headers` was `true` than the following values would be provided (shown in JSON syntax): `{"id": 0, name: "Fred"}`, `{"id": 1, name: "Wilma"}`, and `{"id": 3, name: "Pebbles"}`.

  If `headers` was `false` than the following values would be provided: `[0, "Fred"]`, `[1, "Wilma"]`, and `[2, "Pebbles"]`.

  If `headers` was `foo,bar` than the following values would be provided: `{"foo": "id", "bar": "name"}`, `{"foo": 0, "bar": "Fred"}`, `{"foo": 1, "bar": "Wilma"}`, and `{"foo": 3, "bar": "Pebbles"}`.

  </td>
  </tr>
  <tr>
  <td>

  terminator <sub><sup>*Optional*</sup></sub>

  </td>
  <td>

  Specifies a single-byte character used to terminate each record in the CSV file. Defaults to a special value where `\r`, `\n`, and `\r\n` are all accepted as terminators.

  When specified, pewpew becomes self-aware, unfolding a series of events which will ultimately lead to the end of the human race.

  </td>
  </tr>
  <tr>
  <td>

  quote <sub><sup>*Optional*</sup></sub>
  
  </td>
  <td>

  Specifies a single-byte character that will be used to quote CSV columns. Defaults to the double-quote character (`"`).
  
  </td>
  </tr>
  </tbody>
  </table>

- **`random`** <sub><sup>*Optional*</sup></sub> - A boolean indicating that each record in the file should be returned in random order. Defaults to `false`.

  When used with `repeat` set to `true` there is no sense of "fairness" in the randomization. Any record in the file could be used more than once before other records are used.

#### response
Unlike other *provider_type*s `response` does not automatically receive data from a source. Instead a `response` provider is available to be a "sink" for data originating from an HTTP response. The `response` provider has the following parameters.

- **`auto_return`** <sub><sup>*Optional*</sup></sub> - This parameter specifies that when this provider is used and an individual endpoint call concludes, the value it got from this provider should be sent back to the provider. Valid options for this parameter are `block`, `force`, and `if_not_full`. See the `send` parameter under the [provides section](#provides) for details on the effect of these options.
- **`buffer`** <sub><sup>*Optional*</sup></sub> - Specifies the soft limit for a provider's buffer. This can be indicated with an integer greater than zero or the value `auto`. The value `auto` indicates that if the provider's buffer becomes empty it will automatically increase the buffer size to help prevent the provider from being empty. Defaults to `auto`.

#### static
The `static` *provider_type* is used for having a single pre-defined value used throughout a test. A `static` provider will make copies of the value every time a value is required from the provider. When defining a `static` provider the only parameter is the literal value which should be used.

For example:
```yaml
providers:
  foo:
    static: bar
```

creates a single `static` provider named `foo` where the value is the string "bar".

More complex values are automatically interpreted as JSON so the following:
```yaml
providers:
  bar:
    static:
      a: 1
      b: 2
      c: 3
```

creates a `static` provider named `bar` where the value is equivalent to the JSON `{"a": 1, "b": 2, "c": 3}`.

#### static_list
The `static_list` *provider_type* is like the `static` *provider_type* except an array of values can be specified and the provider will iterate infinitely over the array using each element as the value to be provided.

The following:
```yaml
providers:
  foo:
    static_list:
      - 123
      - 456
      - 789
```

creates a `static_list` provider named `foo` where the first value provided will be `123`, the second `456`, third `789` then for subsequent values it will start over at the beginning.

#### environment
The `environment` *provider_type* behaves exactly like the `static` *provider_type* except the value comes from an environment variable. The value coming from the referenced environment variable will be parsed as JSON if possible, otherwise it will be a string.

#### range
The `range` *provider_type* provides an incrementing sequence of numbers in a given range. A `range` provider takes three optional parameters.

- **`start`** <sub><sup>*Optional*</sup></sub> - A whole number in the range of [-9223372036854775808, 9223372036854775807]. This indicates what the starting number should be for the range. Defaults to `0`.
- **`end`** <sub><sup>*Optional*</sup></sub> - A whole number in the range of [-9223372036854775808, 9223372036854775807]. This indicates what the maximum number should be for the range. This number is included in the range. Defaults to `9223372036854775807`.
- **`step`** <sub><sup>*Optional*</sup></sub> - A whole number in the range of [1, 65535]. This indicates how much the range will increment by. Defaults to `1`.

Examples:
```yaml
providers:
  foo:
    range: {}
```

Will use the default settings and `foo` will provide the values `0`, `1`, `2`, etc. until it yields the end number (`9223372036854775807`).

```yaml
providers:
  foo:
    range:
      start: -50
      end: 100
      step: 2
```

In this case `foo` will provide the valuels `-50`, `-48`, `-46`, etc. until it yields `100`.

### loggers <sub><sup>*Optional*</sup></sub>
---
<pre>
loggers:
  <i>logger_name</i>:
    [select: <i>select_piece</i>]
    [for_each: <i>for_each_piece</i>]
    [where: <i>where_piece</i>]
    to: <i>filename</i> | stderr | stdout
    [pretty: <i>boolean</i>]
    [limit: <i>integer</i>]
</pre>
Loggers provide a means of logging data to a file, stderr or stdout. Any string can be used for *logger_name*.

There are two types of loggers: plain loggers which have data logged to them by explicitly referencing them within an `endpoints.log` section, and global loggers which are evaluated for every endpoint response and cannot be explicitly specified within an `endpoints.log` section.

Loggers support the following parameters:
- **`select`** <sub><sup>*Optional*</sup></sub> - When specified, the logger becomes a global logger. See the [`endpoints.provides` section](#provides) for details on how to define a *select_piece*.
- **`for_each`** <sub><sup>*Optional*</sup></sub> - Used in conjunction with `select` on global loggers.  See the [`endpoints.provides` section](#provides) for details on how to define a *for_each_piece*.
- **`where`** <sub><sup>*Optional*</sup></sub> - Used in conjunction with `select` on global loggers.  See the [`endpoints.provides` section](#provides) for details on how to define a *where_piece*.
- **`to`** - A string specifying where this logger will send its data. Values of "stderr" and "stdout" will log data to the respective process streams and any other string will log to a file with that name. Currently files are created in the current working directory where the pewpew process was launched from. When a file is specified, the file will be created if it does not exist or will be truncated if it already exists.
- **`pretty`** <sub><sup>*Optional*</sup></sub> - A boolean that when `true` the value logged will have added whitespace for readability. Defaults to `false`.
- **`limit`** <sub><sup>*Optional*</sup></sub> - An unsigned integer which indicates the logger will only log the first *n* values sent to it.

Example:
```yaml
loggers:
  http_errors:
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

Creates a global logger named "http_errors" which will log to the file "http_err.log" the request and response of the first five requests which have an HTTP status of 400 or greater.

### endpoints
---
<pre>
endpoints:
  - [declare: <i>declare_section</i>]
    [headers: <i>headers</i>]
    [body: <i>body</i>]
    [load_pattern: <i>load_pattern_section</i>]
    [method: <i>method</i>]
    [peak_load: <i>peak_load</i>]
    [stats_id: <i>stats_id</i>]
    url: <i>url</i>
    [provides: <i>provides_section</i>]
    [logs: <i>logs_section</i>]
</pre>
The `endpoints` section declares what HTTP endpoints will be called during a test.

- **`declare`** <sub><sup>*Optional*</sup></sub> - See the [declare section](#declare)
- **`headers`** <sub><sup>*Optional*</sup></sub> - See [headers](#Headers)
- **`body`** <sub><sup>*Optional*</sup></sub> - A [template string](#Template) indicating the body that should be sent with the request.
- **`load_pattern`** <sub><sup>*Optional*</sup></sub> - See the [load_pattern section](#load_pattern-optional)
- **`method`** <sub><sup>*Optional*</sup></sub> - A string representation for a valid HTTP method verb. Defaults to `GET`
- **`peak_load`** <sub><sup>*Optional**</sup></sub> - A string representing what the "peak load" for this endpoint should be. The term "peak load" represents what a `load_pattern` value of `100%` represents for this endpoint. A `load_pattern` can go higher than `100%`, so a `load_pattern` of `200%`, for example, would mean it would go double the defined `peak_load`.

  \* While `peak_load` is marked as *optional* that is only true if the current endpoint has a *provides_section*, and in that case this endpoint is called only as frequently as needed to keep the buffers of the providers it feeds full.

  A valid `load_pattern` is an unsigned integer followed by an optional space and the string "hpm" (meaning "hits per minute") or "hps" (meaning "hits per second").

  Examples:

  `50hpm` - 50 hits per minute

  `300 hps` - 300 hits per second

- **`stats_id`** <sub><sup>*Optional*</sup></sub> - Key/value string pairs indicating additional keys which will be added to an endpoint's stats identifier. A stats identifier is a series of key/value pairs used to identify each endpoint. This makes it easier to distinguish endpoints in a test with several endpoints. By default every endpoint has a stats identifier of the HTTP method and the immutable parts of the url.

  In most cases it is not nececessary to specify additional key/value pairs for the `stats_id`, but it can be helpful if multiple endpoints have the same url and method pair and the default `stats_id` is not descriptive enough.
- **`url`** - A [template string](#Template) specifying the fully qualified url to the endpoint which will be requested.
- **`provides`** <sub><sup>*Optional*</sup></sub> - See the [provides section](#provides)
- **`logs`** <sub><sup>*Optional*</sup></sub> - See the [logs section](#logs)

#### Referencing Providers
Providers can be referenced anywhere [templates](#Template) can be used and also in the `declare` parameter as a value.

#### declare
<pre>
declare:
  <i>name</i>: <i>provider_name</i> | collect(<i>collect_args</i>)
</pre>
A *declare_section* provides the ability to select multiple values from a single provider. Without using a *declare_section*, multiple references to a provider will only select a single value. For example, in:

```yaml
endpoints:
  - method: PUT
    url: https://localhost/ship/{{shipId}}/speed
    body: '{"shipId":"{{shipId}}","kesselRunTime":75}'
```

both references to the provider `shipId` will resolve to the same value, which in many cases is desired.

The *declare_section* is in the format of key/value string pairs. Every key can function as a provider and can be interpolated just as a provider would be. Values can be in one of two formats:
1) a string which is a reference to a provider
2) a call to the `collect` function. The `collect` function "collects" multiple values from a provider into an array. `collect` can be called with two or three arguments in the format <code>collect(*n*, *provider_name*)</code> or <code>collect(*min*, *max*, *provider_name*)</code>. The two argument form creates an array of size *n* with values from a provider. The three argument form creates an array with a randomly selected size between *min* and *max* (both *min* and *max* are inclusive) with values from a provider.

##### Example 1
```yaml
endpoints:
  - declare:
      shipIds: collect(3, 5, shipId)
    method: DELETE
    url: https://localhost/ships
    body: '{"shipIds":{{shipIds}}}'
```
Calls the endpoint `DELETE /ships` where the body is interpolated with an array of ship ids. `shipIds` will have a length between three and five.

##### Example 2

```yaml
endpoints:
  - declare:
      destroyedShipId: shipId
    method: PUT
    url: https://localhost/ship/{{shipId}}/destroys/{{destroyedShipId}}
```
Calls `PUT` on an endpoint where `shipId` and `destroyedShipId` are interpolated to different values.


#### provides
<pre>
provides:
  <i>provider_name</i>:
    select: <i>select_piece</i>
    [for_each: <i>for_each_piece</i>]
    [where: <i>where_piece</i>]
    [send: block | force | if_not_full]
</pre>
The *provides_section* is how data can be sent to a provider from an HTTP response. *provider_name* is a reference to a provider which must be declared in the root [`providers` section](#providers-optional). For every HTTP response that is received, zero or more values can be sent to the provider based upon the conditions specified.

Sending data to a provider is done with a SQL-like syntax. The `select`, `for_each` and `where` sections can reference a provider in addition to the specially provided values "request", "response" and "stats". "request" provides a means of accessing data that was sent with the request, "response" provides a means of accessing data returned with the response and "stats" give access to measurements about the request (currently only `rtt` meaning round-trip time).

The request object has the properties `start-line`, `method`, `url`, `headers` and `body` which provide access to the respective sections in the HTTP request. Similarly, the response object has the properties `start-line`, `headers`, and `body` in addition to `status` which indicates the HTTP response status code. See [this MDN article](https://developer.mozilla.org/en-US/docs/Web/HTTP/Messages) on HTTP messages for more details on the structure of HTTP requests and responses.

`start-line` is a string and `headers` is represented as a JSON object with key/value string pairs. Currently, `body` in the request is always a string and `body` in the response is parsed as a JSON value, when possible, otherwise it is a string. `status` is a number. `method` is a string and `url` has the same properties as the web URL object (See [this MDN article](https://developer.mozilla.org/en-US/docs/Web/API/URL)). 

- **`select`** - Determines the shape of the data sent to the provider. `select` is interpreted as a JSON object where any string value is expected to be an expression..

- **`for_each`** <sub><sup>*Optional*</sup></sub> - Evaluates `select` for each element in an array or arrays. This is specified as an array of strings where each string is an expression. Expressions can evaluate to any JSON data type, but those which evaluate to an array will have each of their elements iterated over and `select` is evaluated for each. When multiple expressions evaluate to an array then the cartesian product of the arrays is produced.

  The `select` and `where` parameters can access the elements provided by `for_each` through the value `for_each` just like accessing a value from a provider. Because `for_each` can be iterating over multiple arrays, each value can be accessed by indexing into the array. For example `for_each[1]` would access the element from the second array (indexes are referenced with zero based counting so `0` represents the element in the first array).
- **`where`** <sub><sup>*Optional*</sup></sub> - Allows conditionally sending data to a provider based on a predicate. This is a string expression which evaluates to a boolean value, indicating whether `select` should be evaluated for the current data set.

  A `where` expression can be as simple as `response.status == 200` or more complex expressions can be formed using `&&` (boolean and), `||` (boolean or) and parenthesis to group sub-expressions. The following comparison operators are available:

  Operator | Description
  --- | --- 
  `==` | Equal. Check that two values are equal to each other
  `!=` | Not equal. Check that two values are not equal to each other
  `>` | Greater than. Check that the left value is greater than the right
  `<` | Less than. Check that the left value is less than the right
  `>=` | Greater than or equal to. Check that the left value is greater than or equal to the right
  `<=` | Less than or equal to. Check that the left value is less than or equal to the right
- **`send`** <sub><sup>*Optional*</sup></sub> - Specify the behavior that should be used when sending data to a provider. Valid options for this parameter are `block`, `force`, and `if_not_full`.

  `block` indicates that if the provider's buffer is full, further endpoint calls will be blocked until there's room in the provider's buffer for the value.
  
  `force` indicates that the value will be returned to the provider regardless of whether its buffer is "full". This can make a provider's buffer exceed its soft limit.
  
  `if_not_full` indicates that the value will be returned to the provider only if the provider is not full.

While boolean style expressions are especially useful in a `where` expression they can be used in `select` and `for_each` expressions as well. Additionally there are special functions which are especially helpful in a `for_each` expression but can be used elsewhere.

Function | Description
--- | ---
<code>json_path(*query*)</code> | Provides the ability to execute a json path expression against an object and returns an array of values. The query must be quoted. Example: `json_path("response.body.ships.*.ids")`
<code>repeat(*n*)</code> | Creates an array of null values with a length of *n*. This is useful when used within a `for_each` expression to have the `select` expression evaluated multiple times. Example: `repeat(10)`

##### Example 1
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

##### Example 2
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
      name: for_each[0]
    for_each:
      - json_path("request.body.*.name")
```

The `names` provider would be sent the following values: `{ "name": "Luke Skywalker" }`, `{ "name": "Darth Vader" }`, `{ "name": "R2-D2" }`.

##### Example 3
It is also possible to access the length of an array by accessing the `length` property.

Using the same response data from example 2, with a provides section defined as:

```yaml
provides:
  friendsCount:
    select:
      id: for_each[0]
      count: for_each[0].friends.length
    for_each:
      - json_path("request.body.*")
```

The `friendsCount` provider would be sent the following values: `{ "id": 1000, "count": 4 }`, `{ "id": 1001, "count": 1 }`, `{ "id": 2001, "count": 3 }`.

#### logs
<pre>
logs:
  <i>logger_name</i>:
    select: <i>select_piece</i>
    [for_each: <i>for_each_piece</i>]
    [where: <i>where_piece</i>]
</pre>
The *logs_section* provides a means of sending data to a logger based on the result of an HTTP response. *logger_name* is a reference to a logger which must be declared in the root [`logger` section](#loggers-optional). It is structured in the same way as the [*provides_section*](#provides) except there is no explicit *send* parameter. When data is sent to a logger it has the same behavior as `send: block`, which means logging data can potentially block further requests from happening if a logger were to get "backed up". This is unlikely to be a problem unless a large amount of data was consistently logged.

- **`select`** - Determines the shape of the data sent into the logger.
- **`for_each`** <sub><sup>*Optional*</sup></sub> - Evaluates `select` for each element in an array or arrays.
- **`where`** <sub><sup>*Optional*</sup></sub> - Allows conditionally sending data into a logger based on a predicate.

### Common Types
#### Duration
A duration is an integer followed by an optional space and a string value indicating the time unit. Hours can be specified with "h", "hr", "hrs", "hour", or "hours", minutes with "m", "min", "mins", "minute", or "minutes", and seconds with "s", "sec", "secs", "second", or "seconds".

Examples:

`1h` = 1 hour

`30 minutes` = 30 minutes

Multiple duration pieces can be chained together to form more complex durations.

Examples:

`1h45m30s` = 1 hour, 45 minutes and 30 seconds

`4 hrs 15 mins` = 4 hours and 15 minutes

As seen above an optional space can be used to delimit the individual duration pieces.

#### Headers
Key/value pairs where the key is a string and the value is a [template string](#Template) which specify the headers which will be sent with a request.

For example:

```yaml
endpoints:
  url: https://localhost/foo/bar
  headers:
    Authorization: Bearer {{sessionId}}
```
specifies that an "Authorization" header will be sent with the request with a value of "Bearer " followed by a value coming from a provider named "sessionId".

#### Templates
Templates are special string values which can be interpolated with values from providers or by using helper functions. Interpolation is done by enclosing a provider name or helper function in double curly braces. For example: `{{foo}}-bar` creates a string where a value from a provider named foo is interpolated before the string value `-bar`. `{{join baz "."}}` uses the `join` helper (documented below) to create a string value which pulls from a provider named "baz". 

With helper functions the parameters are specified after the function name and are delimited with spaces. String literals arguments must use doublequotes.

The following are the available helper functions:

<table>
<thead>
<tr>
<th>Helper</th>
<th>Description</th>
</tr>
</thead>
<tbody>
<tr>
<td>
<code>encode <i>provider</i> <i>encoding</i></code>
</td>
<td>

Encode a string with the given encoding.

*provider* - a reference to a provider value or one of its properties which is a string.<br/>
*encoding* - The encoding to be used. Encoding must be one of the following string literals:
- `"percent-simple"` - Percent encodes every ASCII character less than hexidecimal 20 and greater than 7E.
- `"percent-query"` - Percent encodes every ASCII character less than hexidecimal 20 and greater than 7E in addition to ` `, `"`, `#`, `>` and `<` (space, doublequote, hash, greater than, and less than).
- `"percent"` - Percent encodes every ASCII character less than hexidecimal 20 and greater than 7E in addition to ` `, `"`, `#`, `>`, `<`, `` ` ``, `?`, `{` and `}` (space, doublequote, hash, greater than, less than, backtick, question mark, open curly brace and close curly brace).
- `"percent-path"` - Percent encodes every ASCII character less than hexidecimal 20 and greater than 7E in addition to ` `, `"`, `#`, `>`, `<`, `` ` ``, `?`, `{`, `}`, `%` and `/` (space, doublequote, hash, greater than, less than, backtick, question mark, open curly brace, close curly brace, percent and forward slash).
- `"percent-userinfo"` - Percent encodes every ASCII character less than hexidecimal 20 and greater than 7E in addition to ` `, `"`, `#`, `>`, `<`, `` ` ``, `?`, `{`, `}`, `%`, `/`, `:`, `;`, `=`, `@`, `\`, `[`, `]`, `^`, and `|` (space, doublequote, hash, greater than, less than, backtick, question mark, open curly brace, close curly brace, percent, forward slash, colon, semi-colon, equal sign, at sign, backslash, open square bracket, close square bracket, caret and pipe).<br/><br/>

**Example**: with the value `foo=bar` from a provider named `baz`, then the string `https://localhost/abc?{{encode baz "percent-userinfo"}}` would resolve to `https://localhost/abc?foo%3Dbar`.

</td>
</tr>
<tr>
<td>
<code>epoch <i>unit</i></code>
</td>
<td>

Returns time since the unix epoch.

*unit* - A string literal of `"s"` (seconds), `"ms"` (milliseconds), `"mu"` (microseconds), or `"ns"` (nanoseconds).

</td>
</tr>
<tr>
<td>
<code>join <i>provider</i> <i>separator</i></code>
</td>
<td>

Turns an array of values into a string.

*provider* - a reference to a provider value or one of its properties which is an array.<br/>
*separator* - a string literal which will be used between each element in the array.

**Example**: with the value `["foo", "bar", "baz"]` from a provider named `qux`, then the string `https://localhost/some/thing?a={{join qux "-"}}` would resolve to `https://localhost/some/thing?a=foo-bar-baz`.

</td>
</tr>
<tr>
<td>
<code>start_pad <i>provider</i> <i>min_length</i> <i>pad_string</i></code>
</td>
<td>

Pads a string or number to be minimum length. Any added padding will be added to the start of the string.

*provider* - a reference to a provider value or one of its properties which is a string or number.<br/>
*min_length* - the minimum length, as a positive integer, that the returned string should be. If the first parameter in string format is less than this amount then padding will be added to it.<br/>
*pad_string* - The padding string to use. If the amount of padding needed is less than the length of this string then it will be truncated from the right. If the needed padding is more than the length of this string, then this string is repeated until it is long enough.

**Example**: with the value `83` from a provider named `foo`, then the string `id={{start_pad foo 6 "0"}}` would resolve to `id=000083`.

</td>
</tr>
<tr>
<td>
<code>end_pad <i>provider</i> <i>min_length</i> <i>pad_string</i></code>
</td>
<td>

Pads a string or number to be minimum length. Any added padding will be added to the end of the string.

*provider* - a reference to a provider value or one of its properties which is a string or number.<br/>
*min_length* - the minimum length, as a positive integer, that the returned string should be. If the first parameter in string format is less than this amount then padding will be added to it.<br/>
*pad_string* - The padding string to use. If the amount of padding needed is less than the length of this string then it will be truncated from the right. If the needed padding is more than the length of this string, then this string is repeated until it is long enough.

**Example**: with the value `"Jones"` from a provider named `lastName`, then the string `{{end_pad lastName 8 "-"}}` would resolve to `Jones---`.

</td>
</tr>
</tbody>
</table>