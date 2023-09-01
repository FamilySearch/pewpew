mod declare;
pub use declare::Declare;

use super::{
    common::{Duration, Headers, ProviderSend},
    load_pattern::LoadPattern,
    query::Query,
    templating::{Bool, False, Regular, Template, True, VarsOnly},
    PropagateVars,
};
use derive_more::{Deref, FromStr};
use serde::Deserialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    convert::TryFrom,
    num::NonZeroUsize,
    path::{Path, PathBuf},
    str::FromStr,
    sync::Arc,
};
use thiserror::Error;

#[derive(Debug, Deserialize, serde::Serialize, PartialEq)]
pub struct Endpoint<VD: Bool = True> {
    #[serde(default)]
    pub method: Method,
    pub url: Template<String, Regular, VD>,
    #[serde(default = "BTreeMap::new")]
    pub tags: BTreeMap<Arc<str>, Template<String, Regular, VD>>,
    #[serde(default = "BTreeMap::new")]
    pub declare: BTreeMap<Arc<str>, Declare<VD>>,
    #[serde(default = "Headers::new")]
    pub headers: Headers<VD>,
    pub body: Option<EndPointBody<VD>>,
    #[serde(bound(deserialize = "LoadPattern<VD>: serde::de::DeserializeOwned"))]
    pub load_pattern: Option<LoadPattern<VD>>,
    pub peak_load: Option<Template<HitsPerMinute, VarsOnly, VD>>,
    #[serde(default = "BTreeMap::new")]
    pub provides: BTreeMap<Arc<str>, EndpointProvides<VD>>,
    // book says optional, check what the behavior should be and if this
    // should default
    #[serde(default)]
    pub on_demand: bool,
    #[serde(default = "Vec::new", with = "tuple_vec_map")]
    pub logs: Vec<(Arc<str>, EndpointLogs<VD>)>,
    pub max_parallel_requests: Option<NonZeroUsize>,
    #[serde(default)]
    pub no_auto_returns: bool,
    pub request_timeout: Option<Template<Duration, VarsOnly, VD>>,
}

impl PropagateVars for Endpoint<False> {
    type Data<VD: Bool> = Endpoint<VD>;

    fn insert_vars(self, vars: &super::Vars<True>) -> Result<Self::Data<True>, super::VarsError> {
        log::trace!("inserting static vars into endpoint");
        Ok(Endpoint {
            declare: self.declare.insert_vars(vars)?,
            headers: self.headers.insert_vars(vars)?,
            body: self.body.insert_vars(vars)?,
            load_pattern: self.load_pattern.insert_vars(vars)?,
            method: self.method,
            peak_load: self.peak_load.insert_vars(vars)?,
            tags: self.tags.insert_vars(vars)?,
            url: self.url.insert_vars(vars)?,
            provides: self.provides.insert_vars(vars)?,
            on_demand: self.on_demand,
            logs: self.logs.insert_vars(vars)?,
            max_parallel_requests: self.max_parallel_requests,
            no_auto_returns: self.no_auto_returns,
            request_timeout: self.request_timeout.insert_vars(vars)?,
        })
    }
}

impl Endpoint<True> {
    pub fn get_required_providers(&self) -> BTreeSet<Arc<str>> {
        self.headers
            .iter()
            .flat_map(|(_, h)| h.get_required_providers())
            .chain(
                self.body
                    .as_ref()
                    .map_or(BTreeSet::new(), |b| b.get_required_providers()),
            )
            .chain(self.url.get_required_providers())
            // need to figure this out; removing it can mess up the peak load detection,
            // but with it, extra values can be taken from providers that are only used
            // in declare.
            .chain(
                self.declare
                    .values()
                    .flat_map(|b| b.get_required_providers()),
            )
            .filter(|p| !self.declare.contains_key(p))
            .collect()
    }

    /// Insert a load pattern if the current is None. The globally defined load_pattern should be
    /// used as a default if one is not defined locally.
    pub(crate) fn insert_load_pattern(&mut self, load: Option<&LoadPattern<True>>) {
        if let Some(lp) = load {
            self.load_pattern.get_or_insert_with(|| lp.clone());
        }
    }

