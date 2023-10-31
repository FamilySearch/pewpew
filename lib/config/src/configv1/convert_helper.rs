//! module for helping with the converter that is able to access private fields of the `configv1`
//! module

use super::{select_parser::template_convert::Segment, Template as TemplateV1, *};
use crate::{
    common::{Duration, ProviderSend},
    config::{Client, Config, General},
    configv1::RequiredProviders,
    convert::ConfigUpdaterError,
    endpoints::{
        Endpoint as EndpointV2, EndpointLogs, EndpointProvides as ProvidesV2, HitsPerMinute,
        MultiPartBodySection,
    },
    load_pattern::{LoadPattern as LPV2, LoadPatternSingle as LPSingleV2, Percent},
    loggers::LogTo,
    providers::{
        CsvParams, FileProvider as FileProviderV2, FileReadFormat, ListProvider as ListProviderV2,
        RangeProvider as RangeProviderV2, ResponseProvider as ResponseProviderV2,
    },
    query::Query,
    templating::{False, Regular, Template, TemplateType, TemplatedString, VarsOnly},
    Headers, Logger, ProviderType, VarValue,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    convert::TryInto,
    sync::Arc,
};

// Functions to convert a V1 PreTemplate into a type that can be transformed into a V2 Template

fn map_template(t: PreTemplate) -> Result<Vec<Segment>, error::Error> {
    Ok(
        t.as_template(&BTreeMap::new(), &mut RequiredProviders::new())?
            .dump(),
    )
}

fn make_templated_string<T: TemplateType>(
    t: PreTemplate,
    var_names: &BTreeSet<Arc<str>>,
) -> Result<TemplatedString<T>, ConfigUpdaterError> {
    TemplatedString::convert_from_v1(map_template(t)?, var_names).map_err(Into::into)
}

fn make_template_string<T: TemplateType>(
    t: PreTemplate,
    var_names: &BTreeSet<Arc<str>>,
) -> Result<Template<String, T, False>, ConfigUpdaterError> {
    make_templated_string::<T>(t, var_names)?
        .try_into()
        .map_err(ConfigUpdaterError::template_gen)
}

/// Trait for Newtype structs that simply contains a PreTemplate that eventually gets evaluated to
/// some value.
trait PreTemplateNewType: Sized
where
    <Self::V2 as FromStr>::Err: std::error::Error + Send + Sync,
{
    /// the type that the evaulated template string gets parsed into
    type V2: FromStr + std::fmt::Debug + 'static;
    type TemplateType: TemplateType;

    fn unwrap_pretemplate(self) -> PreTemplate;

    fn convert_to_v2(
        self,
        var_names: &BTreeSet<Arc<str>>,
    ) -> Result<Template<Self::V2, Self::TemplateType, False>, ConfigUpdaterError> {
        make_templated_string(self.unwrap_pretemplate(), var_names)?
            .try_into()
            .map_err(ConfigUpdaterError::template_gen)
    }
}

macro_rules! v_template_newtype {
    ($i:ty => $v2:ty) => {
        impl PreTemplateNewType for $i {
            type V2 = $v2;
            type TemplateType = VarsOnly;

            fn unwrap_pretemplate(self) -> PreTemplate {
                self.0
            }
        }
    };
}

v_template_newtype!(PreDuration => Duration);
v_template_newtype!(PrePercent => Percent);
v_template_newtype!(PreHitsPer => HitsPerMinute);

// functions to convert specific sections/subsections of the config file
// False is used as the typestate params, as inserting that data is a lossy process, and as much
// data from the original config as possible should be preserved

fn map_headers(
    h: TupleVec<String, PreTemplate>,
    var_names: &BTreeSet<Arc<str>>,
) -> Result<Headers<False>, ConfigUpdaterError> {
    h.0.into_iter()
        .map(|(k, v)| Ok((k, make_template_string(v, var_names)?)))
        .collect::<Result<_, _>>()
        .map(Headers::build)
}

