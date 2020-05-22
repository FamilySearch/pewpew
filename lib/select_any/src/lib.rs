use futures::{Stream, StreamExt};

use std::{
    pin::Pin,
    task::{Context, Poll},
};

#[must_use = "streams do nothing unless polled"]
pub struct SelectAny<T>
where
    T: Stream + Unpin,
{
    elems: Vec<T>,
    last_yield_index: usize,
}

impl<T> Stream for SelectAny<T>
where
    T: Stream + Unpin,
{
    type Item = T::Item;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context) -> Poll<Option<Self::Item>> {
        let last_yield_index = self.last_yield_index + 1;
        let mut done_count = 0;
        for i in 0..self.elems.len() {
            let i = (i + last_yield_index) % self.elems.len();
            let mut this = self.as_mut();
            let stream = &mut this.elems[i];
            match stream.poll_next_unpin(cx) {
                v @ Poll::Ready(Some(_)) => {
                    self.last_yield_index = i;
                    return v;
                }
                Poll::Ready(None) => done_count += 1,
                _ => (),
            }
        }
        if done_count == self.elems.len() {
            Poll::Ready(None)
        } else {
            Poll::Pending
        }
    }
}

pub fn select_any<I>(elems: I) -> SelectAny<I::Item>
where
    I: IntoIterator,
    I::Item: Stream + Unpin,
{
    let elems: Vec<_> = elems.into_iter().collect();
    SelectAny {
        last_yield_index: elems.len() - 1,
        elems,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use futures::{executor::block_on_stream, future::Either, stream};
    use std::{
        rc::Rc,
        sync::atomic::{AtomicUsize, Ordering},
    };

    #[test]
    fn select_any_works() {
        let baton_a = Rc::new(AtomicUsize::new(0));
        let baton_b = baton_a.clone();
        let a = Either::Left(stream::poll_fn(move |_| {
            let n = baton_a.load(Ordering::SeqCst);
            if let 0 | 2 | 4 | 6 = n {
                baton_a.store(n + 1, Ordering::SeqCst);
                Poll::Ready(Some(1))
            } else {
                Poll::Pending
            }
        }));
        let b = Either::Right(stream::poll_fn(move |_| {
            let n = baton_b.load(Ordering::SeqCst);
            if let 1 | 3 | 5 | 7 = n {
                baton_b.store(n + 1, Ordering::SeqCst);
                Poll::Ready(Some(2))
            } else {
                Poll::Pending
            }
        }));

        let expects = vec![1, 2, 1, 2, 1, 2, 1, 2];

        let values: Vec<_> = block_on_stream(select_any(vec![a, b])).take(8).collect();

        assert_eq!(values, expects);
    }

    #[test]
    fn select_any_ends_when_all_streams_finish() {
        let a = Either::Left(stream::empty::<u8>());

        let mut b_counter = 0u8;
        let b = Either::Right(stream::poll_fn(move |_| {
            if b_counter < 3 {
                b_counter += 1;
                Poll::Ready(Some(b_counter))
            } else {
                Poll::Ready(None)
            }
        }));

        let c = Either::Left(stream::empty::<u8>());

        let expects = vec![1, 2, 3];

        let values: Vec<_> = block_on_stream(select_any(vec![a, b, c])).collect();

        assert_eq!(values, expects);
    }
}
