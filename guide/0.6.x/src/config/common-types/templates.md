# Templates

Templates are special strings that can be interpolated from a number of sources. Template interpolations
take the form of the syntax `${tag:content}`, where `tag` is a single character identifying the source
that data should be read from, and content describes what data should be read from the source.

If a literal `'$'` character is needed, either top-level or inside an interpolation, it can be
escaped with a double `$$`. This is particularly relevant for the `json_path()` expression helper
function.

Depending on the field in the config file, the resulting string may then be parsed into some other data
type (such as a Duration).

## Template Sources

The following available sources are:

- `"e"`: An environment variable, read in as a String.
  
  Example: `${e:PORT}`

- `"v"`: A variable value from the [vars section](../vars-section.md). For nested values, keys/indices are separated by `"."`.
  
  Example:

  Given the following `vars` section:
  ```yaml
  vars:
    a: true
    b:
      - 1
      - 2
      - 3
    c:
      e: "hello"
    d:
      f:
        - false
        - false
        - true
  ```
  Then the following templates can be used:

  - `${v:a}` will be `true`
  - `${v:b.0}` will be `1`
  - `${v:c}` will be `{ "e": "hello" }`
  - `${v:d.f}` will be `[false, false, true]`

- `"p"`: A value from a [provider](../providers-section.md) of the specified name.
  
  Example: `${p:foo}` will be a single json value read from a provider named `"foo"`

  Alternatively, the [declare subsection](../endpoints-section.md#declare-subsection) value of that name for the current endpoint.

- `"x"`: A JavaScript expression. Other templatings can be included within.

  Examples:

  - `${x:foo()}` will call the `foo()` helper function
  - `${x:foo(${v:foo_var}, ${p:bar_prov})}` will pass the js value stored in `vars: foo_var`, as well
    as a value from the `bar_prov` provider.
  - `${x:encode(${e:PORT})}` will pass the `PORT` environment variable into the `encode()` function.

## Template Types

Which sources are available for a given field of the config is determined by the type of the
template. All template types can use expressions (`${x:_}`), but the others are limited. The
types of templates are:

- E-Templates: Only values from the Environment Variables can be read from.
- V-Templates: Only values from the [vars section](../vars-section.md) can be read from.
- R-Templates (Regular Templates): [Providers](../providers-section.md) or
  [vars](../vars-section.md) values can be read from.

## Examples

- `"${e:HOME}/file.txt"`: A valid E-Template.
- `"https://localhost:${v:port}/index.html?user=${p:users}"`: A valid R-Template.

## Notes

- `v` and `p` sources will be rendered as Strings when interpolated at the top level. Inside of
  `x` sources, they will be treated as the actual json value.

  Example:

  With the given `vars` section:

  ```
  vars:
    a: true
    b:
      - 1
      - 2
      - 3
  ```

  Then the V-Template `"${v:a}r"` will be the literal string `"truer"`, and the V-Template
  `"${x:${v:b}[2] * 100}"` will read `${v:b}` as the literal array `[1, 2, 3]`, of which the
  index `2` value (`3`) is read and multiplied by `100`, making the whole template evaluate
  to the string `"300"`.

- E-Templates exclusively appear in the `vars` section. R-Templates are used for building the
  requests, and primarily appear in the [endpoints section](../endpoints-section.md).
