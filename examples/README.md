# Pewpew Examples
These are some examples based on tests written for different services tests. See the [guide](https://familysearch.github.io/pewpew) for documentation on functions.

Most of these examples will work with the [test-server](https://familysearch.github.io/pewpew/bug-report.html#using-the-pewpew-test-server). Then specifying the same `PORT` when running the test.

Example:
```bash

PORT=8080 test-server &
PORT=8080 PASSWORD=bogus pewpew try login_for_apis.yaml -l
```

### delete_*.yaml

These examples are different ways to clean-up or DELETE after a test has one. `delete_search.yaml` simulates a search for data based on some created data and deletes until the search returns no results. `delete_sequential_404s.yaml` and `delete_sequential_count.yaml` both assume you used some counter similar to in `provider_spread.yaml` and either delete until X number of 404s, or until X number of deletes happen.

### log_*.yaml

These have some various logging examples. Note: `random_search.yaml` also includes some interesting logging

### login_for_apis*.yaml

These examples assume a basic password type login and have different ways of rotating in new sessions either by `force`, `block`, or `on_demand`.

### provider_*.yaml

These examples show various ways that providers can be changed, looped, or used to have APIs call from one to another and pass data.

### ramp_*.yaml

These examples show various ramping systems you can use.
