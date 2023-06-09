//! Provides Zipping functionality for [`TryStream`] types.

use std::{
    collections::BTreeMap,
    fmt,
    pin::Pin,
    task::{Context, Poll},
};

use futures::{Stream, TryStream, TryStreamExt};

/// Struct representing a zipped [`Vec`] of multiple [`Stream`]s.
///
/// See the [`zip_all`] function for more detail.
#[must_use = "streams do nothing unless polled"]
pub struct ZipAll<T>
where
    T: TryStream + Unpin,
    T::Ok: Unpin,
    T::Error: Unpin,
{
    elems: Vec<(T, Option<T::Ok>)>,
}

impl<T> fmt::Debug for ZipAll<T>
where
    T: TryStream + Unpin + fmt::Debug,
    T::Ok: Unpin + fmt::Debug,
    T::Error: Unpin + fmt::Debug,
{
    fn fmt(&self, fmt: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt.debug_struct("ZipAll")
            .field("elems", &self.elems)
            .finish()
    }
}

impl<T> Stream for ZipAll<T>
where
    T: TryStream + Unpin,
    T::Ok: Unpin,
    T::Error: Unpin,
{
    type Item = Result<Vec<T::Ok>, T::Error>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let mut all_done = true;
        let this = Pin::into_inner(self);
        for (s, result) in &mut this.elems.iter_mut() {
            match result {
                None => match s.try_poll_next_unpin(cx) {
                    Poll::Ready(Some(Ok(v))) => {
                        *result = Some(v);
                    }
                    Poll::Ready(Some(Err(e))) => {
                        this.elems.clear();
                        return Poll::Ready(Some(Err(e)));
                    }
                    Poll::Ready(None) => {
                        this.elems.clear();
                        return Poll::Ready(None);
                    }
                    Poll::Pending => {
                        all_done = false;
                        continue;
                    }
                },
                Some(_) => continue,
            };
        }

        if all_done {
            let result: Vec<_> = this
                .elems
                .iter_mut()
                .map(|(_, o)| o.take().unwrap())
                .collect();
            if result.is_empty() {
                Poll::Ready(None)
            } else {
                Poll::Ready(Some(Ok(result)))
            }
        } else {
            Poll::Pending
        }
    }
}

/// Takes a collection of [`TryStream`]s and returns a new stream that yields a [`Vec`] of one item
/// from each of the original streams as its Item.
///
/// The resulting stream will only yield an `Ok` if all contained streams yield `Ok`.
///
/// For a variant that operates on map types rather than list types, see [`zip_all_map`].
///
/// # Example
/// ```
/// # use zip_all::zip_all;
/// let a = futures::stream::iter((1..5).map(Ok::<i32, ()>));
/// let b = futures::stream::iter((6..i32::MAX).map(Ok));
/// let stream = zip_all([a, b]);
///
/// let mut iter = futures::executor::block_on_stream(stream);
/// assert_eq!(iter.next(), Some(Ok(vec![1, 6])));
/// assert_eq!(iter.next(), Some(Ok(vec![2, 7])));
/// assert_eq!(iter.next(), Some(Ok(vec![3, 8])));
/// assert_eq!(iter.next(), Some(Ok(vec![4, 9])));
/// // Will only yield values if all streams yield values
/// // Even though stream `b` has more numbers, `a` is done.
/// assert_eq!(iter.next(), None);
/// ```
pub fn zip_all<I, T>(elems: I) -> ZipAll<I::Item>
where
    I: IntoIterator<Item = T>,
    T: TryStream + Unpin,
    T::Ok: Unpin,
    T::Error: Unpin,
{
    let elems = elems.into_iter().map(|s| (s, None)).collect();
    ZipAll { elems }
}

/// Struct representing a zipped [`BTreeMap`] of multiple [`Stream`]s.
///
/// See the [`zip_all_map`] function for more detail.
#[derive(Debug)]
#[must_use = "streams do nothing unless polled"]
pub struct ZipAllMap<K, T>
where
    T: TryStream + Unpin,
    T::Ok: Unpin,
    T::Error: Unpin,
    K: Ord + Clone,
{
    elems: BTreeMap<K, (T, Option<T::Ok>)>,
    require_all: bool,
}

