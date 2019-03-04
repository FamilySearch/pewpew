use crossbeam::queue::SegQueue;
use futures::{
    future, sink::Sink, stream, task, Async, AsyncSink, Future, Poll, StartSend, Stream,
};
use serde::Serialize;

use std::{
    error::Error as StdError,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
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
            Limit::Auto(a) => a.load(Ordering::Acquire),
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

struct ParkedTasks(SegQueue<task::Task>);

impl ParkedTasks {
    fn new() -> Self {
        ParkedTasks(SegQueue::new())
    }

    fn park(&self, task: task::Task) {
        self.0.push(task)
    }

    fn wake_all(&self) {
        while let Ok(task) = self.0.pop() {
            task.notify();
        }
    }

    fn len(&self) -> usize {
        self.0.len()
    }
}

pub struct Sender<T> {
    inner: Arc<SegQueue<T>>,
    limit: Limit,
    parked_receivers: Arc<ParkedTasks>,
    parked_senders: Arc<ParkedTasks>,
    receiver_count: Arc<AtomicUsize>,
    sender_count: Arc<AtomicUsize>,
}

pub enum SendState<T> {
    Closed,
    Full(T),
    Success,
}

impl<T> SendState<T> {
    pub fn is_success(&self) -> bool {
        if let SendState::Success = self {
            true
        } else {
            false
        }
    }
}

pub struct ChannelClosed {
    inner: Option<Box<dyn StdError + Send + Sync + 'static>>,
}

impl ChannelClosed {
    pub fn new() -> Self {
        ChannelClosed { inner: None }
    }

    pub fn wrapped<T: StdError + Send + Sync + 'static>(wrapped: T) -> Self {
        ChannelClosed {
            inner: Some(wrapped.into()),
        }
    }

    pub fn inner_cast<T: StdError + 'static>(self) -> Option<Box<T>> {
        self.inner.and_then(|e| e.downcast().ok())
    }
}

impl<T> Sender<T> {
    pub fn limit(&self) -> Limit {
        self.limit.clone()
    }

    pub fn try_send(&self, item: T) -> SendState<T> {
        let ret = if self.receiver_count.load(Ordering::Acquire) == 0 {
            SendState::Closed
        } else if self.inner.len() < self.limit.get() {
            self.inner.push(item);
            SendState::Success
        } else {
            self.parked_senders.park(task::current());
            if self.receiver_count.load(Ordering::Acquire) == 0 {
                SendState::Closed
            } else {
                SendState::Full(item)
            }
        };
        self.parked_receivers.wake_all();
        ret
    }

    pub fn force_send(&self, item: T) {
        self.inner.push(item);
        self.parked_receivers.wake_all();
    }
}

impl<T> Clone for Sender<T> {
    fn clone(&self) -> Self {
        self.sender_count.fetch_add(1, Ordering::Release);
        Sender {
            inner: self.inner.clone(),
            limit: self.limit.clone(),
            parked_receivers: self.parked_receivers.clone(),
            parked_senders: self.parked_senders.clone(),
            receiver_count: self.receiver_count.clone(),
            sender_count: self.sender_count.clone(),
        }
    }
}

impl<T> Drop for Sender<T> {
    fn drop(&mut self) {
        if self.sender_count.fetch_sub(1, Ordering::Release) == 1 {
            self.parked_receivers.wake_all();
            self.parked_senders.wake_all();
        }
    }
}

impl<T> Sink for Sender<T> {
    type SinkItem = T;
    type SinkError = ChannelClosed;

    fn start_send(&mut self, item: Self::SinkItem) -> StartSend<Self::SinkItem, Self::SinkError> {
        match self.try_send(item) {
            SendState::Success => Ok(AsyncSink::Ready),
            SendState::Full(item) => Ok(AsyncSink::NotReady(item)),
            SendState::Closed => Err(ChannelClosed::new()),
        }
    }

    fn poll_complete(&mut self) -> Poll<(), Self::SinkError> {
        Ok(Async::Ready(()))
    }
}

pub struct ChannelStatsReader<T> {
    provider: String,
    inner: Arc<SegQueue<T>>,
    limit: Limit,
    receiver_count: Arc<AtomicUsize>,
    sender_count: Arc<AtomicUsize>,
    waiting_to_receive: Arc<ParkedTasks>,
    waiting_to_send: Arc<ParkedTasks>,
}

impl<T> ChannelStatsReader<T> {
    pub fn new(provider: String, receiver: &Receiver<T>) -> Self {
        ChannelStatsReader {
            provider,
            inner: receiver.inner.clone(),
            limit: receiver.limit.clone(),
            receiver_count: receiver.receiver_count.clone(),
            sender_count: receiver.sender_count.clone(),
            waiting_to_receive: receiver.parked_receivers.clone(),
            waiting_to_send: receiver.parked_senders.clone(),
        }
    }