    /// Inserts the special implicit tags.
    pub(crate) fn insert_special_tags(&mut self, id: usize) {
        let tags = &mut self.tags;
        tags.insert("_id".into(), Template::new_literal(id.to_string()));
        tags.insert(
            "method".into(),
            Template::new_literal(self.method.to_string()),
        );
        let url = &self.url;
        // the `url` tag can be defined explicity, and if it is, it should not be overwritten
        tags.entry("url".into())
            .or_insert_with(|| Template::new_literal(url.evaluate_with_star()));
    }

    /// Insert headers from config section
    pub(crate) fn insert_global_headers(&mut self, headers: &Headers<True>) {
        self.headers.extend(headers.iter().cloned())
    }
}

impl Endpoint<False> {
    pub fn insert_path(&mut self, path: Arc<Path>) {
        if let Some(body) = self.body.as_mut() {
            body.add_file_path(path)
        }
    }
}

/// Newtype wrapper around [`http::Method`] for implementing [`serde::Deserialize`].
#[derive(Deserialize, Debug, Default, Deref, FromStr, PartialEq, Eq)]
#[serde(try_from = "&str")]
pub struct Method(http::Method);

impl From<http::Method> for Method {
    fn from(value: http::Method) -> Self {
        Self(value)
    }
}

impl TryFrom<&str> for Method {
    type Error = <Self as FromStr>::Err;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        value.parse()
    }
}

impl serde::ser::Serialize for Method {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.0.as_ref())
    }
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[derive(serde::Serialize)]
pub enum EndPointBody<VD: Bool = True> {
    #[serde(rename = "str")]
    String(Template<String, Regular, VD>),
    File(FileBody<VD>),
    Multipart(#[serde(with = "tuple_vec_map")] Vec<(String, MultiPartBodySection<VD>)>),
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(from = "Template<String, Regular, VD>")]
pub struct FileBody<VD: Bool> {
    pub base_path: Arc<Path>,
    pub path: Template<String, Regular, VD>,
}

impl<VD: Bool> serde::ser::Serialize for FileBody<VD> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        self.path.serialize(serializer)
    }
}

impl<VD: Bool> From<Template<String, Regular, VD>> for FileBody<VD> {
    fn from(value: Template<String, Regular, VD>) -> Self {
        Self {
            base_path: Arc::from(PathBuf::new()),
            path: value,
        }
    }
}

impl PropagateVars for FileBody<False> {
    type Data<VD: Bool> = FileBody<VD>;

    fn insert_vars(
        self,
        vars: &super::Vars<True>,
    ) -> Result<Self::Data<True>, crate::error::VarsError> {
        Ok(FileBody {
            base_path: self.base_path,
            path: self.path.insert_vars(vars)?,
        })
    }
}

impl EndPointBody<True> {
    fn get_required_providers(&self) -> BTreeSet<Arc<str>> {
        match self {
            Self::String(t) => t.get_required_providers(),
            Self::File(fb) => fb.path.get_required_providers(),
            Self::Multipart(m) => m
                .iter()
                .flat_map(|(_, s)| {
                    s.headers
                        .iter()
                        .flat_map(|(_, h)| h.get_required_providers())
                        .chain(s.body.get_required_providers())
                })
                .collect(),
        }
    }
}

impl EndPointBody<False> {
    fn add_file_path(&mut self, path: Arc<Path>) {
        match self {
            Self::File(FileBody { base_path, .. }) => *base_path = path.clone(),
            Self::Multipart(m) => m
                .iter_mut()
                .for_each(|(_, s)| s.body.add_file_path(Arc::clone(&path))),
            _ => (),
        }
    }
}

impl PropagateVars for EndPointBody<False> {
    type Data<VD: Bool> = EndPointBody<VD>;

    fn insert_vars(self, vars: &super::Vars<True>) -> Result<Self::Data<True>, super::VarsError> {
        use EndPointBody::*;
        match self {
            String(s) => s.insert_vars(vars).map(String),
            File(f) => f.insert_vars(vars).map(File),
            Multipart(mp) => mp.insert_vars(vars).map(Multipart),
        }
    }
}

#[derive(Debug, Deserialize, PartialEq, Eq, serde::Serialize)]
pub struct MultiPartBodySection<VD: Bool = True> {
    #[serde(default = "Headers::new")]
    pub headers: Headers<VD>,
    pub body: EndPointBody<VD>,
}

impl PropagateVars for MultiPartBodySection<False> {
    type Data<VD: Bool> = MultiPartBodySection<VD>;

