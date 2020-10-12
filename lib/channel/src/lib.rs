use concurrent_queue::ConcurrentQueue;
use config::Limit;
use event_listener::{Event, EventListener};
use futures::{sink::Sink, stream, Stream};
use serde::Serialize;

use std::{
    error::Error as StdError,
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    task::{Context, Poll},
};

struct Channel<T> {
    has_maxed: AtomicBool,
    limit: Limit,
    receiver_events: Event,
    sender_events: Event,
    queue: ConcurrentQueue<T>,
    receiver_count: AtomicUsize,
    sender_count: AtomicUsize,
}

pub struct Sender<T> {
    inner: Arc<Channel<T>>,
    listener: Option<EventListener>,
}

pub enum SendState<T> {
    Closed(T),
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

#[allow(clippy::len_without_is_empty)]
impl<T> Sender<T> {
    pub fn len(&self) -> usize {
        self.inner.queue.len()
    }

    pub fn limit(&self) -> Limit {
        self.inner.limit.clone()
    }

    pub fn no_receivers(&self) -> bool {
        self.inner.receiver_count.load(Ordering::Acquire) == 0
    }

    pub fn try_send(&self, item: T) -> SendState<T> {
        if self.no_receivers() {
            SendState::Closed(item)
        } else if self.inner.queue.len() < self.inner.limit.get() {
            self.force_send(item);
            SendState::Success
        } else if self.no_receivers() {
            SendState::Closed(item)
        } else {
            SendState::Full(item)
        }
    }

