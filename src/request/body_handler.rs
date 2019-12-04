use crate::error::{RecoverableError, TestError};
use crate::stats;

use config::{EndpointProvidesSendOptions, ExpressionError, Template};
use ether::{Either, Either3};
use futures::future::{join_all, select_all, Future, IntoFuture};
use parking_lot::Mutex;
use serde_json as json;

use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
    time::{Instant, SystemTime},
};

use super::{BlockSender, Outgoing, ProviderDelays, StatsTx, TemplateValues};

pub(super) struct BodyHandler {
    pub(super) now: Instant,
    pub(super) provider_delays: ProviderDelays,
    pub(super) template_values: TemplateValues,
    pub(super) included_outgoing_indexes: BTreeSet<usize>,
    pub(super) outgoing: Arc<Vec<Outgoing>>,
    pub(super) stats_tx: StatsTx,
    pub(super) status: u16,
    pub(super) tags: Arc<BTreeMap<String, Template>>,
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
        let stats_tx = self.stats_tx;
        let outgoing = self.outgoing.clone();
        let has_logger = outgoing.iter().any(|o| o.logger);
        let rtt = self.now.elapsed().as_micros() as u64;
        let mut template_values = self.template_values;
        template_values.insert("stats".into(), json::json!({ "rtt": rtt as f64 / 1000.0 }));
        let error_result = match result {
            Ok(Some(body)) => {
                template_values
                    .get_mut("response")
                    .expect("template_values should have `response`")
                    .as_object_mut()
                    .expect("`response` in template_values should be an object")
                    .insert("body".into(), body);
                None
            }
            Err(e) => Some(e),
            _ => None,
        };
        let template_values = Arc::new(template_values.0);
        let template_values2 = template_values.clone();
        let tags: BTreeMap<String, String> = self
            .tags
            .iter()
            .filter_map(|(k, t)| {
                t.evaluate(Cow::Borrowed(&*template_values), None)
                    .ok()
                    .map(|v| (k.clone(), v))
            })
            .collect();
        let tags = Arc::new(tags);
        self.provider_delays.log(&tags, &stats_tx);
        let send_response_stat = move |kind, rtt| {
            let mut futures = Vec::new();
            if let stats::StatKind::RecoverableError(e) = &kind {
                if has_logger {
                    let error = json::json!({
                        "msg": format!("{}", e),
                        "code": e.code(),
                    });
                    let mut tv = (&*template_values2).clone();
                    tv.as_object_mut()
                        .expect("should be a json object")
                        .insert("error".into(), error);
                    let tv: Arc<_> = tv.into();
                    for o in outgoing.iter() {
                        let select = o.select.clone();
                        let tv = tv.clone();
                        if let (true, Ok(iter)) = (o.logger, select.iter(tv)) {
                            let iter = iter.map(|v| v.map_err(Into::into));
                            let tx = o.tx.clone();
                            let cb = o.cb.clone();
                            futures.push(BlockSender::new(iter, tx, cb));
                        }
                    }
                }
            }
            let _ = stats_tx.unbounded_send(
                stats::ResponseStat {
                    kind,
                    rtt,
                    time: SystemTime::now(),
                    tags: tags.clone(),
                }
                .into(),
            );
            join_all(futures).map(|_| ())
        };
        let mut futures = Vec::new();
        if let Some(mut f) = auto_returns.try_lock() {
            if let Some(f) = f.take() {
                futures.push(Either3::C(f))
            }
        }
        if let Some(e) = error_result {
            let kind = stats::StatKind::RecoverableError(e);
            futures.push(Either3::B(send_response_stat(kind, None)));
        } else {
            let mut blocked = Vec::new();
            for (i, o) in self.outgoing.iter().enumerate() {
                if !self.included_outgoing_indexes.contains(&i) {
                    if let Some(cb) = &o.cb {
                        cb(false);
                    }
                    continue;
                }
                let select = o.select.clone();
                let send_behavior = select.get_send_behavior();
                let iter = match select.iter(template_values.clone()).map_err(Into::into) {
                    Ok(v) => v.map(|v| v.map_err(Into::into)),
                    Err(ExpressionError::IndexingIntoJson(j, e, _)) => {
                        let r = RecoverableError::IndexingJson(j, e);
                        let kind = stats::StatKind::RecoverableError(r);
                        futures.push(Either3::B(send_response_stat(kind, None)));
                        continue;
                    }
                    Err(e) => return Either::B(Err(e.into()).into_future()),
                };
                match send_behavior {
                    EndpointProvidesSendOptions::Block => {
                        let tx = o.tx.clone();
                        let cb = o.cb.clone();
                        let send_response_stat = send_response_stat.clone();
                        let f = BlockSender::new(iter, tx, cb).or_else(move |e| {
                            if let TestError::Recoverable(r) = e {
                                let kind = stats::StatKind::RecoverableError(r);
                                Either::A(send_response_stat(kind, None))
                            } else {
                                Either::B(Err(e).into_future())
                            }
                        });
                        if o.logger {
                            futures.push(Either3::A(Either::A(f)));
                        } else {
                            blocked.push(f);
                        }
                    }
                    EndpointProvidesSendOptions::Force => {
                        let mut value_added = false;
                        for v in iter {
                            let v = match v {
                                Ok(v) => v,
                                Err(TestError::Recoverable(r)) => {
                                    let kind = stats::StatKind::RecoverableError(r);
                                    futures.push(Either3::B(send_response_stat(kind, None)));
                                    break;
                                }
                                Err(e) => return Either::B(Err(e).into_future()),
                            };
                            o.tx.force_send(v);
                            value_added = true;
                        }
                        if let Some(cb) = &o.cb {
                            cb(value_added);
                        }
                    }
                    EndpointProvidesSendOptions::IfNotFull => {
                        let mut value_added = false;
                        for v in iter {
                            let v = match v {
                                Ok(v) => v,
                                Err(TestError::Recoverable(r)) => {
                                    let kind = stats::StatKind::RecoverableError(r);
                                    futures.push(Either3::B(send_response_stat(kind, None)));
                                    break;
                                }
                                Err(e) => return Either::B(Err(e).into_future()),
                            };
                            if !o.tx.try_send(v).is_success() {
                                break;
                            }
                            value_added = true;
                        }
                        if let Some(cb) = &o.cb {
                            cb(value_added);
                        }
                    }
                }
            }
            if !blocked.is_empty() {
                let f = select_all(blocked)
                    .map_err(|(e, ..)| e)
                    .and_then(|(_, _, rest)| {
                        for mut f in rest {
                            f.poll()?;
                        }
                        Ok(())
                    });
                futures.push(Either3::A(Either::B(f)));
            }
        }
        futures.push(Either3::B(send_response_stat(
            stats::StatKind::Response(self.status),
            Some(rtt),
        )));
        Either::A(join_all(futures).map(|_| ()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use channel::Receiver;
    use futures::{lazy, stream::Stream, sync::mpsc as futures_channel, Async};
    use maplit::{btreemap, btreeset};
    use tokio::runtime::current_thread;

    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use config::{EndpointProvidesSendOptions::*, Limit, Select};

    fn create_outgoing(select: Select) -> (Outgoing, Receiver<json::Value>, Arc<AtomicUsize>) {
        // let static_vars = BTreeMap::new();
        // let eppp = json::from_value(s).unwrap();
        // let select = Select::new(eppp, &static_vars, &mut Default::default(), false).unwrap();
        let (tx, rx) = channel::channel(Limit::Integer(1));
        let cb_called = Arc::new(AtomicUsize::new(0));
        let cb_called2 = cb_called.clone();
        let cb = move |b| {
            cb_called.store(b as usize + 1, Ordering::Relaxed);
        };
        (
            Outgoing::new(select, tx, Some(Arc::new(cb)), false),
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

            let select1 = Select::simple("1 + 1", Force, Some(vec!["repeat(3)"]), None, None);
            let (outgoing1, mut rx1, cb_called1) = create_outgoing(select1);

            let select2 = Select::simple("1", Block, None, None, None);
            let (outgoing2, mut rx2, cb_called2) = create_outgoing(select2);

            let select3 = Select::simple(
                "response.body.foo",
                IfNotFull,
                Some(vec!["repeat(3)"]),
                None,
                None,
            );
            let (outgoing3, mut rx3, cb_called3) = create_outgoing(select3);

            let select4 = Select::simple("1", Block, None, None, None);
            let (outgoing4, mut rx4, cb_called4) = create_outgoing(select4);

            let outgoing = vec![outgoing1, outgoing2, outgoing3, outgoing4].into();
            let (stats_tx, mut stats_rx) = futures_channel::unbounded();
            let status = 200;
            let tags = Arc::new(btreemap! {"_id".into() => Template::simple("0") });

            let bh = BodyHandler {
                now,
                provider_delays: ProviderDelays::new(),
                template_values,
                included_outgoing_indexes,
                outgoing,
                stats_tx,
                status,
                tags,
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
                        Ok(Async::Ready(Some(stats::StatsMessage::ResponseStat(rs)))) => {
                            match rs.tags.get("_id") {
                                Some(s) => s == "0",
                                _ => false,
                            }
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

    #[test]
    fn handles_block_group() {
        current_thread::run(lazy(|| {
            let now = Instant::now();
            let template_values = json::json!({"response": {}}).into();
            let included_outgoing_indexes = btreeset!(0, 1, 2);

            let select1 = Select::simple("1 + 1", Block, Some(vec!["repeat(3)"]), None, None);
            let (outgoing1, mut rx1, cb_called1) = create_outgoing(select1);

            let select2 = Select::simple("1", Block, None, None, None);
            let (outgoing2, mut rx2, cb_called2) = create_outgoing(select2);

            let select3 = Select::simple(
                "response.body.foo",
                Block,
                Some(vec!["repeat(2)"]),
                None,
                None,
            );
            let (outgoing3, mut rx3, cb_called3) = create_outgoing(select3);

            let outgoing = vec![outgoing1, outgoing2, outgoing3].into();
            let (stats_tx, stats_rx) = futures_channel::unbounded();
            let status = 200;
            let tags = Arc::new(BTreeMap::new());

            let bh = BodyHandler {
                now,
                provider_delays: ProviderDelays::new(),
                template_values,
                included_outgoing_indexes,
                outgoing,
                stats_tx,
                status,
                tags,
            };

            type AutoReturns = Arc<Mutex<Option<Box<dyn Future<Item = (), Error = TestError>>>>>;
            let auto_returns: AutoReturns = Arc::new(Mutex::new(None));

            bh.handle(Ok(Some(json::json!({"foo": "bar"}))), auto_returns)
                .then(move |r| {
                    assert!(r.is_ok());

                    // check that the different providers got data sent to them
                    let r = rx1.poll();
                    let b = match &r {
                        Ok(Async::Ready(Some(json::Value::Number(n)))) if *n == 2.into() => true,
                        _ => false,
                    };
                    assert!(b, "receiver 1 received correct data, {:?}", r);
                    let r = rx1.poll();
                    let b = match r {
                        Ok(Async::Ready(None)) => true,
                        _ => false,
                    };
                    assert!(b, "receiver 1 is closed, {:?}", r);
                    assert_eq!(cb_called1.load(Ordering::Relaxed), 2, "callback 1 called");

                    let r = rx2.poll();
                    let b = match &r {
                        Ok(Async::Ready(Some(json::Value::Number(n)))) if *n == 1.into() => true,
                        _ => false,
                    };
                    assert!(b, "receiver 2 received correct data, {:?}", r);
                    let r = rx2.poll();
                    let b = match r {
                        Ok(Async::Ready(None)) => true,
                        _ => false,
                    };
                    assert!(b, "receiver 2 is closed, {:?}", r);
                    assert_eq!(cb_called2.load(Ordering::Relaxed), 2, "callback 2 called");

                    let r = rx3.poll();
                    let b = match &r {
                        Ok(Async::Ready(Some(json::Value::String(s)))) if s == "bar" => true,
                        _ => false,
                    };
                    assert!(b, "receiver 3 received correct data, {:?}", r);
                    let r = rx3.poll();
                    let b = match r {
                        Ok(Async::Ready(None)) => true,
                        _ => false,
                    };
                    assert!(b, "receiver 3 is closed, {:?}", r);
                    assert_eq!(cb_called3.load(Ordering::Relaxed), 2, "callback 3 called");

                    drop(stats_rx);
                    Ok(())
                })
        }));
    }
}
