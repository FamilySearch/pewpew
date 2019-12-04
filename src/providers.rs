mod csv_reader;
mod json_reader;
mod line_reader;

use self::{csv_reader::CsvReader, json_reader::JsonReader, line_reader::LineReader};

use crate::error::TestError;
use crate::util::json_value_to_string;
use crate::TestEndReason;

use bytes::{Buf, Bytes, IntoBuf};
use ether::{Either, Either3};
use futures::{
    stream, sync::mpsc::Sender as FCSender, Async, AsyncSink, Future, IntoFuture, Sink, Stream,
};
use serde_json as json;
use tokio_threadpool::blocking;

use std::{borrow::Cow, io};

pub struct Provider {
    pub auto_return: Option<config::EndpointProvidesSendOptions>,
    pub rx: channel::Receiver<json::Value>,
    pub tx: channel::Sender<json::Value>,
    pub on_demand: channel::OnDemandReceiver<json::Value>,
}

impl Provider {
    fn new(
        auto_return: Option<config::EndpointProvidesSendOptions>,
        rx: channel::Receiver<json::Value>,
        tx: channel::Sender<json::Value>,
    ) -> Self {
        Provider {
            auto_return,
            on_demand: channel::OnDemandReceiver::new(&rx),
            rx,
            tx,
        }
    }
}

pub fn file(
    mut template: config::FileProvider,
    test_killer: FCSender<Result<TestEndReason, TestError>>,
) -> Result<Provider, TestError> {
    let file = std::mem::replace(&mut template.path, Default::default());
    let file2 = file.clone();
    let stream = match template.format {
        config::FileFormat::Csv => Either3::A(
            CsvReader::new(&template, &file)
                .map_err(|e| TestError::CannotOpenFile(file.into(), e.into()))?
                .into_stream(),
        ),
        config::FileFormat::Json => Either3::B(
            JsonReader::new(&template, &file)
                .map_err(|e| TestError::CannotOpenFile(file.into(), e.into()))?
                .into_stream(),
        ),
        config::FileFormat::Line => Either3::C(
            LineReader::new(&template, &file)
                .map_err(|e| TestError::CannotOpenFile(file.into(), e.into()))?
                .into_stream(),
        ),
    };
    let (tx, rx) = channel::channel(template.buffer);
    let tx2 = tx.clone();
    let prime_tx = stream
        .map_err(move |e| {
            let e = TestError::FileReading(file2.clone(), e.into());
            channel::ChannelClosed::wrapped(e)
        })
        .forward(tx2)
        .map(|_| ())
        .or_else(move |e| match e.inner_cast() {
            Some(e) => Either::A(test_killer.send(Err(*e)).then(|_| Ok(()))),
            None => Either::B(Ok(()).into_future()),
        });

    tokio::spawn(prime_tx);
    Ok(Provider::new(template.auto_return, rx, tx))
}

pub fn response(template: config::ResponseProvider) -> Provider {
    let (tx, rx) = channel::channel(template.buffer);
    Provider::new(template.auto_return, rx, tx)
}

pub fn literals(list: config::StaticList) -> Provider {
    let rs = stream::iter_ok::<_, channel::ChannelClosed>(list.into_iter());
    let (tx, rx) = channel::channel(config::Limit::auto());
    let tx2 = tx.clone();
    let prime_tx = rs
        .forward(tx2)
        // Error propagate here when sender channel closes at test conclusion
        .then(|_| Ok(()));
    tokio::spawn(prime_tx);
    Provider::new(None, rx, tx)
}

pub fn range(range: config::RangeProvider) -> Provider {
    let (tx, rx) = channel::channel(config::Limit::auto());
    let prime_tx = stream::iter_ok::<_, channel::ChannelClosed>(range.0.map(json::Value::from))
        .forward(tx.clone())
        // Error propagate here when sender channel closes at test conclusion
        .then(|_| Ok(()));
    tokio::spawn(prime_tx);
    Provider::new(None, rx, tx)
}

