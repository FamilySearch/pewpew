use std::{
    fmt,
    pin::Pin,
    task::{Context, Poll},
};

use futures::{Stream, TryStream, TryStreamExt};

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

#[cfg(test)]
mod tests {
    use super::*;
    use futures::{executor::block_on_stream, stream, StreamExt};

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
}
