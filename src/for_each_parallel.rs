use futures::{sync::oneshot, Async, Future, IntoFuture, Poll, Stream};

use crate::channel::Limit;

use std::cmp;

/// A stream combinator which executes a closure over each item on a
/// stream in parallel. If the stream or any of the futures returned from
/// the closure return an error, the first error will be the result of the
/// future.
#[must_use = "futures do nothing unless polled"]
pub struct ForEachParallel<St, If, Fm, F, E>
where
    St: Stream<Error = E>,
    Fm: FnMut(St::Item) -> If,
    If: IntoFuture<Future = F, Item = F::Item, Error = St::Error>,
    F: Future<Item = (), Error = St::Error> + Send + 'static,
    E: Send + 'static,
{
    f: Fm,
    futures: Vec<oneshot::Receiver<St::Error>>,
    limits: Vec<Limit>,
    stream: Option<St>,
    error: Option<St::Error>,
}

impl<St, If, Fm, F, E> ForEachParallel<St, If, Fm, F, E>
where
    St: Stream<Error = E>,
    Fm: FnMut(St::Item) -> If,
    If: IntoFuture<Future = F, Item = F::Item, Error = St::Error>,
    F: Future<Item = (), Error = St::Error> + Send + 'static,
    E: Send + 'static,
{
    pub fn new(limits: Vec<Limit>, stream: St, f: Fm) -> Self {
        ForEachParallel {
            limits,
            f,
            futures: Vec::new(),
            stream: Some(stream),
            error: None,
        }
    }
}

impl<St, If, Fm, F, E> Future for ForEachParallel<St, If, Fm, F, E>
where
    St: Stream<Error = E>,
    Fm: FnMut(St::Item) -> If,
    If: IntoFuture<Future = F, Item = F::Item, Error = St::Error>,
    F: Future<Item = (), Error = St::Error> + Send + 'static,
    E: Send + 'static,
{
    type Item = ();
    type Error = F::Error;

    fn poll(&mut self) -> Poll<Self::Item, Self::Error> {
        let limit = self
            .limits
            .iter()
            .fold(0, |prev, l| cmp::max(prev, l.get()));
        loop {
            let mut made_progress_this_iter = false;
            // Try and pull an item from the stream
            if let Some(stream) = &mut self.stream {
                if limit == 0 || limit > self.futures.len() {
                    match stream.poll() {
                        Ok(Async::Ready(Some(elem))) => {
                            made_progress_this_iter = true;
                            let (tx, rx) = oneshot::channel();
                            let next_future = (self.f)(elem).into_future().map_err(move |e| {
                                let _ = tx.send(e);
                            });
                            tokio::spawn(next_future);
                            self.futures.push(rx);
                        }
                        Ok(Async::Ready(None)) => self.stream = None,
                        Ok(Async::NotReady) => (),
                        Err(e) => {
                            self.error = Some(e);
                            self.futures.clear();
                            self.stream = None;
                        }
                    }
                }
            }

            let mut error = self.error.take();
            self.futures.drain_filter(|fut| match fut.poll() {
                Ok(Async::NotReady) => false,
                Ok(Async::Ready(e)) => {
                    error = Some(e);
                    made_progress_this_iter = true;
                    true
                }
                _ => {
                    made_progress_this_iter = true;
                    true
                }
            });
            self.error = error;
            if self.error.is_some() {
                self.futures.clear();
                self.stream = None;
            }

            if self.futures.is_empty() && self.stream.is_none() || self.error.is_some() {
                if let Some(e) = self.error.take() {
                    self.futures.clear();
                    self.stream = None;
                    return Err(e);
                }
                return Ok(Async::Ready(()));
            } else if !made_progress_this_iter {
                return Ok(Async::NotReady);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::stream;
    use tokio::timer::Delay;

    use std::{
        iter,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
        time::{Duration, Instant},
    };

    #[test]
    fn for_each_parallel() {
        let counter = Arc::new(AtomicUsize::new(0));
        // how many iterations to run
        let n = 500;
        let counter2 = counter.clone();
        let s = stream::iter_ok::<_, ()>(iter::repeat(()).take(n));
        // how long to wait before a parallel task finishes
        let wait_time_ms = 250;
        let fep = ForEachParallel::new(vec![], s, move |_| {
            counter.fetch_add(1, Ordering::Relaxed);
            Delay::new(Instant::now() + Duration::from_millis(wait_time_ms)).then(|_| Ok(()))
        })
        .then(|_| Ok(()));
        let start = Instant::now();
        tokio::run(fep);
        let elapsed = start.elapsed();
        // check that the function ran n times
        assert_eq!(counter2.load(Ordering::Relaxed), n);
        // check that the whole process ran in an acceptable time span (meaning the tasks went in parallel)
        assert!(
            elapsed < Duration::from_millis(wait_time_ms * 2)
                && elapsed > Duration::from_millis(wait_time_ms)
        );
    }

    #[test]
    fn honors_limits() {
        let counter = Arc::new(AtomicUsize::new(0));
        // how many iterations to run
        let n = 500;
        let counter2 = counter.clone();
        let s = stream::iter_ok::<_, ()>(iter::repeat(()).take(n));
        // how long to wait before a parallel task finishes
        let wait_time_ms = 250;
        let fep = ForEachParallel::new(
            vec![Limit::Integer(100), Limit::Integer(250)],
            s,
            move |_| {
                counter.fetch_add(1, Ordering::Relaxed);
                Delay::new(Instant::now() + Duration::from_millis(wait_time_ms)).then(|_| Ok(()))
            },
        )
        .then(|_| Ok(()));
        let start = Instant::now();
        tokio::run(fep);
        let elapsed = start.elapsed();
        // check that the function ran n times
        assert_eq!(counter2.load(Ordering::Relaxed), n);
        // check that the whole process ran in an acceptable time span (meaning the tasks went in parallel and
        // with a certain limit of concurrent tasks)
        assert!(
            elapsed < Duration::from_millis(wait_time_ms * 3)
                && elapsed > Duration::from_millis(wait_time_ms * 2)
        );
    }
}
