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
        for i in 0..self.elems.len() {
            let i = (i + last_yield_index) % self.elems.len();
            let stream = &mut self.elems[i];
            match stream.poll() {
                v @ Ok(Async::Ready(Some(_))) => {
                    self.last_yield_index = i;
                    return v;
                }
                e @ Err(_) => return e,
                _ => (),
            }
        }
        Ok(Async::NotReady)
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

    use either::Either3;
    use futures::{stream, Future};
    use std::time::Duration;
    use tokio::{self, timer::Interval};

    #[test]
    fn select_any_works() {
        let a = Either3::A(Interval::new_interval(Duration::from_millis(160)).map(|_| 3));
        let b = Either3::B(Interval::new_interval(Duration::from_millis(120)).map(|_| 2));
        let c = Either3::C(Interval::new_interval(Duration::from_millis(80)).map(|_| 1));

        let expects = vec![1, 2, 1, 3];

        let stream = select_any(vec![a, b, c])
            .zip(stream::iter_ok(expects.into_iter().enumerate()))
            .for_each(|(l, (i, r))| {
                assert_eq!(l, r, "index: {}", i);
                Ok(())
            })
            .map_err(|e| panic!(e));

        tokio::run(stream);
    }
}
