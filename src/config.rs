use crate::channel::transform::{Collect, Repeat, Transform};
use crate::mod_interval::{LinearBuilder, HitsPer};
use crate::template::json_value_to_string;
use hyper::Method;
use regex::Regex;
use serde::{
    de::{Error as DeError, Unexpected},
    Deserialize,
    Deserializer,
};
use serde_derive::Deserialize;
use serde_json as json;
use tuple_vec_map;

use std::{
    collections::BTreeMap,
    num::NonZeroU16,
    time::Duration,
};

#[serde(rename_all = "lowercase")]
#[derive(Deserialize)]
enum LoadPatternPreProcessed {
    Linear(LinearBuilderPreProcessed),
}

struct Percent(f64);

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
struct LinearBuilderPreProcessed {
    from: Option<Percent>,
    to: Percent,
    #[serde(deserialize_with = "deserialize_duration")]
    over: Duration,
}

pub enum LoadPattern {
    Linear(LinearBuilder),
}

impl LoadPattern {
    pub fn duration(&self) -> Duration {
        match self {
            LoadPattern::Linear(lb) => lb.duration
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderTransform {
    Collect(usize),
    Repeat(usize),
}

#[serde(rename_all = "lowercase")]
#[derive(Deserialize)]
pub enum Provider {
    File(FileProvider),
    Peek(PeekProvider),
    Response(ResponseProvider),
    Static(StaticProvider),
    StaticList(StaticListProvider),
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct FileProvider {
    #[serde(default = "default_buffer")]
    // range 1-65535
    pub buffer: NonZeroU16,
    pub path: String,
    #[serde(default)]
    pub repeat: bool,
    #[serde(default, deserialize_with = "deserialize_provider_transforms")]
    pub transform: Option<Transform>,
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct PeekProvider {
    #[serde(default)]
    pub limit: Option<usize>,
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct ResponseProvider {
    #[serde(default = "default_buffer")]
    // range 1-65535
    pub buffer: NonZeroU16,
    #[serde(default, deserialize_with = "deserialize_provider_transforms")]
    pub transform: Option<Transform>,
}

#[serde(untagged)]
#[derive(Deserialize)]
pub enum StaticProvider {
    Explicit(StaticProviderExplicit),
    Implicit(json::Value),
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct StaticProviderExplicit {
    pub value: json::Value,
    #[serde(default, deserialize_with = "deserialize_provider_transforms")]
    pub transform: Option<Transform>,
}

#[serde(untagged)]
#[derive(Deserialize)]
pub enum StaticListProvider {
    Explicit(StaticListProviderExplicit),
    Implicit(Vec<json::Value>),
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct StaticListProviderExplicit {
    pub values: Vec<json::Value>,
    #[serde(default, deserialize_with = "deserialize_provider_transforms")]
    pub transform: Option<Transform>,
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct Endpoint {
    #[serde(default, with = "tuple_vec_map")]
    pub headers: Vec<(String, String)>,
    #[serde(default, deserialize_with = "deserialize_body")]
    pub body: Option<String>,
    #[serde(default, deserialize_with = "deserialize_option_vec_load_pattern")]
    pub load_pattern: Option<Vec<LoadPattern>>,
    #[serde(default, deserialize_with = "deserialize_method")]
    pub method: Method,
    #[serde(default)]
    pub peak_load: Option<HitsPer>,
    pub stats_id: Option<BTreeMap<String, String>>,
    pub url: String,
    #[serde(default, deserialize_with = "deserialize_providers")]
    pub provides: Vec<(String, EndpointProvides)>,
}

pub type StatusChecker = dyn Fn(u16) -> bool + Send + Sync;

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct EndpointProvides {
    #[serde(default)]
    pub skip_if_full: bool,
    #[serde(default, deserialize_with = "deserialize_status_string_to_fn")]
    pub status: Option<Box<StatusChecker>>,
    pub value: json::Value,
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct Config {
    pub endpoints: Vec<Endpoint>,
    #[serde(default, deserialize_with = "deserialize_option_vec_load_pattern")]
    pub load_pattern: Option<Vec<LoadPattern>>,
    #[serde(default, deserialize_with = "deserialize_providers")]
    pub providers: Vec<(String, Provider)>,
}

impl<'de> Deserialize<'de> for Percent {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
        where D: Deserializer<'de>,
    {
        let string = String::deserialize(deserializer)?;
        let re = Regex::new(r"^(\d+(?:\.\d+)?)%$").unwrap();

        let captures = re.captures(&string)
            .ok_or_else(|| DeError::invalid_value(Unexpected::Str(&string), &"a percentage like `30%`"))?;

        Ok(Percent(captures.get(1).unwrap()
            .as_str().parse().unwrap()))
    }
}

impl<'de> Deserialize<'de> for HitsPer {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
        where D: Deserializer<'de>,
    {
        let string = String::deserialize(deserializer)?;
        let re = Regex::new(r"^(?i)(\d+)\s*hp([ms])$").unwrap();
        let captures = re.captures(&string).ok_or_else(|| DeError::invalid_value(Unexpected::Str(&string), &"example '150 hpm' or '300 hps'"))?;
        let n = captures.get(1)
            .unwrap().as_str()
            .parse().unwrap();
        if captures.get(2).unwrap().as_str()[0..1].eq_ignore_ascii_case("m") {
            Ok(HitsPer::Minute(n))
        } else {
            Ok(HitsPer::Second(n))
        }
    }
}

fn default_buffer () -> NonZeroU16 { NonZeroU16::new(5).unwrap() }

fn deserialize_provider_transforms<'de, D>(deserializer: D) -> Result<Option<Transform>, D::Error>
    where D: Deserializer<'de>
{
    let transforms: Vec<ProviderTransform> = Vec::deserialize(deserializer)?;
    let mut ret: Option<Transform> = None;
    for transform in transforms {
        let transform = match transform {
            ProviderTransform::Collect(n) => Collect::new(n).into(),
            ProviderTransform::Repeat(n) => Repeat::new(n).into(),
        };
        match &mut ret {
            Some(t) => t.wrap(transform),
            None => ret = Some(transform),
        }
    }
    Ok(ret)
}

fn deserialize_body<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
    where D: Deserializer<'de>
{
    let res: Option<json::Value> = Option::deserialize(deserializer)?;
    Ok(res.as_ref().map(json_value_to_string))
}

fn deserialize_providers<'de, D, T> (deserializer: D) -> Result<Vec<(String, T)>, D::Error>
    where
        D: Deserializer<'de>,
        T: Deserialize<'de>,
{
    let map: Vec<(String, T)> = tuple_vec_map::deserialize(deserializer)?;
    for (k, _) in &map {
        if k == "body" || k == "headers" {
            return Err(DeError::invalid_value(Unexpected::Str(&k), &"Use of reserved provider name"))
        }
    }
    Ok(map)
}

fn deserialize_duration<'de, D> (deserializer: D) -> Result<Duration, D::Error>
    where D: Deserializer<'de>
{
    let string = String::deserialize(deserializer)?;
    let base_re = r"(?i)(\d+)\s*(h|m|s|hrs?|mins?|secs?|hours?|minutes?|seconds?)";
    let sanity_re = Regex::new(&format!(r"^(?:{})+$", base_re)).unwrap();
    if !sanity_re.is_match(&string) {
        return Err(DeError::invalid_value(Unexpected::Str(&string), &"example '15m' or '2 hours'"))
    }
    let mut total_secs = 0;
    let re = Regex::new(base_re).unwrap();
    for captures in re.captures_iter(&string) {
        let n: u64 = captures.get(1)
            .unwrap().as_str()
            .parse().unwrap();
        let unit = &captures.get(2).unwrap().as_str()[0..1];
        let secs = if unit.eq_ignore_ascii_case("h") {
            n * 60 * 60 // hours
        } else if unit.eq_ignore_ascii_case("m") {
            n * 60 // minutes
        } else {
            n // seconds
        };
        total_secs += secs;
    }
    Ok(Duration::from_secs(total_secs))
}

fn deserialize_method<'de, D>(deserializer: D) -> Result<Method, D::Error>
    where D: Deserializer<'de>
{
    let string = String::deserialize(deserializer)?;
    Method::from_bytes(&string.as_bytes())
        .map_err(|_| DeError::invalid_value(Unexpected::Str(&string), &"a valid HTTP method verb"))
}

fn deserialize_option_vec_load_pattern<'de, D>(deserializer: D) -> Result<Option<Vec<LoadPattern>>, D::Error>
    where D: Deserializer<'de>
{
    let ovlppp: Option<Vec<LoadPatternPreProcessed>> = Option::deserialize(deserializer)?;
    if let Some(vec) = ovlppp {
        let mut last_end = 0f64;
        let mut ret = Vec::new();
        for lppp in vec {
            match lppp {
                LoadPatternPreProcessed::Linear(lbpp) => {
                    let start = lbpp.from.map(|p| p.0 / 100f64).unwrap_or(last_end);
                    let end = lbpp.to.0 / 100f64;
                    last_end = end;
                    ret.push(LoadPattern::Linear(LinearBuilder::new(start, end, lbpp.over)));
                }
            }
        }
        return Ok(Some(ret))
    } else {
        return Ok(None)
    }
}

// accepts strings like "2xx", "20x", "204"
fn deserialize_status_string_to_fn<'de, D> (deserializer: D) -> Result<Option<Box<StatusChecker>>, D::Error>
    where D: Deserializer<'de>
{
    let string = String::deserialize(deserializer)?;
    let re = Regex::new(r"^([1-5])(x{2}|\d{2})$").unwrap();
    if let Some(captures) = re.captures(&string) {
        // hundreds place (is a digit)
        let mut base: u16 = captures.get(1).unwrap()
            .as_str().parse::<u16>().unwrap();
        // rest (is two digits or "xx")
        let rest = captures.get(2).unwrap()
            .as_str();
        return match rest.parse::<u16>() {
            Ok(n) => {
                base = base * 100 + n;
                Ok(Some(Box::new(move |s: u16| s == base)))
            },
            Err(_) => Ok(Some(Box::new(move |s: u16| s / 100 == base)))
        }
    }

    let re = Regex::new(r"^(<|>)(=)?([1-5]\d{2})$").unwrap();
    if let Some(captures) = re.captures(&string) {
        let operator = captures.get(1).unwrap()
            .as_str();
        let is_equal = captures.get(2).is_some();
        let n = captures.get(3).unwrap()
            .as_str().parse::<u16>().unwrap();
        let op_fn = match (operator, is_equal) {
            (">", false) => PartialOrd::gt,
            (">", true) => PartialOrd::ge,
            ("<", false) => PartialOrd::lt,
            ("<", true) => PartialOrd::le,
            _ => unreachable!(),
        };
        return Ok(Some(Box::new(move |s: u16| op_fn(&s, &n))))
    }

    Err(DeError::invalid_value(Unexpected::Str(&string), &"a status entry like `2xx` or `>=400`"))
}