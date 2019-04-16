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
    use channel::{Limit, Receiver};
    use futures::lazy;
    use maplit::btreeset;
    use tokio::runtime::current_thread;

    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use crate::config::Select;

    fn create_outgoing(s: json::Value) -> (Outgoing, Receiver<json::Value>, Arc<AtomicUsize>) {
        let static_providers = BTreeMap::new();
        let eppp = json::from_value(s).unwrap();
        let select = Select::new(eppp, &static_providers).unwrap();
        let (tx, rx) = channel::channel(Limit::Integer(1));
        let cb_called = Arc::new(AtomicUsize::new(0));
        let cb_called2 = cb_called.clone();
        let cb = move |b| {
            cb_called.store(b as usize + 1, Ordering::Relaxed);
        };
        (
            Outgoing::new(select, tx, Some(Arc::new(cb))),
            rx,
            cb_called2,
        )
    }

    #[allow(clippy::cognitive_complexity)]
    #[test]
    fn handles_body() {
        current_thread::run(lazy(|| {
            let now = Instant::now();
            let template_values = json::json!({"response": {}}).into();
            let included_outgoing_indexes = btreeset!(0, 1, 2);

            let outgoing1 = json::json!({
                "select": "1 + 1",
                "send": "force",
                "for_each": ["repeat(3)"]
            });
            let (outgoing1, mut rx1, cb_called1) = create_outgoing(outgoing1);

            let outgoing2 = json::json!({
                "select": "1",
                "send": "block",
            });
            let (outgoing2, mut rx2, cb_called2) = create_outgoing(outgoing2);

            let outgoing3 = json::json!({
                "select": "response.body.foo",
                "send": "if_not_full",
                "for_each": ["repeat(3)"]
            });
            let (outgoing3, mut rx3, cb_called3) = create_outgoing(outgoing3);

            let outgoing4 = json::json!({
                "select": "1",
                "send": "block",
            });
            let (outgoing4, mut rx4, cb_called4) = create_outgoing(outgoing4);

            let outgoing = vec![outgoing1, outgoing2, outgoing3, outgoing4].into();
            let endpoint_id = 0;
            let (stats_tx, mut stats_rx) = futures_channel::unbounded();
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

            let auto_return_called = Arc::new(AtomicBool::new(false));
            let auto_return_called2 = auto_return_called.clone();

            let auto_returns =
                Arc::new(Mutex::new(Some(futures::future::ok(()).map(move |_| {
                    auto_return_called.store(true, Ordering::Relaxed)
                }))));

            bh.handle(Ok(Some(json::json!({"foo": "bar"}))), auto_returns)
                .then(move |r| {
                    assert!(r.is_ok());
                    assert!(auto_return_called2.load(Ordering::Relaxed));

                    // check that the different providers got data sent to them
                    for _ in 0..3 {
                        let r = rx1.poll();
                        let b = match &r {
                            Ok(Async::Ready(Some(json::Value::Number(n)))) if *n == 2.into() => {
                                true
                            }
                            _ => false,
                        };
                        assert!(b, "force receiver received correct data, {:?}", r);
                    }
                    let r = rx1.poll();
                    let b = match r {
                        Ok(Async::Ready(None)) => true,
                        _ => false,
                    };
                    assert!(b, "forced receiver is closed, {:?}", r);
                    assert_eq!(cb_called1.load(Ordering::Relaxed), 2, "callback 1 called");

                    let r = rx2.poll();
                    let b = match &r {
                        Ok(Async::Ready(Some(json::Value::Number(n)))) if *n == 1.into() => true,
                        _ => false,
                    };
                    assert!(b, "block receiver received correct data, {:?}", r);
                    let r = rx2.poll();
                    let b = match r {
                        Ok(Async::Ready(None)) => true,
                        _ => false,
                    };
                    assert!(b, "block receier is closed, {:?}", r);
                    assert_eq!(cb_called2.load(Ordering::Relaxed), 2, "callback 2 called");

                    let r = rx3.poll();
                    let b = match &r {
                        Ok(Async::Ready(Some(json::Value::String(s)))) if s == "bar" => true,
                        _ => false,
                    };
                    assert!(b, "if_not_full receiver received correct data, {:?}", r);
                    let r = rx3.poll();
                    let b = match r {
                        Ok(Async::Ready(None)) => true,
                        _ => false,
                    };
                    assert!(b, "if_not_full is closed, {:?}", r);
                    assert_eq!(cb_called3.load(Ordering::Relaxed), 2, "callback 3 called");

                    let r = rx4.poll();
                    let b = match r {
                        Ok(Async::Ready(None)) => true,
                        _ => false,
                    };
                    assert!(b, "not included receier is closed, {:?}", r);
                    assert_eq!(cb_called4.load(Ordering::Relaxed), 1, "callback 4 called");

                    // check that the stats_rx received the correct stats data
                    let r = stats_rx.poll();
                    let b = match &r {
                        Ok(Async::Ready(Some(stats::StatsMessage::ResponseStat(rs))))
                            if rs.endpoint_id == 0 =>
                        {
                            true
                        }
                        _ => false,
                    };
                    assert!(b, "stats_rx should have received response stat. {:?}", r);

                    let r = stats_rx.poll();
                    let b = match &r {
                        Ok(Async::Ready(None)) => true,
                        _ => false,
                    };
                    assert!(b, "stats_rx should be closed. {:?}", r);

                    drop(stats_rx);
                    Ok(())
                })
        }));
    }
}
