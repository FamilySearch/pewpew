# providers section

<pre>
providers:
  <i>provider_name</i>:
    <i>provider_type</i>:
      [parameters]
</pre>

Providers are the means of providing data to an endpoint, including using data from the response of one endpoint in the request of another. The way providers handle data can be thought of as a FIFO queue--when an endpoint uses data from a provider it "pops" a value from the beginning of the queue and when an endpoint provides data to a provider it is "pushed" to the end of the queue. Every provider has an internal buffer with has a soft limit on how many items can be stored.

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

There are five *provider_type*s: [file](#file), [response](#response), [static](#static), [static_list](#static_list) and [range](#range).

## file
The `file` *provider_type* reads data from a file. Every line in the file is read as a value. In the future, the ability to specify the format of the data (csv, json, etc) may be implemented. A `file` provider has the following parameters:

- **`path`** - A [template](./common-types.md#templates) value indicating the path to the file on the file system. Unlike templates used elsewhere, only environment variables can be interopolated. When a relative path is specified it is interpreted as relative to the config file. Absolute paths are supported though discouraged as they prevent the config file from being platform agnostic.
- **`repeat`** - <sub><sup>*Optional*</sup></sub> A boolean value which when `true` indicates when the provider `file` provider gets to the end of the file it should start back at the beginning. Defaults to `false`.
- **`auto_return`** <sub><sup>*Optional*</sup></sub> - This parameter specifies that when this provider is used and an individual endpoint call concludes, the value it got from this provider should be sent back to the provider. Valid options for this parameter are `block`, `force`, and `if_not_full`. See the `send` parameter under the [endpoints.provides subsection](./endpoints-section.md#provides-subsection) for details on the effect of these options.
- **`buffer`** <sub><sup>*Optional*</sup></sub> - Specifies the soft limit for a provider's buffer. This can be indicated with an integer greater than zero or the value `auto`. The value `auto` indicates that if the provider's buffer becomes empty it will automatically increase the buffer size to help prevent the provider from becoming empty again in the future. Defaults to `auto`.
- **`format`** <sub><sup>*Optional*</sup></sub> - Specifies the format for the file. The format can be one of `line` (the default), `json`, or `csv`.
  
  The `line` format will read the file one line at a time with each line ending in a newline (`\n`) or a carriage return and a newline (`\r\n`). Every line will attempt to be parsed as JSON, but if it is not valid JSON it will be a string. Note that a JSON object which spans multiple lines in the file, for example, will not parse into a single object.

  The `json` format will read the file as a stream of JSON values. Every JSON value must be self-delineating (an object, array or string), or must be separated by whitespace or a self-delineating value. For example, the following:

  ```json
  {"a":1}{"foo":"bar"}47[1,2,3]"some text"true 56
  ```

  Would parse into separate JSON values of `{"a": 1}`, `{"foo": "bar"}`, `47`, `[1, 2, 3]`, `"some text"`, `true`, and `56`.

  The `csv` format will read the file as a CSV file. Every non-header column will attempt to be parsed as JSON, but if it is not valid JSON it will be a string. The `csv` parameter allows customization over how the file should be parsed.
- **`csv`** <sub><sup>*Optional*</sup></sub> - When parsing a file using the `csv` format, this parameter provides extra customization on how the file should be parsed. This parameter is in the format of an object with key/value pairs. If the format is not `csv` this property will be ignored.
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

  When specified, Pewpew becomes self-aware, unfolding a series of events which will ultimately lead to the end of the human race.

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

  When enabled there is no sense of "fairness" in the randomization. Any record in the file could be used more than once before other records are used.

## response
Unlike other *provider_type*s `response` does not automatically receive data from a source. Instead a `response` provider is available to be a "sink" for data originating from an HTTP response. The `response` provider has the following parameters.

- **`auto_return`** <sub><sup>*Optional*</sup></sub> - This parameter specifies that when this provider is used and an individual endpoint call concludes, the value it got from this provider should be sent back to the provider. Valid options for this parameter are `block`, `force`, and `if_not_full`. See the `send` parameter under the [endpoints.provides subsection](./endpoints-section.md#provides-subsection) for details on the effect of these options.
- **`buffer`** <sub><sup>*Optional*</sup></sub> - Specifies the soft limit for a provider's buffer. This can be indicated with an integer greater than zero or the value `auto`. The value `auto` indicates that if the provider's buffer becomes empty it will automatically increase the buffer size to help prevent the provider from becoming empty again in the future. Defaults to `auto`.

## static
The `static` *provider_type* is used for having a single pre-defined value used throughout a test. A `static` provider will make copies of the value every time a value is required from the provider. When defining a `static` provider the only parameter is the literal value which should be used. Any string value in the literal will be interpreted as a [template](./common-types.md#templates), but only environment variables can be interpolated.

**Examples**:
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

## static_list
The `static_list` *provider_type* is like the `static` *provider_type* except an array of values can be specified and the provider will iterate infinitely over the array using each element as the value to be provided.

**Example**, the following:
```yaml
providers:
  foo:
    static_list:
      - 123
      - 456
      - 789
```

creates a `static_list` provider named `foo` where the first value provided will be `123`, the second `456`, third `789` then for subsequent values it will start over at the beginning.

## range
The `range` *provider_type* provides an incrementing sequence of numbers in a given range. A `range` provider takes three optional parameters.

- **`start`** <sub><sup>*Optional*</sup></sub> - A whole number in the range of [-9223372036854775808, 9223372036854775807]. This indicates what the starting number should be for the range. Defaults to `0`.
- **`end`** <sub><sup>*Optional*</sup></sub> - A whole number in the range of [-9223372036854775808, 9223372036854775807]. This indicates what the end number should be for the range. This number is included in the range. Defaults to `9223372036854775807`.
- **`step`** <sub><sup>*Optional*</sup></sub> - A whole number in the range of [1, 65535]. This indicates how big each "step" in the range will be. Defaults to `1`.

**Examples**:
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