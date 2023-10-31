use crate::common::ProviderSend;

use self::endpoints::EndpointLogs;
use self::error::{EnvsError, InvalidForLoadTest, LoadTestGenError, VarsError};
use self::providers::ProviderName;
use self::scripting::LibSrc;
use self::templating::{Bool, EnvsOnly, False, Template, True};
use itertools::Itertools;
use serde::Deserialize;
use std::collections::BTreeSet;
use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    fmt::{self, Display},
    hash::Hash,
    path::Path,
    sync::Arc,
};

pub mod config;
pub mod endpoints;
pub mod error;
pub mod load_pattern;
pub mod loggers;
pub mod providers;
pub mod query;
pub mod scripting;
pub mod templating;

pub mod common;

pub use self::config::{Config, General};
pub use common::Headers;
pub use endpoints::{EndPointBody, Endpoint};
pub use loggers::Logger;
pub use providers::ProviderType;

#[derive(Debug, Deserialize, serde::Serialize, PartialEq)]
pub struct LoadTest<VD: Bool = True, ED: Bool = True> {
    #[serde(default = "Vars::new")]
    pub(crate) vars: Vars<ED>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) lib_src: Option<LibSrc>,
    #[serde(bound = "load_pattern::LoadPattern<VD>: serde::de::DeserializeOwned")]
    pub(crate) load_pattern: Option<load_pattern::LoadPattern<VD>>,
    #[serde(default = "Config::default")]
    pub config: config::Config<VD>,
    #[serde(default = "BTreeMap::new")]
    pub loggers: BTreeMap<Arc<str>, Logger<VD>>,
    #[serde(default = "BTreeMap::new")]
    pub providers: BTreeMap<ProviderName, ProviderType<VD>>,
    #[serde()] // Don't have a default here
    pub endpoints: Vec<Endpoint<VD>>,
    /// Tracks errors that would prevent a full Load Test
    #[serde(skip)]
    pub(crate) lt_err: Option<InvalidForLoadTest>,
}

pub(crate) type Vars<ED> = BTreeMap<Arc<str>, VarValue<ED>>;

#[derive(Debug, Deserialize, Clone, PartialEq)]
#[serde(untagged)]
#[derive(serde::Serialize)]
pub(crate) enum VarValue<ED: Bool> {
    Map(Vars<ED>),
    Num(f64),
    Bool(bool),
    Str(Template<String, EnvsOnly, True, ED>),
    List(Vec<Self>),
}

impl From<VarValue<True>> for serde_json::Value {
    fn from(value: VarValue<True>) -> Self {
        match value {
            VarValue::Bool(b) => Self::Bool(b),
            VarValue::Num(n) => Self::Number(serde_json::Number::from_f64(n).unwrap()),
            VarValue::Str(mut t) => Self::String(std::mem::take(t.get_mut())),
            VarValue::List(l) => l.into_iter().map(Into::into).collect::<Vec<Self>>().into(),
            VarValue::Map(m) => Self::Object(
                m.into_iter()
                    .map(|(k, v)| (k.to_string(), v.into()))
                    .collect(),
            ),
        }
    }
}

impl Display for VarValue<True> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Num(n) => Display::fmt(n, f),
            Self::Bool(b) => Display::fmt(b, f),
            Self::Str(t) => write!(f, "\"{}\"", t.get().escape_default()),
            Self::List(l) => {
                write!(f, "[{}]", l.iter().map(ToString::to_string).join(","))
            }
            Self::Map(m) => {
                write!(f, "{{")?;
                let mut multiple_entries = false;
                for (k, v) in m.iter() {
                    if multiple_entries {
                        // We need to not write a trailing slash, so only add this before the second
                        write!(f, ",")?;
                    }
                    write!(f, "\"{}\": {}", k.escape_default(), v)?;
                    multiple_entries = true;
                }
                write!(f, "}}")
            }
        }
    }
}

impl VarValue<True> {
    fn get(&self, path: &[&str]) -> Option<&Self> {
        if !path.is_empty() {
            log::trace!("searching for var value {path:?} in {self:?}");
        }
        match (self, path) {
            (Self::Map(vars), [key, rest @ ..]) => vars.get(*key)?.get(rest),
            (Self::List(arr), [idx, rest @ ..]) => arr.get(idx.parse::<usize>().ok()?)?.get(rest),
            (terminal, []) => Some(terminal),
            (_, [v, ..]) => {
                log::error!("var {v:?} not found in {self:?}");
                None
            }
        }
    }
}

