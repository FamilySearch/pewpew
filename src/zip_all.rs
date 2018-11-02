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