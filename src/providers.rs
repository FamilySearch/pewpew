mod csv_reader;
mod json_reader;
mod line_reader;

use self::{csv_reader::CsvReader, json_reader::JsonReader, line_reader::LineReader};

use crate::channel::{self, Limit};
use crate::config;
use crate::error::TestError;
use crate::load_test::TestEndReason;
use crate::util::{json_value_into_string, tweak_path, Either3};

use futures::{future::Shared, stream, sync::mpsc::Sender as FCSender, Future, Stream};
use serde_json as json;
use tokio::{fs::File as TokioFile, prelude::*};
use tokio_threadpool::blocking;

use std::{io, path::PathBuf, sync::Arc};

pub type Kind = Provider<json::Value>;

pub struct Provider<T> {
    pub auto_return: Option<config::EndpointProvidesSendOptions>,
    pub tx: channel::Sender<T>,
    pub rx: channel::Receiver<T>,
}

pub fn file<F>(
    mut template: config::FileProvider,
    test_complete: Shared<F>,
    test_killer: FCSender<Result<TestEndReason, TestError>>,
    config_path: &PathBuf,
) -> Result<Kind, TestError>
where
    F: Future + Send + 'static,
    <F as Future>::Error: Send + Sync,
    <F as Future>::Item: Send + Sync,
{
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
        .map_err(move |e| TestError::Other(format!("reading file `{}`: {}", file, e).into()))
        .for_each(move |v| {
            tx2.clone()
                .send(v)
                .map(|_| ())
                .map_err(|_| TestError::Internal("Could not send from file provider".into()))
        })
        .or_else(move |e| test_killer2.send(Err(e)).then(|_| Ok(())))
        .map(|_| ())
        .select(test_complete.then(|_| Ok::<(), ()>(())))
        .then(|_| Ok(()));

    tokio::spawn(prime_tx);
    Ok(Provider {
        auto_return: template.auto_return,
        rx,
        tx,
    })
}

#[must_use = "streams do nothing unless polled"]
struct RepeaterStream<T> {
    i: usize,
    values: Vec<T>,
}

impl<T> RepeaterStream<T> {
    fn new(values: Vec<T>) -> Self {
        RepeaterStream { i: 0, values }
    }
}

impl<T> Stream for RepeaterStream<T>
where
    T: Clone,
{
    type Item = T;
    type Error = ();

    fn poll(&mut self) -> Poll<Option<Self::Item>, Self::Error> {
        let i = self.i;
        self.i = (self.i + 1).checked_rem(self.values.len()).unwrap_or(0);
        Ok(Async::Ready(self.values.get(i).cloned()))
    }
}

pub fn response(template: config::ResponseProvider) -> Kind {
    let (tx, rx) = channel::channel(template.buffer);
    Provider {
        auto_return: template.auto_return,
        tx,
        rx,
    }
}

pub fn literals<F>(
    values: Vec<json::Value>,
    auto_return: Option<config::EndpointProvidesSendOptions>,
    test_complete: Shared<F>,
) -> Kind
where
    F: Future + Send + 'static,
    <F as Future>::Error: Send + Sync,
    <F as Future>::Item: Send + Sync,
{
    let rs: RepeaterStream<json::Value> = RepeaterStream::new(values);
    let (tx, rx) = channel::channel(Limit::auto());
    let tx2 = tx.clone();
    let prime_tx = rs
        .forward(tx2)
        // Error propagate here when sender channel closes at test conclusion
        .then(|_| Ok(()))
        .select(test_complete.then(|_| Ok::<_, ()>(())))
        .then(|_| Ok(()));
    tokio::spawn(prime_tx);
    Provider {
        auto_return,
        tx,
        rx,
    }
}

pub fn range<F>(range: config::RangeProvider, test_complete: Shared<F>) -> Kind
where
    F: Future + Send + 'static,
    <F as Future>::Error: Send + Sync,
    <F as Future>::Item: Send + Sync,
{
    let (tx, rx) = channel::channel(Limit::auto());
    let prime_tx = stream::iter_ok::<_, ()>(range.0.map(json::Value::from))
        .forward(tx.clone())
        // Error propagate here when sender channel closes at test conclusion
        .then(|_| Ok(()))
        .select(test_complete.then(|_| Ok::<_, ()>(())))
        .then(|_| Ok(()));
    tokio::spawn(prime_tx);
    Provider {
        auto_return: None,
        tx,
        rx,
    }
}