impl<K, T> Stream for ZipAllMap<K, T>
where
    T: TryStream + Unpin,
    T::Ok: Unpin,
    T::Error: Unpin,
    K: Ord + Clone,
{
    type Item = Result<BTreeMap<K, T::Ok>, T::Error>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let mut all_done = true;
        let this = Pin::into_inner(self);
        let mut done = Vec::with_capacity(this.elems.len());
        for (k, (s, result)) in this.elems.iter_mut().filter(|(_, (_, r))| r.is_none()) {
            match s.try_poll_next_unpin(cx) {
                Poll::Ready(Some(Ok(v))) => {
                    *result = Some(v);
                }
                Poll::Ready(Some(Err(e))) => {
                    this.elems.clear();
                    return Poll::Ready(Some(Err(e)));
                }
                Poll::Ready(None) => {
                    if this.require_all {
                        this.elems.clear();
                        return Poll::Ready(None);
                    } else {
                        done.push(k.clone());
                    }
                }
                Poll::Pending => {
                    all_done = false;
                    continue;
                }
            };
        }
        if !this.require_all {
            for k in done {
                this.elems.remove(&k);
            }
        }
        if this.elems.is_empty() {
            return Poll::Ready(None);
        }

        if all_done {
            let result: BTreeMap<_, _> = this
                .elems
                .iter_mut()
                .map(|(k, (_, o))| (k.clone(), o.take().unwrap()))
                .collect();
            Poll::Ready((!result.is_empty()).then(|| Ok(result)))
        } else {
            Poll::Pending
        }
    }
}

