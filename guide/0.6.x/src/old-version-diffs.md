# Differences from pewpew 0.5.x config

> This is not necessarily an exhaustive list.

Some of these changes can be automated by using the `pewpew-config-updater` program, but
others must still be done manually.

## Enums

Primarily, externally tagged enumerations now use the YAML `!type` syntax rather than simply being
a single-keyed map.

This applies to:

 - `load_pattern` segments
 - `providers` types
 - file provider `format`
 - logger `to` destination
 - endpoint [body](./config/endpoints-section.md#body-subsection) content
 - endpoint [declare](./config/endpoints-section.md#declare-subsection) sources

### Examples

#### Old:

```yaml
load_pattern:
  - linear:
    to: 100%
    over: 5m
  - linear:
    to: 75%
    over: 2h
```

#### New:

```yaml
load_pattern:
  - !linear
    to: 100%
    over: 5m
  - !linear
    to: 75%
    over: 2h
```

## CSV Parameters

For `!file` provider types, instead of a separate `csv` subtable that has no effect unless `format` is
set accordingly, these values are now subvalues of the `!csv` variant directly.

### Examples:

#### Old:

```yaml
path: "file.csv"
format: csv
csv:
  headers: true
```

```yaml
path: "file.txt"
format: line
csv:
  # does nothing
  delimiter: "^"
```

#### New:

```yaml
path: "file.csv"
format: !csv
  headers: true
```

```yaml
path: "file.txt"
format: !line
# no place to put csv parameters
```

Additionally, the option for provided headers are given as a list rather than a single String.

## Templates

Template interpolations are now tagged with the specific source that data is read from. Some tags
are only allowed in certain sections.

### Examples

- `"${PORT}"` in the [vars section](./config/vars-section.md) would now be `"${e:PORT}"`, to specify
  "environment variable named 'PORT'".

Expressions use the `x` tag, and also work differently internally.

Since the parsing and execution is no longer done locally, but rather via a JS runtime, specific
template interpolations are used to specify "read value from this provider."

### Example

- `${join(foo, " -- ", ": ")}` would now be `${x:join(${p:foo}, " -- ", ": ")}` specifying both
  a) that this is an executable expression, and b) that the first parameter is a provider value.

## Expressions

Expressions are no longer parsed/executed locally, but rather use the boa engine Javascript runtime.
While this does not inherently mean much to the end user, there are front-facing changes that
go along with this.

- As stated above, reading values from providers/vars is done with templating when the expression
  itself is part of a [Template](./config/common-types/templates.md). The JS code to properly
  read that value is inserted internally before being passed to the runtime.
- Expressions used for [Queries](./config/common-types/queries.md) do not use templating.
  Helper functions are available, and the `request`, etc. values are provided natively
  with no need for `${p:_}` templatings, and static config vars are part of the `_v` object.
- Some helper functions are deprecated/removed, as native Javascript features can replace them.
  Notably, the `if()` function can be replaced by the ternary operator.
  - Additionally, the context-dependent `collect()` function was removed and replaced with
    a more specific config syntax.
  - Due to JS `==` operator comparing objects by reference, whereas pewpew 0.5.x expressions used
    it to compare by value, a `val_eq()` function was added to perform by-value comparison on any
    data.

Even though a full JS runtime is included, expressions (particularly those used in Templates)
must still be simple inline expressions[^note].

Additionally, Object literals are currently invalid inside of templated expressions, as the
template parser will interpret the `}` as the end of the interpolation.

[^note]: Essentially, anything that you could put between `return` and `;`.

## Declare Subsection

A [declare](./config/endpoints-section.md#declare-subsection) is used, among other things, to take
multiple values from one provider. In pewpew 0.5.x, the `collect()` expression function was used
for this. `collect()` was context-dependent, and would simply return the same input if used outside
of a declare. Now, a `declare` table has specific YAML syntax for collecting.

### Example

#### Old:

```yaml
declare:
  ids: collect(id, 4, 7)
  other_id: id
  foo: entries(collect(bar, 8))
```

#### New:

```yaml
declare:
  ids: !c
    collects:
      - take: [4, 7]
        from: ${p:id}
        as: _ids
    then: ${p:_ids}
  other_id: !x ${p:id}
  foo: !c
    collects:
      - take: 8
        from: ${p:bar}
        as: _foo
    then: ${x:entries(${p:_foo})}
```

If `collect` behavior is not desired for a certain declare, then the `!x` variant, containing a
single [R-Template](./config/common-types/templates.md#template-types), is used.

If `collect` behavior is desired, then the `!c` variant is used. Each entry in the `collects`
array is equivalent to a `collect()` call, and `then` is used to read those arrays as temporary providers.

## Query Tables

[Queries](./config/common-types/queries.md) are now formalized as subtables, rather than simply
being three keys that appear in multiple places. [Loggers](./config/loggers-section.md) and
[provides](./config/endpoints-section.md#provides-subsection) have `select`, `for_each`, and `where`
under the `query` property. Endpoint [logs](./config/endpoints-section.md#logs-subsection), which
only contains a `Query`, is handled transparently.

### Examples

#### Old

```yaml
# endpoint provides
provides:
  a:
    select: response.body.a
    send: block
```

#### New

```yaml
# endpoint provides
provides:
  a:
    query:
      select: response.body.a
    send: block
```

## Endpoint `provides` `send`

In `0.5.x`, the `send` field of a [provides](./config/endpoints-section.md/provides-subsection)
had a default value that was dependent on how other fields in the endpoint were set. This behavior
was not reimplemented for the current config handler, so `send` is now required.
