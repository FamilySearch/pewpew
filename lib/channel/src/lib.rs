use config::Limit;
use crossbeam_queue::SegQueue;
use futures::{sink::Sink, stream, Stream};
use serde::Serialize;

use std::{
    error::Error as StdError,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    task::{Context, Poll, Waker},
};

struct ParkedTasks(SegQueue<Waker>);

impl ParkedTasks {
    fn new() -> Self {
        ParkedTasks(SegQueue::new())
    }

    fn park(&self, waker: &Waker) {
        self.0.push(waker.clone());
    }

    fn wake_all(&self) {
        while let Ok(task) = self.0.pop() {
            task.wake();
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
pub enum SendState2 {
    Closed,
    Full,
    Ready,
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
            inner: Some(Box::new(wrapped)),
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

    pub fn no_receivers(&self) -> bool {
        self.receiver_count.load(Ordering::Acquire) == 0
    }

    pub fn try_send(&self, item: T, waker: &Waker) -> SendState<T> {
        let ret = if self.no_receivers() {
            SendState::Closed
        } else if self.inner.len() < self.limit.get() {
            self.inner.push(item);
            SendState::Success
        } else {
            self.parked_senders.park(waker);
            if self.no_receivers() {
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

impl<T> PartialEq for Sender<T> {
    fn eq(&self, other: &Sender<T>) -> bool {
        Arc::ptr_eq(&self.inner, &other.inner)
    }
}

impl<T> PartialOrd for Sender<T> {
    fn partial_cmp(&self, other: &Sender<T>) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl<T> Eq for Sender<T> {}

impl<T> Ord for Sender<T> {
    fn cmp(&self, other: &Sender<T>) -> std::cmp::Ordering {
        Ord::cmp(&(&*self.inner as *const _), &(&*other.inner as *const _))
    }
}

impl<T> Sink<T> for Sender<T> {
    type Error = ChannelClosed;

    fn poll_ready(self: Pin<&mut Self>, cx: &mut Context) -> Poll<Result<(), Self::Error>> {
        if self.no_receivers() {
            Poll::Ready(Err(ChannelClosed::new()))
        } else if self.inner.len() < self.limit.get() {
            Poll::Ready(Ok(()))
        } else {
            self.parked_senders.park(cx.waker());
            if self.no_receivers() {
                Poll::Ready(Err(ChannelClosed::new()))
            } else {
                Poll::Pending
            }
        }
    }

    fn start_send(self: Pin<&mut Self>, item: T) -> Result<(), Self::Error> {
        self.force_send(item);
        Ok(())
    }

    fn poll_flush(self: Pin<&mut Self>, _: &mut Context) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn poll_close(self: Pin<&mut Self>, _: &mut Context) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
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

    pub fn get_stats(&self, timestamp: u64) -> ChannelStats {
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
    pub timestamp: u64,
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
    has_maxed: Arc<AtomicBool>,
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
            has_maxed: self.has_maxed.clone(),
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

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context) -> Poll<Option<Self::Item>> {
        let msg = self.inner.pop().ok();
        if msg.is_some() {
            let inner_len = self.inner.len();
            if inner_len == 0 {
                // if there's an "auto" limit and we've emptied the buffer
                // after it was previously full increment the limit
                if let Limit::Auto(a) = &self.limit {
                    if self
                        .has_maxed
                        .compare_and_swap(true, false, Ordering::Release)
                    {
                        a.fetch_add(1, Ordering::Release);
                    }
                }
            } else if self.limit.get() == inner_len + 1 {
                // if the buffer was full, raise the has_maxed flag
                self.has_maxed.store(true, Ordering::Release);
            }
            self.parked_senders.wake_all();
            Poll::Ready(msg)
        } else if self.sender_count.load(Ordering::Acquire) == 0 {
            Poll::Ready(None)
        } else {
            self.parked_receivers.park(cx.waker());
            if self.sender_count.load(Ordering::Acquire) == 0 {
                Poll::Ready(None)
            } else {
                self.parked_senders.wake_all();
                Poll::Pending
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
        has_maxed: Arc::new(AtomicBool::new(false)),
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

// The OnDemandReceiver is a type of stream that triggers when a receiver for a channel polls, seeking
// an item from the channel. The task receiving from OnDemandReceiver will do its work to provide a
// value for the channel, then call a callback indicating it is done (signifying whether it actually
// provided a value for the channel--because sometimes the task's work is done but it still doesn't have
// a value to provide).
#[derive(Clone)]
pub struct OnDemandReceiver<T> {
    demander_inner: Arc<SegQueue<T>>,
    demander_parked_receivers: Arc<ParkedTasks>,
    demander_parked_senders: Arc<ParkedTasks>,
    receiver_count: Arc<AtomicUsize>,
    signal: Arc<AtomicUsize>,
}

// The states that the OnDemandReceiver can be in. There are two states before `SIGNAL_WILL_TRIGGER`
// because when a value is pulled from the channel with a receiver, the receiver proactively triggers
// any parked senders to send another (in effort to keep the queue full). OnDemandReceiver ignores
// the first unpark, and will trigger on the subsequent unpark if the queue is empty in both cases.
const SIGNAL_INIT: usize = 0;
const SIGNAL_WAITING_FOR_RECEIVER: usize = 1;
const SIGNAL_WILL_TRIGGER: usize = 2;
const SIGNAL_WAITING_FOR_CALLBACK: usize = 3;

impl<T: Send + 'static> OnDemandReceiver<T> {
    pub fn new(demander: &Receiver<T>) -> Self {
        OnDemandReceiver {
            demander_inner: demander.inner.clone(),
            demander_parked_receivers: demander.parked_receivers.clone(),
            demander_parked_senders: demander.parked_senders.clone(),
            receiver_count: demander.receiver_count.clone(),
            signal: AtomicUsize::default().into(),
        }
    }

    pub fn into_stream(self) -> (impl Stream<Item = ()>, Arc<dyn Fn(bool) + Send + Sync>) {
        let signal = self.signal.clone();
        let demander_inner = self.demander_inner.clone();
        let demander_parked_senders = self.demander_parked_senders.clone();
        // this callback is called after a task finishes
        let cb = move |was_a_value_added: bool| {
            if was_a_value_added || !demander_inner.is_empty() {
                signal.store(SIGNAL_INIT, Ordering::Release);
            } else {
                signal.store(SIGNAL_WILL_TRIGGER, Ordering::Release);
                demander_parked_senders.wake_all();
            }
        };
        let stream = stream::poll_fn(move |cx| {
            // end the on_demand stream if there are no more receivers
            if self.receiver_count.load(Ordering::Acquire) == 0 {
                return Poll::Ready(None);
            }
            if self.demander_inner.is_empty() {
                let receivers_waiting = !self.demander_parked_receivers.0.is_empty();
                let signal_state = self
                    .signal
                    .fetch_update(Ordering::AcqRel, Ordering::Acquire, |prev| {
                        match (receivers_waiting, prev) {
                            (true, SIGNAL_INIT) | (_, SIGNAL_WILL_TRIGGER) => {
                                Some(SIGNAL_WAITING_FOR_CALLBACK)
                            }
                            (_, SIGNAL_WAITING_FOR_RECEIVER) => Some(SIGNAL_WILL_TRIGGER),
                            _ => None,
                        }
                    })
                    .unwrap_or_else(|e| e);

                if (receivers_waiting && signal_state == SIGNAL_INIT)
                    || signal_state == SIGNAL_WILL_TRIGGER
                {
                    return Poll::Ready(Some(()));
                }
            }
            self.demander_parked_senders.park(cx.waker());
            Poll::Pending
        });

        (stream, Arc::new(cb))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::{sink::SinkExt, task, FutureExt, StreamExt};

    use std::collections::BTreeSet;

    #[test]
    fn channel_limit_works() {
        let limit = Limit::Integer(1);
        let (mut tx, _rx) = channel::<bool>(limit.clone());

        for _ in 0..limit.get() {
            let left = tx.send(true).now_or_never();
            let right = Some(Ok(()));
            assert_eq!(left, right);
        }

        let left = tx.send(true).now_or_never();
        let right = None;
        assert_eq!(left, right);
    }

    #[test]
    fn channel_auto_limit_expands() {
        let limit = Limit::auto();
        let start_limit = limit.get();
        let (mut tx, mut rx) = channel::<bool>(limit.clone());

        for _ in 0..start_limit {
            let left = tx.send(true).now_or_never();
            let right = Some(Ok(()));
            assert_eq!(left, right, "first sends work");
        }

        let left = tx.send(true).now_or_never();
        let right = None;
        assert_eq!(left, right, "can't send another because it's full");

        assert_eq!(limit.get(), start_limit, "limit's still the same");

        for _ in 0..start_limit {
            let left = rx.next().now_or_never();
            let right = Some(Some(true));
            assert_eq!(left, right, "receives work");
        }

        let new_limit = start_limit + 1;
        assert_eq!(limit.get(), new_limit, "limit has increased");

        tx.force_send(true);
        let _ = rx.next().now_or_never();

        let left = rx.next().now_or_never();
        let right = None;
        assert_eq!(left, right, "receive doesn't work because it's empty");

        assert_eq!(limit.get(), new_limit, "limit still the same");

        for _ in 0..new_limit {
            let left = tx.send(true).now_or_never();
            let right = Some(Ok(()));
            assert_eq!(left, right, "second sends work");
        }

        let left = tx.send(true).now_or_never();
        let right = None;
        assert_eq!(left, right, "can't send another because it's full");
    }

    #[test]
    fn sender_errs_when_no_receivers() {
        let (mut tx, mut rx) = channel::<bool>(Limit::auto());

        while let Some(_) = tx.send(true).now_or_never() {}

        while rx.next().now_or_never().is_some() {}

        drop(rx);

        let left = tx.send(true).now_or_never();
        let right = Some(Err(ChannelClosed::new()));

        assert_eq!(
            left, right,
            "should not be able to send after receiver is dropped"
        );
    }

    #[test]
    fn sender_ord_works() {
        let (tx_a, _) = channel::<bool>(Limit::auto());
        let (tx_b, _) = channel::<bool>(Limit::auto());
        let (tx_c, _) = channel::<bool>(Limit::auto());
        let tx_a2 = tx_a.clone();
        let tx_a3 = tx_a.clone();
        let tx_b2 = tx_b.clone();
        let tx_b3 = tx_b.clone();

        let mut set = BTreeSet::new();
        set.insert(tx_a);
        set.insert(tx_a2);
        set.insert(tx_b);
        set.insert(tx_b2);

        assert_eq!(set.len(), 2);
        assert!(set.contains(&tx_a3));
        assert!(set.contains(&tx_b3));
        assert!(!set.contains(&tx_c));
    }

    #[test]
    fn receiver_ends_when_no_senders() {
        let limit = Limit::auto();
        let start_size = limit.get();
        let (mut tx, mut rx) = channel::<bool>(limit);

        while tx.send(true).now_or_never().is_some() {}

        drop(tx);

        for _ in 0..start_size {
            let left = rx.next().now_or_never();
            let right = Some(Some(true));
            assert_eq!(
                left, right,
                "receiver should be able to receive until queue is empty"
            );
        }

        let left = rx.next().now_or_never();
        let right = Some(None);

        assert_eq!(
            left, right,
            "should not be able to recieve after sender is dropped and queue is empty"
        );
    }

    #[test]
    fn on_demand_receiver_works() {
        let (tx, mut rx) = channel::<()>(Limit::auto());

        let (mut on_demand, done_fn) = OnDemandReceiver::new(&rx).into_stream();

        let waker = task::noop_waker();

        let left = on_demand.next().now_or_never();
        let right = None;
        assert_eq!(left, right, "on_demand stream should not be ready");

        let left = rx.next().now_or_never();
        let right = None;
        assert_eq!(left, right, "receiver should not be ready");

        let left = on_demand.next().now_or_never();
        let right = Some(Some(()));
        assert_eq!(left, right, "on_demand stream should be ready");

        let left = rx.next().now_or_never();
        let right = None;
        assert_eq!(left, right, "receiver should not be ready2");

        tx.try_send((), &waker);

        let left = on_demand.next().now_or_never();
        let right = None;
        assert_eq!(left, right, "on_demand stream should not be ready until the done_fn is called and receiver is polled");

        done_fn(true);

        let left = on_demand.next().now_or_never();
        let right = None;
        assert_eq!(
            left, right,
            "on_demand stream should not be ready until the receiver is polled"
        );

        let left = rx.next().now_or_never();
        let right = Some(Some(()));
        assert_eq!(left, right, "receiver should have a value");

        let left = on_demand.next().now_or_never();
        let right = None;
        assert_eq!(left, right, "on_demand stream should not be ready2");

        let left = rx.next().now_or_never();
        let right = None;
        assert_eq!(left, right, "receiver should not be ready3");

        let left = on_demand.next().now_or_never();
        let right = Some(Some(()));
        assert_eq!(left, right, "on_demand stream should be ready2");

        let left = rx.next().now_or_never();
        let right = None;
        assert_eq!(left, right, "receiver should not be ready4");

        let left = on_demand.next().now_or_never();
        let right = None;
        assert_eq!(left, right, "on_demand stream should not be ready3");

        tx.try_send((), &waker);

        let left = on_demand.next().now_or_never();
        let right = None;
        assert_eq!(left, right, "on_demand stream should not be ready until the done_fn is called and receiver is polled2");
    }
}
