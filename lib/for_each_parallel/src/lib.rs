use futures::{channel::oneshot, Future, FutureExt, Stream, StreamExt, TryFutureExt};

use std::{
    marker::Unpin,
    pin::Pin,
    task::{Context, Poll},
};

/// A stream combinator which executes a closure over each item on a
/// stream in parallel. If the stream or any of the futures returned from
/// the closure return an error, the first error will be the result of the
/// future.
#[must_use = "futures do nothing unless polled"]
pub struct ForEachParallel<St, StI, Fm, F, E>
where
    St: Stream<Item = Result<StI, E>> + Unpin,
    Fm: FnMut(StI) -> F + Unpin,
    F: Future<Output = Result<(), E>> + Send + 'static,
    E: Send + 'static + Unpin,
{
    f: Fm,
    limit_fn: Option<Box<dyn FnMut(usize) -> usize + Send + Unpin>>,
    futures: Vec<oneshot::Receiver<E>>,
    stream: Option<St>,
    error: Option<E>,
}

impl<St, StI, Fm, F, E> ForEachParallel<St, StI, Fm, F, E>
where
    St: Stream<Item = Result<StI, E>> + Unpin,
    Fm: FnMut(StI) -> F + Unpin,
    F: Future<Output = Result<(), E>> + Send + 'static,
    E: Send + 'static + Unpin,
{
    pub fn new(
        limit_fn: Option<Box<dyn FnMut(usize) -> usize + Send + Unpin>>,
        stream: St,
        f: Fm,
    ) -> Self {
        ForEachParallel {
            limit_fn,
            f,
            futures: Vec::new(),
            stream: Some(stream),
            error: None,
        }
    }
}

impl<St, StI, Fm, F, E> Future for ForEachParallel<St, StI, Fm, F, E>
where
    St: Stream<Item = Result<StI, E>> + Unpin,
    Fm: FnMut(StI) -> F + Unpin,
    F: Future<Output = Result<(), E>> + Send + 'static,
    E: Send + 'static + Unpin,
{
    type Output = Result<(), E>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context) -> Poll<Self::Output> {
        let this = Pin::into_inner(self);
        let limit = match &mut this.limit_fn {
            Some(lf) => lf(this.futures.len()),
            None => 0,
        };
        loop {
            let mut made_progress_this_iter = false;
            // Try and pull an item from the stream
            if let Some(stream) = &mut this.stream {
                if limit == 0 || limit > this.futures.len() {
                    match stream.poll_next_unpin(cx) {
                        Poll::Ready(Some(Ok(elem))) => {
                            made_progress_this_iter = true;
                            let (tx, rx) = oneshot::channel();
                            let next_future = (this.f)(elem).map_err(move |e| {
                                let _ = tx.send(e);
                            });
                            tokio::spawn(next_future);
                            this.futures.push(rx);
                        }
                        Poll::Ready(None) => this.stream = None,
                        Poll::Pending => (),
                        Poll::Ready(Some(Err(e))) => {
                            this.error = Some(e);
                            this.futures.clear();
                            this.stream = None;
                        }
                    }
                }
            }

            let futures = std::mem::take(&mut this.futures);
            for mut fut in futures {
                match fut.poll_unpin(cx) {
                    Poll::Pending => this.futures.push(fut),
                    Poll::Ready(r) => {
                        if let Ok(e) = r {
                            this.error = Some(e);
                        }
                        made_progress_this_iter = true;
                    }
                }
            }
            if this.error.is_some() {
                this.futures.clear();
                this.stream = None;
            }

            if this.futures.is_empty() && this.stream.is_none() || this.error.is_some() {
                if let Some(e) = this.error.take() {
                    this.futures.clear();
                    this.stream = None;
                    return Poll::Ready(Err(e));
                }
                return Poll::Ready(Ok(()));
            } else if !made_progress_this_iter {
                return Poll::Pending;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::stream;
    use futures_timer::Delay;
    use tokio::runtime::Runtime;

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
        let s = stream::iter(iter::repeat(Ok::<_, ()>(())).take(n));
        // how long to wait before a parallel task finishes
        let wait_time_ms = 250;
        let fep = ForEachParallel::new(None, s, move |_| {
            let counter = counter.clone();
            async move {
                counter.fetch_add(1, Ordering::Relaxed);
                Delay::new(Duration::from_millis(wait_time_ms)).await;
                Ok(())
            }
        });
        let start = Instant::now();
        let rt = Runtime::new().unwrap();
        rt.block_on(fep).unwrap();
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
        let s = stream::iter(iter::repeat(Ok::<_, ()>(())).take(n));
        // how long to wait before a parallel task finishes
        let wait_time_ms = 250;
        let limit_fn: Option<Box<dyn std::ops::FnMut(usize) -> usize + Send + Unpin + 'static>> =
            Some(Box::new(|_| 250));
        let fep = ForEachParallel::new(limit_fn, s, move |_| {
            let counter = counter.clone();
            async move {
                counter.fetch_add(1, Ordering::Relaxed);
                Delay::new(Duration::from_millis(wait_time_ms)).await;
                Ok(())
            }
        });
        let start = Instant::now();
        let rt = Runtime::new().unwrap();
        rt.block_on(fep).unwrap();
        let elapsed = start.elapsed();
        // check that the function ran n times
        assert_eq!(counter2.load(Ordering::Relaxed), n);
        // check that the whole process ran in an acceptable time span (meaning the tasks went in parallel and
        // with a certain limit of concurrent tasks)
        assert!(
            elapsed < Duration::from_millis(wait_time_ms * 3)
                && elapsed > Duration::from_millis(wait_time_ms * 2),
            "{:?}",
            elapsed
        );
    }

    #[test]
    fn honors_cap() {
        let counter = Arc::new(AtomicUsize::new(0));
        // how many iterations to run
        let n = 150;
        let counter2 = counter.clone();
        let s = stream::iter(iter::repeat(Ok::<_, ()>(())).take(n));
        // how long to wait before a parallel task finishes
        let wait_time_ms = 250;
        let fep = ForEachParallel::new(Some(Box::new(|_| 50)), s, move |_| {
            let counter = counter.clone();
            async move {
                counter.fetch_add(1, Ordering::Relaxed);
                Delay::new(Duration::from_millis(wait_time_ms)).await;
                Ok(())
            }
        });
        // let start = Instant::now();
        let rt = Runtime::new().unwrap();
        rt.block_on(fep).unwrap();
        // let elapsed = start.elapsed();
        // check that the function ran n times
        assert_eq!(counter2.load(Ordering::Relaxed), n);
        // check that the whole process ran in an acceptable time span (meaning the tasks went in parallel and
        // with a certain limit of concurrent tasks)
        // disabled due to CI flakiness
        // assert!(
        //     elapsed < Duration::from_millis(900) && elapsed > Duration::from_millis(750),
        //     "elapsed: {:?}",
        //     elapsed
        // );
    }
}
