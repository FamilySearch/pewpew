mod csv_reader;
mod json_reader;
mod line_reader;

use self::{csv_reader::CsvReader, json_reader::JsonReader, line_reader::LineReader};

use crate::config;
use crate::error::TestError;
use crate::load_test::TestEndReason;
use crate::util::{json_value_into_string, tweak_path};

use channel::Limit;
use ether::{Either, Either3};
use futures::{stream, sync::mpsc::Sender as FCSender, Future, IntoFuture, Sink, Stream};
use serde_json as json;
use tokio_threadpool::blocking;

use std::{io, path::PathBuf};

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
    config_path: &PathBuf,
) -> Result<Provider, TestError> {
    tweak_path(&mut template.path, config_path);
    let file = template.path.clone();
    let test_killer2 = test_killer.clone();
    let stream = match template.format {
        config::FileFormat::Csv => Either3::A(
            CsvReader::new(&template)
                .map_err(|e| {
                    TestError::Other(
                        format!("creating file reader from file `{}`: {}", file, e).into(),
                    )
                })?
                .into_stream(),
        ),
        config::FileFormat::Json => Either3::B(
            JsonReader::new(&template)
                .map_err(|e| {
                    TestError::Other(
                        format!("creating file reader from file `{}`: {}", file, e).into(),
                    )
                })?
                .into_stream(),
        ),
        config::FileFormat::Line => Either3::C(
            LineReader::new(&template)
                .map_err(|e| {
                    TestError::Other(
                        format!("creating file reader from file `{}`: {}", file, e).into(),
                    )
                })?
                .into_stream(),
        ),
    };
    let (tx, rx) = channel::channel(template.buffer);
    let tx2 = tx.clone();
    let prime_tx = stream
        .map_err(move |e| {
            let e = TestError::Other(format!("reading file `{}`: {}", file, e).into());
            channel::ChannelClosed::wrapped(e)
        })
        .forward(tx2)
        .map(|_| ())
        .or_else(move |e| match e.inner_cast() {
            Some(e) => Either::A(test_killer2.send(Err(*e)).then(|_| Ok(()))),
            None => Either::B(Ok(()).into_future()),
        });

    tokio::spawn(prime_tx);
    Ok(Provider::new(template.auto_return, rx, tx))
}

pub fn response(template: config::ResponseProvider) -> Provider {
    let (tx, rx) = channel::channel(template.buffer);
    Provider::new(template.auto_return, rx, tx)
}

pub fn literals(values: Vec<json::Value>) -> Provider {
    let rs = stream::iter_ok::<_, channel::ChannelClosed>(values.into_iter().cycle());
    let (tx, rx) = channel::channel(Limit::auto());
    let tx2 = tx.clone();
    let prime_tx = rs
        .forward(tx2)
        // Error propagate here when sender channel closes at test conclusion
        .then(|_| Ok(()));
    tokio::spawn(prime_tx);
    Provider::new(None, rx, tx)
}

pub fn range(range: config::RangeProvider) -> Provider {
    let (tx, rx) = channel::channel(Limit::auto());
    let prime_tx = stream::iter_ok::<_, channel::ChannelClosed>(range.0.map(json::Value::from))
        .forward(tx.clone())
        // Error propagate here when sender channel closes at test conclusion
        .then(|_| Ok(()));
    tokio::spawn(prime_tx);
    Provider::new(None, rx, tx)
}