struct LogSink<W>
where
    W: tokio::io::AsyncWrite + Send + Sync + 'static,
{
    buf: Option<io::Cursor<Bytes>>,
    name: String,
    pretty: bool,
    writer: W,
}

impl<W> Sink for LogSink<W>
where
    W: tokio::io::AsyncWrite + Send + Sync + 'static,
{
    type SinkItem = json::Value;
    type SinkError = TestError;

    fn start_send(
        &mut self,
        item: Self::SinkItem,
    ) -> Result<AsyncSink<Self::SinkItem>, Self::SinkError> {
        if self.buf.is_some() {
            match self.poll_complete() {
                Ok(Async::Ready(_)) => (),
                Ok(Async::NotReady) => return Ok(AsyncSink::NotReady(item)),
                Err(e) => return Err(e),
            }
        }
        let buf = if self.pretty && !item.is_string() {
            let pretty = format!("{:#}\n", item);
            Bytes::from(pretty).into_buf()
        } else {
            let mut s = json_value_to_string(Cow::Owned(item)).into_owned();
            s.push('\n');
            Bytes::from(s).into_buf()
        };
        self.buf = Some(buf);
        Ok(AsyncSink::Ready)
    }

    fn poll_complete(&mut self) -> Result<Async<()>, Self::SinkError> {
        loop {
            if let Some(ref mut buf) = &mut self.buf {
                match self.writer.write_buf(buf) {
                    Ok(Async::Ready(_)) if !buf.has_remaining() => {
                        self.buf = None;
                        return self
                            .writer
                            .poll_flush()
                            .map_err(|e| TestError::WritingToLogger(self.name.clone(), e.into()));
                    }
                    Ok(Async::Ready(_)) => continue,
                    Ok(Async::NotReady) => return Ok(Async::NotReady),
                    Err(e) => {
                        let e = TestError::WritingToLogger(self.name.clone(), e.into());
                        return Err(e);
                    }
                }
            } else {
                return self
                    .writer
                    .poll_flush()
                    .map_err(|e| TestError::WritingToLogger(self.name.clone(), e.into()));
            }
        }
    }
}

pub fn logger<F, W>(
    name: String,
    template: config::Logger,
    test_killer: FCSender<Result<TestEndReason, TestError>>,
    writer_future: F,
) -> channel::Sender<json::Value>
where
    F: Future<Item = W, Error = TestError> + Send + Sync + 'static,
    W: tokio::io::AsyncWrite + Send + Sync + 'static,
{
    let (tx, rx) = channel::channel::<json::Value>(config::Limit::Integer(5));
    let pretty = template.pretty;
    let kill = template.kill;
    let limit = if kill && template.limit.is_none() {
        Some(1)
    } else {
        template.limit
    };
    let logger = writer_future
        .and_then(move |writer| {
            let sink = LogSink {
                buf: None,
                name,
                pretty,
                writer,
            };
            let rx = if let Some(limit) = limit {
                Either::A(rx.take(limit as u64))
            } else {
                Either::B(rx)
            };
            rx.map_err(|_| unreachable!("logger receiver unexpectedly errored"))
                .forward(sink)
        })
        .then(move |r| match r {
            Ok(_) if kill => Either3::A(
                test_killer
                    .send(Ok(TestEndReason::KilledByLogger))
                    .then(|_| Ok(())),
            ),
            Ok(_) => Either3::B(Ok(()).into_future()),
            Err(e) => Either3::C(test_killer.send(Err(e)).then(|_| Ok::<_, ()>(()))),
        });
    tokio::spawn(logger);
    tx
}

fn into_stream<I: Iterator<Item = Result<json::Value, io::Error>>>(
    mut iter: I,
) -> impl Stream<Item = json::Value, Error = io::Error> {
    stream::poll_fn(move || blocking(|| iter.next()))
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))
        .and_then(|r| r)
}

