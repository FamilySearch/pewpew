use crate::{
    common::ProviderSend,
    configv1::{CsvHeader, EndpointProvidesSendOptions as EPSO, Limit},
    providers::{BufferLimit, CsvHeaders},
};

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

