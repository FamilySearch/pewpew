use crate::channel::{
    self,
    Limit,
    transform::{
        self,
        Transform,
    }
};
use crate::config::{FileProvider, ResponseProvider};
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

use std::io::{BufReader, Error as IOError, SeekFrom};

pub enum Kind {
    Body(Provider<channel::Receiver<Vec<u8>>>),
    Value(Provider<json::Value>),
}

pub struct Provider<T> {
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

pub fn file<F>(template: FileProvider, test_complete: Shared<F>) -> Kind
    where F: Future + Send + 'static,
        <F as Future>::Error: Send + Sync,
        <F as Future>::Item: Send + Sync,
{
    let (tx, rx) = if let Some(transform) = template.transform {
        transform::channel(template.buffer, transform, test_complete.clone())
    } else {
        channel::channel(template.buffer)
    };
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
    Kind::Value(Provider { rx, tx })
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

pub fn response<F>(template: ResponseProvider, test_complete: F) -> Kind
    where F: Future + Send + 'static
{
    let (tx, rx) = if let Some(transform) = template.transform {
        transform::channel(template.buffer, transform, test_complete)
    } else {
        channel::channel(template.buffer)
    };
    Kind::Value(Provider { tx, rx })
}

pub fn literals<F>(values: Vec<json::Value>, transform: Option<Transform>, test_complete: Shared<F>) -> Kind
    where F: Future + Send + 'static,
        <F as Future>::Error: Send + Sync,
        <F as Future>::Item: Send + Sync, 
{
    let rs: RepeaterStream<json::Value> = RepeaterStream::new(values);
    let (tx, rx) = if let Some(transform) = transform {
        transform::channel(Limit::auto(), transform, test_complete.clone())
    } else {
        channel::channel(Limit::auto())
    };
    let tx2 = tx.clone();
    let prime_tx = rs.forward(tx2)
        // Error propagate here when sender channel closes at test conclusion
        .then(|_| Ok(()))
        .select(test_complete.then(|_| Ok::<_, ()>(())))
        .then(|_| Ok(()));
    tokio::spawn(prime_tx);
    Kind::Value(Provider { tx, rx })
}


pub fn peek<F>(first: Option<usize>, test_complete: F) -> Kind
    where F: Future + Send + 'static
{
    // TODO: make a kind which doesn't have a rx channel
    let (tx, rx) = channel::channel(Limit::Integer(1));
    let (_, ret_rx) = channel::channel(Limit::Integer(1));
    let mut counter = 1;
    let logger = rx.for_each(move |v| {
            match first {
                Some(limit) if counter > limit => {
                    // tx2.close();
                    Err(())
                },
                _ => {
                    counter += 1;
                    eprint!("{}", format!("{:#}\n", v));
                    Ok(())
                }
            }
        })
        .then(|_| Ok(()))
        .select(test_complete.then(|_| Ok::<_, ()>(())))
        .then(|_| Ok(()));
    tokio::spawn(logger);
    Kind::Value(Provider { tx, rx: ret_rx })
}