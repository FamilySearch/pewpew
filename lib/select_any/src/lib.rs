use futures::{Async, Poll, Stream};

#[must_use = "streams do nothing unless polled"]
pub struct SelectAny<T>
where
    T: Stream,
{
    elems: Vec<T>,
    last_yield_index: usize,
}

impl<T> Stream for SelectAny<T>
where
    T: Stream,
{
    type Item = T::Item;
    type Error = T::Error;

    fn poll(&mut self) -> Poll<Option<Self::Item>, Self::Error> {
        let last_yield_index = self.last_yield_index + 1;
        let mut done_count = 0;
        for i in 0..self.elems.len() {
            let i = (i + last_yield_index) % self.elems.len();
            let stream = &mut self.elems[i];
            match stream.poll() {
                v @ Ok(Async::Ready(Some(_))) => {
                    self.last_yield_index = i;
                    return v;
                }
                Ok(Async::Ready(None)) => done_count += 1,
                e @ Err(_) => return e,
                _ => (),
            }
        }
        if done_count == self.elems.len() {
            Ok(Async::Ready(None))
        } else {
            Ok(Async::NotReady)
        }
    }
}

pub fn select_any<I>(elems: I) -> SelectAny<I::Item>
where
    I: IntoIterator,
    I::Item: Stream,
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

    use ether::{Either, Either3};
    use futures::{stream, Future};
    use std::{
        rc::Rc,
        sync::atomic::{AtomicUsize, Ordering},
    };
    use tokio::runtime::current_thread;

    #[test]
    fn select_any_works() {
        let baton_a = Rc::new(AtomicUsize::new(0));
        let baton_b = baton_a.clone();
        let baton_c = baton_a.clone();
        let a = Either3::A(stream::poll_fn(move || {
            let n = baton_a.load(Ordering::SeqCst);
            if let 0 | 2 | 4 | 6 = n {
                baton_a.store(n + 1, Ordering::SeqCst);
                Ok(Async::Ready(Some(1)))
            } else {
                Ok(Async::NotReady)
            }
        }));
        let b = Either3::B(stream::poll_fn(move || {
            let n = baton_b.load(Ordering::SeqCst);
            if let 1 | 5 | 7 = n {
                baton_b.store(n + 1, Ordering::SeqCst);
                Ok(Async::Ready(Some(2)))
            } else {
                Ok(Async::NotReady)
            }
        }));
        let c = Either3::C(stream::poll_fn(move || {
            let n = baton_c.load(Ordering::SeqCst);
            if let 3 | 8 = n {
                baton_c.store(n + 1, Ordering::SeqCst);
                Ok(Async::Ready(Some(3)))
            } else {
                Ok(Async::NotReady)
            }
        }));

        let expects = vec![1, 2, 1, 3, 1, 2, 1, 2, 3];

        let stream = select_any(vec![a, b, c])
            .zip(stream::iter_ok(expects.into_iter().enumerate()))
            .for_each(|(l, (i, r))| {
                assert_eq!(l, r, "index: {}", i);
                Ok(())
            })
            .map_err(|e: ()| panic!(e));

        current_thread::run(stream);
    }

    #[test]
    fn select_any_ends_when_all_streams_finish() {
        let a = Either::A(stream::empty::<u8, ()>());

        let mut b_counter = 0u8;
        let b = Either::B(stream::poll_fn(move || {
            if b_counter < 3 {
                b_counter += 1;
                Ok(Async::Ready(Some(b_counter)))
            } else {
                Ok(Async::Ready(None))
            }
        }));

        let c = Either::A(stream::empty::<u8, ()>());

        let expects = Ok(vec![1, 2, 3]);

        let stream = select_any(vec![a, b, c]).collect().then(move |left| {
            assert_eq!(left, expects);
            Ok(())
        });

        current_thread::run(stream);
    }
}
