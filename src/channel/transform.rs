use crate::channel::{
    self,
    Receiver,
    Sender,
};
use serde_json as json;
use tokio::{
    self,
    prelude::*,
};

use std::mem;

pub struct Collect {
    collection: Vec<json::Value>,
    count: usize,
}

impl Clone for Collect {
    fn clone(&self) -> Self {
        Collect::new(self.count)
    }
}

impl Collect {
    pub fn new(count: usize) -> Self {
        Collect {
            collection: Vec::new(),
            count,
        }
    }

    fn transform(&mut self, v: Option<json::Value>) -> Option<json::Value> {
        if let Some(v) = v {
            self.collection.push(v);
            if self.collection.len() == self.count {
                let ret = mem::replace(&mut self.collection, Vec::new());
                Some(ret.into())
            } else {
                None
            }
        } else {
            None
        }
    }
}

pub struct Repeat {
    count: usize,
    i: usize,
    previous: Option<json::Value>,
}

impl Clone for Repeat {
    fn clone(&self) -> Self {
        Repeat::new(self.count)
    }
}

impl Repeat {
    pub fn new(count: usize) -> Self {
        Repeat {
            count,
            i: 0,
            previous: None,
        }
    }

    fn transform(&mut self, mut v: Option<json::Value>) -> Option<json::Value> {
        if v.is_some() {
            self.i = 1;
            self.previous = v.clone();
        } else if self.i < self.count {
            self.i += 1;
            v = self.previous.clone();
        } else {
            self.previous = None;
        };
        v
    }
}

// transforms have a `transform` method which is called with an `Option<T>`.
// the `Transform` enum type also has a `transform` method and manages calling
// chains of transforms. When a `TransformSink` or `TransformStream` is polled
// they first call the `Transform` enum's `transform` method with `None`. This
// is done to get any elements buffered within a transform (for example `Repeat`
// which continues providing elements even when new data may not be coming in).
// If the first call the `transform` provides a value, then that value is used
// for, in the case of a `Sender`/`Sink` to send to the receiver, or in the case of
// a `Receiver`/`Stream` to send downstream. If the first call to `transform` did
// not provide a value then in the case of a `Sender`/`Sink` the value provided
// to the `poll` method is then used, or in the case of a `Receiver`/`Stream`
// it attempts to use the channel to get a new value to be used in subsequent
// call(s) to `transform`
pub enum Transform {
    Collect(Collect, Box<Option<Transform>>),
    Repeat(Repeat, Box<Option<Transform>>),
}

impl Clone for Transform {
    fn clone(&self) -> Self {
        match self {
            Transform::Collect(c, t) => {
                Transform::Collect(c.clone(), t.clone())
            },
            Transform::Repeat(r, t) => {
                Transform::Repeat(r.clone(), t.clone())
            },
        }
    }
}

impl Transform {
    fn transform(&mut self, mut v: Option<json::Value>) -> Option<json::Value> {
        let mut transform = Some(self);
        while let Some(t) = transform {
            match t {
                Transform::Collect(inner, wrap) => {
                    v = inner.transform(v);
                    transform = Option::as_mut(wrap);
                },
                Transform::Repeat(inner, wrap) => {
                    v = inner.transform(v);
                    transform = Option::as_mut(wrap);
                },
            }
            if v.is_none() {
                break
            }
        }
        v
    }

    pub fn wrap(&mut self, transform: Transform) {
        let wrap = match self {
            Transform::Collect(_, wrap) => wrap,
            Transform::Repeat(_, wrap) => wrap,
        };
        match wrap.as_mut() {
            Some(t) => t.wrap(transform),
            None => *wrap = Box::new(Some(transform)),
        }
    }
}

impl From<Collect> for Transform {
    fn from(c: Collect) -> Self {
        Transform::Collect(c, Box::new(None))
    }
}

impl From<Repeat> for Transform {
    fn from(r: Repeat) -> Self {
        Transform::Repeat(r, Box::new(None))
    }
}

pub struct Transformer {
    receiver: Receiver<json::Value>,
    sender: Sender<json::Value>,
    transform: Transform,
}

impl Transformer {
    pub fn prime<F>(self, test_ended: F)
        where F: Future + Send + 'static,
    {
        let mut transform = self.transform;
        let sender = self.sender;
        let task = self.receiver.for_each(move |v| {
            let mut v = Some(v);
            let mut results = Vec::new();
            while let Some(r) = transform.transform(v.take()) {
                results.push(r);
            }
            stream::iter_ok::<_, ()>(results)
                .forward(sender.clone())
                .map(|_| ())
        })
        .select(test_ended.then(|_| Ok(())))
        .then(|_| Ok(()));

        tokio::spawn(task);
    }
}

pub fn channel<F>(cap: usize, transform: Transform, test_ended: F)
    -> (Sender<json::Value>, Receiver<json::Value>)
    where F: Future + Send + 'static,
{
    let (tx, receiver) = channel::channel(cap);
    let (sender, rx) = channel::channel(cap);

    let transformer = Transformer {
        receiver,
        sender,
        transform,
    };
    transformer.prime(test_ended);

    (tx, rx)
}

// #[cfg(test)]
// mod tests {
//     use super::*;
//     use futures::{
//         future::lazy,
//         stream,
//     };
//     use tokio;

//     use serde_json as json;

//     use std::{
//         sync::{
//             Arc,
//             atomic::{AtomicUsize, Ordering},
//         },
//         time::{Duration, Instant}
//     };

//     #[test]
//     fn repeat_transform() {
//         let in_count = Arc::new(AtomicUsize::new(0));
//         let in_count2 = in_count.clone();
//         let out_count = Arc::new(AtomicUsize::new(0));
//         let out_count2 = out_count.clone();
//         let multiplier = 10;
//         tokio::run(lazy(move || {
//             let transform: Transform = Repeat::new(multiplier).into();
//             let (tx, rx) = channel(20, transform);

//             let duration = Duration::from_secs(1);
//             let start = Instant::now();
//             let feed = stream::repeat::<_, ()>(json::Value::Number(1.into()))
//                 .take_while(move |_| {
//                     let pass = start.elapsed() < duration;
//                     if pass {
//                         in_count2.fetch_add(1, Ordering::Relaxed);
//                     }
//                     Ok(start.elapsed() < duration)
//                 })
//                 .forward(tx)
//                 .map(|_| ());
//             tokio::spawn(feed);

//             rx.for_each(move |_| {
//                     out_count2.fetch_add(1, Ordering::Relaxed);
//                     Ok(())
//                 })
//                 .map_err(|_e| println!("err"))
//         }));
//         assert_eq!(in_count.load(Ordering::Relaxed) * multiplier, out_count.load(Ordering::Relaxed));
//     }
// }