    fn insert_vars(self, vars: &super::Vars<True>) -> Result<Self::Data<True>, super::VarsError> {
        let Self { headers, body } = self;
        Ok(MultiPartBodySection {
            headers: headers.insert_vars(vars)?,
            body: body.insert_vars(vars)?,
        })
    }
}

#[derive(Debug, Deserialize, PartialEq, PartialOrd, Deref, Clone, Copy)]
#[serde(try_from = "&str")]
pub struct HitsPerMinute(f64);

impl std::fmt::Display for HitsPerMinute {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // See if it rounds to hpm and format as such
        if self.0.fract() == 0.0 {
            write!(f, "{}hpm", self.0)
        } else {
            write!(f, "{}hps", self.0 / 60.0)
        }
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ParseHitsPerError {
    #[error("invalid hits per minute")]
    Invalid,
    #[error("hits per minute value too large")]
    TooBig,
}

impl FromStr for HitsPerMinute {
    type Err = ParseHitsPerError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        use crate::shared::Per;
        let (n, tag) = crate::shared::get_hits_per(s).ok_or(ParseHitsPerError::Invalid)?;
        // Highly doubt anyone will do this, but you never know.
        let n = n
            .is_finite()
            .then_some(n)
            .ok_or(ParseHitsPerError::TooBig)?;
        Ok(Self(
            n * match tag {
                Per::Minute => 1.0,
                Per::Second => 60.0,
            },
        ))
    }
}

impl TryFrom<&str> for HitsPerMinute {
    type Error = <Self as FromStr>::Err;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        value.parse()
    }
}

#[derive(Debug, Deserialize, serde::Serialize, PartialEq, Eq)]
pub struct EndpointProvides<VD: Bool> {
    pub(crate) query: Query<VD>,
    pub(crate) send: ProviderSend,
}

impl<VD: Bool> EndpointProvides<VD> {
    pub fn set_send_behavior(&mut self, send: ProviderSend) {
        self.send = send
    }
}

impl PropagateVars for EndpointProvides<False> {
    type Data<VD: Bool> = EndpointProvides<VD>;

    fn insert_vars(
        self,
        vars: &super::Vars<True>,
    ) -> Result<Self::Data<True>, crate::error::VarsError> {
        Ok(EndpointProvides {
            query: self.query.insert_vars(vars)?,
            send: self.send,
        })
    }
}

impl From<EndpointProvides<True>> for (Query<True>, ProviderSend) {
    fn from(EndpointProvides { query, send }: EndpointProvides<True>) -> Self {
        (query, send)
    }
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(transparent)]
#[derive(serde::Serialize)]
pub struct EndpointLogs<VD: Bool> {
    pub(crate) query: Query<VD>,
}

impl PropagateVars for EndpointLogs<False> {
    type Data<VD: Bool> = EndpointLogs<VD>;

    fn insert_vars(
        self,
        vars: &super::Vars<True>,
    ) -> Result<Self::Data<True>, crate::error::VarsError> {
        Ok(EndpointLogs {
            query: self.query.insert_vars(vars)?,
        })
    }
}

