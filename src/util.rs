use futures::{
    Poll,
    Stream,
};

use tokio::prelude::*;

use std::{
    cmp::PartialEq,
    fmt,
};

pub enum Either<A, B> {
    A(A),
    B(B),
}

impl<A, B> Stream for Either<A, B>
    where A: Stream,
          B: Stream<Item = A::Item, Error = A::Error>
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

impl<A, B> fmt::Debug for Either<A, B>
    where A: fmt::Debug,
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
    where A: PartialEq,
          B: PartialEq
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
    where A: Future,
          B: Future<Item = A::Item, Error = A::Error>
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
    C(C)
}

impl<A, B, C> Stream for Either3<A, B, C>
    where A: Stream,
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