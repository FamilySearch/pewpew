# vars section

<pre>
vars:
  <i>variable_name</i>: <i>definition</i>
</pre>

Variables are used where a single pre-defined value is needed in the test a test. The variable *definition* can be any valid YAML type where any strings will be interpreted as a [template](./common-types.md#templates). In variable templates only environment variables can be interpolated in expressions.

**Examples**:
```yaml
vars:
  foo: bar
```

creates a single variabled named `foo` where the value is the string "bar".

More complex values are automatically interpreted as JSON so the following:
```yaml
vars:
  bar:
    a: 1
    b: 2
    c: 3
```

creates a variable named `bar` where the value is equivalent to the JSON `{"a": 1, "b": 2, "c": 3}`.

As noted above, environment variables can be interpolated in the string templates. So, the following:

```yaml
vars:
  password: ${PASSWORD}
```

would create a variable named `password` where the value comes from the environment variable `PASSWORD`.