fn get_var_at_path<'a>(vars: &'a Vars<True>, path: &str) -> Option<&'a VarValue<True>> {
    let mut path = path.split('.').collect::<VecDeque<_>>();
    let this = path.pop_front()?;
    log::trace!("checking for var {this:?}");
    let var = vars.get(this)?;

    var.get(path.make_contiguous())
}

fn insert_env_vars(
    v: Vars<False>,
    evars: &BTreeMap<String, String>,
) -> Result<Vars<True>, EnvsError> {
    v.into_iter()
        .map(|(k, v)| Ok((k, v.insert_env_vars(evars)?)))
        .collect()
}

impl VarValue<False> {
    fn insert_env_vars(
        self,
        evars: &BTreeMap<String, String>,
    ) -> Result<VarValue<True>, EnvsError> {
        match self {
            Self::Map(v) => insert_env_vars(v, evars).map(VarValue::Map),
            Self::List(v) => v
                .into_iter()
                .map(|v| v.insert_env_vars(evars))
                .collect::<Result<_, _>>()
                .map(VarValue::List),
            Self::Str(t) => t.insert_env_vars(evars).map(VarValue::Str),
            Self::Bool(b) => Ok(VarValue::Bool(b)),
            Self::Num(n) => Ok(VarValue::Num(n)),
        }
    }
}

impl LoadTest<True, True> {
    /// Entrypoint for generating config data from the YAML text.
    pub fn from_yaml(
        yaml: &str,
        file_path: Arc<Path>,
        env_vars: &BTreeMap<String, String>,
    ) -> Result<Self, LoadTestGenError> {
        use LoadTestGenError::{MissingProviders, NoEndpoints};
        // TODO: Why isn't this causing errors on empty
        let mut pre_envs: LoadTest<False, False> = serde_yaml::from_str(yaml)?;
        log::debug!("LoadTest::from_yaml pre_envs: {:?}", pre_envs);
        // init lib js
        scripting::set_source(std::mem::take(&mut pre_envs.lib_src))?;

        let mut pre_vars = pre_envs.insert_env_vars(env_vars)?;
        pre_vars
            .endpoints
            .iter_mut()
            .for_each(|e| e.insert_path(Arc::clone(&file_path)));
        let vars = std::mem::take(&mut pre_vars.vars);
        let mut loadtest = pre_vars.insert_vars(&vars)?;

        // Check if providers all exists for the templates
        let missing = loadtest
            .get_required_providers()
            .into_iter()
            .filter(|p| !loadtest.providers.contains_key::<str>(p))
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Err(MissingProviders(missing));
        }

        let loggers = &loadtest.loggers;
        let load_pattern = &loadtest.load_pattern;
        let endpoints = &mut loadtest.endpoints;
        let headers = &loadtest.config.client.headers;
        // Check for no endpoints
        if endpoints.is_empty() {
            return Err(NoEndpoints());
        }
        endpoints.iter_mut().enumerate().for_each(|(id, endpoint)| {
            endpoint.insert_load_pattern(load_pattern.as_ref());
            endpoint.insert_special_tags(id);
            endpoint.insert_global_headers(headers);
            // This was done in the `from_config`` in v1.
            // We need to add all loggers to all endpoints if they have a query/select
            for (name, logger) in loggers {
                if let Some(query) = &logger.query {
                    endpoint.logs.push((
                        name.clone(),
                        EndpointLogs {
                            query: query.clone(),
                        },
                    ))
                }
            }
        });

        loadtest.lt_err = loadtest.make_lt_err();

