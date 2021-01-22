mod hash_set;

use concurrent_queue::ConcurrentQueue;
use event_listener::{Event, EventListener};
use futures::{sink::Sink, stream, Stream};
use hash_set::HashSet;
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

#[derive(Debug)]
pub enum Limit {
    AutoSized(AtomicUsize),
    Hard(usize),
}

impl Limit {
    pub fn auto(n: usize) -> Self {
        Limit::AutoSized(AtomicUsize::new(n))
    }

    pub fn hard(n: usize) -> Self {
        Limit::Hard(n)
    }

    fn get(&self) -> usize {
        match self {
            Limit::AutoSized(a) => a.load(Ordering::Acquire),
            Limit::Hard(n) => *n,
        }
    }
}

struct Channel<T: Serialize> {
    has_maxed: AtomicBool,
    limit: Limit,
    receiver_events: Event,
    sender_events: Event,
    queue: ConcurrentQueue<T>,
    receiver_count: AtomicUsize,
    sender_count: AtomicUsize,
    unique: Option<HashSet>,
}

impl<T: Serialize> Channel<T> {
    fn new(limit: Limit, unique: bool) -> Self {
        let unique = match unique {
            true => Some(HashSet::new()),
            false => None,
        };
        Self {
            has_maxed: AtomicBool::new(false),
            limit,
            receiver_events: Event::new(),
            sender_events: Event::new(),
            queue: ConcurrentQueue::unbounded(),
            receiver_count: AtomicUsize::new(1),
            sender_count: AtomicUsize::new(1),
            unique,
        }
    }

    fn send(&self, item: T) {
        // if this is a unique channel check that the item is not in the set
        let should_send = self
            .unique
            .as_ref()
            .map(|s| s.insert(&item))
            .unwrap_or(true);
        if should_send {
            self.queue
                .push(item)
                .ok()
                .expect("should never error because queue is unbounded");
            self.notify_receiver();
        }
    }

    fn recv(&self) -> Option<T> {
        let item = self.queue.pop().ok();
        if let Some(item) = &item {
            // if this is a unique channel, remove this item from the set
            if let Some(set) = &self.unique {
                set.remove(item);
            }
            let inner_len = self.len();
            let limit = self.limit();
            if inner_len == 0 {
                // if there's an "auto" limit and we've emptied the buffer
                // after it was previously full increment the limit
                if let Limit::AutoSized(a) = &self.limit {
                    if self
                        .has_maxed
                        .compare_and_swap(true, false, Ordering::Release)
                    {
                        a.fetch_add(1, Ordering::Release);
                    }
                }
            } else if limit == inner_len + 1 {
                // if the buffer was full, raise the has_maxed flag
                self.has_maxed.store(true, Ordering::Release);
            }

            if inner_len < limit {
                self.notify_sender();
            }
        }
        item
    }

    fn len(&self) -> usize {
        self.queue.len()
    }

    fn limit(&self) -> usize {
        self.limit.get()
    }

    // notify a single sender with an event listener
    fn notify_sender(&self) {
        self.sender_events.notify(1);
    }

    // notify all senders with an event listener
    fn notify_all_senders(&self) {
        self.sender_events.notify(std::usize::MAX);
    }

    // notify a single receiver with an event listener
    fn notify_receiver(&self) {
        self.receiver_events.notify(1);
    }

    // notify all senders with an event listener
    fn notify_all_receivers(&self) {
        self.receiver_events.notify(std::usize::MAX);
    }

    // create a listener so a sender can get notice when it can make progress
    fn sender_listen(&self) -> EventListener {
        self.sender_events.listen()
    }

    // create a listener so a receiver can get notice when it can make progress
    fn receiver_listen(&self) -> EventListener {
        self.receiver_events.listen()
    }

    // get the number of senders
    fn sender_count(&self) -> usize {
        self.sender_count.load(Ordering::Acquire)
    }

    // increment the sender count and return the new count
    fn increment_sender_count(&self) -> usize {
        self.sender_count.fetch_add(1, Ordering::Release) + 1
    }

    // decrement the sender count and return the new count
    fn decrement_sender_count(&self) -> usize {
        self.sender_count.fetch_sub(1, Ordering::Release) - 1
    }

    // get the number of receivers
    fn receiver_count(&self) -> usize {
        self.receiver_count.load(Ordering::Acquire)
    }

    // increment the receiver count and return the new count
    fn increment_receiver_count(&self) -> usize {
        self.receiver_count.fetch_add(1, Ordering::Release) + 1
    }