pub fn logger<F, W>(
    name: String,
    template: config::Logger,
    test_killer: FCSender<Result<TestEndReason, TestError>>,
    writer_future: F,
) -> channel::Sender<json::Value>
where
    F: Future<Item = W, Error = TestError> + Send + Sync + 'static,
    W: io::Write + Send + Sync + 'static,
{
    let (tx, rx) = channel::channel::<json::Value>(Limit::Integer(5));
    let limit = template.limit;
    let pretty = template.pretty;
    let kill = template.kill;
    let mut counter = 0;
    let mut keep_logging = true;
    let test_killer2 = test_killer.clone();
    let logger = writer_future
        .and_then(move |mut writer| {
            rx.map_err(|_| TestError::Internal("logger receiver unexpectedly errored".into()))
                .for_each(move |v| {
                    counter += 1;
                    let result = if keep_logging {
                        if pretty {
                            writeln!(writer, "{:#}", v)
                        } else {
                            writeln!(writer, "{}", json_value_into_string(v))
                        }
                    } else {
                        Ok(())
                    };
                    let result = result
                        .map_err(|e| {
                            TestError::Other(format!("writing to logger `{}`: {}", name, e).into())
                        })
                        .into_future();
                    match limit {
                        Some(limit) if counter >= limit => {
                            keep_logging = false;
                            if kill {
                                Either3::B(
                                    test_killer
                                        .clone()
                                        .send(Err(TestError::KilledByLogger))
                                        .then(|_| Ok(())),
                                )
                            } else {
                                Either3::A(result)
                            }
                        }
                        None if kill => {
                            keep_logging = false;
                            Either3::C(
                                test_killer
                                    .clone()
                                    .send(Err(TestError::KilledByLogger))
                                    .then(|_| Ok(())),
                            )
                        },
                        _ => Either3::A(result),
                    }
                })
        })
        .or_else(move |e| test_killer2.send(Err(e)).then(|_| Ok::<_, ()>(())))
        .then(|_| Ok(()));
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
    use futures::{
        future,
        sync::mpsc::channel as futures_channel,
        Async,
    };
    use json::json;
    use parking_lot::Mutex;
    use tokio::runtime::current_thread;

    use std::{
        sync::Arc,
        time::{Duration, Instant},
    };

    #[test]
    fn range_provider_works() {
        current_thread::run(future::lazy(|| {
            let range_params = r#"{
                "start": 0,
                "end": 20
            }"#;
            let range_params = serde_json::from_str(range_params).unwrap();
            let p = range(range_params);
            let expects = stream::iter_ok(0..=20);

            let f = p.rx.zip(expects).for_each(|(left, right)| {
                assert_eq!(left, right);
                Ok(())
            });
            current_thread::spawn(f);

            let range_params = r#"{
                "start": 0,
                "end": 20,
                "step": 2
            }"#;
            let range_params = serde_json::from_str(range_params).unwrap();
            let p = range(range_params);
            let expects = stream::iter_ok((0..=20).step_by(2));

            let f = p.rx.zip(expects).for_each(|(left, right)| {
                assert_eq!(left, right);
                Ok(())
            });
            current_thread::spawn(f);

            let range_params = r#"{
                "start": 0,
                "end": 20,
                "repeat": true
            }"#;

            let range_params = serde_json::from_str(range_params).unwrap();
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
            let p = literals(jsons.clone());
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
                buffer: Limit::auto(),
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

    #[derive(Clone)]
    struct TestWriter(Arc<Mutex<Vec<u8>>>);

    impl TestWriter {
        fn new() -> Self {
            TestWriter(Mutex::new(Vec::new()).into())
        }

        fn get_string(&self) -> String {
            String::from_utf8(self.0.lock().split_off(0)).unwrap()
        }
    }

    impl io::Write for TestWriter {
        fn write(&mut self, buf: &[u8]) -> std::result::Result<usize, std::io::Error> {
            self.0.lock().write(buf)
        }

        fn flush(&mut self) -> std::result::Result<(), std::io::Error> {
            io::Write::flush(&mut *self.0.lock())
        }
    }

    #[test]
    fn basic_logger_works() {
        current_thread::run(future::lazy(|| {
            let logger_params = r#"{
                "to": "",
                "kill": true
            }"#;
            let logger_params = serde_json::from_str(logger_params).unwrap();
            let (test_killer, mut test_killed_rx) = futures_channel(1);
            let writer = TestWriter::new();
            let writer_future = future::ok(writer.clone());

            let tx = logger("".into(), logger_params, test_killer.clone(), writer_future);

            tokio::spawn(
                tx.send_all(stream::iter_ok(vec!(json!(1), json!(2))))
                    .then(|_| Ok(()))
            );

            let f = tokio::timer::Delay::new(Instant::now() + Duration::from_millis(100))
                .then(move |_| {
                    let left = writer.get_string();
                    let right = "1\n";
                    assert_eq!(left, right, "value in writer should match");
                    
                    let check = if let Ok(Async::Ready(Some(Err(_)))) = test_killed_rx.poll() {
                        true
                    } else {
                        false
                    };
                    assert!(check, "test should be killed");
                    drop(test_killer);
                    Ok(())
                });

            tokio::spawn(f);

            Ok(())
        }));
    }

    #[test]
    fn logger_limit_works() {
        current_thread::run(future::lazy(|| {
            let logger_params = r#"{
                "to": "",
                "limit": 1
            }"#;
            let logger_params = serde_json::from_str(logger_params).unwrap();
            let (test_killer, mut test_killed_rx) = futures_channel(1);
            let writer = TestWriter::new();
            let writer_future = future::ok(writer.clone());

            let tx = logger("".into(), logger_params, test_killer.clone(), writer_future);

            tokio::spawn(
                tx.send_all(stream::iter_ok(vec!(json!(1), json!(2))))
                    .then(|_| Ok(()))
            );

            let f = tokio::timer::Delay::new(Instant::now() + Duration::from_millis(100))
                .then(move |_| {
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
                });

            tokio::spawn(f);

            Ok(())
        }));
    }

    #[test]
    fn logger_pretty_works() {
        current_thread::run(future::lazy(|| {
            let logger_params = r#"{
                "to": "",
                "pretty": true
            }"#;
            let logger_params = serde_json::from_str(logger_params).unwrap();
            let (test_killer, mut test_killed_rx) = futures_channel(1);
            let writer = TestWriter::new();
            let writer_future = future::ok(writer.clone());

            let tx = logger("".into(), logger_params, test_killer.clone(), writer_future);

            tokio::spawn(
                tx.send_all(stream::iter_ok(vec!(json!({"foo": [1, 2, 3]}), json!(2))))
                    .then(|_| Ok(()))
            );

            let f = tokio::timer::Delay::new(Instant::now() + Duration::from_millis(100))
                .then(move |_| {
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
                });

            tokio::spawn(f);

            Ok(())
        }));
    }

}
