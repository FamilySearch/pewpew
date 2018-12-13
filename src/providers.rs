mod csv_reader;
mod json_reader;
mod line_reader;

use self::{
    csv_reader::CsvReader,
    json_reader::JsonReader,
    line_reader::LineReader,
};

use crate::channel::{
    self,
    Limit,
};
use crate::config;
use crate::util::Either3;

use futures::{
    future::Shared,
    Future,
    stream,
    Stream
};
use serde_json as json;
use tokio::{
    fs::File as TokioFile,
    prelude::*,
};
use tokio_threadpool::blocking;

use std::io;

pub enum Kind {
    Body(Provider<channel::Receiver<Vec<u8>>>),
    Value(Provider<json::Value>),
}

pub struct Provider<T> {
    pub auto_return: Option<config::EndpointProvidesSendOptions>,
    pub tx: channel::Sender<T>,
    pub rx: channel::Receiver<T>,
}

pub fn file<F>(template: config::FileProvider, test_complete: Shared<F>) -> Kind
    where F: Future + Send + 'static,
        <F as Future>::Error: Send + Sync,
        <F as Future>::Item: Send + Sync,
{
    let stream = match template.format {
        config::FileFormat::Csv => Either3::A(CsvReader::new(&template).expect("error creating file reader").into_stream()),
        config::FileFormat::Json => Either3::B(JsonReader::new(&template).expect("error creating file reader").into_stream()),
        config::FileFormat::Line => Either3::C(LineReader::new(&template).expect("error creating file reader").into_stream()),
    };
    let (tx, rx) = channel::channel(template.buffer);
    let tx2 = tx.clone();
    let prime_tx = stream
        .map_err(|e| println!("file reading error: {}", e))
        .forward(tx2)
        // Error propagate here when sender channel closes at test conclusion
        // .then(|_v| Ok(()))
        .map(|_| ())
        .map_err(|_| ())
        .select(test_complete.then(|_| Ok(())))
        .then(|_| Ok(()));

    tokio::spawn(prime_tx);
    Kind::Value(Provider { auto_return: template.auto_return, rx, tx })
}

#[must_use = "streams do nothing unless polled"]
struct RepeaterStream<T> {
    i: usize,
    values: Vec<T>,
}

impl<T> RepeaterStream<T> {
    fn new (values: Vec<T>) -> Self {
        if values.is_empty() {
            panic!("repeater stream must have at least one value");
        }
        RepeaterStream { i: 0, values }
    }
}

impl<T> Stream for RepeaterStream<T> where T: Clone {
    type Item = T;
    type Error = ();

    fn poll (&mut self) -> Poll<Option<Self::Item>, Self::Error> {
        self.i = (self.i + 1) % self.values.len();
        Ok(Async::Ready(Some(self.values[self.i].clone())))
    }
}

pub fn response(template: config::ResponseProvider) -> Kind {
    let (tx, rx) = channel::channel(template.buffer);
    Kind::Value(Provider { auto_return: template.auto_return, tx, rx })
}

pub fn literals<F>(values: Vec<json::Value>, auto_return: Option<config::EndpointProvidesSendOptions>, test_complete: Shared<F>) -> Kind
    where F: Future + Send + 'static,
        <F as Future>::Error: Send + Sync,
        <F as Future>::Item: Send + Sync, 
{
    let rs: RepeaterStream<json::Value> = RepeaterStream::new(values);
    let (tx, rx) = channel::channel(Limit::auto());
    let tx2 = tx.clone();
    let prime_tx = rs.forward(tx2)
        // Error propagate here when sender channel closes at test conclusion
        .then(|_| Ok(()))
        .select(test_complete.then(|_| Ok::<_, ()>(())))
        .then(|_| Ok(()));
    tokio::spawn(prime_tx);
    Kind::Value(Provider { auto_return, tx, rx })
}

pub fn range<F>(range: config::RangeProvider, test_complete: Shared<F>) -> Kind
    where F: Future + Send + 'static,
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
    Kind::Value(Provider { auto_return: None, tx, rx })
}

pub fn logger<F>(template: &config::Logger, test_complete: F) -> channel::Sender<json::Value>
    where F: Future + Send + 'static
{
    let (tx, rx) = channel::channel::<json::Value>(Limit::Integer(5));
    let file_name = template.to.clone();
    let limit = template.limit;
    let pretty = template.pretty;
    let mut counter = 1;
    match template.to.as_str() {
        "stderr" => {
            let logger = rx.for_each(move |v| {
                    if let Some(limit) = limit {
                        if counter > limit {
                            return Err(())
                        }
                    }
                    counter += 1;
                    if pretty {
                        eprintln!("{:#}", v);
                    } else {
                        eprintln!("{}", v);
                    }
                    Ok(())
                })
                .select(test_complete.then(|_| Ok::<_, ()>(())))
                .then(|_| Ok(()));
            tokio::spawn(logger);
        },
        "stdout" => {
            let logger = rx.for_each(move |v| {
                    if let Some(limit) = limit {
                        if counter > limit {
                            return Err(())
                        }
                    }
                    counter += 1;
                    if pretty {
                        println!("{:#}", v);
                    } else {
                        println!("{}", v);
                    }
                    Ok(())
                })
                .select(test_complete.then(|_| Ok::<_, ()>(())))
                .then(|_| Ok(()));
            tokio::spawn(logger);
        },
        _ => {
            let logger = TokioFile::create(file_name.clone())
                .map_err(|_| ())
                .and_then(move |mut file| {
                    rx.for_each(move |v| {
                        if let Some(limit) = limit {
                            if counter > limit {
                                return Err(())
                            }
                        }
                        counter += 1;
                        if pretty {
                            writeln!(file, "{:#}", v)
                        } else {
                            writeln!(file, "{}", v)
                        }.map_err(|e| eprintln!("Error writing to `{}`, {}", file_name, e))
                    })
                })
                .select(test_complete.then(|_| Ok::<_, ()>(())))
                .then(|_| Ok(()));
                tokio::spawn(logger);
        }
    }
    tx
}

fn into_stream<I: Iterator<Item=Result<json::Value, io::Error>>>(mut iter: I)
    -> impl Stream<Item = json::Value, Error = io::Error>    
{
    stream::poll_fn(move || {
            blocking(|| iter.next())
        })
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))
        .and_then(|r| r)
}