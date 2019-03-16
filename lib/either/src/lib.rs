use std::{cmp::PartialEq, fmt, io};

use futures::{Async, Future, Poll, Stream};
use tokio::io::AsyncWrite;

pub enum Either<A, B> {
    A(A),
    B(B),
}

impl<A, B> Either<A, B> {
    pub fn map_a<F, R>(self, t_fn: F) -> Either<R, B>
    where
        F: FnOnce(A) -> R,
    {
        match self {
            Either::A(a) => Either::A(t_fn(a)),
            Either::B(b) => Either::B(b),
        }
    }
}

impl<A, B> Stream for Either<A, B>
where
    A: Stream,
    B: Stream<Item = A::Item, Error = A::Error>,
{
    type Item = A::Item;
    type Error = A::Error;
    fn poll(&mut self) -> Poll<Option<A::Item>, A::Error> {
        match *self {
            Either::A(ref mut a) => a.poll(),
            Either::B(ref mut b) => b.poll(),
        }
    }
}

impl<A, B> Clone for Either<A, B>
where
    A: Clone,
    B: Clone,
{
    fn clone(&self) -> Self {
        match self {
            Either::A(a) => Either::A(a.clone()),
            Either::B(b) => Either::B(b.clone()),
        }
    }
}

impl<A, B, T> Iterator for Either<A, B>
where
    A: Iterator<Item = T>,
    B: Iterator<Item = T>,
{
    type Item = T;

    fn next(&mut self) -> Option<Self::Item> {
        match self {
            Either::A(a) => a.next(),
            Either::B(b) => b.next(),
        }
    }
}

impl<A, B> fmt::Display for Either<A, B>
where
    A: fmt::Display,
    B: fmt::Display,
{
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match &self {
            Either::A(a) => write!(f, "{}", a),
            Either::B(b) => write!(f, "{}", b),
        }
    }
}

impl<A, B> fmt::Debug for Either<A, B>
where
    A: fmt::Debug,
    B: fmt::Debug,
{
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match &self {
            Either::A(a) => write!(f, "Either::A({:?})", a),
            Either::B(b) => write!(f, "Either::B({:?})", b),
        }
    }
}

impl<A, B> PartialEq for Either<A, B>
where
    A: PartialEq,
    B: PartialEq,
{
    fn eq(&self, rhs: &Either<A, B>) -> bool {
        match (self, rhs) {
            (Either::A(l), Either::A(r)) => l == r,
            (Either::B(l), Either::B(r)) => l == r,
            _ => false,
        }
    }
}

impl<A, B> Future for Either<A, B>
where
    A: Future,
    B: Future<Item = A::Item, Error = A::Error>,
{
    type Item = A::Item;
    type Error = A::Error;

    fn poll(&mut self) -> Poll<A::Item, A::Error> {
        match *self {
            Either::A(ref mut a) => a.poll(),
            Either::B(ref mut b) => b.poll(),
        }
    }
}

pub enum Either3<A, B, C> {
    A(A),
    B(B),
    C(C),
}

impl<A, B, C> Stream for Either3<A, B, C>
where
    A: Stream,
    B: Stream<Item = A::Item, Error = A::Error>,
    C: Stream<Item = A::Item, Error = A::Error>,
{
    type Item = A::Item;
    type Error = A::Error;
    fn poll(&mut self) -> Poll<Option<A::Item>, A::Error> {
        match *self {
            Either3::A(ref mut e) => e.poll(),
            Either3::B(ref mut e) => e.poll(),
            Either3::C(ref mut e) => e.poll(),
        }
    }
}

impl<A, B, C> Future for Either3<A, B, C>
where
    A: Future,
    B: Future<Item = A::Item, Error = A::Error>,
    C: Future<Item = A::Item, Error = A::Error>,
{
    type Item = A::Item;
    type Error = A::Error;

    fn poll(&mut self) -> Poll<A::Item, A::Error> {
        match *self {
            Either3::A(ref mut a) => a.poll(),
            Either3::B(ref mut b) => b.poll(),
            Either3::C(ref mut b) => b.poll(),
        }
    }
}

impl<A, B, C, T> Iterator for Either3<A, B, C>
where
    A: Iterator<Item = T>,
    B: Iterator<Item = T>,
    C: Iterator<Item = T>,
{
    type Item = T;

    fn next(&mut self) -> Option<Self::Item> {
        match self {
            Either3::A(a) => a.next(),
            Either3::B(b) => b.next(),
            Either3::C(c) => c.next(),
        }
    }
}

impl<A, B, C> Clone for Either3<A, B, C>
where
    A: Clone,
    B: Clone,
    C: Clone,
{
    fn clone(&self) -> Self {
        match self {
            Either3::A(a) => Either3::A(a.clone()),
            Either3::B(b) => Either3::B(b.clone()),
            Either3::C(c) => Either3::C(c.clone()),
        }
    }
}

impl<A, B, C> fmt::Debug for Either3<A, B, C>
where
    A: fmt::Debug,
    B: fmt::Debug,
    C: fmt::Debug,
{
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match &self {
            Either3::A(a) => write!(f, "Either::A({:?})", a),
            Either3::B(b) => write!(f, "Either::B({:?})", b),
            Either3::C(c) => write!(f, "Either::C({:?})", c),
        }
    }
}

impl<A, B, C> fmt::Display for Either3<A, B, C>
where
    A: fmt::Display,
    B: fmt::Display,
    C: fmt::Display,
{
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match &self {
            Either3::A(a) => write!(f, "{}", a),
            Either3::B(b) => write!(f, "{}", b),
            Either3::C(c) => write!(f, "{}", c),
        }
    }
}

impl<A, B, C> io::Write for Either3<A, B, C>
where
    A: io::Write,
    B: io::Write,
    C: io::Write,
{
    fn write(&mut self, buf: &[u8]) -> Result<usize, io::Error> {
        match self {
            Either3::A(a) => a.write(buf),
            Either3::B(b) => b.write(buf),
            Either3::C(c) => c.write(buf),
        }
    }

    fn flush(&mut self) -> Result<(), io::Error> {
        match self {
            Either3::A(a) => a.flush(),
            Either3::B(b) => b.flush(),
            Either3::C(c) => c.flush(),
        }
    }
}

impl<A, B, C> AsyncWrite for Either3<A, B, C>
where
    A: AsyncWrite,
    B: AsyncWrite,
    C: AsyncWrite,
{
    fn shutdown(&mut self) -> Result<Async<()>, io::Error> {
        match self {
            Either3::A(a) => a.shutdown(),
            Either3::B(b) => b.shutdown(),
            Either3::C(c) => c.shutdown(),
        }
    }
}