fn map_config_section(
    cfg: ConfigPreProcessed,
    var_names: &BTreeSet<Arc<str>>,
) -> Result<Config<False>, ConfigUpdaterError> {
    fn map_cfg_client(
        client: ClientConfigPreProcessed,
        var_names: &BTreeSet<Arc<str>>,
    ) -> Result<Client<False>, ConfigUpdaterError> {
        let ClientConfigPreProcessed {
            headers,
            keepalive,
            request_timeout,
        } = client;
        let request_timeout = request_timeout.convert_to_v2(var_names)?;
        let keepalive = keepalive.convert_to_v2(var_names)?;

        let headers = map_headers(headers, var_names)?;

        Ok(Client {
            request_timeout,
            headers,
            keepalive,
        })
    }

    fn map_cfg_general(
        gen: GeneralConfigPreProcessed,
        var_names: &BTreeSet<Arc<str>>,
    ) -> Result<General<False>, ConfigUpdaterError> {
        let GeneralConfigPreProcessed {
            auto_buffer_start_size,
            bucket_size,
            log_provider_stats,
            watch_transition_time,
            ..
        } = gen;
        let bucket_size = bucket_size.convert_to_v2(var_names)?;
        let watch_transition_time = watch_transition_time
            .map(|wtt| wtt.convert_to_v2(var_names))
            .transpose()?;

        Ok(General {
            auto_buffer_start_size: auto_buffer_start_size as u64,
            bucket_size,
            log_provider_stats,
            watch_transition_time,
        })
    }
    let ConfigPreProcessed { client, general } = cfg;

    let client = map_cfg_client(client, var_names)?;
    let general = map_cfg_general(general, var_names)?;

    Ok(Config { client, general })
}

fn map_provider(
    p: ProviderPreProcessed,
    var_names: &BTreeSet<Arc<str>>,
) -> Result<ProviderType<False>, ConfigUpdaterError> {
    fn map_list(l: ListProvider) -> ListProviderV2 {
        match l {
            ListProvider::DefaultOptions(l) => ListProviderV2 {
                values: l,
                ..Default::default()
            },
            ListProvider::WithOptions(ListWithOptions {
                random,
                repeat,
                values,
                unique,
            }) => ListProviderV2 {
                values,
                repeat,
                random,
                unique,
            },
        }
    }
    fn map_range(r: RangeProviderPreProcessed) -> RangeProviderV2 {
        let RangeProviderPreProcessed {
            start,
            end,
            step,
            repeat,
            unique,
        } = r;
        RangeProviderV2::from_parts(start, end, step, repeat, unique)
    }
    fn map_response(r: ResponseProvider) -> ResponseProviderV2 {
        let ResponseProvider {
            auto_return,
            buffer,
            unique,
        } = r;
        ResponseProviderV2 {
            auto_return: auto_return.map(Into::into),
            buffer: buffer.into(),
            unique,
        }
    }
    fn map_file(
        f: FileProviderPreProcessed,
        var_names: &BTreeSet<Arc<str>>,
    ) -> Result<FileProviderV2<False>, ConfigUpdaterError> {
        let FileProviderPreProcessed {
            csv,
            auto_return,
            buffer,
            format,
            path,
            random,
            repeat,
            unique,
        } = f;
        let path = make_template_string(path, var_names)?;

        Ok(FileProviderV2 {
            path,
            repeat,
            unique,
            auto_return: auto_return.map(Into::into),
            buffer: buffer.into(),
            format: match format {
                FileFormat::Line => FileReadFormat::Line,
                FileFormat::Json => FileReadFormat::Json,
                FileFormat::Csv => FileReadFormat::Csv(csv.into()),
            },
            random,
        })
    }
    Ok(match p {
        ProviderPreProcessed::List(l) => ProviderType::List(map_list(l)),
        ProviderPreProcessed::Range(r) => ProviderType::Range(map_range(r)),
        ProviderPreProcessed::File(f) => ProviderType::File(map_file(f, var_names)?),
        ProviderPreProcessed::Response(r) => ProviderType::Response(map_response(r)),
    })
}

