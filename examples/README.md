# Pewpew Examples
These are some examples based on tests written for different services tests. See the [guide](https://familysearch.github.io/pewpew) for documentation on functions.

Most of these examples will work with the [test-server](https://familysearch.github.io/pewpew/bug-report.html#using-the-pewpew-test-server). Then specifying the same `PORT` when running the test.

Example:
```bash

PORT=8080 test-server &
PORT=8080 PASSWORD=bogus pewpew try login_for_apis.yaml -l
```