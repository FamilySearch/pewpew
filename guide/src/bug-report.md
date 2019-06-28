# Found a bug?

Before filing a new issue on [GitHub](https://github.com/fs-eng/pewpew/issues), it is helpful to create a reproducible test case. To do that, please do the following:

1) Remove all `endpoints`, `providers`, `loggers`, `vars`, `load_pattern`s and `config` options not needed to reproduce the issue.
2) When possible, replace `file` providers with a variable (`vars`) or a concise `list` provider. If the `file` provider is required to replicate the issue, make the file as small as possible.
3) Replace all references to environment variables with actual values in `vars`.
4) Change the remaining `endpoints` to run against the Pewpew test server (see below).
5) Reduce `peak_load`s and `load_pattern`s as much as possible while still reproducing the issue.

## Using the Pewpew test server

The Pewpew test server provides a way to reproduce problems without generating load against others' servers. The test server is a simple, locally run HTTP server which is usually run from the same machine that Pewpew runs from.

To run the test server first download the latest test server binaries [here](https://github.com/fs-eng/pewpew/releases), extract the archive and run the executable from the command-line. You should then see a message like:

```
Listening on port 2073
```

To customize the port the test server uses, set the `PORT` environment variable. Here's an example run in bash:

```bash
$ PORT=8080 ./test-server
Listening on port 8080
```

The test server provides two HTTP endpoints:

- `/` - this endpoint acts as an "echo server" and will return in the response body any data that was sent to it. This endpoint should only ever return a `200` or `204` status code. It accepts all HTTP methods though only `GET`, `POST` and `PUT` can echo data back in the response. For the `GET` method to echo data back, specify the echo data in the `echo` query parameter. For `POST` and `PUT` simply put the data to be echoed back in the request body. The response will use the same `Content-Type` header from the response when specified, otherwise it will use `text/plain`.

  There is also an optional `wait` query parameter which defines a delay (specified in milliseconds) for how long the server should wait before sending the response.

- `/multipart` - this endpoint is mostly used to verify the multipart capability of Pewpew and has very limited usefulness. This endpoint expects a `POST` request with a multipart body. Every field in the multipart request is expected to have a `sha1` header which is the SHA1 hash of the current field's body. If all the previously mentioned expectations pass then a `204` status code is returned. If any of the expectations fail then a `400` status code is returned.