use std::fmt;

use futures::{Async, Poll, Stream};

#[must_use = "streams do nothing unless polled"]
pub struct ZipAll<T> where T: Stream {
    elems: Vec<(T, Option<T::Item>)>,
}

impl<T> fmt::Debug for ZipAll<T>
    where T: Stream + fmt::Debug,
        T::Item: fmt::Debug,
{
    fn fmt(&self, fmt: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt.debug_struct("ZipAll")
            .field("elems", &self.elems)
            .finish()
    }
}

pub fn zip_all<I>(elems: I) -> ZipAll<I::Item>
    where I: IntoIterator,
          I::Item: Stream
{
    let elems = elems.into_iter().map(|s| (s, None)).collect();
    ZipAll { elems }
}

impl<T> Stream for ZipAll<T> where T: Stream {
    type Item = Vec<T::Item>;
    type Error = T::Error;


    fn poll(&mut self) -> Poll<Option<Self::Item>, Self::Error> {
        let mut all_done = true;
        for (s, result) in &mut self.elems.iter_mut() {
            match result {
                None => {
                    match s.poll() {
                        Ok(Async::Ready(v)) => {
                            if let Some(v) = v {
                                *result = Some(v);
                            } else {
                                self.elems = Vec::new();
                                return Ok(Async::Ready(None))
                            }
                        },
                        Ok(Async::NotReady) => {
                            all_done = false;
                            continue
                        }
                        Err(e) => {
                            self.elems = Vec::new();
                            return Err(e)
                        }
                    }
                }
                Some(_) => continue,
            };
        }

        if all_done {
            let result = self.elems.iter_mut()
                .map(|(_, o)| o.take().unwrap())
                .collect();
            Ok(Async::Ready(Some(result)))
        } else {
            Ok(Async::NotReady)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::stream;
    use crate::util::Either;

    #[test]
    fn zip_all_works() {
        // stream that yields: 1, 2, 3, 4
        let a = Either::A(stream::iter_ok::<Vec<Either<u8, &char>>, ()>(
            (1..5).map(Either::A).collect()
        ));
        // stream that yields: 6, 7, 8, 9
        let b = Either::A(stream::iter_ok::<Vec<Either<u8, &char>>, ()>(
            (6..10).map(Either::A).collect()
        ));
        // stream that yields: 'a', 'b', 'c', 'd'
        let c = Either::B(stream::iter_ok::<Vec<Either<u8, &char>>, ()>(
            ['a', 'b', 'c', 'd'].iter().map(Either::B).collect()
        ));
        let streams = vec!(a, b, c);

        let mut expects = vec!(
            vec!(Either::A(1), Either::A(6), Either::B(&'a')),
            vec!(Either::A(2), Either::A(7), Either::B(&'b')),
            vec!(Either::A(3), Either::A(8), Either::B(&'c')),
            vec!(Either::A(4), Either::A(9), Either::B(&'d')),
        );

        for r in zip_all(streams).wait() {
            if let Ok(r) = r {
                let expect = expects.remove(0);
                assert_eq!(r, expect);
            }
        }

        assert!(expects.is_empty());
    }
}