impl From<CsvSettings> for CsvParams {
    fn from(value: CsvSettings) -> Self {
        let CsvSettings {
            comment,
            delimiter,
            double_quote,
            escape,
            headers,
            terminator,
            quote,
        } = value;
        CsvParams {
            comment: comment.map(Into::into),
            delimiter: delimiter.map(Into::into),
            double_quote: double_quote.unwrap_or(true),
            escape: escape.map(Into::into),
            headers: headers.into(),
            terminator: terminator.map(Into::into),
            quote: quote.map(Into::into),
        }
    }
}

fn map_vars(v: PreVar) -> Result<VarValue<False>, ConfigUpdaterError> {
    fn map_js_var(v: json::Value) -> Result<VarValue<False>, ConfigUpdaterError> {
        match v {
            json::Value::Null => unimplemented!("null var"),
            json::Value::Bool(b) => Ok(VarValue::Bool(b)),
            json::Value::Number(n) => Ok(VarValue::Num(n.as_f64().unwrap_or_default())),
            json::Value::String(s) => {
                let t = TemplateV1::new(
                    &s,
                    &BTreeMap::new(),
                    &mut RequiredProviders::new(),
                    false,
                    create_marker(),
                )?;
                let t = t.dump();
                let t = TemplatedString::convert_from_v1(t, &BTreeSet::new())?;
                Ok(VarValue::Str(
                    t.try_into().map_err(ConfigUpdaterError::template_gen)?,
                ))
            }
            json::Value::Array(a) => a
                .into_iter()
                .map(map_js_var)
                .collect::<Result<_, _>>()
                .map(VarValue::List),
            json::Value::Object(o) => o
                .into_iter()
                .map(|(k, v)| Ok((k.into(), map_js_var(v)?)))
                .collect::<Result<_, _>>()
                .map(VarValue::Map),
        }
    }
    map_js_var(v.0.destruct().0)
}

fn map_load_pattern(
    lp: PreLoadPattern,
    var_names: &BTreeSet<Arc<str>>,
) -> Result<LPV2<False>, ConfigUpdaterError> {
    struct LinearTmp {
        from: PrePercent,
        to: PrePercent,
        over: PreDuration,
    }
    let mut last_end = PrePercent(PreTemplate::new(WithMarker {
        inner: "0%".to_owned(),
        marker: create_marker(),
    }));

    lp.0.into_iter()
        .map(|lp| {
            let LoadPatternPreProcessed::Linear(LinearBuilderPreProcessed { from, to, over }) = lp;
            let from = from.unwrap_or(std::mem::replace(
                &mut last_end,
                PrePercent(PreTemplate::new(WithMarker {
                    inner: to.0 .0.inner().clone(),
                    marker: create_marker(),
                })),
            ));
            LinearTmp { from, to, over }
        })
        .map(|lp| {
            let LinearTmp { from, to, over } = lp;
            let from = from.convert_to_v2(var_names)?;
            let to = to.convert_to_v2(var_names)?;
            let over = over.convert_to_v2(var_names)?;
            Ok(LPSingleV2::<False>::Linear { from, to, over })
        })
        .collect::<Result<_, _>>()
        .map(LPV2::build)
}

fn map_logger(
    lg: LoggerPreProcessed,
    var_names: &BTreeSet<Arc<str>>,
) -> Result<Logger<False>, ConfigUpdaterError> {
    let LoggerPreProcessed {
        select,
        for_each,
        where_clause,
        to,
        pretty,
        limit,
        kill,
    } = lg;

    Ok(Logger {
        query: map_query(select, for_each, where_clause),
        to: match to.0.inner().as_str() {
            "stdout" => LogTo::Stdout,
            "stderr" => LogTo::Stderr,
            other => {
                log::info!("interpreting string {other:?} as a File path template");
                LogTo::File(make_template_string(to, var_names)?)
            }
        },
        pretty,
        limit: limit.map(|x| x as u64),
        kill,
    })
}

