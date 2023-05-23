# Common types
## Duration
A duration is an integer followed by an optional space and a string value indicating the time
unit. Days can be specified with "d", "day" or "days", hours with "h", "hr", "hrs", "hour" or
"hours", minutes with "m", "min", "mins", "minute" or "minutes", and seconds with "s", "sec",
"secs", "second" or "seconds". All Durations in the config are
[V-Templates](./common-types/templates.md#template-types).

Examples:

`1h` = 1 hour

`30 minutes` = 30 minutes

Multiple duration pieces can be chained together to form more complex durations.

Examples:

`1h45m30s` = 1 hour, 45 minutes and 30 seconds

`4 hrs 15 mins` = 4 hours and 15 minutes

As seen above an optional space can be used to delimit the individual duration pieces.

## Headers
Key/value pairs where the key is a string and the value is an [R-Template](./common-types/templates.md#template-types)
which specify the headers which will be sent with a request. Note that the `host` and `content-length`
headers are added automatically to requests and any headers with the same name will be overwritten.

In an [endpoints](./endpoints-section.md) `headers` sub-section, a YAML `null` can be specified
as the value which will unset any global header with that name. Because HTTP specs allow a header
to be specified multiple times in a request, to override a global header it is necessary to specify
the header twice in the [endpoints](./endpoints-section.md) `headers` sub-section, once with a
`null` value and once with the new value. Not including the `null` value will mean the request
will have the header specified twice.

For example:

```yaml
endpoints:
  url: https://localhost/foo/bar
  headers:
    Authorization: Bearer ${p:sessionId}
```
specifies that an "Authorization" header will be sent with the request with a value of "Bearer "
followed by a value coming from a provider named "sessionId".