        Ok(loadtest)
    }

    fn get_required_providers(&self) -> BTreeSet<Arc<str>> {
        self.endpoints
            .iter()
            .flat_map(|e| e.get_required_providers())
            .chain(self.config.get_required_providers())
            // Filter out p:null?
            .filter(|p| !p.eq_ignore_ascii_case("null"))
            .collect()
    }

    /// Removes all loggers and each Endpoint's logs data.
    /// Used to prepare for a try run.
    pub fn clear_loggers(&mut self) {
        self.loggers.clear();
        for endpoint in &mut self.endpoints {
            endpoint.logs.clear();
        }
    }

    pub fn add_logger(&mut self, name: Arc<str>, l: Logger) {
        self.loggers.insert(name.clone(), l.clone());
        self.endpoints.iter_mut().for_each(|e| {
            e.logs.push((
                name.clone(),
                EndpointLogs {
                    query: l.query.clone().expect("try_run logger should have Query"),
                },
            ))
        });
    }

    fn make_lt_err(&self) -> Option<InvalidForLoadTest> {
        use InvalidForLoadTest::{MissingLoadPattern, MissingPeakLoad};
        let missing = self
            .endpoints
            .iter()
            .enumerate()
            .filter_map(|(i, e)| e.load_pattern.is_none().then_some(i))
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Some(MissingLoadPattern(missing));
        }
        let missing_peak = self
            .endpoints
            .iter()
            .enumerate()
            .filter(|(_, e)| e.peak_load.is_none())
            .filter(|(_, e)| {
                e.get_required_providers().into_iter().all(|p| {
                    match self.providers.get::<str>(&p) {
                        None => true,
                        Some(ProviderType::Response(_)) => false,
                        Some(_) => true,
                    }
                })
            })
            .filter(|(_, e)| {
                e.provides
                    .iter()
                    .all(|(_, p)| p.send != ProviderSend::Block)
            })
            .map(|(i, _)| i)
            .collect_vec();

        (!missing_peak.is_empty()).then_some(MissingPeakLoad(missing_peak))
    }

    pub fn ok_for_loadtest(&self) -> Result<(), InvalidForLoadTest> {
        match self.lt_err.as_ref() {
            Some(e) => Err(e.clone()),
            None => Ok(()),
        }
    }

    /// Return the full duration of the load test, that being the maximum duration of each
    /// endpoint's specifically defined load pattern, or the global.
    pub fn get_duration(&self) -> std::time::Duration {
        // the global load_pattern has alreday been inserted into each endpoint, so it does not
        // need to be checked explicitly
        self.endpoints
            .iter()
            .filter_map(|e| {
                e.load_pattern
                    .as_ref()
                    .map(load_pattern::LoadPattern::duration)
            })
            .max()
            .unwrap_or_default()
    }

    /// Returns the path to an externally defined js library, if one exists.
    ///
    /// Can be used to check for updates to that file.
    pub fn get_lib_path(&self) -> Option<Arc<Path>> {
        match &self.lib_src {
            None => None,
            Some(LibSrc::Inline(_)) => None,
            Some(LibSrc::Extern(p)) => Some(p.clone()),
        }
    }
}

impl LoadTest<False, False> {
    fn insert_env_vars(
        self,
        evars: &BTreeMap<String, String>,
    ) -> Result<LoadTest<False, True>, EnvsError> {
        let Self {
            config,
            load_pattern,
            vars,
            providers,
            loggers,
            endpoints,
            lib_src,
            ..
        } = self;
        Ok(LoadTest {
            config,
            load_pattern,
            vars: insert_env_vars(vars, evars)?,
            providers,
            loggers,
            endpoints,
            lt_err: None,
            lib_src,
        })
    }
}

/// Trait for inserting static Vars into Templates. Any type in the config that needs var values
/// should implement this trait.
///
/// `Self::Data<False>` should be the same type as `Self`
trait PropagateVars: Into<Self::Data<False>> {
    type Data<VD: Bool>;

    fn insert_vars(self, vars: &Vars<True>) -> Result<Self::Data<True>, VarsError>;
}

impl PropagateVars for LoadTest<False, True> {
    type Data<VD: Bool> = LoadTest<VD, True>;

    fn insert_vars(self, vars: &Vars<True>) -> Result<Self::Data<True>, VarsError> {
        log::info!("inserting static vars into LoadTest");
        let Self {
            config,
            load_pattern,
            vars: v,
            providers,
            loggers,
            endpoints,
            lib_src,
            ..
        } = self;

        Ok(LoadTest {
            config: config.insert_vars(vars)?,
            load_pattern: load_pattern.insert_vars(vars)?,
            vars: v,
            providers: providers.insert_vars(vars)?,
            loggers: loggers.insert_vars(vars)?,
            endpoints: endpoints.insert_vars(vars)?,
            lt_err: None,
            lib_src,
        })
    }
}

