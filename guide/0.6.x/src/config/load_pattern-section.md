# load_pattern section

<pre>
load_pattern:
  - !<i>load_pattern_type</i>
      [parameters]
</pre>

> If a root level `load_pattern` is not specified then each endpoint *must* specify its own `load_pattern`.

The `load_pattern` section defines the "shape" that the generated traffic will take over the course of the test.
Individual endpoints can choose to specify their own `load_pattern` (see the [endpoints section](./endpoints-section.md)).

`load_pattern` is an array of *load_pattern_type*s specifying how generated traffic for a segment of the test will scale up,
down or remain steady. Currently the only *load_pattern_type* is `linear`.

Example:
```yaml
load_pattern:
  - !linear
      to: 100%
      over: 5m
  - !linear
      to: 100%
      over: 2m
```

## linear
The linear *load_pattern_type* allows generated traffic to increase or decrease linearly. There are three parameters which
can be specified for each linear segment:

- **`from`** <sub><sup>*Optional*</sup></sub> - A [V-Template](./common-types/templates.md#template-types) indicating the
  starting point to scale from, specified as a percentage. Defaults to `0%` if the current segment is the first entry in
  `load_pattern`, or the `to` value of the previous segment otherwise.

  A valid percentage is any unsigned number, integer or decimal, immediately followed by the percent symbol (`%`). Percentages
  can exceed `100%` but cannot be negative. For example `15.25%` or `150%`. 
- **`to`** - A [V-Template](./common-types/templates.md#template-types) indicating the end point to scale to, specified as a
  percentage.
- **`over`** - The [duration](./common-types.md#duration) for how long the current segment should last.
