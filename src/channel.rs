use crossbeam::queue::SegQueue;
use futures::{
    Async,
    AsyncSink,
    Poll,
    sink::Sink,
    StartSend,
    Stream,
    task,
};

use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

pub enum Limit {
    Auto(Arc<AtomicUsize>),
    Integer(usize),
}

impl Limit {
    pub fn auto() -> Limit {
        Limit::Auto(Arc::new(AtomicUsize::new(5)))
    }

    pub fn get(&self) -> usize {
        match self {
            Limit::Auto(a) => a.load(Ordering::Relaxed),
            Limit::Integer(n) => *n,
        }
    }
}

impl Clone for Limit {
    fn clone(&self) -> Self {
        match self {
            Limit::Auto(a) => Limit::Auto(a.clone()),
            Limit::Integer(n) => Limit::Integer(*n),
        }
    }
}

pub struct Sender<T> {
    inner: Arc<SegQueue<T>>,
    len: Arc<AtomicUsize>,
    limit: Limit,
    parked_receivers: Arc<SegQueue<task::Task>>,
    parked_senders: Arc<SegQueue<task::Task>>,
    sender_count: Arc<AtomicUsize>,
}

impl<T> Sender<T> {
    pub fn limit(&self) -> Limit {
        self.limit.clone()
    }

    pub fn try_send(&self, item: T) -> Result<(), T> {
        let res = self.len.fetch_update(|n| {
            if n < self.limit.get() {
                Some(n + 1)
            } else {
                None
            }
        }, Ordering::Relaxed, Ordering::Relaxed);
        let ret = if res.is_ok() {
            self.inner.push(item);
            Ok(())
        } else {
            self.parked_senders.push(task::current());
            Err(item)
        };
        while let Some(task) = self.parked_receivers.try_pop() {
            task.notify();
        }
        ret
    }

    pub fn force_send(&self, item: T) {
        self.len.fetch_add(1, Ordering::Relaxed);
        self.inner.push(item);
        while let Some(task) = self.parked_receivers.try_pop() {
            task.notify();
        }
    }
}

impl<T> Clone for Sender<T> {
    fn clone(&self) -> Self {
        self.sender_count.fetch_add(1, Ordering::Relaxed);
        Sender {
            inner: self.inner.clone(),
            len: self.len.clone(),
            limit: self.limit.clone(),
            parked_receivers: self.parked_receivers.clone(),
            parked_senders: self.parked_senders.clone(),
            sender_count: self.sender_count.clone(),
        }
    }
}

impl<T> Drop for Sender<T> {
    fn drop(&mut self) {
        if self.sender_count.fetch_sub(1, Ordering::Relaxed) == 1 {
            while let Some(task) = self.parked_receivers.try_pop() {
                task.notify();
            }
        }
    }
}

impl<T> Sink for Sender<T> {
    type SinkItem = T;
    type SinkError = ();

    fn start_send(&mut self, item: Self::SinkItem) -> StartSend<Self::SinkItem, Self::SinkError> {
        match self.try_send(item) {
            Ok(_) => Ok(AsyncSink::Ready),
            Err(item) => Ok(AsyncSink::NotReady(item))
        }
    }

    fn poll_complete (&mut self) -> Poll<(), Self::SinkError> {
        Ok(Async::Ready(()))
    }
}

#[derive(Clone)]
pub struct Receiver<T> {
    inner: Arc<SegQueue<T>>,
    len: Arc<AtomicUsize>,
    limit: Limit,
    parked_receivers: Arc<SegQueue<task::Task>>,
    parked_senders: Arc<SegQueue<task::Task>>,
    sender_count: Arc<AtomicUsize>,
}

impl<T> Stream for Receiver<T> {
    type Item = T;
    type Error = ();

    fn poll(&mut self) -> Poll<Option<Self::Item>, Self::Error> {
        let msg = self.inner.try_pop();
        if msg.is_some() {
            let n = self.len.fetch_sub(1, Ordering::Relaxed);
            if n == 1 {
                // if there's an "auto" limit and we've emptied the buffer, 
                // increment the limit
                if let Limit::Auto(a) = &self.limit {
                    a.fetch_add(1, Ordering::Relaxed);
                }
            }
            while let Some(task) = self.parked_senders.try_pop() {
                task.notify();
            }
            Ok(Async::Ready(msg))
        } else if self.sender_count.load(Ordering::Relaxed) == 0 {
            Ok(Async::Ready(None))
        } else {
            self.parked_receivers.push(task::current());
            while let Some(task) = self.parked_senders.try_pop() {
                task.notify();
            }
            Ok(Async::NotReady)
        }
    }
}

pub fn channel<T>(limit: Limit) -> (Sender<T>, Receiver<T>) {
    let inner = Arc::new(SegQueue::new());
    let len = Arc::new(AtomicUsize::new(0));
    let parked_receivers = Arc::new(SegQueue::new());
    let parked_senders = Arc::new(SegQueue::new());
    let sender_count = Arc::new(AtomicUsize::new(1));
    let receiver = Receiver {
        inner: inner.clone(),
        len: len.clone(),
        limit: limit.clone(),
        parked_receivers: parked_receivers.clone(),
        parked_senders: parked_senders.clone(),
        sender_count: sender_count.clone(),
    };
    let sender = Sender {
        inner,
        len,
        limit,
        parked_receivers,
        parked_senders,
        sender_count,
    };
    (sender, receiver)
}


#[cfg(test)]
mod tests {
    use super::*;
    use futures::{
        future::lazy,
        stream,
    };
    use tokio::{
        self,
        prelude::*,
    };

    use std::time::{Duration, Instant};

    #[test]
    fn bench3() {
        tokio::run(lazy(|| {
            let (tx, rx) = channel(Limit::Integer(20));
            let duration = Duration::from_secs(1);
            let start = Instant::now();
            let feed = stream::repeat::<_, ()>(1)
                .take_while(move |_| Ok(start.elapsed() < duration))
                .forward(tx)
                .map(|_| ());
            tokio::spawn(feed);

            rx.fold(0, |n, _| Ok(n + 1))
                .map(|n| eprintln!("done {}", n))
                .map_err(|_e| println!("err"))
        }));
    }
}