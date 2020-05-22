use super::*;

use config::{RESPONSE_BODY, RESPONSE_HEADERS, RESPONSE_HEADERS_ALL, RESPONSE_STARTLINE, STATS};
use futures::StreamExt;

pub(super) struct ResponseHandler {
    pub(super) provider_delays: ProviderDelays,
    pub(super) template_values: TemplateValues,
    pub(super) precheck_rr_providers: u16,
    pub(super) rr_providers: u16,
    pub(super) outgoing: Arc<Vec<Outgoing>>,
    pub(super) now: Instant,
    pub(super) stats_tx: StatsTx,
    pub(super) tags: Arc<BTreeMap<String, Template>>,
}

impl ResponseHandler {
    pub(super) async fn handle<F>(
        self,
        response: hyper::Response<HyperBody>,
        auto_returns: Option<F>,
    ) -> Result<(), RecoverableError>
    where
        F: Future<Output = ()> + Send,
    {
        let status_code = response.status();
        let status = status_code.as_u16();
        let response_provider = json::json!({ "status": status });
        let mut template_values = self.template_values;
        template_values.insert("response".into(), response_provider);
        let mut response_fields_added = 0b000_111;
        handle_response_requirements(
            self.precheck_rr_providers,
            &mut response_fields_added,
            template_values
                .get_mut("response")
                .expect("template_values should have `response`")
                .as_object_mut()
                .expect("`response` in template_values should be an object"),
            &response,
        );
        let rr_providers = self.rr_providers;
        let where_clause_special_providers = self.precheck_rr_providers;
        // executing the where clause determine which of the provides and logs need
        // to be executed
        let included_outgoing_indexes = self
            .outgoing
            .iter()
            .enumerate()
            .map(|(i, o)| {
                if where_clause_special_providers & RESPONSE_BODY == RESPONSE_BODY
                    || where_clause_special_providers & STATS == STATS
                    || o.select.execute_where(template_values.as_json())?
                {
                    handle_response_requirements(
                        rr_providers,
                        &mut response_fields_added,
                        template_values
                            .get_mut("response")
                            .expect("template_values should have `response`")
                            .as_object_mut()
                            .expect("`response` in template_values should be an object"),
                        &response,
                    );
                    Ok(Some(i))
                } else {
                    Ok(None)
                }
            })
            .filter_map(Result::transpose)
            .collect::<Result<BTreeSet<_>, RecoverableError>>()?;
        let ce_header = response.headers().get("content-encoding").map(|h| {
            h.to_str()
                .expect("content-encoding header should cast to str")
        });
        let ce_header = match ce_header {
            Some(s) => s,
            None => "",
        };
        let body_value = match (
            response_fields_added & RESPONSE_BODY != 0,
            body_reader::Compression::try_from(ce_header),
        ) {
            (true, Some(ce)) => {
                let mut body = response.into_body();
                let mut br = body_reader::BodyReader::new(ce);
                let mut body_buffer = bytes::BytesMut::new();
                let mut body_value = None;
                while let Some(r) = body.next().await {
                    // in the case there's an error receiving or parsing the body, we want to pass it on
                    // to the body handler so it can log it
                    let chunks = match r {
                        Ok(c) => c,
                        Err(e) => {
                            body_value = Some(Err(RecoverableError::BodyErr(Arc::new(e))));
                            break;
                        }
                    };
                    if let Err(e) = br.decode(chunks, &mut body_buffer) {
                        body_value = Some(Err(RecoverableError::BodyErr(Arc::new(e))));
                        break;
                    }
                }
                if body_value.is_none() {
                    let body_string = str::from_utf8(&body_buffer).unwrap_or("<<binary data>>");
                    let value = if let Ok(value) = json::from_str(body_string) {
                        value
                    } else {
                        json::Value::String(body_string.into())
                    };
                    body_value = Some(Ok(value))
                }
                body_value
            }
            _ => {
                let mut body_value = None;
                let mut body = response.into_body();
                // if we don't need the body, skip parsing it, but make sure we get it all
                while let Some(r) = body.next().await {
                    if let Err(e) = r {
                        body_value = Some(Err(RecoverableError::BodyErr(Arc::new(e))));
                        break;
                    }
                }
                body_value
            }
        };
        let provider_delays = self.provider_delays;
        let now = self.now;
        let outgoing = self.outgoing;
        let stats_tx = self.stats_tx;
        let bh = BodyHandler {
            provider_delays,
            now,
            template_values,
            included_outgoing_indexes,
            outgoing,
            stats_tx,
            status,
            tags: self.tags,
        };
        bh.handle(body_value.transpose(), auto_returns).await
    }
}

fn handle_response_requirements(
    bitwise: u16,
    response_fields_added: &mut u16,
    rp: &mut json::map::Map<String, json::Value>,
    response: &Response<HyperBody>,
) {
    // check if we need the response startline and it hasn't already been set
    if ((bitwise & RESPONSE_STARTLINE) ^ (*response_fields_added & RESPONSE_STARTLINE)) != 0 {
        *response_fields_added |= RESPONSE_STARTLINE;
        let version = response.version();
        rp.insert(
            "start-line".into(),
            format!("{:?} {}", version, response.status()).into(),
        );
    }
    // check if we need response.headers and it hasn't already been set
    if ((bitwise & RESPONSE_HEADERS) ^ (*response_fields_added & RESPONSE_HEADERS)) != 0 {
        *response_fields_added |= RESPONSE_HEADERS;
        let mut headers_json = json::Map::new();
        for (k, v) in response.headers() {
            headers_json.insert(
                k.as_str().to_string(),
                json::Value::String(String::from_utf8_lossy(v.as_bytes()).into_owned()),
            );
        }
        rp.insert("headers".into(), json::Value::Object(headers_json));
    }
    // check if we need response.headers_all and it hasn't already been set
    if ((bitwise & RESPONSE_HEADERS_ALL) ^ (*response_fields_added & RESPONSE_HEADERS_ALL)) != 0 {
        *response_fields_added |= RESPONSE_HEADERS_ALL;
        let mut headers_json = json::Map::new();
        for (k, v) in response.headers() {
            headers_json
                .entry(k.as_str())
                .or_insert_with(|| json::Value::Array(Vec::new()))
                .as_array_mut()
                .expect("should be a json array")
                .push(json::Value::String(
                    String::from_utf8_lossy(v.as_bytes()).into_owned(),
                ))
        }
        rp.insert("headers_all".into(), json::Value::Object(headers_json));
    }
    // check if we need the response body and it hasn't already been set
    if ((bitwise & RESPONSE_BODY) ^ (*response_fields_added & RESPONSE_BODY)) != 0 {
        *response_fields_added |= RESPONSE_BODY;
        // the actual adding of the body happens later
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::executor::block_on;

    #[test]
    fn handles_response() {
        let template_values = TemplateValues::new();
        let precheck_rr_providers = 0;
        let rr_providers = 0;
        let outgoing = Vec::new().into();
        let now = Instant::now();
        let (stats_tx, _) = futures_channel::unbounded();
        let tags = Arc::new(BTreeMap::new());
        let rh = ResponseHandler {
            provider_delays: ProviderDelays::new(),
            template_values,
            precheck_rr_providers,
            rr_providers,
            outgoing,
            now,
            stats_tx,
            tags,
        };

        let auto_returns: Option<futures::future::Pending<_>> = None;

        let r = block_on(rh.handle(Default::default(), auto_returns));
        assert!(r.is_ok());
    }
}