    pub fn force_send(&self, item: T) {
        self.inner
            .queue
            .push(item)
            .ok()
            .expect("should never error because queue is unbounded");
        self.inner.receiver_events.notify(1);
    }
}

impl<T> Clone for Sender<T> {
    fn clone(&self) -> Self {
        self.inner.sender_count.fetch_add(1, Ordering::Release);
        Sender {
            inner: self.inner.clone(),
            listener: None,
        }
    }
}

impl<T> Drop for Sender<T> {
    fn drop(&mut self) {
        if self.inner.sender_count.fetch_sub(1, Ordering::Release) == 1 {
            self.inner.receiver_events.notify(std::usize::MAX);
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

    fn poll_ready(mut self: Pin<&mut Self>, cx: &mut Context) -> Poll<Result<(), Self::Error>> {
        loop {
            if self.no_receivers() {
                self.listener = None;
                return Poll::Ready(Err(ChannelClosed::new()));
            }

            if let Some(listener) = self.listener.as_mut() {
                match Pin::new(listener).poll(cx) {
                    Poll::Ready(()) => self.listener = None,
                    _ => return Poll::Pending,
                }
            }

            if self.inner.queue.len() < self.inner.limit.get() {
                self.listener = None;
                return Poll::Ready(Ok(()));
            } else if self.listener.is_none() {
                self.listener = Some(self.inner.sender_events.listen());
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
    channel: Arc<Channel<T>>,
}

impl<T> ChannelStatsReader<T> {
    pub fn new(provider: String, receiver: &Receiver<T>) -> Self {
        ChannelStatsReader {
            provider,
            channel: receiver.inner.clone(),
        }
    }

    pub fn get_stats(&self, timestamp: u64) -> ChannelStats {
        ChannelStats {
            provider: &self.provider,
            timestamp,
            len: self.channel.queue.len(),
            limit: self.channel.limit.get(),
            receiver_count: self.channel.receiver_count.load(Ordering::Acquire),
            sender_count: self.channel.sender_count.load(Ordering::Acquire),
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
}

pub struct Receiver<T> {
    inner: Arc<Channel<T>>,
    listener: Option<EventListener>,
}

impl<T> Clone for Receiver<T> {
    fn clone(&self) -> Self {
        self.inner.receiver_count.fetch_add(1, Ordering::Release);
        Receiver {
            inner: self.inner.clone(),
            listener: None,
        }
    }
}

impl<T> Drop for Receiver<T> {
    fn drop(&mut self) {
        if self.inner.receiver_count.fetch_sub(1, Ordering::Release) == 1 {
            self.inner.sender_events.notify(std::usize::MAX);
        }
    }
}

impl<T> Stream for Receiver<T> {
    type Item = T;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context) -> Poll<Option<Self::Item>> {
        loop {
            if let Some(listener) = self.listener.as_mut() {
                match Pin::new(listener).poll(cx) {
                    Poll::Ready(()) => self.listener = None,
                    _ => {
                        // notify senders here for the sake of OnDemand
                        self.inner.sender_events.notify(1);
                        return Poll::Pending;
                    }
                }
            }

            loop {
                let msg = self.inner.queue.pop().ok();
                if msg.is_some() {
                    let inner_len = self.inner.queue.len();
                    let limit = self.inner.limit.get();
                    if inner_len == 0 {
                        // if there's an "auto" limit and we've emptied the buffer
                        // after it was previously full increment the limit
                        if let Limit::Auto(a) = &self.inner.limit {
                            if self
                                .inner
                                .has_maxed
                                .compare_and_swap(true, false, Ordering::Release)
                            {
                                a.fetch_add(1, Ordering::Release);
                            }
                        }
                    } else if limit == inner_len + 1 {
                        // if the buffer was full, raise the has_maxed flag
                        self.inner.has_maxed.store(true, Ordering::Release);
                    }
                    if inner_len < limit {
                        self.inner.sender_events.notify(1);
                    }
                    self.listener = None;
                    return Poll::Ready(msg);
                } else if self.inner.sender_count.load(Ordering::Acquire) == 0 {
                    self.listener = None;
                    return Poll::Ready(None);
                } else if self.listener.is_none() {
                    self.listener = Some(self.inner.receiver_events.listen());
                } else {
                    break;
                }
            }
        }
    }
}

pub fn channel<T>(limit: Limit) -> (Sender<T>, Receiver<T>) {
    let channel = Channel {
        has_maxed: AtomicBool::new(false),
        limit,
        receiver_events: Event::new(),
        sender_events: Event::new(),
        queue: ConcurrentQueue::unbounded(),
        receiver_count: AtomicUsize::new(1),
        sender_count: AtomicUsize::new(1),
    };
    let inner = Arc::new(channel);
    let receiver = Receiver {
        inner: inner.clone(),
        listener: None,
    };
    let sender = Sender {
        inner,
        listener: None,
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
    channel: Arc<Channel<T>>,
}

impl<T: Send + 'static> OnDemandReceiver<T> {
    pub fn new(demander: &Receiver<T>) -> Self {
        OnDemandReceiver {
            channel: demander.inner.clone(),
        }
    }

    pub fn into_stream(self) -> impl Stream<Item = ()> {
        let mut listener: Option<EventListener> = None;
        let mut previous_len: Option<usize> = None;
        stream::poll_fn(move |cx| {
            loop {
                // end the stream if there are no more receivers
                if self.channel.receiver_count.load(Ordering::Acquire) == 0 {
                    listener = None;
                    return Poll::Ready(None);
                }
                match listener.as_mut() {
                    Some(listener2) => {
                        let ret = match Pin::new(listener2).poll(cx) {
                            Poll::Ready(()) => {
                                listener = None;
                                let queue_len = self.channel.queue.len();
                                match previous_len.take() {
                                    Some(n) if n == queue_len => Poll::Ready(Some(())),
                                    _ => {
                                        previous_len = Some(queue_len);
                                        listener = Some(self.channel.sender_events.listen());
                                        self.channel.sender_events.notify(1);
                                        Poll::Pending
                                    }
                                }
                            }
                            Poll::Pending => Poll::Pending,
                        };
                        return ret;
                    }
                    None => {
                        listener = Some(self.channel.sender_events.listen());
                    }
                }
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::{sink::SinkExt, FutureExt, StreamExt};

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

        while tx.send(true).now_or_never().is_some() {}

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

        let mut on_demand = OnDemandReceiver::new(&rx).into_stream();

        let left = on_demand.next().now_or_never();
        let right = None;
        assert_eq!(left, right, "on_demand stream should not be ready");

        let left = rx.next().now_or_never();
        let right = None;
        assert_eq!(left, right, "receiver should not be ready");

        on_demand.next().now_or_never();
        let left = on_demand.next().now_or_never();
        let right = Some(Some(()));
        assert_eq!(left, right, "on_demand stream should be ready");

        let left = rx.next().now_or_never();
        let right = None;
        assert_eq!(left, right, "receiver should not be ready2");

        tx.try_send(());

        let left = on_demand.next().now_or_never();
        let right = None;
        assert_eq!(left, right, "on_demand stream should not be ready until the done_fn is called and receiver is polled");

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

        tx.try_send(());

        let left = on_demand.next().now_or_never();
        let right = None;
        assert_eq!(left, right, "on_demand stream should not be ready until the done_fn is called and receiver is polled2");
    }
}
