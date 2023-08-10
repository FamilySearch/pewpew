#[cfg(feature = "legacy")]
pub mod configv1;

mod configv2;
pub use configv2::*;

mod shared;

pub use shared::duration_from_string;

pub(crate) mod make_send;

#[cfg(feature = "convert")]
pub mod convert;

#[cfg(feature = "legacy")]
pub use either::*;

#[cfg(feature = "legacy")]
mod either {
    use crate::configv1 as v1;
    use crate::configv2 as v2;
    use crate::templating::True;
    use std::collections::BTreeMap;
    use std::path::PathBuf;
    use std::time::Duration;

    pub enum LoadTestEither {
        /// Valid load test data for pewpew `0.5.x`
        V1(v1::LoadTest),
        /// Valid load test data for pewpew `0.6.x`
        V2(v2::LoadTest<True, True>),
    }

    pub type V1Error = v1::error::Error;
    pub type V2Error = v2::error::LoadTestGenError;

    impl LoadTestEither {
        /// Attempt parsing either version of a LoadTest from the passed in config string.
        ///
        /// If
        /// either successfully parse, then one valid LoadTest is returned, prioritizing the V2.
        ///
        /// If parsing both fail, then both errors are returned.
        pub fn parse(
            yaml: &str,
            env_vars: &BTreeMap<String, String>,
        ) -> Result<Self, (V1Error, V2Error)> {
            match v2::LoadTest::from_yaml(yaml, PathBuf::new().into(), env_vars) {
                Ok(lt) => Ok(Self::V2(lt)),
                Err(e) => {
                    match v1::LoadTest::from_config(yaml.as_bytes(), &PathBuf::new(), env_vars) {
                        Ok(lt) => Ok(Self::V1(lt)),
                        Err(e2) => Err((e2, e)),
                    }
                }
            }
        }

        pub fn get_duration(&self) -> Duration {
            match self {
                Self::V1(lt) => lt.get_duration(),
                Self::V2(lt) => lt.get_duration(),
            }
        }

        // Any other needed functions can be implemented by dispatching the call to the equivalent
        // function on whichever load test happens to be held by `self`
    }
}