impl<K, V> PropagateVars for BTreeMap<K, V>
where
    K: Ord,
    V: PropagateVars,
    BTreeMap<K, V::Data<False>>: From<Self>,
{
    type Data<VD: Bool> = BTreeMap<K, V::Data<VD>>;

    fn insert_vars(self, vars: &Vars<True>) -> Result<Self::Data<True>, VarsError> {
        log::info!(
            "inserting static vars into BTreeMap of {}",
            std::any::type_name::<V>()
        );
        self.into_iter()
            .map(|(k, v)| Ok((k, v.insert_vars(vars)?)))
            .collect()
    }
}

impl<K, V> PropagateVars for HashMap<K, V>
where
    K: Eq + Hash,
    V: PropagateVars,
    HashMap<K, V::Data<False>>: From<Self>,
{
    type Data<VD: Bool> = HashMap<K, V::Data<VD>>;

    fn insert_vars(self, vars: &Vars<True>) -> Result<Self::Data<True>, VarsError> {
        log::info!(
            "inserting static vars into HashMap of {}",
            std::any::type_name::<V>()
        );
        self.into_iter()
            .map(|(k, v)| Ok((k, v.insert_vars(vars)?)))
            .collect()
    }
}

impl<T> PropagateVars for Vec<T>
where
    T: PropagateVars,
    Vec<T::Data<False>>: From<Self>,
{
    type Data<VD: Bool> = Vec<T::Data<VD>>;

    fn insert_vars(self, vars: &Vars<True>) -> Result<Self::Data<True>, VarsError> {
        log::info!(
            "inserting static vars into Vec of {}",
            std::any::type_name::<T>()
        );
        self.into_iter().map(|x| x.insert_vars(vars)).collect()
    }
}

impl<T> PropagateVars for Option<T>
where
    T: PropagateVars,
    Option<T::Data<False>>: From<Self>,
{
    type Data<VD: Bool> = Option<T::Data<VD>>;

    fn insert_vars(self, vars: &Vars<True>) -> Result<Self::Data<True>, VarsError> {
        self.map(|t| t.insert_vars(vars)).transpose()
    }
}

