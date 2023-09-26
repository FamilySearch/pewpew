cli tool to partially automate conversion from `0.5.x` pewpew YAML config files to `0.6.x`.

Expression segments (queries and some templating sections) will need to be updated manually.

setting `RUST_LOG` to at least `warn` is recommended, as log warnings can help indicate what needs to be updated manually


Known issues:
- Expressions in vars will not wrap environment variables in the expected `${e:VAR}`
- vars in `logs` and `provides` will not have the prepended `_v.` before the var name.