/// Takes a collection of (`K`, [`TryStream`]) pairs and returns a new stream that yields a
/// [`BTreeMap`] containing one item from each of the original streams as its Item, with each value
/// being associated with the key of the original stream.
///
/// If `true` is passed in for `require_all`, then a value will only be yielded if all of the
/// initial streams provide a value each time. Otherwise, once a single stream is done, streams
/// that can still yield values will still be polled.
///
/// The resulting stream will only yield an `Ok` if all contained streams yield `Ok`.
///
/// For a variant that operates on list types rather than map types, see [`zip_all`].
///
/// **Note:** As the `K` values are cloned for each time a new map is yielded, is should be
/// preferred for `K` to be a type that is cheaper to clone, such as a [`Copy`] type, a
/// borrowed reference, or a shared pointer such as [`Arc<_>`](std::sync::Arc).
///
/// # Examples
/// ```
/// # use zip_all::zip_all_map;
/// # use std::collections::BTreeMap;
/// let a = futures::stream::iter((1..5).map(Ok::<i32, ()>));
/// let b = futures::stream::iter((6..100).map(Ok));
/// let stream = zip_all_map(BTreeMap::from([('a', a), ('b', b)]), true);
///
/// let mut iter = futures::executor::block_on_stream(stream);
/// assert_eq!(iter.next(), Some(Ok(BTreeMap::from([('a', 1), ('b', 6)]))));
/// assert_eq!(iter.next(), Some(Ok(BTreeMap::from([('a', 2), ('b', 7)]))));
/// assert_eq!(iter.next(), Some(Ok(BTreeMap::from([('a', 3), ('b', 8)]))));
/// assert_eq!(iter.next(), Some(Ok(BTreeMap::from([('a', 4), ('b', 9)]))));
/// // `require_all` was passed in as `true`, so the zipped stream ends here.
/// assert_eq!(iter.next(), None);
/// ```
/// ```
/// # use zip_all::zip_all_map;
/// # use std::collections::BTreeMap;
/// let a = futures::stream::iter((1..5).map(Ok::<i32, ()>));
/// let b = futures::stream::iter((6..13).map(Ok));
/// let stream = zip_all_map(BTreeMap::from([('a', a), ('b', b)]), false);
///
/// let mut iter = futures::executor::block_on_stream(stream);
/// assert_eq!(iter.next(), Some(Ok(BTreeMap::from([('a', 1), ('b', 6)]))));
/// assert_eq!(iter.next(), Some(Ok(BTreeMap::from([('a', 2), ('b', 7)]))));
/// assert_eq!(iter.next(), Some(Ok(BTreeMap::from([('a', 3), ('b', 8)]))));
/// assert_eq!(iter.next(), Some(Ok(BTreeMap::from([('a', 4), ('b', 9)]))));
/// // `require_all` was passed in as `false`, so the zipped stream continues.
/// assert_eq!(iter.next(), Some(Ok(BTreeMap::from([('b', 10)]))));
/// assert_eq!(iter.next(), Some(Ok(BTreeMap::from([('b', 11)]))));
/// assert_eq!(iter.next(), Some(Ok(BTreeMap::from([('b', 12)]))));
/// // both streams have now ended
/// assert_eq!(iter.next(), None);
/// ```
pub fn zip_all_map<K, I, T>(elems: I, require_all: bool) -> ZipAllMap<K, T>
where
    I: IntoIterator<Item = (K, T)>,
    T: TryStream + Unpin,
    T::Ok: Unpin,
    T::Error: Unpin,
    K: Ord + Clone,
{
    let elems = elems.into_iter().map(|(k, s)| (k, (s, None))).collect();
    ZipAllMap { elems, require_all }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::{executor::block_on_stream, stream, StreamExt};
    use std::collections::VecDeque;

    #[derive(Debug, PartialEq)]
    enum NumOrChar {
        Num(u8),
        Char(&'static char),
    }

    #[test]
    fn zip_all_works() {
        // stream that yields: 1, 2, 3, 4
        let a = stream::iter::<Vec<Result<NumOrChar, ()>>>(
            (1..5).map(|v| Ok(NumOrChar::Num(v))).collect(),
        )
        .boxed();
        // stream that yields: 6, 7, 8, 9
        let b = stream::iter::<Vec<Result<NumOrChar, ()>>>(
            (6..10).map(|v| Ok(NumOrChar::Num(v))).collect(),
        )
        .boxed();
        // stream that yields: 'a', 'b', 'c', 'd'
        let c = stream::iter::<Vec<Result<NumOrChar, ()>>>(
            ['a', 'b', 'c', 'd']
                .iter()
                .map(|v| Ok(NumOrChar::Char(v)))
                .collect(),
        )
        .boxed();
        let streams = vec![a, b, c];

        let mut expects = vec![
            vec![NumOrChar::Num(1), NumOrChar::Num(6), NumOrChar::Char(&'a')],
            vec![NumOrChar::Num(2), NumOrChar::Num(7), NumOrChar::Char(&'b')],
            vec![NumOrChar::Num(3), NumOrChar::Num(8), NumOrChar::Char(&'c')],
            vec![NumOrChar::Num(4), NumOrChar::Num(9), NumOrChar::Char(&'d')],
        ];

        for r in block_on_stream(zip_all(streams)) {
            let expect = expects.remove(0);
            assert_eq!(r, Ok(expect));
        }

        assert!(expects.is_empty());
    }

    #[test]
    fn zip_all_map_works() {
        use NumOrChar::{Char, Num};

        // stream that yields: 1, 2, 3, 4
        let a = stream::iter::<Vec<Result<NumOrChar, ()>>>((1..5).map(|v| Ok(Num(v))).collect())
            .boxed();
        // stream that yields: 6, 7, 8, 9
        let b = stream::iter::<Vec<Result<NumOrChar, ()>>>((6..=10).map(|v| Ok(Num(v))).collect())
            .boxed();
        // stream that yields: 'a', 'b', 'c', 'd'
        let c = stream::iter::<Vec<Result<NumOrChar, ()>>>(
            ['a', 'b', 'c', 'd'].iter().map(|v| Ok(Char(v))).collect(),
        )
        .boxed();
        let streams = BTreeMap::from([("a", a), ("b", b), ("c", c)]);

        let mut expects = VecDeque::from([
            BTreeMap::from([("a", Num(1)), ("b", Num(6)), ("c", Char(&'a'))]),
            BTreeMap::from([("a", Num(2)), ("b", Num(7)), ("c", Char(&'b'))]),
            BTreeMap::from([("a", Num(3)), ("b", Num(8)), ("c", Char(&'c'))]),
            BTreeMap::from([("a", Num(4)), ("b", Num(9)), ("c", Char(&'d'))]),
            BTreeMap::from([("b", Num(10))]),
        ]);

        for r in block_on_stream(zip_all_map(streams, false)) {
            let expect = expects.pop_front().unwrap();
            assert_eq!(r, Ok(expect));
        }

        assert!(expects.is_empty());
    }

    #[test]
    fn zip_all_map_works_require_all() {
        use NumOrChar::{Char, Num};

        // stream that yields: 1, 2, 3, 4
        let a = stream::iter::<Vec<Result<NumOrChar, ()>>>((1..105).map(|v| Ok(Num(v))).collect())
            .boxed();
        // stream that yields: 6, 7, 8, 9
        let b = stream::iter::<Vec<Result<NumOrChar, ()>>>((6..=10).map(|v| Ok(Num(v))).collect())
            .boxed();
        // stream that yields: 'a', 'b', 'c', 'd'
        let c = stream::iter::<Vec<Result<NumOrChar, ()>>>(
            ['a', 'b', 'c', 'd'].iter().map(|v| Ok(Char(v))).collect(),
        )
        .boxed();
        let streams = BTreeMap::from([("a", a), ("b", b), ("c", c)]);

        let mut expects = VecDeque::from([
            BTreeMap::from([("a", Num(1)), ("b", Num(6)), ("c", Char(&'a'))]),
            BTreeMap::from([("a", Num(2)), ("b", Num(7)), ("c", Char(&'b'))]),
            BTreeMap::from([("a", Num(3)), ("b", Num(8)), ("c", Char(&'c'))]),
            BTreeMap::from([("a", Num(4)), ("b", Num(9)), ("c", Char(&'d'))]),
        ]);

        for r in block_on_stream(zip_all_map(streams, true)) {
            let expect = expects.pop_front().unwrap();
            assert_eq!(r, Ok(expect));
        }

        assert!(expects.is_empty());
    }
}
