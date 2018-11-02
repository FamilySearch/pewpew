use crate::channel::{
    self,
    Limit,
};
use crate::config;
use futures::{
    future::Shared,
    Future,
    Stream
};
use serde_json as json;
use tokio::{
    fs::File as TokioFile,
    io::{lines, Read},
    prelude::*,
};

use std::{
    io::{BufReader, Error as IOError, SeekFrom}
};

pub enum Kind {
    Body(Provider<channel::Receiver<Vec<u8>>>),
    Value(Provider<json::Value>),
}

pub struct Provider<T> {
    pub auto_return: Option<config::EndpointProvidesSendOptions>,
    pub tx: channel::Sender<T>,
    pub rx: channel::Receiver<T>,
}

struct RecurrableFile {
    inner: TokioFile,
    repeat: bool,
}

impl Read for RecurrableFile {
    fn read(&mut self, mut buf: &mut [u8]) -> Result<usize, IOError> {
        let mut n = self.inner.read(buf)?;
        // EOF
        if n == 0 && self.repeat {
            // seek back to the beginning of the file and write a newline to the buffer
            self.inner.poll_seek(SeekFrom::Start(0))?;
            n = buf.write(&[b'\n'])?;
        }
        Ok(n)
    }
}

impl AsyncRead for RecurrableFile {}

pub fn file<F>(template: config::FileProvider, test_complete: Shared<F>) -> Kind
    where F: Future + Send + 'static,
        <F as Future>::Error: Send + Sync,
        <F as Future>::Item: Send + Sync,
{
    let (tx, rx) = channel::channel(template.buffer);
    let tx2 = tx.clone();
    let repeat = template.repeat;
    let prime_tx = TokioFile::open(template.path)
        .map_err(|e| panic!("error opening file {}", e))
        .and_then(move |file| {
            lines(BufReader::new(RecurrableFile { inner: file, repeat }))
                .filter(|s| !s.is_empty())
                .map(json::Value::String)
                .map_err(|e| {
                    panic!("error reading file {}", e)
                })
                .forward(tx2)
                // Error propagate here when sender channel closes at test conclusion
                .then(|_ok| Ok(()))
        })
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