fn map_query(
    select: Option<WithMarker<json::Value>>,
    for_each: Vec<WithMarker<String>>,
    where_clause: Option<WithMarker<String>>,
) -> Option<Query<False>> {
    // Fallback query if we can't parse anything
    let empty_query = Query::simple("PLEASE_UPDATE_MANUALLY".to_owned(), vec![], None).unwrap();

    // Attempt to parse the where_clause
    let where_clause = if let Some(w) = where_clause {
        let w = w.destruct().0;
        Some(w)
    } else {
        None
    };
    // Attempt to parse the for_each
    let for_each: Vec<String> = for_each
        .iter()
        .map(|fe| (fe.inner.to_string(), fe.marker).0)
        .collect();

    // See if we can create a fallback with the where and for_each but without the select
    let manual_query = match Query::simple(
        "PLEASE_UPDATE_MANUALLY".to_owned(),
        for_each.clone(),
        where_clause.clone(),
    ) {
        Ok(q) => q,
        Err(e) => {
            log::warn!("query `where` or `for_each` item must be updated manually: {e:?}");
            empty_query
        }
    };

    // Finally attempt to parse the select but fallback to the manual_query or empty_query
    select.map(|s| {
        let select_temp = s.inner();
        log::debug!("select_temp query: {select_temp}");
        let query = match select_temp {
            json::Value::Object(_) => {
                log::info!("Object query: {select_temp}");
                Query::<False>::complex_json(
                    format!("{select_temp}").as_str(),
                    for_each,
                    where_clause,
                )
            }
            json::Value::String(s) => Query::simple(s.to_string(), for_each, where_clause),
            _ => Query::simple(format!("{select_temp}"), for_each, where_clause),
        };
        let query = match query {
            Ok(q) => q,
            Err(e) => {
                log::warn!("query `select` {select_temp} must be updated manually: {e:?}");
                manual_query
            }
        };
        log::debug!("new query: {query:?}");
        query
    })
}

fn map_endpoint(
    e: EndpointPreProcessed,
    var_names: &BTreeSet<Arc<str>>,
) -> Result<EndpointV2<False>, ConfigUpdaterError> {
    fn map_provides(pv: EndpointProvidesPreProcessed) -> ProvidesV2<False> {
        let EndpointProvidesPreProcessed {
            for_each,
            select,
            send,
            where_clause,
        } = pv;
        let query = map_query(Some(select), for_each, where_clause);
        ProvidesV2 {
            query: query.expect("passed in a Some"),
            send: send.map_or_else(
                || {
                    // In configv1, the default value of `send` relies and the settings of other
                    // fields. This behavior has not been replicated in configv2.
                    log::warn!(
                    "endpoint provides `send` field is not optional; defaulting to `block` here"
                );
                    ProviderSend::Block
                },
                Into::into,
            ),
        }
    }
    let EndpointPreProcessed {
        declare,
        headers,
        body,
        load_pattern,
        method,
        on_demand,
        peak_load,
        tags,
        url,
        provides,
        logs,
        max_parallel_requests,
        no_auto_returns,
        request_timeout,
        ..
    } = e;

    let declare = {
        if !declare.is_empty() {
            log::warn!("endpoint `declare` section {declare:?} must be updated manually");
            BTreeMap::from([(
                Arc::<str>::from("TODO".to_owned()),
                crate::endpoints::Declare::<False>::Expr(Template::new_literal("TODO".to_owned())),
            )])
        } else {
            BTreeMap::new()
        }
    };
    let load_pattern = load_pattern
        .map(|lp| map_load_pattern(lp, var_names))
        .transpose()?;
    let method = crate::endpoints::Method::from(method);
    let peak_load = peak_load
        .map(|pl| pl.convert_to_v2(var_names))
        .transpose()?;
    let tags = tags
        .into_iter()
        .map(|(k, v)| Ok((k.into(), make_template_string::<Regular>(v, var_names)?)))
        .collect::<Result<BTreeMap<Arc<str>, _>, ConfigUpdaterError>>()?;
    let url = make_template_string::<Regular>(url, var_names)?;
    let provides = provides
        .0
        .into_iter()
        .map(|(k, v)| (k.into(), map_provides(v)))
        .collect();
    let logs = logs
        .0
        .into_iter()
        .map(
            |(
                k,
                LogsPreProcessed {
                    select,
                    for_each,
                    where_clause,
                },
            )| {
                (
                    k.into(),
                    EndpointLogs {
                        query: map_query(Some(select), for_each, where_clause)
                            .expect("passed in Some"),
                    },
                )
            },
        )
        .collect::<Vec<_>>();

    let request_timeout = request_timeout
        .map(|rt| rt.convert_to_v2(var_names))
        .transpose()?;

    Ok(EndpointV2 {
        declare,
        headers: headers
            .0
            .into_iter()
            .map(|(k, v)| match v {
                // TODO: is this correct?
                Nullable::Null => Ok((k, Template::new_literal("null".to_owned()))),
                Nullable::Some(h) => Ok((k, make_template_string(h, var_names)?)),
            })
            .collect::<Result<_, ConfigUpdaterError>>()
            .map(Headers::build)?,
        body: body
            .map(|b| {
                Ok::<_, ConfigUpdaterError>(match b {
                    Body::File(f) => crate::EndPointBody::File(crate::endpoints::FileBody {
                        base_path: PathBuf::new().into(),
                        path: make_template_string(f, var_names)?,
                    }),
                    Body::String(s) => {
                        crate::EndPointBody::String(make_template_string(s, var_names)?)
                    }
                    Body::Multipart(m) => {
                        let m =
                            m.0.into_iter()
                                .map(|(s, mp)| {
                                    let BodyMultipartPiece { headers, body } = mp;
                                    let headers = map_headers(headers, var_names)?;
                                    let body = match body {
                                        BodyMultipartPieceBody::String(s) => {
                                            crate::EndPointBody::String(make_template_string(
                                                s, var_names,
                                            )?)
                                        }
                                        BodyMultipartPieceBody::File(f) => {
                                            crate::EndPointBody::File(crate::endpoints::FileBody {
                                                base_path: PathBuf::new().into(),
                                                path: make_template_string(f, var_names)?,
                                            })
                                        }
                                    };
                                    Ok((s, MultiPartBodySection { headers, body }))
                                })
                                .collect::<Result<_, ConfigUpdaterError>>()?;
                        crate::EndPointBody::Multipart(m)
                    }
                })
            })
            .transpose()?,
        load_pattern,
        method,
        peak_load,
        tags,
        url,
        provides,
        on_demand,
        logs,
        max_parallel_requests,
        no_auto_returns,
        request_timeout,
    })
}