pub fn logger<F>(
    mut template: config::Logger,
    test_complete: F,
    test_killer: FCSender<Result<TestEndReason, TestError>>,
    config_path: &PathBuf,
) -> channel::Sender<json::Value>
where
    F: Future + Send + 'static,
{
    let (tx, rx) = channel::channel::<json::Value>(Limit::Integer(5));
    let limit = template.limit;
    let pretty = template.pretty;
    let kill = template.kill;
    let mut counter = 0;
    let mut keep_logging = true;
    match template.to.as_str() {
        "stderr" => {
            let logger = rx
                .for_each(move |v| {
                    counter += 1;
                    if keep_logging {
                        if pretty && !v.is_string() {
                            eprintln!("{:#}", v);
                        } else {
                            eprintln!("{}", json_value_into_string(v));
                        }
                    }
                    match limit {
                        Some(limit) if counter >= limit => {
                            if kill {
                                Either3::B(
                                    test_killer
                                        .clone()
                                        .send(Err(TestError::KilledByLogger))
                                        .then(|_| Ok(())),
                                )
                            } else {
                                keep_logging = false;
                                Either3::A(Ok(()).into_future())
                            }
                        }
                        None if kill => Either3::C(
                            test_killer
                                .clone()
                                .send(Err(TestError::KilledByLogger))
                                .then(|_| Ok(())),
                        ),
                        _ => Either3::A(Ok(()).into_future()),
                    }
                })
                .select(test_complete.then(|_| Ok::<_, ()>(())))
                .then(|_| Ok(()));
            tokio::spawn(logger);
        }
        "stdout" => {
            let logger = rx
                .for_each(move |v| {
                    counter += 1;
                    if keep_logging {
                        if pretty && !v.is_string() {
                            println!("{:#}", v);
                        } else {
                            println!("{}", json_value_into_string(v));
                        }
                    }
                    match limit {
                        Some(limit) if counter >= limit => {
                            if kill {
                                Either3::B(
                                    test_killer
                                        .clone()
                                        .send(Err(TestError::KilledByLogger))
                                        .then(|_| Ok(())),
                                )
                            } else {
                                keep_logging = false;
                                Either3::A(Ok(()).into_future())
                            }
                        }
                        None if kill => Either3::C(
                            test_killer
                                .clone()
                                .send(Err(TestError::KilledByLogger))
                                .then(|_| Ok(())),
                        ),
                        _ => Either3::A(Ok(()).into_future()),
                    }
                })
                .select(test_complete.then(|_| Ok::<_, ()>(())))
                .then(|_| Ok(()));
            tokio::spawn(logger);
        }
        _ => {
            tweak_path(&mut template.to, config_path);
            let file_name = Arc::new(template.to);
            let file_name2 = file_name.clone();
            let test_killer2 = test_killer.clone();
            let logger = TokioFile::create((&*file_name).clone())
                .map_err(move |e| {
                    TestError::Other(
                        format!("creating logger file `{:?}`: {}", file_name2, e).into(),
                    )
                })
                .and_then(move |mut file| {
                    rx.map_err(|_| {
                        TestError::Internal("logger receiver unexpectedly errored".into())
                    })
                    .for_each(move |v| {
                        let file_name = file_name.clone();
                        counter += 1;
                        let result = if keep_logging {
                            if pretty {
                                writeln!(file, "{:#}", v)
                            } else {
                                writeln!(file, "{}", v)
                            }
                        } else {
                            Ok(())
                        };
                        let result = result.into_future().map_err(move |e| {
                            TestError::Other(
                                format!("writing to file `{}`: {}", file_name, e).into(),
                            )
                        });
                        match limit {
                            Some(limit) if counter >= limit => {
                                if kill {
                                    Either3::B(
                                        test_killer
                                            .clone()
                                            .send(Err(TestError::KilledByLogger))
                                            .then(|_| Ok(())),
                                    )
                                } else {
                                    keep_logging = false;
                                    Either3::A(result)
                                }
                            },
                            None if kill => Either3::C(
                                test_killer
                                    .clone()
                                    .send(Err(TestError::KilledByLogger))
                                    .then(|_| Ok(())),
                            ),
                            _ => Either3::A(result),
                        }
                    })
                })
                .or_else(move |e| test_killer2.send(Err(e)).then(|_| Ok::<_, ()>(())))
                .select(test_complete.then(|_| Ok::<_, ()>(())))
                .then(|_| Ok(()));
            tokio::spawn(logger);
        }
    }
    tx
}

fn into_stream<I: Iterator<Item = Result<json::Value, io::Error>>>(
    mut iter: I,
) -> impl Stream<Item = json::Value, Error = io::Error> {
    stream::poll_fn(move || blocking(|| iter.next()))
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))
        .and_then(|r| r)
}