// used for the serde tuple vec map
impl<T, U> PropagateVars for (T, U)
where
    U: PropagateVars,
    (T, U::Data<False>): From<Self>,
{
    type Data<VD: Bool> = (T, U::Data<VD>);

    fn insert_vars(self, vars: &Vars<True>) -> Result<Self::Data<True>, VarsError> {
        log::info!(
            "inserting static vars into Map of {}",
            std::any::type_name::<U>()
        );
        Ok((self.0, self.1.insert_vars(vars)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn empty_path() -> Arc<Path> {
        Arc::from(PathBuf::new())
    }

    #[test]
    fn empty() {
        let input = r#"
        "#;
        let err = LoadTest::from_yaml(input, empty_path(), &BTreeMap::new()).unwrap_err();
        assert!(matches!(err, LoadTestGenError::YamlParse(_)));
        assert!(format!("{:?}", err).contains("missing field `endpoints`"));
    }

    #[test]
    fn basic_no_endpoints() {
        let input = r#"
        config:
          client: {}
          general: {}
        providers: {}
        loggers: {}
        vars: {}
        "#;
        let err = LoadTest::from_yaml(input, empty_path(), &BTreeMap::new()).unwrap_err();
        assert!(matches!(err, LoadTestGenError::YamlParse(_)));
        assert!(format!("{:?}", err).contains("missing field `endpoints`"));
        let input = r#"
        config:
          client: {}
          general: {}
        providers: {}
        endpoints: []
        loggers: {}
        vars: {}
        "#;
        let err = LoadTest::from_yaml(input, empty_path(), &BTreeMap::new()).unwrap_err();
        assert!(matches!(err, LoadTestGenError::NoEndpoints()));
    }

    #[test]
    fn basic() {
        let input = r#"
        config:
          client: {}
          general: {}
        providers: {}
        load_pattern:
          - !linear
              to: 50%
              over: 1m
        endpoints:
          - method: GET
            url: localhost:8000
            peak_load: 4hps
        loggers: {}
        vars: {}
        "#;
        let lt = LoadTest::from_yaml(input, empty_path(), &BTreeMap::new()).unwrap();
        lt.ok_for_loadtest().unwrap();
    }

    #[test]
    fn error_missing_load_pattern() {
        let input = r#"
        config:
          client: {}
          general: {}
        providers: {}
        endpoints:
          - method: GET
            url: localhost:8000
        loggers: {}
        vars: {}
        "#;
        let lt = LoadTest::from_yaml(input, empty_path(), &BTreeMap::new()).unwrap();
        let err = lt.ok_for_loadtest().unwrap_err();
        assert_eq!(err, InvalidForLoadTest::MissingLoadPattern(vec![0]));
        let input = r#"
        config:
          client: {}
          general: {}
        providers: {}
        endpoints:
          - method: GET
            url: localhost:8000
          - method: POST
            url: localhost:9900
            load_pattern:
              - !linear
                  to: 150%
                  over: 5m
          - url: localhost:17777
        loggers: {}
        vars: {}
        "#;
        let lt = LoadTest::from_yaml(input, empty_path(), &BTreeMap::new()).unwrap();
        let err = lt.ok_for_loadtest().unwrap_err();
        assert_eq!(err, InvalidForLoadTest::MissingLoadPattern(vec![0, 2]));
        let input = r#"
        config:
          client: {}
          general: {}
        providers: {}
        endpoints:
          - peak_load: 12hpm
            url: localhost:8000
          - peak_load: 4hps
            url: localhost:9900
          - url: localhost:17777
            peak_load: 10hpm
        loggers: {}
        vars: {}
        load_pattern:
          - !linear
              to: 999%
              over: 2m
        "#;
        let lt = LoadTest::from_yaml(input, empty_path(), &BTreeMap::new()).unwrap();
        // global load pattern means endpoints do not need one
        lt.ok_for_loadtest().unwrap();
    }

    #[test]
    fn error_missing_peak_load() {
        let input = r#"
        config:
          client: {}
          general: {}
        providers: {}
        endpoints:
          - url: localhost:12345
        loggers: {}
        vars: {}
        load_pattern:
          - !linear
              to: 50%
              over: 1m
        "#;
        let lt = LoadTest::from_yaml(input, empty_path(), &BTreeMap::new()).unwrap();
        let err = lt.ok_for_loadtest().unwrap_err();
        assert_eq!(err, InvalidForLoadTest::MissingPeakLoad(vec![0]));

        let input = r#"
        config:
          client: {}
          general: {}
        providers:
          resp: !response
          a: !list
            - 1
        endpoints:
          # defines peak load
          - url: localhost:12345
            peak_load: 99hpm
          # depends on response provider
          - url: localhost:7777/${p:resp}
          # has a provides with block
          - url: localhost:23456
            provides:
              resp:
                query:
                  select: "1"
                send: block
              a:
                query:
                  select: "43"
                send: if_not_full
          # none of those
          - url: localhost:445${p:a}
        loggers: {}
        vars: {}
        load_pattern:
          - !linear
              to: 50%
              over: 1m
        "#;
        let lt = LoadTest::from_yaml(input, empty_path(), &BTreeMap::new()).unwrap();
        let err = lt.ok_for_loadtest().unwrap_err();
        assert_eq!(err, InvalidForLoadTest::MissingPeakLoad(vec![3]));
    }

    #[test]
    fn get_test_duration() {
        use std::time::Duration;
        let input = r#"
        endpoints:
          - method: GET
            url: localhost:8000
            peak_load: 4hps
        loggers: {}
        vars: {}
        load_pattern: []
        "#;
        let lt = LoadTest::from_yaml(input, empty_path(), &BTreeMap::new()).unwrap();
        assert_eq!(lt.get_duration(), Duration::default());
        let input = r#"
        endpoints:
          - method: GET
            url: localhost:8000
            peak_load: 4hps
        loggers: {}
        vars: {}
        load_pattern:
          - !linear
              from: 50%
              to: 150%
              over: 12h
        "#;
        let lt = LoadTest::from_yaml(input, empty_path(), &BTreeMap::new()).unwrap();
        assert_eq!(lt.get_duration(), Duration::from_secs(12 * 60 * 60));
        let input = r#"
        endpoints:
          - url: localhost:8080
            load_pattern:
              - !linear
                  to: 78%
                  over: 13h
          - url: localhost:9900
          - url: localhost:5432
            load_pattern:
              - !linear
                  to: 99%
                  over: 1m
        loggers: {}
        vars: {}
        load_pattern:
          - !linear
              from: 50%
              to: 150%
              over: 12h
        "#;
        let lt = LoadTest::from_yaml(input, empty_path(), &BTreeMap::new()).unwrap();
        assert_eq!(lt.get_duration(), Duration::from_secs(13 * 60 * 60));
    }

    #[test]
    fn with_custom_js() {
        // sleep is to prevent collision issues with the test in the scripting module
        std::thread::sleep(std::time::Duration::from_secs(1));

        let input = r#"
        lib_src: !inline |
          function custom_inline_test() {
            return "value from js";
          }
          function inline2(x) {
            if (x == "value from js") {
              return 100;
            }
            return 1;
          }
        vars:
          from_custom: '${x:custom_inline_test()}'
        load_pattern:
          - !linear
            to: '${x:inline2(${v:from_custom})}%'
            over: 1s
        endpoints:
          - method: GET
            url: localhost:8000
            peak_load: 4hps
        "#;
        let lt = LoadTest::from_yaml(input, empty_path(), &BTreeMap::new()).unwrap();
        let lp0 = lt.load_pattern.unwrap().into_iter().next().unwrap();
        let load_pattern::LoadPatternSingle::Linear { to, .. } = lp0;
        assert_eq!(to.get(), &"100%".parse::<load_pattern::Percent>().unwrap());

        let input = r#"
        lib_src: !extern "./tests/test_custom.js"
        vars:
          foo:
            x: 84
        load_pattern:
          - !linear
            to: '${x:foo_custom(${v:foo})}%'
            over: 1s
        endpoints:
          - method: GET
            url: localhost:8000
            peak_load: 4hps
        "#;
        let lt = LoadTest::from_yaml(input, empty_path(), &BTreeMap::new()).unwrap();
        let lp0 = lt.load_pattern.unwrap().into_iter().next().unwrap();
        let load_pattern::LoadPatternSingle::Linear { to, .. } = lp0;
        assert_eq!(to.get(), &"86%".parse::<load_pattern::Percent>().unwrap());
    }

    #[test]
    fn serialize() {
        let input = r#"
        providers:
          l: !list []
          l2: !list
            values: []
            repeat: false
            random: true
          a: !range
          b: !response
        endpoints:
          - url: localhost:8080
            load_pattern:
              - !linear
                  to: 78%
                  over: 13h
          - url: localhost:9900
            declare:
              foo: !c
                collects:
                  - take: 3
                    from: ${p:null}
                    as: nulls
                then: ${x:entries(${p:nulls})}
            headers:
              auth: ${x:random(1, 100, ${p:null})}
          - url: localhost:${v:port}
          - url: localhost:5432
            load_pattern:
              - !linear
                  to: 99%
                  over: 1m
        loggers:
          test1:
            to: !stdout
          test2: 
            to: !file out.txt
        vars:
          port: ${e:PORT}
          token: ${x:random(1, 100)}
          a:
            b: 4
            c: 3
            d: [5, 6, 7]
        load_pattern:
          - !linear
              from: 50%
              to: 150%
              over: 12h
        "#;
        let lt: LoadTest<False, False> = serde_yaml::from_str(input).unwrap();
        let yaml = serde_yaml::to_string(&lt).unwrap();
        let lt2: LoadTest<False, False> = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(lt, lt2);

        let lt = LoadTest::from_yaml(
            input,
            empty_path(),
            &[("PORT".into(), "8000".into())].into(),
        )
        .unwrap();
        let lt2 = LoadTest::from_yaml(
            &yaml,
            empty_path(),
            &[("PORT".into(), "8000".into())].into(),
        )
        .unwrap();
        assert_eq!(lt, lt2);
    }
}
