use futures::{try_ready, Async, Future, Poll, Stream};
use tokio::timer::Delay;

use std::{
    cmp,
    time::{Duration, Instant},
    vec,
};

const NANOS_IN_SECOND: u32 = 1_000_000_000;

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
    fn y(&mut self, x: f64) -> f64;
}

#[derive(Clone)]
pub struct LinearBuilder {
    pieces: Vec<LinearBuilderPiece>,
    duration: Duration,
}

impl LinearBuilder {
    pub fn new(start_percent: f64, end_percent: f64, duration: Duration) -> Self {
        let mut ret = LinearBuilder {
            pieces: Vec::new(),
            duration: Duration::from_secs(0),
        };
        ret.append(start_percent, end_percent, duration);
        ret
    }

    pub fn append(&mut self, start_percent: f64, end_percent: f64, duration: Duration) {
        self.duration += duration;
        let duration = duration.as_nanos() as f64;
        let lb = LinearBuilderPiece::new(start_percent, end_percent, duration);
        self.pieces.push(lb);
    }

    pub fn duration(&self) -> Duration {
        self.duration
    }

    pub fn build<E>(self, peak_load: &HitsPer) -> ModInterval<LinearScaling, E> {
        ModInterval::new(LinearScaling::new(self, peak_load))
    }
}

#[derive(Clone)]
struct LinearBuilderPiece {
    start_percent: f64,
    end_percent: f64,
    duration: f64,
}

impl LinearBuilderPiece {
    fn new(start_percent: f64, end_percent: f64, duration: f64) -> Self {
        LinearBuilderPiece {
            start_percent,
            end_percent,
            duration,
        }
    }
}

pub struct LinearScaling {
    pieces: vec::IntoIter<LinearScalingPiece>,
    current: LinearScalingPiece,
    duration_offset: f64,
    duration: f64,
}

impl LinearScaling {
    pub fn new(builder: LinearBuilder, peak_load: &HitsPer) -> Self {
        let mut pieces = builder
            .pieces
            .into_iter()
            .map(|piece| {
                let peak_load = match peak_load {
                    HitsPer::Second(n) => f64::from(*n),
                    HitsPer::Minute(n) => f64::from(*n) / 60.0,
                };
                LinearScalingPiece::new(
                    piece.start_percent,
                    piece.end_percent,
                    piece.duration,
                    peak_load,
                )
            })
            .collect::<Vec<_>>()
            .into_iter();
        let current = pieces.next().expect("should have at least one scale piece");
        LinearScaling {
            current,
            pieces,
            duration: builder.duration.as_nanos() as f64,
            duration_offset: 0.0,
        }
    }
}

impl ScaleFn for LinearScaling {
    #[inline]
    fn y(&mut self, mut x: f64) -> f64 {
        while x - self.duration_offset >= self.current.duration {
            if let Some(current) = self.pieces.next() {
                self.duration_offset += self.current.duration;
                self.current = current;
            } else {
                break;
            }
        }
        x -= self.duration_offset;
        self.current.y(x)
    }

    #[inline]
    fn max_x(&self) -> f64 {
        self.duration
    }
}

#[derive(Debug)]
pub struct LinearScalingPiece {
    duration: f64,
    max_y: f64,
    m: f64,
    b: f64,
}

impl LinearScalingPiece {
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
        LinearScalingPiece {
            b,
            duration,
            m,
            max_y,
        }
    }
}

impl ScaleFn for LinearScalingPiece {
    #[inline]
    fn y(&mut self, x: f64) -> f64 {
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
pub struct ModInterval<T, E>
where
    T: ScaleFn + Send,
{
    _e: std::marker::PhantomData<E>,
    delay: Delay,
    scale_fn: T,
    start_end_time: Option<(Instant, Instant)>,
}

impl<T, E> ModInterval<T, E>
where
    T: ScaleFn + Send,
{
    pub fn new(scale_fn: T) -> Self {
        ModInterval {
            _e: std::marker::PhantomData,
            delay: Delay::new(Instant::now()),
            scale_fn,
            start_end_time: None,
        }
    }
}

impl<T, E> Stream for ModInterval<T, E>
where
    T: ScaleFn + Send,
    E: From<tokio::timer::Error>,
{
    type Item = Instant;
    type Error = E;

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
            let x = (deadline - start_time).as_nanos() as f64;
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
    fn linear_scaling_works() {
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
            let mut scale_fn = lb.build::<()>(&hitsper).scale_fn;
            for (i2, (secs, hps)) in expects.iter().enumerate() {
                let nanos = secs * nis;
                let right = 1.0 / (scale_fn.y(nanos) / nis);
                let left = hps;
                let diff = (right - left).abs();
                let close_enough = diff < 0.000_001;
                assert!(
                    close_enough,
                    "index ({}, {}) left {} != right {}",
                    i, i2, left, right
                );
            }
        }
    }

    #[test]
    fn multiple_scaling_works() {
        let mut lb = LinearBuilder::new(0.5, 1.0, Duration::from_secs(60));
        lb.append(99.0, 500.0, Duration::from_secs(60));
        lb.append(1.0, 0.5, Duration::from_secs(60));
        let hitsper = HitsPer::Second(10);
        let mut scale_fn = lb.build::<()>(&hitsper).scale_fn;
        let nis = f64::from(NANOS_IN_SECOND);
        let mut y_values: std::collections::VecDeque<_> = (0..60)
            .step_by(10)
            .chain((120..=180).step_by(10))
            .map(|secs| {
                let nanos = f64::from(secs) * nis;
                (secs, scale_fn.y(nanos))
            })
            .collect();
        while !y_values.is_empty() {
            match (y_values.pop_front(), y_values.pop_back()) {
                (Some((left_x, left_y)), Some((right_x, right_y))) => {
                    let diff = (right_y - left_y).abs();
                    let close_enough = diff < 0.000_001;
                    assert!(
                        close_enough,
                        "times: ({}, {}) left {} != right {}",
                        left_x, right_x, left_y, right_y
                    );
                }
                _ => break,
            }
        }
    }
}