    // decrement the receiver count and return the new count
    fn decrement_receiver_count(&self) -> usize {
        self.receiver_count.fetch_sub(1, Ordering::Release) - 1
    }
}

pub struct Sender<T: Serialize> {
    channel: Arc<Channel<T>>,
    listener: Option<EventListener>,
}

pub enum SendState<T> {
    Closed(T),
    Full(T),
    Success,
}

impl<T> SendState<T> {
    pub fn is_success(&self) -> bool {
        matches!(self, SendState::Success)
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
impl<T: Serialize> Sender<T> {
    pub fn len(&self) -> usize {
        self.channel.len()
    }

    pub fn limit(&self) -> usize {
        self.channel.limit()
    }

    pub fn no_receivers(&self) -> bool {
        self.channel.receiver_count() == 0
    }

    pub fn try_send(&self, item: T) -> SendState<T> {
        if self.no_receivers() {
            SendState::Closed(item)
        } else if self.channel.len() < self.channel.limit() {
            self.force_send(item);
            SendState::Success
        } else if self.no_receivers() {
            SendState::Closed(item)
        } else {
            SendState::Full(item)
        }
    }

    pub fn force_send(&self, item: T) {
        self.channel.send(item)
    }
}

impl<T: Serialize> Clone for Sender<T> {
    fn clone(&self) -> Self {
        self.channel.increment_sender_count();
        Sender {
            channel: self.channel.clone(),
            listener: None,
        }
    }
}

impl<T: Serialize> Drop for Sender<T> {
    fn drop(&mut self) {
        if self.channel.decrement_sender_count() == 0 {
            self.channel.notify_all_receivers();
        }
    }
}

impl<T: Serialize> PartialEq for Sender<T> {
    fn eq(&self, other: &Sender<T>) -> bool {
        Arc::ptr_eq(&self.channel, &other.channel)
    }
}

impl<T: Serialize> PartialOrd for Sender<T> {
    fn partial_cmp(&self, other: &Sender<T>) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl<T: Serialize> Eq for Sender<T> {}

impl<T: Serialize> Ord for Sender<T> {
    fn cmp(&self, other: &Sender<T>) -> std::cmp::Ordering {
        Ord::cmp(
            &(&*self.channel as *const _),
            &(&*other.channel as *const _),
        )
    }
}

// Implementing the `Sink` trait on `Sender` allows enables `send: block` functionality
impl<T: Serialize> Sink<T> for Sender<T> {
    type Error = ChannelClosed;

    // Checks whether the channel is ready to have data pushed in.
    // If there are no receivers it returns with a channel closed error.
    // If there is room in the channel it will return an ok.
    // Otherwise it sets up a listener to be notified when there is room in
    // channel.
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

            if self.channel.len() < self.channel.limit() {
                self.listener = None;
                return Poll::Ready(Ok(()));
            } else if self.listener.is_none() {
                self.listener = Some(self.channel.sender_listen());
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

pub struct ChannelStatsReader<T: Serialize> {
    provider: String,
    channel: Arc<Channel<T>>,
}

impl<T: Serialize> ChannelStatsReader<T> {
    pub fn new(provider: String, receiver: &Receiver<T>) -> Self {
        ChannelStatsReader {
            provider,
            channel: receiver.channel.clone(),
        }
    }

    pub fn get_stats(&self, timestamp: u64) -> ChannelStats {
        ChannelStats {
            provider: &self.provider,
            timestamp,
            len: self.channel.len(),
            limit: self.channel.limit(),
            receiver_count: self.channel.receiver_count(),
            sender_count: self.channel.sender_count(),
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

pub struct Receiver<T: Serialize> {
    channel: Arc<Channel<T>>,
    listener: Option<EventListener>,
}

impl<T: Serialize> Clone for Receiver<T> {
    fn clone(&self) -> Self {
        self.channel.increment_receiver_count();
        Receiver {
            channel: self.channel.clone(),
            listener: None,
        }
    }
}

impl<T: Serialize> Drop for Receiver<T> {
    fn drop(&mut self) {
        if self.channel.decrement_receiver_count() == 0 {
            // notify all senders so they will see there are no more receivers
            // and stop awaiting
            self.channel.notify_all_senders();
        }
    }
}

impl<T: Serialize> Stream for Receiver<T> {
    type Item = T;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context) -> Poll<Option<Self::Item>> {
        loop {
            if let Some(listener) = self.listener.as_mut() {
                match Pin::new(listener).poll(cx) {
                    Poll::Ready(()) => self.listener = None,
                    _ => {
                        // notify a sender here for the sake of OnDemand
                        self.channel.notify_sender();
                        return Poll::Pending;
                    }
                }
            }

            let msg = self.channel.recv();
            if msg.is_some() {
                self.listener = None;
                return Poll::Ready(msg);
            } else if self.channel.sender_count() == 0 {
                self.listener = None;
                return Poll::Ready(None);
            } else if self.listener.is_none() {
                self.listener = Some(self.channel.receiver_listen());
            }
        }
    }
}

pub fn channel<T: Serialize>(limit: Limit, unique: bool) -> (Sender<T>, Receiver<T>) {
    let channel = Arc::new(Channel::new(limit, unique));
    let receiver = Receiver {
        channel: channel.clone(),
        listener: None,
    };
    let sender = Sender {
        channel,
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
pub struct OnDemandReceiver<T: Serialize> {
    channel: Arc<Channel<T>>,
}

impl<T: Serialize + Send + 'static> OnDemandReceiver<T> {
    pub fn new(demander: &Receiver<T>) -> Self {
        OnDemandReceiver {
            channel: demander.channel.clone(),
        }
    }

    pub fn into_stream(self) -> impl Stream<Item = ()> {
        let mut listener: Option<EventListener> = None;
        let mut previous_len: Option<usize> = None;
        stream::poll_fn(move |cx| {
            loop {
                // end the stream if there are no more receivers
                if self.channel.receiver_count() == 0 {
                    listener = None;
                    return Poll::Ready(None);
                }
                match listener.as_mut() {
                    Some(listener2) => {
                        let ret = match Pin::new(listener2).poll(cx) {
                            Poll::Ready(()) => {
                                listener = None;
                                let queue_len = self.channel.len();
                                match previous_len.take() {
                                    Some(n) if n == queue_len => Poll::Ready(Some(())),
                                    _ => {
                                        previous_len = Some(queue_len);
                                        listener = Some(self.channel.sender_listen());
                                        self.channel.notify_sender();
                                        Poll::Pending
                                    }
                                }
                            }
                            Poll::Pending => Poll::Pending,
                        };
                        return ret;
                    }
                    None => {
                        listener = Some(self.channel.sender_listen());
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
        let limit = Limit::Hard(1);
        let (mut tx, _rx) = channel::<bool>(limit, false);

        for _ in 0..tx.limit() {
            let left = tx.send(true).now_or_never();
            let right = Some(Ok(()));
            assert_eq!(left, right);
        }

        let left = tx.send(true).now_or_never();
        let right = None;
        assert_eq!(left, right);
    }

    #[test]
    fn unique_channel_works() {
        let cap = 8; // how many unique values we'll put into the channel
        let limit = Limit::Hard(100); // the size of the channel and how many times we will insert values
        let (tx, _rx) = channel::<usize>(limit, true);

        assert!(tx.limit() > cap);

        for n in 0..tx.limit() {
            tx.force_send(n % cap);
        }

        assert_eq!(tx.len(), cap);
    }

    #[test]
    fn channel_auto_limit_expands() {
        let limit = Limit::auto(5);
        let start_limit = limit.get();
        let (mut tx, mut rx) = channel::<bool>(limit, false);

        for _ in 0..start_limit {
            let left = tx.send(true).now_or_never();
            let right = Some(Ok(()));
            assert_eq!(left, right, "first sends work");
        }

        let left = tx.send(true).now_or_never();
        let right = None;
        assert_eq!(left, right, "can't send another because it's full");

        assert_eq!(tx.limit(), start_limit, "limit's still the same");

        for _ in 0..start_limit {
            let left = rx.next().now_or_never();
            let right = Some(Some(true));
            assert_eq!(left, right, "receives work");
        }

        let new_limit = start_limit + 1;
        assert_eq!(tx.limit(), new_limit, "limit has increased");

        tx.force_send(true);
        let _ = rx.next().now_or_never();

        let left = rx.next().now_or_never();
        let right = None;
        assert_eq!(left, right, "receive doesn't work because it's empty");

        assert_eq!(tx.limit(), new_limit, "limit still the same");

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
        let (mut tx, mut rx) = channel::<bool>(Limit::auto(5), false);

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
        let (tx_a, _) = channel::<bool>(Limit::auto(5), false);
        let (tx_b, _) = channel::<bool>(Limit::auto(5), false);
        let (tx_c, _) = channel::<bool>(Limit::auto(5), false);
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
        let limit = Limit::auto(5);
        let start_size = limit.get();
        let (mut tx, mut rx) = channel::<bool>(limit, false);

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
        let (tx, mut rx) = channel::<()>(Limit::auto(5), false);

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
