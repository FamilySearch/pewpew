use std::{
    cmp::PartialEq,
    fmt,
    future::Future,
    io,
    pin::Pin,
    task::{Context, Poll},
};

use futures::Stream;

/// Allows the mapping of two different (similar) types to determine either A or B.
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

    pub fn map_b<F, R>(self, t_fn: F) -> Either<A, R>
    where
        F: FnOnce(B) -> R,
    {
        match self {
            Either::A(a) => Either::A(a),
            Either::B(b) => Either::B(t_fn(b)),
        }
    }
}

impl<A> Either<A, A> {
    /// If both types are the same, allow unwrap
    pub fn unwrap(self) -> A {
        match self {
            Either::A(a) => a,
            Either::B(b) => b,
        }
    }
}

impl<A, B> Stream for Either<A, B>
where
    A: Stream,
    B: Stream<Item = A::Item>,
{
    type Item = A::Item;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<A::Item>> {
        unsafe {
            match self.get_unchecked_mut() {
                Either::A(x) => Pin::new_unchecked(x).poll_next(cx),
                Either::B(x) => Pin::new_unchecked(x).poll_next(cx),
            }
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
            Either::A(a) => write!(f, "{a}"),
            Either::B(b) => write!(f, "{b}"),
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
            Either::A(a) => write!(f, "Either::A({a:?})"),
            Either::B(b) => write!(f, "Either::B({b:?})"),
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
    B: Future<Output = A::Output>,
{
    type Output = A::Output;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<A::Output> {
        unsafe {
            match self.get_unchecked_mut() {
                Either::A(x) => Pin::new_unchecked(x).poll(cx),
                Either::B(x) => Pin::new_unchecked(x).poll(cx),
            }
        }
    }
}

/// Allows the mapping of three different (similar) types to determine either A, B, or C.
pub enum Either3<A, B, C> {
    A(A),
    B(B),
    C(C),
}

impl<A, B, C> Stream for Either3<A, B, C>
where
    A: Stream,
    B: Stream<Item = A::Item>,
    C: Stream<Item = A::Item>,
{
    type Item = A::Item;
    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<A::Item>> {
        unsafe {
            match self.get_unchecked_mut() {
                Either3::A(x) => Pin::new_unchecked(x).poll_next(cx),
                Either3::B(x) => Pin::new_unchecked(x).poll_next(cx),
                Either3::C(x) => Pin::new_unchecked(x).poll_next(cx),
            }
        }
    }
}

impl<A, B, C> Future for Either3<A, B, C>
where
    A: Future,
    B: Future<Output = A::Output>,
    C: Future<Output = A::Output>,
{
    type Output = A::Output;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<A::Output> {
        unsafe {
            match self.get_unchecked_mut() {
                Either3::A(x) => Pin::new_unchecked(x).poll(cx),
                Either3::B(x) => Pin::new_unchecked(x).poll(cx),
                Either3::C(x) => Pin::new_unchecked(x).poll(cx),
            }
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
            Either3::A(a) => write!(f, "Either::A({a:?})"),
            Either3::B(b) => write!(f, "Either::B({b:?})"),
            Either3::C(c) => write!(f, "Either::C({c:?})"),
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
            Either3::A(a) => write!(f, "{a}"),
            Either3::B(b) => write!(f, "{b}"),
            Either3::C(c) => write!(f, "{c}"),
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

pub trait FutureExt: Future + Sized {
    fn a<B>(self) -> Either<Self, B>
    where
        B: Future<Output = Self::Output>,
    {
        Either::A(self)
    }

    fn b<A>(self) -> Either<A, Self>
    where
        A: Future<Output = Self::Output>,
    {
        Either::B(self)
    }

    fn a3<B, C>(self) -> Either3<Self, B, C>
    where
        B: Future<Output = Self::Output>,
        C: Future<Output = Self::Output>,
    {
        Either3::A(self)
    }

    fn b3<A, C>(self) -> Either3<A, Self, C>
    where
        A: Future<Output = Self::Output>,
        C: Future<Output = Self::Output>,
    {
        Either3::B(self)
    }

    fn c3<A, B>(self) -> Either3<A, B, Self>
    where
        A: Future<Output = Self::Output>,
        B: Future<Output = Self::Output>,
    {
        Either3::C(self)
    }
}

impl<T: ?Sized> EitherExt for T {}

pub trait EitherExt {
    fn a<B>(self) -> Either<Self, B>
    where
        Self: Sized,
    {
        Either::A(self)
    }

    fn b<A>(self) -> Either<A, Self>
    where
        Self: Sized,
    {
        Either::B(self)
    }

    fn a3<B, C>(self) -> Either3<Self, B, C>
    where
        Self: Sized,
    {
        Either3::A(self)
    }

    fn b3<A, C>(self) -> Either3<A, Self, C>
    where
        Self: Sized,
    {
        Either3::B(self)
    }

    fn c3<A, B>(self) -> Either3<A, B, Self>
    where
        Self: Sized,
    {
        Either3::C(self)
    }
}