#[cfg(test)]
mod tests {
    use super::*;

    use futures::{future, sync::mpsc::channel as futures_channel, Async};
    use json::json;
    use test_common::TestWriter;
    use tokio::runtime::current_thread;

    use std::{
        collections::BTreeSet,
        time::{Duration, Instant},
    };

    #[test]
    fn range_provider_works() {
        current_thread::run(future::lazy(|| {
            let range_params = r#"
                start: 0
                end: 20
            "#;
            let range_params = config::FromYaml::from_yaml_str(range_params).unwrap();
            let p = range(range_params);
            let expects = stream::iter_ok(0..=20);

            let f = p.rx.zip(expects).for_each(|(left, right)| {
                assert_eq!(left, right);
                Ok(())
            });
            current_thread::spawn(f);

            let range_params = r#"
                start: 0
                end: 20
                step: 2
            "#;
            let range_params = config::FromYaml::from_yaml_str(range_params).unwrap();
            let p = range(range_params);
            let expects = stream::iter_ok((0..=20).step_by(2));

            let f = p.rx.zip(expects).for_each(|(left, right)| {
                assert_eq!(left, right);
                Ok(())
            });
            current_thread::spawn(f);

            let range_params = r#"
                start: 0
                end: 20
                repeat: true
            "#;

            let range_params = config::FromYaml::from_yaml_str(range_params).unwrap();
            let p = range(range_params);
            let expects = stream::iter_ok((0..=20).cycle());

            p.rx.zip(expects).take(100).for_each(|(left, right)| {
                assert_eq!(left, right);
                Ok(())
            })
        }));
    }

    #[test]
    fn literals_provider_works() {
        current_thread::run(future::lazy(|| {
            let jsons = vec![json!(1), json!(2), json!(3)];

            let esl = config::ExplicitStaticList {
                values: jsons.clone(),
                repeat: false,
                random: false,
            };

            let p = literals(esl.into());
            let expects = stream::iter_ok(jsons.clone().into_iter());

            let f = p.rx.zip(expects).for_each(|(left, right)| {
                assert_eq!(left, right);
                Ok(())
            });

            tokio::spawn(f);

            let esl = config::ExplicitStaticList {
                values: jsons.clone(),
                repeat: false,
                random: true,
            };

            let p = literals(esl.into());

            let jsons2 = jsons.clone();
            let f = p.rx.collect().and_then(move |mut v| {
                v.sort_unstable_by_key(|v| v.clone().as_u64().unwrap());
                assert_eq!(v, jsons2);
                Ok(())
            });

            tokio::spawn(f);

            let esl = config::ExplicitStaticList {
                values: jsons.clone(),
                repeat: true,
                random: false,
            };

            let p = literals(esl.into());
            let expects = stream::iter_ok(jsons.clone().into_iter().cycle());

            let f = p.rx.zip(expects).take(50).for_each(|(left, right)| {
                assert_eq!(left, right);
                Ok(())
            });

            tokio::spawn(f);

            let esl = config::ExplicitStaticList {
                values: jsons.clone(),
                repeat: true,
                random: true,
            };

            let p = literals(esl.into());
            let expects: BTreeSet<_> = jsons
                .clone()
                .into_iter()
                .map(|v| v.as_u64().unwrap())
                .collect();
            let jsons2: Vec<_> = jsons.clone().into_iter().cycle().take(500).collect();

            let f = p.rx.take(500).collect().and_then(move |v| {
                assert_ne!(v, jsons2);
                for j in v {
                    assert!(expects.contains(&j.as_u64().unwrap()));
                }
                Ok(())
            });

            tokio::spawn(f);

            let p = literals(jsons.clone().into());
            let expects = stream::iter_ok(jsons.into_iter().cycle());

            p.rx.zip(expects).take(50).for_each(|(left, right)| {
                assert_eq!(left, right);
                Ok(())
            })
        }));
    }

