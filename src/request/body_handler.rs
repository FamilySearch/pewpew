use super::*;

use futures::future::IntoFuture;

pub(super) struct BodyHandler {
    pub(super) now: Instant,
    pub(super) template_values: TemplateValues,
    pub(super) included_outgoing_indexes: BTreeSet<usize>,
    pub(super) outgoing: Arc<Vec<Outgoing>>,
    pub(super) endpoint_id: usize,
    pub(super) stats_tx: StatsTx,
    pub(super) status: u16,
}

impl BodyHandler {
    pub(super) fn handle<F>(
        self,
        result: Result<Option<json::Value>, RecoverableError>,
        auto_returns: Arc<Mutex<Option<F>>>,
    ) -> impl Future<Item = (), Error = TestError>
    where
        F: Future<Item = (), Error = TestError>,
    {
        let rtt = self.now.elapsed().as_micros() as u64;
        let stats_tx = self.stats_tx.clone();
        let endpoint_id = self.endpoint_id;
        let send_response_stat = move |kind, rtt| {
            Either3::B(
                stats_tx
                    .clone()
                    .send(
                        stats::ResponseStat {
                            endpoint_id,
                            kind,
                            rtt,
                            time: SystemTime::now(),
                        }
                        .into(),
                    )
                    .map(|_| ())
                    .map_err(|e| {
                        TestError::Internal(
                            format!("unexpected error trying to send stats, {}", e).into(),
                        )
                    }),
            )
        };
        let mut template_values = self.template_values;
        let mut futures = vec![send_response_stat(
            stats::StatKind::Response(self.status),
            Some(rtt),
        )];
        if let Some(mut f) = auto_returns.try_lock() {
            if let Some(f) = f.take() {
                futures.push(Either3::C(f))
            }
        }
        template_values.insert("stats".into(), json::json!({ "rtt": rtt as f64 / 1000.0 }));
        match result {
            Ok(body) => {
                if let Some(body) = body {
                    template_values
                        .get_mut("response")
                        .expect("template_values should have `response`")
                        .as_object_mut()
                        .expect("`response` in template_values should be an object")
                        .insert("body".into(), body);
                }
                for (i, o) in self.outgoing.iter().enumerate() {
                    if !self.included_outgoing_indexes.contains(&i) {
                        if let Some(cb) = &o.cb {
                            cb(false);
                        }
                        continue;
                    }
                    let mut iter = match o.select.as_iter(template_values.as_json().clone()) {
                        Ok(v) => v.peekable(),
                        Err(TestError::Recoverable(r)) => {
                            let kind = stats::StatKind::RecoverableError(r);
                            futures.push(send_response_stat(kind, None));
                            continue;
                        }
                        Err(e) => return Either::B(Err(e).into_future()),
                    };
                    let not_empty = iter.peek().is_some();
                    match o.select.get_send_behavior() {
                        EndpointProvidesSendOptions::Block => {
                            let tx = o.tx.clone();
                            let cb = o.cb.clone();
                            let fut = stream::iter_result(iter)
                                .map_err(channel::ChannelClosed::wrapped)
                                .forward(tx)
                                .map(|_| ())
                                .or_else(move |e| match e.inner_cast::<TestError>() {
                                    Some(e) => Err(*e),
                                    None => Ok(()),
                                })
                                .then(move |r| {
                                    if let Some(cb) = cb {
                                        cb(not_empty)
                                    }
                                    r
                                });
                            futures.push(Either3::A(fut));
                        }
                        EndpointProvidesSendOptions::Force => {
                            for v in iter {
                                let v = match v {
                                    Ok(v) => v,
                                    Err(TestError::Recoverable(r)) => {
                                        let kind = stats::StatKind::RecoverableError(r);
                                        futures.push(send_response_stat(kind, None));
                                        continue;
                                    }
                                    Err(e) => return Either::B(Err(e).into_future()),
                                };
                                o.tx.force_send(v);
                            }
                            if let Some(cb) = &o.cb {
                                cb(not_empty);
                            }
                        }
                        EndpointProvidesSendOptions::IfNotFull => {
                            for v in iter {
                                let v = match v {
                                    Ok(v) => v,
                                    Err(TestError::Recoverable(r)) => {
                                        let kind = stats::StatKind::RecoverableError(r);
                                        futures.push(send_response_stat(kind, None));
                                        continue;
                                    }
                                    Err(e) => return Either::B(Err(e).into_future()),
                                };
                                if !o.tx.try_send(v).is_success() {
                                    break;
                                }
                            }
                            if let Some(cb) = &o.cb {
                                cb(not_empty);
                            }
                        }
                    }
                }
            }
            Err(r) => {
                let kind = stats::StatKind::RecoverableError(r);
                futures.push(send_response_stat(kind, None));
            }
        }
        Either::A(join_all(futures).map(|_| ()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::lazy;
    use tokio::runtime::current_thread;

    #[test]
    fn handles_body() {
        current_thread::run(lazy(|| {
            let now = Instant::now();
            let template_values = TemplateValues::new();
            let included_outgoing_indexes = BTreeSet::new();
            let outgoing = Vec::new().into();
            let endpoint_id = 0;
            let (stats_tx, stats_rx) = futures_channel::unbounded();
            let status = 200;

            let bh = BodyHandler {
                now,
                template_values,
                included_outgoing_indexes,
                outgoing,
                endpoint_id,
                stats_tx,
                status,
            };

            let auto_returns: Arc<Mutex<Option<futures::future::Empty<_, _>>>> =
                Arc::new(Mutex::new(None));

            bh.handle(Ok(None), auto_returns).then(move |r| {
                assert!(r.is_ok());
                drop(stats_rx);
                Ok(())
            })
        }));
    }
}
