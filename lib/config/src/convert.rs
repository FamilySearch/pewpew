//! publicly accessible types and functions for config updating

use crate::{
    common::ProviderSend,
    configv1::{CreatingExpressionError, CsvHeader, EndpointProvidesSendOptions as EPSO, Limit},
    providers::{BufferLimit, CsvHeaders},
};
use thiserror::Error;

impl From<EPSO> for ProviderSend {
    fn from(value: EPSO) -> Self {
        match value {
            EPSO::Block => Self::Block,
            EPSO::Force => Self::Force,
            EPSO::IfNotFull => Self::IfNotFull,
        }
    }
}

impl From<Limit> for BufferLimit {
    fn from(value: Limit) -> Self {
        match value {
            Limit::Static(x) => BufferLimit::Limit(x as u64),
            Limit::Dynamic(_) => BufferLimit::Auto,
        }
    }
}

impl From<CsvHeader> for CsvHeaders {
    fn from(value: CsvHeader) -> Self {
        match value {
            CsvHeader::Bool(b) => CsvHeaders::Use(b),
            CsvHeader::String(s) => {
                CsvHeaders::Provide(s.split(',').map(ToOwned::to_owned).collect())
            }
        }
    }
}

pub fn update_v1_to_v2(v1: &str) -> Result<String, ConfigUpdaterError> {
    let lt = crate::configv1::convert_helper::map_v1_yaml(v1)?;
    let s = serde_yaml::to_string(&lt)?;
    Ok(s)
}

#[derive(Debug, Error)]
pub enum ConfigUpdaterError {
    #[error("error serializing V2 LoadTest: {0}")]
    Serialize(#[from] serde_yaml::Error),
    #[error("error generating v1 template: {0}")]
    T1(#[from] crate::configv1::error::Error),
    #[error(transparent)]
    Segments(#[from] TemplateSegmentError),
    #[error("error making V2 template: {0}")]
    T2(Box<dyn std::error::Error + 'static>),
    #[error(transparent)]
    CEE(#[from] CreatingExpressionError),
}

impl ConfigUpdaterError {
    pub(crate) fn template_gen<E: std::error::Error + 'static>(e: E) -> Self {
        Self::T2(Box::new(e))
    }
}

#[derive(Debug, Error)]
#[error("template source {0:?} is not valid at that location")]
pub struct TemplateSegmentError(pub(crate) String);
