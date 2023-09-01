use std::{
    borrow::{Borrow, Cow},
    convert::TryFrom,
    ops::Deref,
    str::FromStr,
    sync::Arc,
};

use super::{
    common::ProviderSend,
    templating::{Bool, False, True},
    PropagateVars,
};
use serde::Deserialize;

mod file;
mod list;
mod range;

pub use file::{CsvHeaders, CsvParams, FileProvider, FileReadFormat};
pub use list::ListProvider;
pub use range::RangeProvider;
use thiserror::Error;

/// Wrapper struct that prevents name collisions with reserved provider identifiers.
#[derive(Debug, Deserialize, PartialEq, Eq, Clone, PartialOrd, Ord, Hash)]
#[serde(try_from = "Cow<'_, str>")]
#[derive(serde::Serialize)]
pub struct ProviderName(Arc<str>);

#[derive(Debug, Error, Clone, Copy)]
#[error("reserved provider name {0:?} found")]
pub struct ReservedProviderName(&'static str);

macro_rules! p_names {
    ($s:ident, $($n:literal),*) => {
        match $s {
            $($n => Err(ReservedProviderName($n)),)*
            other => Ok(ProviderName(Arc::from(other)))
        }
    }
}

impl FromStr for ProviderName {
    type Err = ReservedProviderName;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        p_names!(s, "request", "response", "stats", "null")
    }
}

impl TryFrom<Cow<'_, str>> for ProviderName {
    type Error = ReservedProviderName;

    fn try_from(value: Cow<'_, str>) -> Result<Self, Self::Error> {
        value.parse()
    }
}

impl ProviderName {
    pub fn get(&self) -> Arc<str> {
        self.0.clone()
    }
}

impl Deref for ProviderName {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl Borrow<str> for ProviderName {
    fn borrow(&self) -> &str {
        self
    }
}

impl Borrow<str> for &ProviderName {
    fn borrow(&self) -> &str {
        self
    }
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone)]
#[serde(rename_all = "snake_case")]
#[derive(serde::Serialize)]
pub enum ProviderType<VD: Bool = True> {
    File(file::FileProvider<VD>),
    Response(ResponseProvider),
    List(ListProvider),
    Range(range::RangeProvider),
}

#[derive(Debug, Deserialize, PartialEq, Eq, Clone, serde::Serialize)]
pub struct ResponseProvider {
    pub auto_return: Option<ProviderSend>,
    #[serde(default)]
    pub buffer: BufferLimit,
    #[serde(default)]
    pub unique: bool,
}

impl PropagateVars for ProviderType<False> {
    type Data<VD: Bool> = ProviderType<VD>;

    fn insert_vars(self, vars: &super::Vars<True>) -> Result<Self::Data<True>, super::VarsError> {
        log::info!("inserting static vars into provider");
        match self {
            Self::File(fp) => fp.insert_vars(vars).map(ProviderType::File),
            Self::Range(r) => Ok(ProviderType::Range(r)),
            Self::List(l) => Ok(ProviderType::List(l)),
            Self::Response(r) => Ok(ProviderType::Response(r)),
        }
    }
}

#[derive(Debug, Deserialize, PartialEq, Eq, Default, Clone, Copy)]
#[serde(from = "BufferLimitTmp")]
pub enum BufferLimit {
    Limit(u64),
    #[default]
    Auto,
}

impl serde::ser::Serialize for BufferLimit {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Self::Auto => serializer.serialize_str("auto"),
            Self::Limit(x) => serializer.serialize_u64(*x),
        }
    }
}

impl From<BufferLimitTmp> for BufferLimit {
    fn from(value: BufferLimitTmp) -> Self {
        match value {
            BufferLimitTmp::Limit(x) => Self::Limit(x),
            BufferLimitTmp::Auto(Auto::Auto) => Self::Auto,
        }
    }
}

/// Limit is supposed to be a number or the literal keyword "auto"
/// This slightly redundant setup allows for that, but gets converted into the "real" limit struct
/// after.
#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
enum BufferLimitTmp {
    Limit(u64),
    Auto(Auto),
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Auto {
    Auto,
}

#[cfg(test)]
mod tests {
    use crate::configv2::templating::False;

    use super::*;
    use serde_yaml::from_str as from_yaml;

    #[test]
    fn test_basic_types() {
        // buffer limit
        let bl: BufferLimit = from_yaml("43").unwrap();
        assert_eq!(bl, BufferLimit::Limit(43));
        let bl: BufferLimit = from_yaml("auto").unwrap();
        assert_eq!(bl, BufferLimit::Auto);
    }

    #[test]
    fn test_provider_type_response() {
        static TEST1: &str = "!response";

        let ProviderType::<False>::Response(ResponseProvider {
            auto_return,
            buffer,
            unique,
        }) = from_yaml(TEST1).unwrap()
        else {
            panic!("was not response")
        };
        assert_eq!(auto_return, None);
        assert_eq!(buffer, BufferLimit::Auto);
        assert_eq!(unique, false);

        static TEST2: &str = r#"
!response
  buffer: auto
  auto_return: block
  unique: true
        "#;

        let ProviderType::<False>::Response(ResponseProvider {
            auto_return,
            buffer,
            unique,
        }) = from_yaml(TEST2).unwrap()
        else {
            panic!("was not response")
        };
        assert_eq!(auto_return, Some(ProviderSend::Block));
        assert_eq!(buffer, BufferLimit::Auto);
        assert_eq!(unique, true);
    }

    #[test]
    fn test_provider_type_other() {
        // just one quick check on each type
        // more detailed testing on specific properties should be handled in the dedicated modules

        static TEST_FILE: &str = r##"
!file
  path: file.csv
  repeat: true
  unique: true
  auto_return: force
  buffer: 27
  format: !csv
    comment: "#"
    headers: true"##;

        let ProviderType::<False>::File(_) = from_yaml(TEST_FILE).unwrap() else {
            panic!("was not file provider")
        };

        static TEST_LIST: &str = r##"
!list
  - a
  - b
        "##;

        let ProviderType::<False>::List(_) = from_yaml(TEST_LIST).unwrap() else {
            panic!("was not list provider")
        };

        static TEST_RANGE: &str = r#"
!range
  start: 15
        "#;

        let ProviderType::<False>::Range(_) = from_yaml(TEST_RANGE).unwrap() else {
            panic!("was not range")
        };
    }
}
