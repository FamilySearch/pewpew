# lib_src section

<pre>
lib_src:
  !extern [file] | !inline [source]
</pre>

This optional section specifies where [Custom Javascript](./common-types/expressions.md#custom-javascript)
should be loaded from.

The value is enumerated over two possible variants:

- `!extern`: contains a file path to load js from
- `!inline`: contains the js source directly, written in the config file

## Examples:

```yaml
lib_src: !inline |
  function double_input(x) {
    return x + x;
  }
vars:
  doubled_key: '${x:double_input(${e:KEY})}'
```