    #[test]
    fn response_provider_works() {
        current_thread::run(future::lazy(|| {
            let jsons = vec![json!(1), json!(2), json!(3)];
            let rp = config::ResponseProvider {
                auto_return: None,
                buffer: config::Limit::auto(),
            };
            let p = response(rp);
            let responses = stream::iter_ok(jsons.clone().into_iter().cycle());
            current_thread::spawn(p.tx.send_all(responses).then(|_| Ok(())));

            let expects = stream::iter_ok(jsons.into_iter().cycle());

            p.rx.zip(expects).take(50).for_each(|(left, right)| {
                assert_eq!(left, right);
                Ok(())
            })
        }));
    }

    #[test]
    fn basic_logger_works() {
        current_thread::run(future::lazy(|| {
            let logger_params = r#"
                to: ""
                kill: true
            "#;
            let logger_params = config::FromYaml::from_yaml_str(logger_params).unwrap();
            let (logger_params, _) = config::Logger::from_pre_processed(
                logger_params,
                &Default::default(),
                &mut Default::default(),
            )
            .unwrap();
            let (test_killer, mut test_killed_rx) = futures_channel(1);
            let writer = TestWriter::new();
            let writer_future = future::ok(writer.clone());

            let tx = logger("".into(), logger_params, test_killer.clone(), writer_future);

            tokio::spawn(
                tx.send_all(stream::iter_ok(vec![json!(1), json!(2)]))
                    .then(|_| Ok(())),
            );

            let f = tokio::timer::Delay::new(Instant::now() + Duration::from_millis(100)).then(
                move |_| {
                    let left = writer.get_string();
                    let right = "1\n";
                    assert_eq!(left, right, "value in writer should match");

                    let check = if let Ok(Async::Ready(Some(Ok(TestEndReason::KilledByLogger)))) =
                        test_killed_rx.poll()
                    {
                        true
                    } else {
                        false
                    };
                    assert!(check, "test should be killed");
                    drop(test_killer);
                    Ok(())
                },
            );

            tokio::spawn(f);

            Ok(())
        }));
    }

    #[test]
    fn basic_logger_works_with_large_data() {
        current_thread::run(future::lazy(|| {
            let logger_params = r#"
                to: ""
            "#;
            let logger_params = config::FromYaml::from_yaml_str(logger_params).unwrap();
            let (logger_params, _) = config::Logger::from_pre_processed(
                logger_params,
                &Default::default(),
                &mut Default::default(),
            )
            .unwrap();
            let (test_killer, mut test_killed_rx) = futures_channel(1);
            let writer = TestWriter::new();
            let writer_future = future::ok(writer.clone());

            let tx = logger("".into(), logger_params, test_killer.clone(), writer_future);

            let right: String = (0..1000).map(|_| {
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum."
            }).collect();

            tokio::spawn(
                tx.send_all(stream::iter_ok(vec![right.clone().into()]))
                    .then(|_| Ok(())),
            );

            let f = tokio::timer::Delay::new(Instant::now() + Duration::from_millis(100)).then(
                move |_| {
                    let left = writer.get_string();
                    assert_eq!(left, format!("{}\n", right), "value in writer should match");

                    let check = if let Ok(Async::Ready(Some(Err(_)))) = test_killed_rx.poll() {
                        false
                    } else {
                        true
                    };
                    assert!(check, "test should not be killed");
                    drop(test_killer);
                    Ok(())
                },
            );

            tokio::spawn(f);

            Ok(())
        }));
    }