impl From<EndpointLogs<True>> for (Query<True>, ProviderSend) {
    fn from(value: EndpointLogs<True>) -> Self {
        (value.query, ProviderSend::Block)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::configv2::False;
    use serde_yaml::from_str as from_yaml;

    #[test]
    fn test_hits_per_minute() {
        assert_eq!("15hpm".parse(), Ok(HitsPerMinute(15.0)));
        assert_eq!("22 hpm".parse(), Ok(HitsPerMinute(22.0)));
        assert_eq!("1hps".parse(), Ok(HitsPerMinute(60.0)));

        assert_eq!("1.5 hpm".parse(), Ok(HitsPerMinute(1.5)));
        assert_eq!("0.5 hps".parse(), Ok(HitsPerMinute(30.0)));

        // Allowed, but should it be?
        assert_eq!("0hps".parse(), Ok(HitsPerMinute(0.0)));

        // Even though these are valid values for parsing a float, the regex won't catch them (and
        // shouldn't)
        assert_eq!(
            "NaN hpm".parse::<HitsPerMinute>(),
            Err(super::ParseHitsPerError::Invalid)
        );
        assert_eq!(
            "infinity hpm".parse::<HitsPerMinute>(),
            Err(super::ParseHitsPerError::Invalid)
        );
        assert_eq!(
            "-3.0 hpm".parse::<HitsPerMinute>(),
            Err(super::ParseHitsPerError::Invalid)
        );
    }

    #[test]
    fn test_body() {
        let EndPointBody::<False>::String(body) = from_yaml("!str my text").unwrap() else {
            panic!("was not template variant")
        };
        assert_eq!(
            body,
            Template::Literal {
                value: "my text".to_owned()
            }
        );

        let EndPointBody::<False>::File(FileBody { path: file, .. }) =
            from_yaml("!file body.txt").unwrap()
        else {
            panic!("was not file variant")
        };
        assert_eq!(
            file,
            Template::Literal {
                value: "body.txt".to_owned()
            }
        );

        static TEST: &str = r#"
        !multipart
          foo:
            headers:
              Content-Type: image/jpeg
            body:
              !file foo.jpg
          bar:
            body:
              !str some text"#;
        let EndPointBody::<False>::Multipart(multipart) = from_yaml(TEST).unwrap() else {
            panic!("was not multipart variant")
        };
        assert_eq!(multipart.len(), 2);
        assert_eq!(multipart[0].0, "foo");
        assert_eq!(
            multipart[0].1,
            MultiPartBodySection {
                headers: vec![(
                    "Content-Type".to_owned(),
                    Template::Literal {
                        value: "image/jpeg".to_owned()
                    }
                )]
                .into(),
                body: EndPointBody::File(FileBody {
                    base_path: Arc::from(PathBuf::new()),
                    path: Template::Literal {
                        value: "foo.jpg".to_owned()
                    }
                })
            }
        );
        assert_eq!(multipart[1].0, "bar");
        assert_eq!(
            multipart[1].1,
            MultiPartBodySection {
                headers: Default::default(),
                body: EndPointBody::String(Template::Literal {
                    value: "some text".to_owned()
                })
            }
        );
    }

    #[test]
    fn test_method_default() {
        // The Default impl for the local Method is forwarded to http::Method::default()
        // in current version, that default is GET. This test is to check if that changes between
        // versions.
        assert_eq!(Method::default(), Method(http::Method::GET));
    }

    #[test]
    fn test_method() {
        // The pewpew book does not specify a valid subset, so assuming all should be tested.
        let Method(method) = from_yaml("GET").unwrap();
        assert_eq!(method, http::Method::GET);
        let Method(method) = from_yaml("CONNECT").unwrap();
        assert_eq!(method, http::Method::CONNECT);
        let Method(method) = from_yaml("DELETE").unwrap();
        assert_eq!(method, http::Method::DELETE);
        let Method(method) = from_yaml("HEAD").unwrap();
        assert_eq!(method, http::Method::HEAD);
        let Method(method) = from_yaml("OPTIONS").unwrap();
        assert_eq!(method, http::Method::OPTIONS);
        let Method(method) = from_yaml("PATCH").unwrap();
        assert_eq!(method, http::Method::PATCH);
        let Method(method) = from_yaml("POST").unwrap();
        assert_eq!(method, http::Method::POST);
        let Method(method) = from_yaml("PUT").unwrap();
        assert_eq!(method, http::Method::PUT);
        let Method(method) = from_yaml("TRACE").unwrap();
        assert_eq!(method, http::Method::TRACE);
    }

    #[test]
    fn test_endpoint() {
        static TEST: &str = r#"url: example.com"#;
        let Endpoint::<True> {
            declare,
            headers,
            body,
            load_pattern,
            method,
            peak_load,
            tags,
            url,
            provides,
            //on_demand,
            logs,
            max_parallel_requests,
            no_auto_returns,
            request_timeout,
            ..
        } = from_yaml::<Endpoint<False>>(TEST)
            .unwrap()
            .insert_vars(&BTreeMap::new())
            .unwrap();
        assert!(declare.is_empty());
        assert!(headers.is_empty());
        assert_eq!(body, None);
        assert_eq!(load_pattern, None);
        assert_eq!(*method, http::Method::GET);
        assert_eq!(peak_load, None);
        assert!(tags.is_empty());
        assert_eq!(
            url,
            Template::Literal {
                value: "example.com".to_owned()
            }
        );
        assert!(provides.is_empty());
        //assert_eq!(on_demand, None);
        assert!(logs.is_empty());
        assert_eq!(max_parallel_requests, None);
        assert_eq!(no_auto_returns, false);
        assert_eq!(request_timeout, None);
    }
}
