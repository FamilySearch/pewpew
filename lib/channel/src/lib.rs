#![feature(no_more_cas)]
use crossbeam_queue::SegQueue;
use futures::{sink::Sink, stream, task, Async, AsyncSink, Poll, StartSend, Stream};
use serde::{
    de::{Error as DeError, Unexpected},
    Deserialize, Deserializer, Serialize,
};

use std::{
    error::Error as StdError,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};

#[derive(Clone)]
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

impl<'de> Deserialize<'de> for Limit {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let string = String::deserialize(deserializer)?;
        if string == "auto" {
            Ok(Limit::auto())
        } else {
            let n = string.parse::<usize>().map_err(|_| {
                DeError::invalid_value(Unexpected::Str(&string), &"a valid limit value")
            })?;
            Ok(Limit::Integer(n))
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

#[derive(Debug, Default)]
pub struct ChannelClosed {
    inner: Option<Box<dyn StdError + Send + Sync + 'static>>,
}

impl PartialEq<ChannelClosed> for ChannelClosed {
    fn eq(&self, rhs: &ChannelClosed) -> bool {
        self.inner.is_none() && rhs.inner.is_none()
    }
}

impl ChannelClosed {
    pub fn new() -> Self {
        ChannelClosed::default()
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
                if let Limit::Auto(a) = &self.limit {
                    a.fetch_add(1, Ordering::Release);
                }
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

#[derive(Clone)]
pub struct OnDemandReceiver<T> {
    demander_inner: Arc<SegQueue<T>>,
    demander_parked_receivers: Arc<ParkedTasks>,
    demander_parked_senders: Arc<ParkedTasks>,
    signal: Arc<AtomicUsize>,
}

const SIGNAL_INIT: usize = 0;
const SIGNAL_WAITING_FOR_RECEIVER: usize = 1;
const SIGNAL_WILL_TRIGGER: usize = 2;
const SIGNAL_WAITING_FOR_CALLBACK: usize = 3;

impl<T: Send + Sync + 'static> OnDemandReceiver<T> {
    pub fn new(demander: &Receiver<T>) -> Self {
        OnDemandReceiver {
            demander_inner: demander.inner.clone(),
            demander_parked_receivers: demander.parked_receivers.clone(),
            demander_parked_senders: demander.parked_senders.clone(),
            signal: AtomicUsize::default().into(),
        }
    }

    pub fn into_stream(
        self,
    ) -> (
        impl Stream<Item = (), Error = ()>,
        Arc<dyn Fn(bool) + Send + Sync + 'static>,
    ) {
        let signal = self.signal.clone();
        let demander_inner = self.demander_inner.clone();
        let demander_parked_senders = self.demander_parked_senders.clone();
        // this callback is called after a request finishes
        let cb = move |was_a_value_added: bool| {
            if was_a_value_added || !demander_inner.is_empty() {
                signal.store(SIGNAL_WAITING_FOR_RECEIVER, Ordering::Release);
            } else {
                signal.store(SIGNAL_WILL_TRIGGER, Ordering::Release);
                demander_parked_senders.wake_all();
            }
        };
        let stream = stream::poll_fn(move || {
            if self.demander_inner.is_empty() {
                let receivers_waiting = !self.demander_parked_receivers.0.is_empty();
                let signal_state = self
                    .signal
                    .fetch_update(
                        |prev| match (receivers_waiting, prev) {
                            (true, SIGNAL_INIT) | (_, SIGNAL_WILL_TRIGGER) => Some(SIGNAL_WAITING_FOR_CALLBACK),
                            (_, SIGNAL_WAITING_FOR_RECEIVER) => Some(SIGNAL_WILL_TRIGGER),
                            _ => None,
                        },
                        Ordering::Acquire,
                        Ordering::AcqRel,
                    )
                    .unwrap_or_else(|e| e);

                if (receivers_waiting && signal_state == SIGNAL_INIT) || signal_state == SIGNAL_WILL_TRIGGER {
                    return Ok(Async::Ready(Some(())));
                }
            }
            self.demander_parked_senders.park(task::current());
            Ok(Async::NotReady)
        });

        (stream, Arc::new(cb))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::future;
    use tokio::runtime::current_thread;

    #[test]
    fn channel_limit_works() {
        let f = future::lazy(|| {
            let limit = Limit::Integer(1);
            let (mut tx, _rx) = channel::<bool>(limit.clone());

            for _ in 0..limit.get() {
                let left = tx.start_send(true);
                let right = Ok(AsyncSink::Ready);
                assert_eq!(left, right);
            }

            let left = tx.start_send(true);
            let right = Ok(AsyncSink::NotReady(true));
            assert_eq!(left, right);

            Ok(())
        });
        current_thread::run(f);
    }

    #[test]
    fn channel_auto_limit_expands() {
        let f = future::lazy(|| {
            let limit = Limit::auto();
            let start_limit = limit.get();
            let (mut tx, mut rx) = channel::<bool>(limit.clone());

            for _ in 0..start_limit {
                let left = tx.start_send(true);
                let right = Ok(AsyncSink::Ready);
                assert_eq!(left, right, "first sends work");
            }

            let left = tx.start_send(true);
            let right = Ok(AsyncSink::NotReady(true));
            assert_eq!(left, right, "can't send another because it's full");

            assert_eq!(limit.get(), start_limit, "limit's still the same");

            for _ in 0..start_limit {
                let left = rx.poll();
                let right = Ok(Async::Ready(Some(true)));
                assert_eq!(left, right, "receives work");
            }

            let mut new_limit = start_limit + 1;
            assert_eq!(limit.get(), new_limit, "limit has increased");

            let left = rx.poll();
            let right = Ok(Async::NotReady);
            assert_eq!(left, right, "receive doesn't work because it's empty");

            new_limit += 1;
            assert_eq!(limit.get(), new_limit, "limit has increased again");

            for _ in 0..new_limit {
                let left = tx.start_send(true);
                let right = Ok(AsyncSink::Ready);
                assert_eq!(left, right, "second sends work");
            }

            let left = tx.start_send(true);
            let right = Ok(AsyncSink::NotReady(true));
            assert_eq!(left, right, "can't send another because it's full");

            Ok(())
        });
        current_thread::run(f);
    }

    #[test]
    fn sender_errs_when_no_receivers() {
        let f = future::lazy(|| {
            let (mut tx, mut rx) = channel::<bool>(Limit::auto());

            loop {
                if let Ok(AsyncSink::NotReady(_)) = tx.start_send(true) {
                    break;
                }
            }

            loop {
                if let Ok(Async::NotReady) = rx.poll() {
                    break;
                }
            }

            drop(rx);

            let left = tx.start_send(true);
            let right = Err(ChannelClosed::new());

            assert_eq!(
                left, right,
                "should not be able to send after receiver is dropped"
            );

            Ok(())
        });
        current_thread::run(f);
    }

    #[test]
    fn receiver_ends_when_no_senders() {
        let f = future::lazy(|| {
            let limit = Limit::auto();
            let start_size = limit.get();
            let (mut tx, mut rx) = channel::<bool>(limit);

            loop {
                if let Ok(AsyncSink::NotReady(_)) = tx.start_send(true) {
                    break;
                }
            }

            drop(tx);

            for _ in 0..start_size {
                let left = rx.poll();
                let right = Ok(Async::Ready(Some(true)));
                assert_eq!(
                    left, right,
                    "receiver should be able to receive until queue is empty"
                );
            }

            let left = rx.poll();
            let right = Ok(Async::Ready(None));

            assert_eq!(
                left, right,
                "should not be able to recieve after sender is dropped and queue is empty"
            );

            Ok(())
        });
        current_thread::run(f);
    }

    #[test]
    fn on_demand_receiver_works() {
        let f = future::lazy(|| {
            let (tx, mut rx) = channel::<()>(Limit::auto());

            let (mut on_demand, done_fn) = OnDemandReceiver::new(&rx).into_stream();

            let left = on_demand.poll();
            let right = Ok(Async::NotReady);
            assert_eq!(left, right, "on_demand stream should not be ready");

            let left = rx.poll();
            let right = Ok(Async::NotReady);
            assert_eq!(left, right, "receiver should not be ready");

            let left = on_demand.poll();
            let right = Ok(Async::Ready(Some(())));
            assert_eq!(left, right, "on_demand stream should be ready");

            let left = rx.poll();
            let right = Ok(Async::NotReady);
            assert_eq!(left, right, "receiver should not be ready2");

            tx.try_send(());

            let left = on_demand.poll();
            let right = Ok(Async::NotReady);
            assert_eq!(left, right, "on_demand stream should not be ready until the done_fn is called and receiver is polled");

            done_fn(true);

            let left = on_demand.poll();
            let right = Ok(Async::NotReady);
            assert_eq!(
                left, right,
                "on_demand stream should not be ready until the receiver is polled"
            );

            let left = rx.poll();
            let right = Ok(Async::Ready(Some(())));
            assert_eq!(left, right, "receiver should have a value");

            let left = on_demand.poll();
            let right = Ok(Async::NotReady);
            assert_eq!(left, right, "on_demand stream should not be ready2");

            let left = rx.poll();
            let right = Ok(Async::NotReady);
            assert_eq!(left, right, "receiver should not be ready3");

            let left = on_demand.poll();
            let right = Ok(Async::Ready(Some(())));
            assert_eq!(left, right, "on_demand stream should be ready2");

            let left = rx.poll();
            let right = Ok(Async::NotReady);
            assert_eq!(left, right, "receiver should not be ready4");

            let left = on_demand.poll();
            let right = Ok(Async::NotReady);
            assert_eq!(left, right, "on_demand stream should not be ready3");

            tx.try_send(());

            let left = on_demand.poll();
            let right = Ok(Async::NotReady);
            assert_eq!(left, right, "on_demand stream should not be ready until the done_fn is called and receiver is polled2");

            Ok(())
        });
        current_thread::run(f);
    }

}