    pub fn get_stats(&self, timestamp: i64) -> ChannelStats {
        ChannelStats {
            provider: &self.provider,
            timestamp,
            len: self.inner.len(),
            limit: self.limit.get(),
            receiver_count: self.receiver_count.load(Ordering::Acquire),
            sender_count: self.sender_count.load(Ordering::Acquire),
            waiting_to_receive: self.waiting_to_receive.len(),
            waiting_to_send: self.waiting_to_send.len(),
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
    pub receiver_count: usize,
    pub sender_count: usize,
    pub waiting_to_send: usize,
    pub waiting_to_receive: usize,
}

pub struct Receiver<T> {
    inner: Arc<SegQueue<T>>,
    limit: Limit,
    parked_receivers: Arc<ParkedTasks>,
    parked_senders: Arc<ParkedTasks>,
    receiver_count: Arc<AtomicUsize>,
    sender_count: Arc<AtomicUsize>,
}

impl<T> Clone for Receiver<T> {
    fn clone(&self) -> Self {
        self.receiver_count.fetch_add(1, Ordering::Release);
        Receiver {
            inner: self.inner.clone(),
            limit: self.limit.clone(),
            parked_receivers: self.parked_receivers.clone(),
            parked_senders: self.parked_senders.clone(),
            receiver_count: self.receiver_count.clone(),
            sender_count: self.sender_count.clone(),
        }
    }
}

impl<T> Drop for Receiver<T> {
    fn drop(&mut self) {
        if self.receiver_count.fetch_sub(1, Ordering::Release) == 1 {
            self.parked_senders.wake_all();
            self.parked_receivers.wake_all();
        }
    }
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
                    a.fetch_add(1, Ordering::Release);
                }
            }
            self.parked_senders.wake_all();
            Ok(Async::Ready(msg))
        } else if self.sender_count.load(Ordering::Acquire) == 0 {
            Ok(Async::Ready(None))
        } else {
            self.parked_receivers.park(task::current());
            if self.sender_count.load(Ordering::Acquire) == 0 {
                Ok(Async::Ready(None))
            } else {
                self.parked_senders.wake_all();
                Ok(Async::NotReady)
            }
        }
    }
}

pub fn channel<T>(limit: Limit) -> (Sender<T>, Receiver<T>) {
    let inner = Arc::new(SegQueue::new());
    let parked_receivers = Arc::new(ParkedTasks::new());
    let parked_senders = Arc::new(ParkedTasks::new());
    let sender_count = Arc::new(AtomicUsize::new(1));
    let receiver_count = Arc::new(AtomicUsize::new(1));
    let receiver = Receiver {
        inner: inner.clone(),
        limit: limit.clone(),
        parked_receivers: parked_receivers.clone(),
        parked_senders: parked_senders.clone(),
        receiver_count: receiver_count.clone(),
        sender_count: sender_count.clone(),
    };
    let sender = Sender {
        inner,
        limit,
        parked_receivers,
        parked_senders,
        receiver_count,
        sender_count,
    };
    (sender, receiver)
}

struct DropFuture {
    dropped: Arc<AtomicBool>,
    parked_tasks: Arc<ParkedTasks>,
}

impl DropFuture {
    fn new_pair() -> (DropFuture, DropFuture) {
        let dropped = Arc::new(AtomicBool::default());
        let parked_tasks = Arc::new(ParkedTasks::new());
        let a = DropFuture {
            dropped: dropped.clone(),
            parked_tasks: parked_tasks.clone(),
        };
        let b = DropFuture {
            dropped,
            parked_tasks,
        };
        (a, b)
    }
}

impl Drop for DropFuture {
    fn drop(&mut self) {
        self.dropped.store(true, Ordering::Release);
        self.parked_tasks.wake_all();
    }
}

impl Future for DropFuture {
    type Item = ();
    type Error = ();

    fn poll(&mut self) -> Result<Async<()>, ()> {
        if self.dropped.load(Ordering::Acquire) {
            Ok(Async::Ready(()))
        } else {
            self.parked_tasks.park(task::current());
            Ok(Async::NotReady)
        }
    }
}

#[derive(Clone)]
pub struct OnDemandReceiver<T> {
    demander: Receiver<T>,
    bootstrapped: Arc<AtomicBool>,
    parked_listeners: Arc<ParkedTasks>,
    signal: Arc<AtomicUsize>,
}

impl<T: Send + Sync + 'static> OnDemandReceiver<T> {
    pub fn new(demander: Receiver<T>) -> Self {
        OnDemandReceiver {
            demander,
            bootstrapped: AtomicBool::default().into(),
            parked_listeners: ParkedTasks::new().into(),
            signal: AtomicUsize::default().into(),
        }
    }

    pub fn into_stream(
        self,
    ) -> (
        impl Stream<Item = (), Error = ()>,
        Arc<Fn() + Send + Sync + 'static>,
    ) {
        let mut kill_switch = None;
        if !self.bootstrapped.swap(true, Ordering::Release) {
            let (left, mut right) = DropFuture::new_pair();
            kill_switch = Some(left);
            self.demander.parked_senders.park(task::current());
            let mut first_go = true;
            let signal = self.signal.clone();
            let parked_listeners = self.parked_listeners.clone();
            let parked_senders = self.demander.parked_senders.clone();
            let inner = self.demander.inner.clone();
            let coordinator = future::poll_fn(move || {
                if let Ok(Async::Ready(())) = right.poll() {
                    return Ok(Async::Ready(()));
                }
                parked_senders.park(task::current());
                if first_go {
                    first_go = false;
                } else if inner.is_empty() && signal.compare_and_swap(0, 1, Ordering::AcqRel) == 0 {
                    parked_listeners.wake_all();
                }
                Ok(Async::NotReady)
            });
            tokio::spawn(coordinator);
        }

        let signal = self.signal.clone();
        // this callback is called after a request finishes
        let right = move || {
            signal.store(0, Ordering::Release);
        };
        // Currently the on demand stream must resolve for every callback. That should be changed to a
        // select_any on the streams
        let left = stream::poll_fn(move || {
            let _ = kill_switch;
            if self.signal.compare_and_swap(1, 2, Ordering::AcqRel) == 1 {
                Ok(Async::Ready(Some(())))
            } else {
                self.parked_listeners.park(task::current());
                Ok(Async::NotReady)
            }
        });

        (left, Arc::new(right))
    }
}
