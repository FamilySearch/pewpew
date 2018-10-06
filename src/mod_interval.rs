

use futures::try_ready;
use tokio::{
    prelude::*,
    timer::{Delay, Error as TimerError}
};

use std::{
    cmp,
    ops::Mul,
    time::{Instant, Duration}
};

const NANOS_IN_SECOND: u32 = 1_000_000_000;

#[inline]
fn duration_to_nanos (d: Duration) -> f64 {
    (d.as_secs() * u64::from(NANOS_IN_SECOND) + u64::from(d.subsec_nanos())) as f64
}

#[inline]
fn nanos_to_duration (n: f64) -> Duration {
    let secs = n as u64 / u64::from(NANOS_IN_SECOND);
    let nanos = (n % f64::from(NANOS_IN_SECOND)) as u32;
    Duration::new(secs, nanos)
}

#[inline]
fn hits_per_to_nanos (h: &HitsPer) -> f64 {
    let (base_nanos, inner) = match h {
        HitsPer::Second(n) => (u64::from(NANOS_IN_SECOND), n),
        HitsPer::Minute(n) => (u64::from(NANOS_IN_SECOND) * 60, n)
    };
    base_nanos.checked_div(u64::from(*inner)).unwrap_or(base_nanos) as f64
}

#[derive(Debug)]
pub enum HitsPer {
    Second(u32),
    Minute(u32),
}

impl Mul<f64> for &HitsPer {
     type Output = HitsPer;

     fn mul(self, rhs: f64) -> Self::Output {
         match self {
             HitsPer::Second(n) => HitsPer::Second((f64::from(*n) * rhs).round() as u32),
             HitsPer::Minute(n) => HitsPer::Minute((f64::from(*n) * rhs).round() as u32)
         }
     }
}

pub trait ScaleFn {
    fn max_x (&self) -> f64;
    fn y (&self, x: f64) -> f64;
}

#[derive(Clone)]
pub struct LinearBuilder {
    start_percent: f64,
    end_percent: f64,
    pub duration: Duration,
}

impl LinearBuilder {
    pub fn new (start_percent: f64, end_percent: f64, duration: Duration) -> Self {
        LinearBuilder { start_percent, end_percent, duration }
    }

    pub fn build (&self, peak_load: &HitsPer) -> ModInterval<LinearScaling> {
        let x1 = 0f64;
        let y1 = hits_per_to_nanos(&(peak_load * self.start_percent));
        let y2 = hits_per_to_nanos(&(peak_load * self.end_percent));
        let x2 = duration_to_nanos(self.duration);
        ModInterval::new(LinearScaling::new(x1, y1, x2, y2))
    }
}

#[derive(Debug)]
pub struct LinearScaling {
    m: f64,
    b: f64,
    max_x: f64,
}

impl LinearScaling {
    // x represents the duration for how long this scaling will happen
    // y represents the amount of time between hits
    pub fn new (x1: f64, y1: f64, x2: f64, y2: f64) -> Self {
        let m = (y2 - y1) / (x2 - x1);
        LinearScaling { m, b: y1 - m * x1, max_x: x2 }
    }
}

impl ScaleFn for LinearScaling {
    // Calculate y for x (time elapsed since start), then calculate y2
    // for x + y, and return the average y and y2
    #[inline]
    fn y (&self, x: f64) -> f64 {
        let y1 = self.max_x.min(self.m * x + self.b);
        let y2 = self.max_x.min(self.m * (x + y1) + self.b);
        (y1 + y2) / 2f64
    }
    #[inline]
    fn max_x(&self) -> f64 {
        self.max_x
    }
}

/// A stream representing notifications at a modulating interval.
/// This stream also has a built in end time
#[must_use = "streams do nothing unless polled"]
pub struct ModInterval<T> where T: ScaleFn + Send {
    delay: Delay,
    scale_fn: T,
    start_end_time: Option<(Instant, Instant)>,
}

impl<T> ModInterval<T> where T: ScaleFn + Send {
    pub fn new(scale_fn: T) -> Self {
        ModInterval {
            delay: Delay::new(Instant::now()),
            scale_fn,
            start_end_time: None,
        }
    }
}

impl<T> Stream for ModInterval<T> where T: ScaleFn + Send {
    type Item = Instant;
    type Error = TimerError;

    fn poll(&mut self) -> Poll<Option<Self::Item>, Self::Error> {
        // deadline represents a time when the next item will be provided from the stream
        let mut deadline = Delay::deadline(&self.delay);
        let (start_time, end_time) = match self.start_end_time {
            // the first time `poll` is called
            None => {
                let start = Instant::now();
                let end = start + nanos_to_duration(self.scale_fn.max_x());
                deadline = start + nanos_to_duration(self.scale_fn.y(0f64));
                self.delay.reset(deadline);
                self.start_end_time = Some((start, end));
                (start, end)
            },
            // subsequent calls to `poll`
            Some(t) => t,
        };

        // if we've reached the end
        if Instant::now() >= end_time {
            return Ok(Async::Ready(None));
        }

        // Wait for the delay to be done
        try_ready!(self.delay.poll());

        // Calculate how long the next delay should be
        let next_deadline = {
            let x = duration_to_nanos(deadline - start_time);
            let y = self.scale_fn.y(x);
            cmp::min(start_time + nanos_to_duration(y + x), end_time)
        };

        // set the next delay
        self.delay.reset(next_deadline);

        // Return the current instant
        Ok(Some(deadline).into())
    }
}