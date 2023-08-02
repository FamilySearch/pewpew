use super::{select_parser::template_convert::Segment, *};
use crate::{
    common::Duration,
    config::{Client, Config, General},
    configv1::RequiredProviders,
    endpoints::HitsPerMinute,
    load_pattern::Percent,
    providers::ListProvider as ListProviderV2,
    templating::{Bool, False, Regular, Template, TemplateType, TemplatedString, VarsOnly},
    ProviderType,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    convert::TryInto,
    sync::Arc,
};

fn map_template(t: PreTemplate) -> Result<Vec<Segment>, ()> {
    Ok(
        t.as_template(&BTreeMap::new(), &mut RequiredProviders::new())
            .map_err(|_| ())?
            .dump(),
    )
}

fn make_templated_string<T: TemplateType>(
    t: PreTemplate,
    var_names: &BTreeSet<Arc<str>>,
) -> Result<TemplatedString<T>, ()> {
    TemplatedString::convert_from_v1(map_template(t)?, var_names)
}

fn make_r_template_string(
    t: PreTemplate,
    var_names: &BTreeSet<Arc<str>>,
) -> Result<Template<String, Regular, False, False>, ()> {
    make_templated_string::<Regular>(t, var_names)?
        .try_into()
        .map_err(|_| ())
}

trait PreTemplateNewType: Sized
where
    <Self::V2 as FromStr>::Err: std::error::Error + Send + Sync,
{
    type V2: FromStr;
    type TemplateType: TemplateType;

    fn unwrap_pretemplate(self) -> PreTemplate;

    fn convert_to_v2<ED: Bool>(
        self,
        var_names: &BTreeSet<Arc<str>>,
    ) -> Result<Template<Self::V2, Self::TemplateType, False, ED>, ()> {
        make_templated_string(self.unwrap_pretemplate(), var_names)?
            .try_into()
            .map_err(|_| ())
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

fn map_config_section(
    cfg: ConfigPreProcessed,
    var_names: &BTreeSet<Arc<str>>,
) -> Result<Config<False>, ()> {
    fn map_cfg_client(
        client: ClientConfigPreProcessed,
        var_names: &BTreeSet<Arc<str>>,
    ) -> Result<Client<False>, ()> {
        let ClientConfigPreProcessed {
            headers,
            keepalive,
            request_timeout,
        } = client;
        let request_timeout = request_timeout.convert_to_v2(var_names)?;
        let keepalive = keepalive.convert_to_v2(var_names)?;

        let headers = todo!("client config headers");

        Ok(Client {
            request_timeout,
            headers,
            keepalive,
        })
    }

    fn map_cfg_general(
        gen: GeneralConfigPreProcessed,
        var_names: &BTreeSet<Arc<str>>,
    ) -> Result<General<False>, ()> {
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

fn map_providers(p: ProviderPreProcessed, var_names: &BTreeSet<Arc<str>>) -> ProviderType<False> {
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
    match p {
        ProviderPreProcessed::List(l) => ProviderType::List(map_list(l)),
        ProviderPreProcessed::File(f) => todo!(),
        _ => todo!(),
    }
}
