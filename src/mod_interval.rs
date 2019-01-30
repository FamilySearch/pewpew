use crate::error::TestError;

use futures::try_ready;
use tokio::{prelude::*, timer::Delay};

use std::{
    cmp,
    time::{Duration, Instant},
};

const NANOS_IN_SECOND: u32 = 1_000_000_000;

#[inline]
fn duration_to_nanos(d: Duration) -> f64 {
    (d.as_secs() * u64::from(NANOS_IN_SECOND) + u64::from(d.subsec_nanos())) as f64
}

#[inline]
fn nanos_to_duration(n: f64) -> Duration {
    let secs = n as u64 / u64::from(NANOS_IN_SECOND);
    let nanos = (n % f64::from(NANOS_IN_SECOND)) as u32;
    Duration::new(secs, nanos)
}

#[derive(Debug)]
pub enum HitsPer {
    Second(u32),
    Minute(u32),
}

// x represents the time elapsed in the test
// y represents the amount of time between hits
pub trait ScaleFn {
    fn max_x(&self) -> f64;
    fn y(&self, x: f64) -> f64;
}

#[derive(Clone)]
pub struct LinearBuilder {
    start_percent: f64,
    end_percent: f64,
    pub duration: Duration,
}

impl LinearBuilder {
    pub fn new(start_percent: f64, end_percent: f64, duration: Duration) -> Self {
        LinearBuilder {
            start_percent,
            end_percent,
            duration,
        }
    }

    pub fn build(&self, peak_load: &HitsPer) -> ModInterval<LinearScaling> {
        let peak_load = match peak_load {
            HitsPer::Second(n) => f64::from(*n),
            HitsPer::Minute(n) => f64::from(*n) / 60.0,
        };
        let duration = duration_to_nanos(self.duration);
        ModInterval::new(LinearScaling::new(
            self.start_percent,
            self.end_percent,
            duration,
            peak_load,
        ))
    }
}

#[derive(Debug)]
pub struct LinearScaling {
    duration: f64,
    max_y: f64,
    m: f64,
    b: f64,
}

impl LinearScaling {
    pub fn new(start_percent: f64, end_percent: f64, duration: f64, peak_load: f64) -> Self {
        let a = f64::from(NANOS_IN_SECOND);
        let b = peak_load * start_percent;
        let m = (end_percent * peak_load - b) / duration;
        // find y where y = 0.5x
        let max_y = if m >= 0.0 {
            (-b + (b * b + 8.0 * m * a).sqrt()) / (2.0 * m)
        } else {
            -((b + (b * b + 8.0 * m * a).sqrt()) / (2.0 * m))
        };
        LinearScaling {
            b,
            duration,
            m,
            max_y,
        }
    }
}

impl ScaleFn for LinearScaling {
    #[inline]
    fn y(&self, x: f64) -> f64 {
        let hps = self.m * x + self.b;
        self.max_y.min(f64::from(NANOS_IN_SECOND) / hps)
    }

    #[inline]
    fn max_x(&self) -> f64 {
        self.duration
    }
}

/// A stream representing notifications at a modulating interval.
/// This stream also has a built in end time
#[must_use = "streams do nothing unless polled"]
pub struct ModInterval<T>
where
    T: ScaleFn + Send,
{
    delay: Delay,
    scale_fn: T,
    start_end_time: Option<(Instant, Instant)>,
}

impl<T> ModInterval<T>
where
    T: ScaleFn + Send,
{
    pub fn new(scale_fn: T) -> Self {
        ModInterval {
            delay: Delay::new(Instant::now()),
            scale_fn,
            start_end_time: None,
        }
    }
}

impl<T> Stream for ModInterval<T>
where
    T: ScaleFn + Send,
{
    type Item = Instant;
    type Error = TestError;

    fn poll(&mut self) -> Poll<Option<Self::Item>, Self::Error> {
        // deadline represents a time when the next item will be provided from the stream
        let mut deadline = Delay::deadline(&self.delay);
        let (start_time, end_time) = match self.start_end_time {
            // the first time `poll` is called
            None => {
                let start = Instant::now();
                let end = start + nanos_to_duration(self.scale_fn.max_x());
                deadline = start + nanos_to_duration(self.scale_fn.y(0.0));
                self.delay.reset(deadline);
                self.start_end_time = Some((start, end));
                (start, end)
            }
            // subsequent calls to `poll`
            Some(t) => t,
        };

        let now = Instant::now();
        // if we've reached the end
        if now >= end_time {
            return Ok(Async::Ready(None));
        } else if deadline >= now {
            // Wait for the delay to finish
            try_ready!(self.delay.poll());
        }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linear_scaling_works2() {
        let checks = vec![
            (
                // scale from 0 to 100% over 30 seconds (100% = 12 hps)
                0.0,
                1.0,
                30,
                HitsPer::Second(12),
                // at time t (in seconds), we should be at x hps
                vec![(0.0, 0.447_213), (10.0, 4.0), (15.0, 6.0), (30.0, 12.0)],
            ),
            (
                0.0,
                1.0,
                30,
                HitsPer::Minute(720),
                vec![(0.0, 0.447_213), (10.0, 4.0), (15.0, 6.0), (30.0, 12.0)],
            ),
            (
                0.5,
                1.0,
                30,
                HitsPer::Second(12),
                vec![(0.0, 6.0), (10.0, 8.0), (15.0, 9.0), (30.0, 12.0)],
            ),
            (
                0.0,
                1.0,
                60,
                HitsPer::Second(1),
                vec![(0.0, 0.091_287), (15.0, 0.25), (30.0, 0.5), (60.0, 1.0)],
            ),
            (
                1.0,
                0.0,
                60 * 60 * 12,
                HitsPer::Second(12),
                vec![
                    (0.0, 12.0),
                    (21_600.0, 6.0),
                    (32_400.0, 3.0),
                    (43_200.0, 0.000_023),
                ],
            ),
            (
                0.1,
                0.0,
                60 * 60 * 12,
                HitsPer::Second(10),
                vec![
                    (0.0, 1.0),
                    (21_600.0, 0.5),
                    (32_400.0, 0.25),
                    (43_200.0, 0.000_023),
                ],
            ),
            (
                1.0,
                1.0,
                60,
                HitsPer::Second(10),
                vec![(0.0, 10.0), (15.0, 10.0), (30.0, 10.0), (60.0, 10.0)],
            ),
            (
                0.5,
                0.5,
                60,
                HitsPer::Second(10),
                vec![(0.0, 5.0), (15.0, 5.0), (30.0, 5.0), (60.0, 5.0)],
            ),
        ];
        let nis = f64::from(NANOS_IN_SECOND);
        for (i, (start_percent, end_percent, duration, hitsper, expects)) in
            checks.into_iter().enumerate()
        {
            let lb = LinearBuilder::new(start_percent, end_percent, Duration::from_secs(duration));
            let scale_fn = lb.build(&hitsper).scale_fn;
            for (i2, (secs, hps)) in expects.iter().enumerate() {
                let nanos = secs * nis;
                let right = 1.0 / (scale_fn.y(nanos) / nis);
                let left = hps;
                let diff = (right - left).abs();
                let equal = diff < 0.000_001;
                assert!(
                    equal,
                    "index ({}, {}) left {} != right {}",
                    i, i2, left, right
                );
            }
        }
    }
}