    #[test]
    fn basic_logger_works_with_would_block() {
        current_thread::run(future::lazy(|| {
            let logger_params = r#"
                to: ""
            "#;
            let logger_params = config::FromYaml::from_yaml_str(logger_params).unwrap();
            let (logger_params, _) = config::Logger::from_pre_processed(
                logger_params,
                &Default::default(),
                &mut Default::default(),
            )
            .unwrap();
            let (test_killer, mut test_killed_rx) = futures_channel(1);
            let writer = TestWriter::new();
            writer.do_would_block_on_next_write();
            let writer_future = future::ok(writer.clone());

            let tx = logger("".into(), logger_params, test_killer.clone(), writer_future);

            tokio::spawn(
                tx.send_all(stream::iter_ok(vec![json!(1), json!(2)]))
                    .then(|_| Ok(())),
            );

            let f = tokio::timer::Delay::new(Instant::now() + Duration::from_millis(100)).then(
                move |_| {
                    let left = writer.get_string();
                    let right = "1\n2\n";
                    assert_eq!(left, right, "value in writer should match");

                    let check = if let Ok(Async::Ready(Some(Err(_)))) = test_killed_rx.poll() {
                        false
                    } else {
                        true
                    };
                    assert!(check, "test should not be killed");
                    drop(test_killer);
                    Ok(())
                },
            );

            tokio::spawn(f);

            Ok(())
        }));
    }

    #[test]
    fn logger_limit_works() {
        current_thread::run(future::lazy(|| {
            let logger_params = r#"
                to: ""
                limit: 1
            "#;
            let logger_params = config::FromYaml::from_yaml_str(logger_params).unwrap();
            let (logger_params, _) = config::Logger::from_pre_processed(
                logger_params,
                &Default::default(),
                &mut Default::default(),
            )
            .unwrap();
            let (test_killer, mut test_killed_rx) = futures_channel(1);
            let writer = TestWriter::new();
            let writer_future = future::ok(writer.clone());

            let tx = logger("".into(), logger_params, test_killer.clone(), writer_future);

            tokio::spawn(
                tx.send_all(stream::iter_ok(vec![json!(1), json!(2)]))
                    .then(|_| Ok(())),
            );

            let f = tokio::timer::Delay::new(Instant::now() + Duration::from_millis(100)).then(
                move |_| {
                    let left = writer.get_string();
                    let right = "1\n";
                    assert_eq!(left, right, "value in writer should match");

                    let check = if let Ok(Async::NotReady) = test_killed_rx.poll() {
                        true
                    } else {
                        false
                    };
                    assert!(check, "test should not be killed");
                    drop(test_killer);
                    Ok(())
                },
            );

            tokio::spawn(f);

            Ok(())
        }));
    }

    #[test]
    fn logger_pretty_works() {
        current_thread::run(future::lazy(|| {
            let logger_params = r#"
                to: ""
                pretty: true
            "#;
            let logger_params = config::FromYaml::from_yaml_str(logger_params).unwrap();
            let (logger_params, _) = config::Logger::from_pre_processed(
                logger_params,
                &Default::default(),
                &mut Default::default(),
            )
            .unwrap();
            let (test_killer, mut test_killed_rx) = futures_channel(1);
            let writer = TestWriter::new();
            let writer_future = future::ok(writer.clone());

            let tx = logger("".into(), logger_params, test_killer.clone(), writer_future);

            tokio::spawn(
                tx.send_all(stream::iter_ok(vec![json!({"foo": [1, 2, 3]}), json!(2)]))
                    .then(|_| Ok(())),
            );

            let f = tokio::timer::Delay::new(Instant::now() + Duration::from_millis(100)).then(
                move |_| {
                    let left = writer.get_string();
                    let right = "{\n  \"foo\": [\n    1,\n    2,\n    3\n  ]\n}\n2\n";
                    assert_eq!(left, right, "value in writer should match");

                    let check = if let Ok(Async::NotReady) = test_killed_rx.poll() {
                        true
                    } else {
                        false
                    };
                    assert!(check, "test should not be killed");
                    drop(test_killer);
                    Ok(())
                },
            );

            tokio::spawn(f);

            Ok(())
        }));
    }
}
