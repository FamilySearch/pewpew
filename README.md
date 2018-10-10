# Pewpew

## TODOs
- in stats change `time` to `bucket_time` and add `start_time` and `end_time`
- Add "x [time] remaining" in stats output every minute
- Add additional types of transforms: substring, json path extraction, unnest
- refactor provides templates. Allow looping using native handlebars `each` helper.
- refactor json helper so it can be used in larger template. Get rid of the the `single_element` parameter in favor of
      something like `{{json ("some.query").0}}` or `{{json-first "some.query"}}`. 
- refactor provides to have `request` and `response` (change those to be reserved provider names). Both can have `start-line`, `headers`, and `body`
- refactor `Peek` provider: change name to `Log`, allow logging to file (each error gets new file??, save all results in directory)
      or stdout/stderr or to stats, limit per endpoint
- add global option for `Log` so, for example, any response that is >=400 is logged
- every minute we print stats to console, also write those results to disk, overwriting the previous file every minute
- add config options: for client: request timeout, standard headers, keepalive time, dns resolution thread pool
- add `files` body provider
- update `mod_interval` code so that multiple `scale_fn`s can be added so that it handles the transition from
      one fn to the next, rather than using `Stream::chain`. This is important because, currently, if a
      provider value is delayed for a long period of time, it will start on the next `mod_interval` even
      though enough time may have passed that it should skip several `mod_interval`s. Should also help in allowing
      `load_patterns` to be dynamically changed during test run
- url encode url templates (maybe just a helper)
- add more tests - unit and integration - get code coverage
- create a mechanism to create aliases so a request could get multiple values from the same provider
- resolve `static` providers before creating endpoint stream
- add more configuration to file provider. random order; format: string, json, csv
- create template helpers to extract fields from csv
- add in ability to log connection timeouts, connection errors, etc
- track system health (sysinfo crate) perhaps event loop latency and determine if system is overloaded
- ensure RTTs are accurate. Is there any queueing of requests if waiting for an available socket???
- add in machine clustering. Machines should open up a secure connection using a PSK
- create custom executor with priorities. system monitoring and logging should be high priority
      generating load should be low priority
- are there cases a request provider (without load_pattern) should drop a value rather than buffering it
      in the channel or event loop???
- create stats viewer (raw html + js + css - no server)
- allow load_patterns/config to change while a test is running
- add test monitoring. Possibly use tui for terminal output. Have webserver which will display a dashboard