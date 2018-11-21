use futures::{
    Async,
    Future,
    IntoFuture,
    Poll,
    Stream,
    sync::oneshot,
};

use crate::channel::Limit;

use std::cmp;

/// A stream combinator which executes a unit closure over each item on a
/// stream in parallel.
#[must_use = "streams do nothing unless polled"]
pub struct ForEachParallel<St, If, Fm, F>
where St: Stream,
    Fm: FnMut(St::Item) -> If,
    If: IntoFuture<Future=F, Item=F::Item, Error=F::Error>,
    F: Future<Item=(), Error=()> + Send + 'static,
{
    f: Fm,
    futures: Vec<oneshot::Receiver<()>>,
    limits: Vec<Limit>,
    stream: Option<St>,
    stream_errored: bool,
}

impl<St, If, Fm, F> ForEachParallel<St, If, Fm, F>
where St: Stream,
    Fm: FnMut(St::Item) -> If,
    If: IntoFuture<Future=F, Item=F::Item, Error=F::Error>,
    F: Future<Item=(), Error=()> + Send + 'static,
{
    pub fn new(limits: Vec<Limit>, stream: St, f: Fm) -> Self {
        ForEachParallel {
            limits,
            f,
            futures: Vec::new(),
            stream: Some(stream),
            stream_errored: false,
        }
    }
}

impl<St, If, Fm, F> Future for ForEachParallel<St, If, Fm, F>
where St: Stream,
    Fm: FnMut(St::Item) -> If,
    If: IntoFuture<Future=F, Item=F::Item, Error=F::Error>,
    F: Future<Item=(), Error=()> + Send + 'static,
{
    type Item = ();
    type Error = ();

    fn poll(&mut self) -> Poll<Self::Item, Self::Error> {
        let limit = self.limits.iter().fold(0, |prev, l| cmp::max(prev, l.get()));
        loop {
            let mut made_progress_this_iter = false;
            // Try and pull an item from the stream
            if let Some(stream) = &mut self.stream {
                if limit == 0 || limit > self.futures.len() {
                    match stream.poll() {
                        Ok(Async::Ready(Some(elem))) => {
                            made_progress_this_iter = true;
                            let (tx, rx) = oneshot::channel();
                            let next_future = (self.f)(elem)
                                .into_future()
                                .then(move |_| tx.send(()));
                            tokio::spawn(next_future);
                            self.futures.push(rx);
                        },
                        Ok(Async::Ready(None)) => {
                            self.stream = None
                        },
                        Ok(Async::NotReady) => (),
                        Err(_) => {
                            self.stream_errored = true;
                            self.stream = None;
                        },
                    }
                }
            }

            self.futures.drain_filter(|fut| {
                if let Ok(Async::NotReady) = fut.poll() {
                    false
                } else {
                    made_progress_this_iter = true;
                    true
                }
            });

            if self.futures.is_empty() && self.stream.is_none() {
                if self.stream_errored {
                    return Err(())
                }
                return Ok(Async::Ready(()))
            } else if !made_progress_this_iter {
                return Ok(Async::NotReady)
            }
        }
    }
}