fn map_load_test(
    lt: LoadTestPreProcessed,
) -> Result<crate::LoadTest<False, False>, ConfigUpdaterError> {
    let LoadTestPreProcessed {
        config,
        endpoints,
        load_pattern,
        providers,
        loggers,
        vars,
    } = lt;
    let var_names = vars.keys().map(ToOwned::to_owned).map(Into::into).collect();
    let config = map_config_section(config, &var_names)?;
    let endpoints = endpoints
        .into_iter()
        .map(|ep| map_endpoint(ep, &var_names))
        .collect::<Result<Vec<_>, _>>()?;
    let load_pattern = load_pattern
        .map(|lp| map_load_pattern(lp, &var_names))
        .transpose()?;
    let providers = providers
        .into_iter()
        .map(|(n, p)| {
            Ok::<_, ConfigUpdaterError>((
                Cow::<str>::Owned(n).try_into().expect("came from config"),
                map_provider(p, &var_names)?,
            ))
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let loggers = loggers
        .into_iter()
        .map(|(k, l)| Ok::<_, ConfigUpdaterError>((k.into(), map_logger(l, &var_names)?)))
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let vars = vars
        .into_iter()
        .map(|(k, v)| Ok::<_, ConfigUpdaterError>((k.into(), map_vars(v)?)))
        .collect::<Result<_, _>>()?;
    Ok(crate::LoadTest::<False, False> {
        lib_src: None,
        config,
        loggers,
        load_pattern,
        vars,
        providers,
        endpoints,
        lt_err: None,
    })
}

/// Generates a configv2 LoadTest struct fron configv1 yaml, with saome data potentially filled in
/// with placeholder.
pub(crate) fn map_v1_yaml(s: &str) -> Result<crate::LoadTest<False, False>, ConfigUpdaterError> {
    let lt = LoadTestPreProcessed::from_yaml_str(s)?;

    map_load_test(lt)
}
