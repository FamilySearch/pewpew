# Expressions

Expressions are like a mini-scripting language embedded within Pewpew. Expressions only deal with very limited data types--the JSON types--strings, numbers, booleans, null values, arrays and objects.

Expressions are most commonly used to access data from a provider (via [templates](../common-types.md#templates])) or to transform data from an HTTP response to be sent into a provider. Expressions allow the traversal of object and array structures, evaluating boolean logic and basic mathematic operators. Helper functions extend the functionality of expressions further.

## Operators

Operator | Description
--- | --- 
`==` | Equal. Check that two values are equal to each other and produces a boolean.
`!=` | Not equal. Check that two values are not equal to each other and produces a boolean.
`>` | Greater than. Check that the left value is greater than the right and produces a boolean.
`<` | Less than. Check that the left value is less than the right and produces a boolean.
`>=` | Greater than or equal to. Check that the left value is greater than or equal to the right and produces a boolean.
`<=` | Less than or equal to. Check that the left value is less than or equal to the right and produces a boolean.
`&&` | And. Checks that two values are true and produces a boolean.
<code>&#124;&#124;</code> | Or. Checks that one of two values is true and produces a boolean.
`+` | Add. Adds two numbers together producing a number.
`-` | Subtract. Subtracts two numbers producing a number.
`*` | Multiply. Multiplies two numbers producing a number.
`/` | Divide. Divides two numbers producing a number.
`%` | Remainder. Provides the remainder after dividing two numbers.

## Helper functions

<table>
<thead>
<tr>
<th>Function</th>
<th>Description</th>
</tr>
</thead>
<tbody>
<tr>
<td>

<code>collect(<i>item</i>, <i>n</i>)</code>

or

<code>collect(<i>item</i>, <i>min</i>, <i>max</i>)</code>
</code>
</td>
<td>

When used in a [endpoints.declare subsection](../endpoints-section.md#declare-subsection) `collect` provides the special ability to "collect" multiple values from a provider into an array. `collect` can be called with two or three arguments. The two argument form creates an array of size *n*. The three argument form creates an array with a randomly selected size between *min* (inclusive) and *max* (exclusive).

When used outside a [declare subsection](../endpoints-section.md#declare-subsection), `collect` will simply return the *item*.

See the [endpoints.declare subsection](../endpoints-section.md#declare-subsection) for an example.

</td>
</tr>
<tr>
<td>
<code>encode(<i>value</i>, <i>encoding</i>)</code>
</td>
<td>

Encode a string with the given encoding.

*value* - any expression. The result of the expression will be coerced to a string if needed and then encoded with the specified encoding.<br/>
*encoding* - The encoding to be used. Encoding must be one of the following string literals:
- `"base64"` - Base64 encodes the value.
- `"percent-simple"` - Percent encodes every ASCII character less than hexidecimal 20 and greater than 7E.
- `"percent-query"` - Percent encodes every ASCII character less than hexidecimal 20 and greater than 7E in addition to ` `, `"`, `#`, `>` and `<` (space, doublequote, hash, greater than, and less than).
- `"percent"` - Percent encodes every ASCII character less than hexidecimal 20 and greater than 7E in addition to ` `, `"`, `#`, `>`, `<`, `` ` ``, `?`, `{` and `}` (space, doublequote, hash, greater than, less than, backtick, question mark, open curly brace and close curly brace).
- `"percent-path"` - Percent encodes every ASCII character less than hexidecimal 20 and greater than 7E in addition to ` `, `"`, `#`, `>`, `<`, `` ` ``, `?`, `{`, `}`, `%` and `/` (space, doublequote, hash, greater than, less than, backtick, question mark, open curly brace, close curly brace, percent and forward slash).
- `"percent-userinfo"` - Percent encodes every ASCII character less than hexidecimal 20 and greater than 7E in addition to ` `, `"`, `#`, `>`, `<`, `` ` ``, `?`, `{`, `}`, `/`, `:`, `;`, `=`, `@`, `\`, `[`, `]`, `^`, and `|` (space, doublequote, hash, greater than, less than, backtick, question mark, open curly brace, close curly brace, forward slash, colon, semi-colon, equal sign, at sign, backslash, open square bracket, close square bracket, caret and pipe).<br/><br/>
- `"non-alphanumeric"` - Non-Alphanumeric encodes every ASCII character that is not an ASCII letter or digit.

**Example**: with the value `foo=bar` from a provider named `baz`, then the template `https://localhost/abc?${encode(baz, "percent-userinfo"}` would resolve to `https://localhost/abc?foo%3Dbar`.

</td>
</tr>
<tr>
<td>
<code>end_pad(<i>value</i>, <i>min_length</i>, <i>pad_string</i>)</code>
</td>
<td>

Pads a string or number to be minimum length. Any added padding will be added to the end of the string.

*value* - An expression whose value will be coerced to a string if needed.<br/>
*min_length* - the minimum length, as a positive integer, that the returned string should be. If the first parameter in string format is less than this amount then padding will be added to it.<br/>
*pad_string* - The padding string to use. If the amount of padding needed is less than the length of this string then it will be truncated from the right. If the needed padding is more than the length of this string, then this string is repeated until it is long enough.

**Example**: with the value `"Jones"` from a provider named `lastName`, then the string `${end_pad(lastName, 8, "-")}` would resolve to `Jones---`.

</td>
</tr>
<tr>
<td>
<code>entries(<i>value</i>)</code>
</td>
<td>

Returns the "entries" which make up *value*. For an object this will yield the object's key/value pairs. For an array it yields the array's indices and elements. For a string it yields the indices and the characters. For boolean and null types it yields back those same values.

**Examples**

With the value `{"a": {"foo": "bar", "baz": 123}, "b": ["abc", "def"], "c": "xyz", "d": null }` coming from a provider named `test`:

```
entries(test.a)
```

would return `[["foo", "bar"], ["baz", 123]]`.

```
entries(test.b)
```

would return `[[0, "abc"], [1, "def"]]`.

```
entries(test.c)
```

would return `[[0, "x"], [1, "y"], [2, "z"]]`.

```
entries(test.d)
```

would return `null`.

</td>
</tr>
<tr>
<td>
<code>epoch(<i>unit</i>)</code>
</td>
<td>

Returns time since the unix epoch.

*unit* - A string literal of `"s"` (seconds), `"ms"` (milliseconds), `"mu"` (microseconds), or `"ns"` (nanoseconds).

</td>
</tr>
<tr>
<td><code>if(<i>check</i>, <i>true_value</i>, <i>false_value</i>)</code></td>
<td>

Does a boolean check against the first argument, if true the second argument is returned otherwise the third argument is returned.

*check* - An expression which will be coerced to a boolean if needed.<br/>
*true_value* - The value that is returned if `check` evaluates to true.<br/>
*false_value* - The value that is returned if `check` evaluates to false.<br/>

**Example**: `if(true, 1, 2)` would always resolve to `1`.

</td>
</tr>
<tr>
<td>


<code>join(<i>value</i>, <i>separator</i>)</code>

or

<code>join(<i>value</i>, <i>separator</i>, <i>separator2</i>)</code>

</td>
<td>

Turns an array of values into a string or turns an object into a string.

*value* - any expression. When the expression resolves to an array, the elements of the array are coerced to a string if needed and are then joined together to a single string using the specified separator. When the *value* resolves to an object and the three argument variant is used then the object will be turned into a string with the specified separators. In any other case *value* is coerced to a string and returned.<br/>
*separator* - a string literal which will be used between each element in the array. In the case of the three argument variant when the first argument is an object *separator* is used to separate key/value pairs.<br/>
*separator2* - a string literal which is used to separate keys and values in an object.

**Examples**

With the value `["foo", "bar", "baz"]` from a provider named `qux`, then the template `https://localhost/some/thing?a=${join(qux, "-")}` would resolve to `https://localhost/some/thing?a=foo-bar-baz`.

With the value `{"a": 1, "b": 2}` from a provider named `foo`, then the expression `join(foo, "\n", ": ")` would resolve to the following string:

```
a: 1
b: 2
```

or for an alternative, json-ified view: `"a: 1\nb: 2"`

</td>
</tr>
<tr>
<td>
<code>json_path(<i>query</i>)</code>
</td>
<td>

Provides the ability to execute a [json path query](https://goessner.net/articles/JsonPath/index.html) against an object and returns an array of values. The query must be a string literal.

**Example**: `json_path("response.body.ships.*.ids")`

</td>
</tr>
<tr>
<td>
<code>match(<i>string</i>, <i>regex</i>)</code>
</td>
<td>

Allows matching a string against a regex. Returns an object with the matches from the regex. Named matches are supported though any unnamed matches will be a number based on their position. Match `0` is always the portion of the string which the regex matched against. If the regex does not match `null` is returned.

If the first parameter is not a string it will be coerced into a string.

Regex look arounds are not supported.

**Example**:

If a response body were the following:

```
<html>
<body>
Hello, Jean! Today's date is 2038-01-19. So glad you made it!
</body>
</html>
```

Then the following expression:

```
match(response.body, "Hello, (?P<name>\w+).*(?P<y>\d{4})-(?P<m>\d{2})-(?P<d>\d{2})")
```

Would return:

```
{
  "0": "Jean! Today's date is 2038-01-19",
  "name": Jean",
  "y": "2038",
  "m": "01",
  "d": "19"
}
```

</td>
</tr>
<tr>
<td>

<code>max(<i>...number</i>)</code>

</td>
<td>

Selects the largest number out of a sequence of numbers. Each argument should be an expression which resolves to a number otherwise it will not be considered in determining the min. If no arguments are provided, or if none of the arguments resolve to a number, then `null` will be returned.

</td>
</tr>
<tr>
<td>

<code>min(<i>...number</i>)</code>

</td>
<td>

Selects the smallest number out of a sequence of numbers. Each argument should be an expression which resolves to a number otherwise it will not be considered in determining the max. If no arguments are provided, or if none of the arguments resolve to a number, then `null` will be returned.

</td>
</tr>
<tr>
<td>

<code>random(<i>start</i>, </i>end</i>)</code>

</td>
<td>

Generates a random number between *start* (inclusive) and *end* (exclusive). Both *start* and *end* must be number literals. If both numbers are integers only integers will be generated within the specified range. If either number is a floating point number then a floating point number will be generated within the specified range.

</td>
</tr>
<tr>
<td>

<code>range(<i>start</i>, </i>end</i>)</code>

</td>
<td>

Creates an array of numeric values in the specified range.

*start* - any expression resolving to a whole number. Represents the starting number for the range (inclusive).

*end* - any expression resolving to a whole number. Represents the end number for the range (exclusive).

**Examples**:

`range(1, 10)`

`range(50, 1)`

</td>
</tr>
<tr>
<td>

<code>repeat(<i>n</i>)</code>

or

<code>repeat(<i>min</i>, </i>max</i>)</code>

</td>
<td>

Creates an array of `null` values. The single argument version creates an array with a length of *n*. The three argument form creates an array with a randomly selected size between min (inclusive) and max (exclusive). This is mainly useful when used within a `for_each` to have the `select` expression evaluated multiple times.

**Example**: `repeat(10)`

</td>
</tr>
<tr>
<td>
<code>start_pad(<i>value</i>, <i>min_length</i>, <i>pad_string</i>)</code>
</td>
<td>

Pads a string or number to be minimum length. Any added padding will be added to the start of the string.

*value* - an expression whose value will be coerced to a string if needed.<br/>
*min_length* - the minimum length, as a positive integer, that the returned string should be. If the first parameter in string format is less than this amount then padding will be added to it.<br/>
*pad_string* - The padding string to use. If the amount of padding needed is less than the length of this string then it will be truncated from the right. If the needed padding is more than the length of this string, then this string is repeated until it is long enough.

**Example**: with the value `83` from a provider named `foo`, then the string `id=${start_pad(foo, 6, "0")}` would resolve to `id=000083`.

</td>
</tr>
<tr>
<td>
<code>replace(<i>needle</i>, <i>haystack</i>, <i>replacer</i>)</code>
</td>
<td>

Replaces any instance of a string (*needle*) within a JSON value (*haystack*) with another string (*replacer*). This function will recursively check the JSON for any string value of *needle* and replace it with *replacer*. This includes checking within a nested object's key and value pairs, within arrays and within strings.

*needle* - an expression whose value will be coerced to a string if needed.<br/>
*haystack* - the JSON value to search<br/>
*replacer* - an expression whose value will be coerced to a string if needed.<br/>

**Example**: with the value `{"foo": "baz", "zed": ["abc", 123, "fooo"]}` from a provider named `a`, then the expression `replace("foo", a, "bar")` would resolve to `{"bar": "baz", "zed": ["abc", 123, "baro"]}`.

</td>
</tr>
<tr>
<td>
<code>parseInt(<i>value</i>)</code>
</td>
<td>

Converts a string or other value into an integer (`i64`). If the value cannot be converted to a number, then `null` will be returned.

*value* - any expression. The result of the expression will be coerced to a string if needed and then converted.

</td>
</tr>
<tr>
<td>
<code>parseFloat(<i>value</i>)</code>
</td>
<td>

Converts a string or other value into an floating point number (`f64`). If the value cannot be converted to a number, then `null` will be returned.

*value* - any expression. The result of the expression will be coerced to a string if needed and then converted.

</td>
</tr>
</tbody>
</table>