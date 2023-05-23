use crate::error::RecoverableError;
use crate::stats;

use config::{
    common::ProviderSend,
    templating::{Regular, Template, True},
};
use ether::EitherExt;
use futures::{
    future::{select_all, try_join_all},
    FutureExt, TryFutureExt,
};
use log::debug;
use serde_json as json;

use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
    future::Future,
    sync::Arc,
    time::{Instant, SystemTime},
};

use super::{BlockSender, Outgoing, ProviderDelays, ProviderOrLogger, StatsTx, TemplateValues};

pub(super) struct BodyHandler {
    pub(super) included_outgoing_indexes: BTreeSet<usize>,
    pub(super) now: Instant,
    pub(super) outgoing: Arc<Vec<Outgoing>>,
    pub(super) provider_delays: ProviderDelays,
    pub(super) stats_tx: StatsTx,
    pub(super) status: u16,
    pub(super) tags: Arc<BTreeMap<Arc<str>, Template<String, Regular, True>>>,
    pub(super) template_values: TemplateValues,
}

impl BodyHandler {
    // this function is not async because of a compiler bug which raises a nonsensical error
    // https://github.com/rust-lang/rust/issues/71723
    pub(super) fn handle<F>(
        self,
        result: Result<Option<json::Value>, RecoverableError>,
        auto_returns: Option<F>,
    ) -> impl Future<Output = Result<(), RecoverableError>>
    where
        F: Future<Output = ()> + Send,
    {
        let stats_tx = self.stats_tx;
        let outgoing = self.outgoing.clone();
        let has_logger = outgoing.iter().any(|o| o.tx.is_logger());
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
        let tags: BTreeMap<Arc<str>, String> = self
            .tags
            .iter()
            .filter_map(|(k, t)| {
                t.evaluate(Cow::Borrowed(&*template_values))
                    .ok()
                    .map(|v| (Arc::clone(k), v))
            })
            .collect();
        let tags = Arc::new(tags);
        self.provider_delays.log(&tags, &stats_tx);

        let send_response_stat = move |kind, rtt| {
            let mut futures = Vec::new();
            if let stats::StatKind::RecoverableError(e) = &kind {
                if has_logger {
                    let error = json::json!({
                        "msg": format!("{e}"),
                        "code": e.code(),
                    });
                    let mut tv = (*template_values2).clone();
                    tv.as_object_mut()
                        .expect("should be a json object")
                        .insert("error".into(), error);
                    let tv: Arc<_> = tv.into();
                    for o in outgoing.iter() {
                        let query = Arc::clone(&o.query);
                        let tv = Arc::clone(&tv);
                        if let ProviderOrLogger::Logger(tx) = &o.tx {
                            if let Ok(iter) = query.query(tv) {
                                let iter = iter.map(|v| v.map_err(Box::new).map_err(Into::into));
                                futures.push(
                                    BlockSender::new(iter, ProviderOrLogger::Logger(tx.clone()))
                                        .into_future(),
                                );
                            }
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
            try_join_all(futures).map_ok(|_| ())
        };
        let mut futures = Vec::new();
        if let Some(f) = auto_returns {
            futures.push(f.map(|_| Ok(())).a().b3());
        }
        if let Some(e) = error_result {
            let kind = stats::StatKind::RecoverableError(e);
            futures.push(send_response_stat(kind, None).a3());
        } else {
            let mut blocked = Vec::new();
            for (i, o) in self.outgoing.iter().enumerate() {
                if !self.included_outgoing_indexes.contains(&i) {
                    continue;
                }
                let query = Arc::clone(&o.query);
                let send_behavior = o.send;
                let iter = match query.query(template_values.clone()).map_err(Into::into) {
                    Ok(v) => v.map(|v| v.map_err(Box::new).map_err(Into::into)),
                    Err(e) => {
                        let r = RecoverableError::ExecutingExpression(e);
                        let kind = stats::StatKind::RecoverableError(r);
                        futures.push(send_response_stat(kind, None).a3());
                        continue;
                    }
                };
                match send_behavior {
                    // This is where we actually send or block from a request
                    ProviderSend::Block => {
                        debug!("BodyHandler:handle ProviderSend::Block {}", o.tx.name());
                        let tx = o.tx.clone();
                        let f = BlockSender::new(iter, tx).into_future().map(|_| Ok(()));
                        if o.tx.is_logger() {
                            futures.push(f.c3());
                        } else {
                            blocked.push(f.boxed());
                        }
                    }
                    ProviderSend::Force => {
                        debug!("BodyHandler:handle ProviderSend::Force {}", o.tx.name());
                        for v in iter {
                            let v = match v {
                                Ok(v) => v,
                                Err(r) => {
                                    let kind = stats::StatKind::RecoverableError(r);
                                    futures.push(send_response_stat(kind, None).a3());
                                    break;
                                }
                            };
                            if let ProviderOrLogger::Provider(tx) = &o.tx {
                                tx.force_send(v);
                            }
                        }
                    }
                    ProviderSend::IfNotFull => {
                        debug!("BodyHandler:handle ProviderSend::IfNotFull {}", o.tx.name());
                        for v in iter {
                            let v = match v {
                                Ok(v) => v,
                                Err(r) => {
                                    let kind = stats::StatKind::RecoverableError(r);
                                    futures.push(send_response_stat(kind, None).a3());
                                    break;
                                }
                            };
                            if let ProviderOrLogger::Provider(tx) = &o.tx {
                                if !tx.try_send(v).is_success() {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            if !blocked.is_empty() {
                // for all "send: block" provides on an endpoint, we only wait for at least one to send
                let f = select_all(blocked).map(|(_, _, rest)| {
                    for f in rest {
                        f.now_or_never();
                    }
                    Ok(())
                });
                futures.push(f.b().b3());
            }
        }
        futures.push(send_response_stat(stats::StatKind::Response(self.status), Some(rtt)).a3());
        try_join_all(futures).map_ok(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use channel::{Limit, Receiver};
    use config::query::Query;
    use futures::{channel::mpsc as futures_channel, executor::block_on, StreamExt};
    use maplit::{btreemap, btreeset};
    use std::sync::atomic::{AtomicBool, Ordering};

    fn create_outgoing(query: Query, send: ProviderSend) -> (Outgoing, Receiver<json::Value>) {
        let (tx, rx) = channel::channel(Limit::Static(1), false, &"create_outgoing".to_string());
        (
            Outgoing::new(query, send, ProviderOrLogger::Provider(tx)),
            rx,
        )
    }

    #[allow(clippy::cognitive_complexity)]
    #[test]
    fn handles_body() {
        let now = Instant::now();
        let template_values = json::json!({"response": {}}).into();
        let included_outgoing_indexes = btreeset!(0, 1, 2);

        let select1 = Query::simple("1 + 1".into(), vec!["repeat(3)".into()], None).unwrap();
        let (outgoing1, mut rx1) = create_outgoing(select1, ProviderSend::Force);

        let select2 = Query::simple("1".into(), vec![], None).unwrap();
        let (outgoing2, mut rx2) = create_outgoing(select2, ProviderSend::Block);

        let select3 = Query::simple(
            "response.body.foo".to_owned(),
            vec!["repeat(3)".to_owned()],
            None,
        )
        .unwrap();
        let (outgoing3, mut rx3) = create_outgoing(select3, ProviderSend::IfNotFull);

        let select4 = Query::simple("1".to_owned(), vec![], None).unwrap();
        let (outgoing4, mut rx4) = create_outgoing(select4, ProviderSend::Block);

        let outgoing = vec![outgoing1, outgoing2, outgoing3, outgoing4].into();
        let (stats_tx, mut stats_rx) = futures_channel::unbounded();
        let status = 200;
        let tags = Arc::new(btreemap! {"_id".into() => Template::new_literal("0".to_owned()) });

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

        let auto_returns = {
            let f = futures::future::ready(()).map(move |_| {
                auto_return_called.store(true, Ordering::Relaxed);
            });
            Some(f)
        };

        let _ = block_on(bh.handle(Ok(Some(json::json!({"foo": "bar"}))), auto_returns)).unwrap();
        assert!(auto_return_called2.load(Ordering::Relaxed));

        // check that the different providers got data sent to them
        for _ in 0..3 {
            let r = rx1.next().now_or_never();
            let b = match &r {
                Some(Some(json::Value::Number(n))) if *n == 2.into() => true,
                _ => false,
            };
            assert!(b, "force receiver received correct data, {:?}", r);
        }
        let r = rx1.next().now_or_never();
        let b = match r {
            Some(None) => true,
            _ => false,
        };
        assert!(b, "forced receiver is closed, {:?}", r);

        let r = rx2.next().now_or_never();
        let b = match &r {
            Some(Some(json::Value::Number(n))) if *n == 1.into() => true,
            _ => false,
        };
        assert!(b, "block receiver received correct data, {:?}", r);
        let r = rx2.next().now_or_never();
        let b = match r {
            Some(None) => true,
            _ => false,
        };
        assert!(b, "block receier is closed, {:?}", r);

        let r = rx3.next().now_or_never();
        let b = match &r {
            Some(Some(json::Value::String(s))) if s == "bar" => true,
            _ => false,
        };
        assert!(b, "if_not_full receiver received correct data, {:?}", r);
        let r = rx3.next().now_or_never();
        let b = match r {
            Some(None) => true,
            _ => false,
        };
        assert!(b, "if_not_full is closed, {:?}", r);

        let r = rx4.next().now_or_never();
        let b = match r {
            Some(None) => true,
            _ => false,
        };
        assert!(b, "not included receier is closed, {:?}", r);

        // check that the stats_rx received the correct stats data
        let r = stats_rx.next().now_or_never();
        let b = match &r {
            Some(Some(stats::StatsMessage::ResponseStat(rs))) => match rs.tags.get("_id") {
                Some(s) => s == "0",
                _ => false,
            },
            _ => false,
        };
        assert!(b, "stats_rx should have received response stat. {:?}", r);

        let r = stats_rx.next().now_or_never();
        let b = match &r {
            Some(None) => true,
            _ => false,
        };
        assert!(b, "stats_rx should be closed. {:?}", r);
    }

    #[test]
    fn handles_block_group() {
        let now = Instant::now();
        let template_values = json::json!({"response": {}}).into();
        let included_outgoing_indexes = btreeset!(0, 1, 2);

        let q1 = Query::simple("1 + 1".to_owned(), vec!["repeat(3)".to_owned()], None).unwrap();
        let (outgoing1, mut rx1) = create_outgoing(q1, ProviderSend::Block);

        let q2 = Query::simple("1".to_owned(), vec![], None).unwrap();
        let (outgoing2, mut rx2) = create_outgoing(q2, ProviderSend::Block);

        let q3 = Query::simple(
            "response.body.foo".to_owned(),
            vec!["repeat(2)".to_owned()],
            None,
        )
        .unwrap();
        let (outgoing3, mut rx3) = create_outgoing(q3, ProviderSend::Block);

        let outgoing = vec![outgoing1, outgoing2, outgoing3].into();
        let (stats_tx, _) = futures_channel::unbounded();
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

        type AutoReturns = Option<Box<dyn Future<Output = ()> + Send + Unpin>>;
        let auto_returns: AutoReturns = None;

        let r = block_on(bh.handle(Ok(Some(json::json!({"foo": "bar"}))), auto_returns));
        assert!(r.is_ok());

        // check that the different providers got data sent to them
        let r = rx1.next().now_or_never();
        let b = match &r {
            Some(Some(json::Value::Number(n))) if *n == 2.into() => true,
            _ => false,
        };
        assert!(b, "receiver 1 received correct data, {:?}", r);
        let r = rx1.next().now_or_never();
        let b = match r {
            Some(None) => true,
            _ => false,
        };
        assert!(b, "receiver 1 is closed, {:?}", r);

        let r = rx2.next().now_or_never();
        let b = match &r {
            Some(Some(json::Value::Number(n))) if *n == 1.into() => true,
            _ => false,
        };
        assert!(b, "receiver 2 received correct data, {:?}", r);
        let r = rx2.next().now_or_never();
        let b = match r {
            Some(None) => true,
            _ => false,
        };
        assert!(b, "receiver 2 is closed, {:?}", r);

        let r = rx3.next().now_or_never();
        let b = match &r {
            Some(Some(json::Value::String(s))) if s == "bar" => true,
            _ => false,
        };
        assert!(b, "receiver 3 received correct data, {:?}", r);
        let r = rx3.next().now_or_never();
        let b = match r {
            Some(None) => true,
            _ => false,
        };
        assert!(b, "receiver 3 is closed, {:?}", r);
    }
}
