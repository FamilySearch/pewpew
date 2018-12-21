use futures::{Poll, Stream};
use regex::Regex;
use serde_json as json;
use tokio::prelude::*;

use std::{cmp::PartialEq, fmt};

pub enum Either<A, B> {
    A(A),
    B(B),
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

pub fn str_to_json(s: &str) -> json::Value {
    json::from_str(s).unwrap_or_else(|_| json::Value::String(s.into()))
}

// TODO: make this more versatile so ['request'].body is parsed properly
pub fn parse_provider_name(s: &str) -> &str {
    // parse out the provider name, or if it's `request` or `response` get the second layer
    let param_name_re = Regex::new(r"^((?:request\.|response\.)?[^\[.]*)").unwrap();
    param_name_re
        .captures(s)
        .unwrap()
        .get(1)
        .expect("invalid json path query")
        .as_str()
}
