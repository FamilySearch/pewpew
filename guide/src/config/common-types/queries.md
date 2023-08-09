# Queries

<pre>
select: <i>select</i>
[for_each: <i>for_each</i>]
[where: <i>where</i>]
</pre>

Queries define how some input data should be sent to a target with expressions.

Queries are not Templated. Provider values are read simply by the name of the provider, and
var values are accessed through the `_v` object.

Some special values are available to Query expressions.

- `request`: Contains data about the HTTP request that was sent. Has the properties
  - `start_line`
  - `method`
  - `url`
  - `headers`
  - `headers_all`
  - `body`
- `response`: Contains Response data. Has the properties
  - `start_line`
  - `headers`
  - `headers_all`
  - `body`
  - `status`
- `stats`
  - `rtt`: Round-Trip Time

See [this MDN article](https://developer.mozilla.org/en-US/docs/Web/HTTP/Messages) on HTTP
messages for more details on the structure of HTTP requests and responses.

`start_line` is a string and `headers` is represented as a JSON object with key/value string
pairs. In the event where a request or response has multiple headers with the same name, the
`headers_all` property can be used which is a JSON object where the header name is the key and
the value an array of header values. Currently, `body` in the request is always a string and
`body` in the response is parsed as a JSON value, when possible, otherwise it is a string.
`status` is a number. `method` is a string and `url` is an object with the same properties as
the web URL object (see [this MDN article](https://developer.mozilla.org/en-US/docs/Web/API/URL)). 

- **`select`** - Determines the shape of the data sent to the provider. select is interpreted as a
  JSON object where any string value is evaluated as an expression.
- **`for_each`** <sub><sup>*Optional*</sup></sub> - Evaluates `select` for each element in an array
  or arrays. This is specified as an array of [expressions](./common-types/expressions.md).
  Expressions can evaluate to any JSON data type, but those which evaluate to an array will have
  each of their elements iterated over and `select` is evaluated for each. When multiple expressions
  evaluate to an array then the cartesian product of the arrays is produced.

  The `select` and `where` parameters can access the elements provided by `for_each` through the
  value `for_each` just like accessing a value from a provider. Because a `for_each` can iterate
  over multiple arrays, each element can be accessed by indexing into the array. For example
  `for_each[1]` would access the element from the second array (indexes are referenced with zero
  based counting so `0` represents the element in the first array).
- **`where`** <sub><sup>*Optional*</sup></sub> - Allows conditionally sending data to a provider
  based on a predicate. This is an [expression](./common-types/expressions.md) which evaluates
  to a boolean value, indicating whether `select` should be evaluated for the current data set.

### Example 1
With an HTTP response with the following body

```json
{ "session": "abc123" }
```

and a query defined as:

```yaml
select: response.body.session
where: response.status < 400
```

The value `"abc123"` would be output if the status code was less than 400 otherwise nothing would be sent.

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

and our query is defined as:

```yaml
select:
  name: for_each[0].name
for_each:
  - response.body.characters
```

The output values would be: `{ "name": "Luke Skywalker" }`, `{ "name": "Darth Vader" }`, `{ "name": "R2-D2" }`.

### Example 3
It is also possible to access the length of an array by accessing the `length` property.

Using the same response data from example 2, with a query defined as:

```yaml
select:
  id: for_each[0].id
  count: for_each[0].friends.length
for_each:
  - response.body.characters
```

The output values would be: `{ "id": 1000, "count": 4 }`, `{ "id": 1001, "count": 1 }`, `{ "id": 2001, "count": 3 }`.
