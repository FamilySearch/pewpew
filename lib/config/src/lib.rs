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
    use log::{debug, info, warn};

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
            validate_legacy_only: Option<bool>,
        ) -> Result<Self, (V1Error, V2Error)> {
            debug!(
                "LoadTestEither::parse validate_legacy_only={:?}",
                validate_legacy_only
            );
            // BUG: If there are no required variables, this passes even if there is bad yaml
            // TODO: Add param that forces it to one or the other?
            match validate_legacy_only {
                Some(legacy_only) => {
                    if legacy_only {
                        match v1::LoadTest::from_config(yaml.as_bytes(), &PathBuf::new(), env_vars)
                        {
                            Ok(lt) => {
                                info!("LoadTestEither::parse OK v1::LoadTest::from_config");
                                debug!(
                                    "LoadTestEither::parse v1::lt.endpoints={:?}",
                                    lt.endpoints.len()
                                );
                                Ok(Self::V1(lt))
                            }
                            Err(e) => {
                                warn!("LoadTestEither::parse v1 error={:?}", e);
                                Err((e, V2Error::OtherErr("V1 Error".to_string())))
                            }
                        }
                    } else {
                        match v2::LoadTest::from_yaml(yaml, PathBuf::new().into(), env_vars) {
                            Ok(lt) => {
                                info!("LoadTestEither::parse OK v2::LoadTest::from_yaml");
                                debug!("LoadTestEither::parse v2::lt={:?}", lt);
                                Ok(Self::V2(lt))
                            }
                            Err(e) => {
                                warn!("LoadTestEither::parse v2 error={:?}", e);
                                Err((V1Error::OtherErr("V2 Error".to_string()), e))
                            }
                        }
                    }
                }
                None => match v2::LoadTest::from_yaml(yaml, PathBuf::new().into(), env_vars) {
                    Ok(lt) => {
                        info!("LoadTestEither::parse OK v2::LoadTest::from_yaml");
                        debug!("LoadTestEither::parse v2::lt={:?}", lt);
                        Ok(Self::V2(lt))
                    }
                    Err(e) => {
                        warn!("LoadTestEither::parse v2 error={:?}", e);
                        match v1::LoadTest::from_config(yaml.as_bytes(), &PathBuf::new(), env_vars)
                        {
                            Ok(lt) => {
                                info!("LoadTestEither::parse OK v1::LoadTest::from_config");
                                debug!(
                                    "LoadTestEither::parse v1::lt.endpoints={:?}",
                                    lt.endpoints.len()
                                );
                                Ok(Self::V1(lt))
                            }
                            Err(e2) => {
                                warn!("LoadTestEither::parse v1 error={:?}", e2);
                                warn!("LoadTestEither::parse v2 error={:?}", e);
                                Err((e2, e))
                            }
                        }
                    }
                },
            }
        }

        pub fn get_duration(&self) -> Duration {
            match self {
                Self::V1(lt) => lt.get_duration(),
                Self::V2(lt) => lt.get_duration(),
            }
        }

        pub fn get_logger_files(&self) -> Vec<String> {
            match self {
                Self::V1(lt) => lt
                    .loggers
                    .values()
                    .map(|l| l.to.as_str().into())
                    .collect::<Vec<_>>(),
                Self::V2(lt) => lt
                    .loggers
                    .values()
                    .map(|l| l.to.as_str().into())
                    .collect::<Vec<_>>(),
            }
        }

        // return the bucket size for the test
        pub fn get_bucket_size(&self) -> u64 {
            match self {
                Self::V1(lt) => lt.config.general.bucket_size.as_secs(),
                Self::V2(lt) => lt.config.general.bucket_size.get().as_secs(),
            }
        }

        // return a string array of files used to feed providers
        pub fn get_input_files(&self) -> Vec<String> {
            match self {
                Self::V1(lt) => {
                    // We also need to include file bodies so we can validate that we have those as well.
                    // Endpoint file bodies - BodyTemplate(File)
                    let mut body_files: Vec<String> = lt
                        .endpoints
                        .iter()
                        .filter_map(|endpoint| {
                            if let v1::BodyTemplate::File(_, template) = &endpoint.body {
                                // The path is the base path, the template.pieces has the real path
                                debug!("endpoint::body::file.template={:?}", template);
                                Some(template.evaluate_with_star())
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>();
                    // file providers
                    let mut provider_files = lt
                        .providers
                        .iter()
                        .filter_map(|(_, v)| {
                            if let v1::Provider::File(f) = v {
                                Some(f.path.as_str().into())
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>();
                    provider_files.append(&mut body_files);
                    provider_files
                }
                Self::V2(lt) => {
                    // We also need to include file bodies so we can validate that we have those as well.
                    // Endpoint file bodies - BodyTemplate(File)
                    let mut body_files: Vec<String> =
                        lt.endpoints
                            .iter()
                            .filter_map(|endpoint| {
                                if let Some(crate::EndPointBody::File(
                                    crate::endpoints::FileBody { path: template, .. },
                                )) = &endpoint.body
                                {
                                    // The path is the base path, the template.pieces has the real path
                                    debug!("endpoint::body::file.template={:?}", template);
                                    Some(template.evaluate_with_star())
                                } else {
                                    None
                                }
                            })
                            .collect::<Vec<_>>();
                    // file providers
                    let mut provider_files = lt
                        .providers
                        .iter()
                        .filter_map(|(_, v)| {
                            if let crate::ProviderType::File(f) = v {
                                Some(f.path.get().as_str().into())
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>();
                    provider_files.append(&mut body_files);
                    provider_files
                }
            }
        }

        // returns nothing if the config file has no errors, throws an error containing a string description, if the config file has errors
        pub fn check_ok(&self) -> Result<(), String> {
            match self {
                Self::V1(lt) => lt.ok_for_loadtest().map_err(|e| format!("{e:?}")),
                Self::V2(lt) => lt.ok_for_loadtest().map_err(|e| format!("{e:?}")),
            }
        }

        // Any other needed functions can be implemented by dispatching the call to the equivalent
        // function on whichever load test happens to be held by `self`
    }
}
