use crossbeam::queue::SegQueue;
use futures::{sink::Sink, task, Async, AsyncSink, Poll, StartSend, Stream};
use serde::Serialize;

use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

pub enum Limit {
    Auto(Arc<AtomicUsize>),
    Integer(usize),
}

impl Default for Limit {
    fn default() -> Self {
        Limit::auto()
    }
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelStats<'a> {
    pub timestamp: i64,
    pub provider: &'a str,
    pub len: usize,
    pub limit: usize,
    pub waiting_to_send: usize,
    pub waiting_to_receive: usize,
}

pub struct Sender<T> {
    inner: Arc<SegQueue<T>>,
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
        let ret = if self.inner.len() < self.limit.get() {
            self.inner.push(item);
            Ok(())
        } else {
            self.parked_senders.push(task::current());
            Err(item)
        };
        while let Ok(task) = self.parked_receivers.pop() {
            task.notify();
        }
        ret
    }

    pub fn force_send(&self, item: T) {
        self.inner.push(item);
        while let Ok(task) = self.parked_receivers.pop() {
            task.notify();
        }
    }

    pub fn get_stats<'a>(&self, provider: &'a str, timestamp: i64) -> ChannelStats<'a> {
        ChannelStats {
            provider,
            timestamp,
            len: self.inner.len(),
            limit: self.limit.get(),
            waiting_to_receive: self.parked_receivers.len(),
            waiting_to_send: self.parked_senders.len(),
        }
    }
}

impl<T> Clone for Sender<T> {
    fn clone(&self) -> Self {
        self.sender_count.fetch_add(1, Ordering::Relaxed);
        Sender {
            inner: self.inner.clone(),
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
            while let Ok(task) = self.parked_receivers.pop() {
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
            Err(item) => Ok(AsyncSink::NotReady(item)),
        }
    }

    fn poll_complete(&mut self) -> Poll<(), Self::SinkError> {
        Ok(Async::Ready(()))
    }
}

#[derive(Clone)]
pub struct Receiver<T> {
    inner: Arc<SegQueue<T>>,
    limit: Limit,
    parked_receivers: Arc<SegQueue<task::Task>>,
    parked_senders: Arc<SegQueue<task::Task>>,
    sender_count: Arc<AtomicUsize>,
}

impl<T> Stream for Receiver<T> {
    type Item = T;
    type Error = ();

    fn poll(&mut self) -> Poll<Option<Self::Item>, Self::Error> {
        let msg = self.inner.pop().ok();
        if msg.is_some() {
            if self.inner.len() == 1 {
                // if there's an "auto" limit and we've emptied the buffer,
                // increment the limit
                if let Limit::Auto(a) = &self.limit {
                    a.fetch_add(1, Ordering::Relaxed);
                }
            }
            while let Ok(task) = self.parked_senders.pop() {
                task.notify();
            }
            Ok(Async::Ready(msg))
        } else if self.sender_count.load(Ordering::Relaxed) == 0 {
            Ok(Async::Ready(None))
        } else {
            self.parked_receivers.push(task::current());
            while let Ok(task) = self.parked_senders.pop() {
                task.notify();
            }
            Ok(Async::NotReady)
        }
    }
}

pub fn channel<T>(limit: Limit) -> (Sender<T>, Receiver<T>) {
    let inner = Arc::new(SegQueue::new());
    let parked_receivers = Arc::new(SegQueue::new());
    let parked_senders = Arc::new(SegQueue::new());
    let sender_count = Arc::new(AtomicUsize::new(1));
    let receiver = Receiver {
        inner: inner.clone(),
        limit: limit.clone(),
        parked_receivers: parked_receivers.clone(),
        parked_senders: parked_senders.clone(),
        sender_count: sender_count.clone(),
    };
    let sender = Sender {
        inner,
        limit,
        parked_receivers,
        parked_senders,
        sender_count,
    };
    (sender, receiver)
}
