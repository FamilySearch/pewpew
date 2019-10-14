use config::{HitsPer, LinearBuilder, LoadPattern};
use futures::{try_ready, Async, Future, Poll, Stream};
use tokio::timer::Delay;

use std::{
    cmp,
    time::{Duration, Instant},
    vec,
};

const NANOS_IN_SECOND: f64 = 1_000_000_000.0;

pub type LoadUpdateChannel = channel::Receiver<(LinearScaling, Option<Duration>)>;

fn nanos_to_duration(n: f64) -> Duration {
    Duration::from_nanos(n as u64)
}

// x represents the time elapsed in the test
// y represents the amount of time between hits
pub trait ScaleFn {
    fn max_x(&self) -> f64;
    fn y(&mut self, x: f64) -> f64;
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

    fn transition_from(
        &mut self,
        from: &mut LinearScaling,
        transition_time: Duration,
        time_elapsed: Duration,
    ) {
        let time_elapsed = time_elapsed.as_nanos() as f64;
        let elapsed_plus_transition_time = transition_time.as_nanos() as f64 + time_elapsed;

        // create the transition piece for the load_pattern
        let x1 = time_elapsed;
        let y1 = NANOS_IN_SECOND / from.y(x1);
        let x2 = elapsed_plus_transition_time.min(self.duration);
        let y2 = NANOS_IN_SECOND / self.y(x2);
        let current = LinearScalingPiece::new_from_points(x1, y1, x2, y2);
        let current = std::mem::replace(&mut self.current, current);

        self.duration_offset += x1 - self.duration_offset;
        let next_piece = if elapsed_plus_transition_time > self.duration {
            None
        } else {
            Some(current)
        };
        // splice the transition into the next piece
        if let Some(mut next_piece) = next_piece {
            let x_diff = x2 - x1;
            let x1 = x2;
            let y1 = y2;
            let x2 = next_piece.duration + x2 - x_diff;
            let y2 = NANOS_IN_SECOND / next_piece.y(next_piece.duration);
            let next_piece = LinearScalingPiece::new_from_points(x1, y1, x2, y2);
            let mut pieces = vec![next_piece];
            pieces.extend(&mut self.pieces);
            self.pieces = pieces.into_iter();
        }
    }
}

impl ScaleFn for LinearScaling {
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

    fn max_x(&self) -> f64 {
        self.duration
    }
}

#[derive(Debug, PartialEq)]
pub struct LinearScalingPiece {
    duration: f64,
    max_y: f64,
    m: f64,
    b: f64,
}

impl LinearScalingPiece {
    pub fn new(start_percent: f64, end_percent: f64, duration: f64, peak_load: f64) -> Self {
        let b = peak_load * start_percent;
        let m = (end_percent * peak_load - b) / duration;
        let max_y = LinearScalingPiece::calc_max_y(b, m);
        LinearScalingPiece {
            b,
            duration,
            m,
            max_y,
        }
    }

    fn new_from_points(x1: f64, y1: f64, x2: f64, y2: f64) -> Self {
        let m = (y2 - y1) / (x2 - x1);
        let max_y = LinearScalingPiece::calc_max_y(y1, m);
        LinearScalingPiece {
            b: y1,
            duration: x2 - x1,
            m,
            max_y,
        }
    }

    fn calc_max_y(b: f64, m: f64) -> f64 {
        let a = NANOS_IN_SECOND;
        // find y where y = 0.5x
        if m >= 0.0 {
            (-b + (b * b + 8.0 * m * a).sqrt()) / (2.0 * m)
        } else {
            -((b + (b * b + 8.0 * m * a).sqrt()) / (2.0 * m))
        }
    }
}

impl ScaleFn for LinearScalingPiece {
    fn y(&mut self, x: f64) -> f64 {
        let hps = self.m * x + self.b;
        self.max_y.min(NANOS_IN_SECOND / hps)
    }

    fn max_x(&self) -> f64 {
        self.duration
    }
}

/// A stream representing notifications at a modulating interval.
/// This stream also has a built in end time
#[must_use = "streams do nothing unless polled"]
pub struct ModInterval<E> {
    _e: std::marker::PhantomData<E>,
    delay: Delay,
    scale_fn: LinearScaling,
    scale_fn_updater: Option<LoadUpdateChannel>,
    start_end_time: Option<(Instant, Instant)>,
}

impl<E> ModInterval<E> {
    pub fn new(
        load_pattern: LoadPattern,
        peak_load: &HitsPer,
        scale_fn_updater: Option<LoadUpdateChannel>,
    ) -> Self {
        match load_pattern {
            LoadPattern::Linear(lb) => {
                let scale_fn = LinearScaling::new(lb, peak_load);
                ModInterval {
                    _e: std::marker::PhantomData,
                    delay: Delay::new(Instant::now()),
                    scale_fn,
                    scale_fn_updater,
                    start_end_time: None,
                }
            }
        }
    }
}

impl<E> Stream for ModInterval<E>
where
    E: From<tokio::timer::Error>,
{
    type Item = Instant;
    type Error = E;

    fn poll(&mut self) -> Poll<Option<Self::Item>, Self::Error> {
        let now = Instant::now();
        // deadline represents a time when the next item will be provided from the stream
        let mut deadline = Delay::deadline(&self.delay);
        let (start_time, mut end_time) = match self.start_end_time {
            // the first time `poll` is called
            None => {
                let end = now + nanos_to_duration(self.scale_fn.max_x());
                deadline = now + nanos_to_duration(self.scale_fn.y(0.0));
                self.delay.reset(deadline);
                self.start_end_time = Some((now, end));
                (now, end)
            }
            // subsequent calls to `poll`
            Some(t) => t,
        };

        let update_delay = move |s: &mut Self, current: Instant| {
            // Calculate how long the next delay should be
            let next_deadline = {
                let x = (current - start_time).as_nanos() as f64;
                let y = s.scale_fn.y(x);
                cmp::min(start_time + nanos_to_duration(y + x), end_time)
            };

            // set the next delay
            s.delay.reset(next_deadline);
        };

        if let Some(updater) = &mut self.scale_fn_updater {
            let mut update = None;
            while let Ok(Async::Ready(u @ Some(_))) = updater.poll() {
                update = u;
            }
            if let Some((mut scale_fn, transition_time)) = update {
                if let Some(transition_time) = transition_time {
                    scale_fn.transition_from(&mut self.scale_fn, transition_time, now - start_time);
                    end_time = start_time + nanos_to_duration(scale_fn.max_x());
                    self.start_end_time = Some((start_time, end_time));
                }
                self.scale_fn = scale_fn;
                update_delay(self, now);
            }
        }

        // if we've reached the end
        if now >= end_time {
            return Ok(Async::Ready(None));
        } else if deadline >= now {
            // Wait for the delay to finish
            try_ready!(self.delay.poll());
        }

        update_delay(self, deadline);

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
                HitsPer::Second(12.0),
                // at time t (in seconds), we should be at x hps
                vec![(0.0, 0.447_213), (10.0, 4.0), (15.0, 6.0), (30.0, 12.0)],
            ),
            (
                0.0,
                1.0,
                30,
                HitsPer::Minute(720.0),
                vec![(0.0, 0.447_213), (10.0, 4.0), (15.0, 6.0), (30.0, 12.0)],
            ),
            (
                0.5,
                1.0,
                30,
                HitsPer::Second(12.0),
                vec![(0.0, 6.0), (10.0, 8.0), (15.0, 9.0), (30.0, 12.0)],
            ),
            (
                0.0,
                1.0,
                60,
                HitsPer::Second(1.0),
                vec![(0.0, 0.091_287), (15.0, 0.25), (30.0, 0.5), (60.0, 1.0)],
            ),
            (
                1.0,
                0.0,
                60 * 60 * 12,
                HitsPer::Second(12.0),
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
                HitsPer::Second(10.0),
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
                HitsPer::Second(10.0),
                vec![(0.0, 10.0), (15.0, 10.0), (30.0, 10.0), (60.0, 10.0)],
            ),
            (
                0.5,
                0.5,
                60,
                HitsPer::Second(10.0),
                vec![(0.0, 5.0), (15.0, 5.0), (30.0, 5.0), (60.0, 5.0)],
            ),
        ];
        let nis = NANOS_IN_SECOND;
        for (i, (start_percent, end_percent, duration, hitsper, expects)) in
            checks.into_iter().enumerate()
        {
            let lb = LinearBuilder::new(start_percent, end_percent, Duration::from_secs(duration));
            let mut scale_fn = LinearScaling::new(lb, &hitsper);
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
        let hitsper = HitsPer::Second(10.0);
        let mut scale_fn = LinearScaling::new(lb, &hitsper);
        let nis = NANOS_IN_SECOND;
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

    #[test]
    fn transitions_work() {
        let mut lb = LinearBuilder::new(0.5, 1.0, Duration::from_secs(60));
        lb.append(99.0, 500.0, Duration::from_secs(60));
        lb.append(1.0, 0.5, Duration::from_secs(60));
        let hitsper = HitsPer::Second(10.0);
        let mut scale_fn = LinearScaling::new(lb, &hitsper);
        lb = LinearBuilder::new(0.5, 1.0, Duration::from_secs(60));
        lb.append(99.0, 500.0, Duration::from_secs(60));
        lb.append(1.0, 0.5, Duration::from_secs(60));
        lb.append(1.0, 1.0, Duration::from_secs(60));
        let mut scale_fn2 = LinearScaling::new(lb, &hitsper);
        scale_fn2.transition_from(
            &mut scale_fn,
            Duration::from_secs(10),
            Duration::from_secs(3 * 60),
        );

        let left = scale_fn2.duration;
        let right = 240_000_000_000.0;
        assert!(left.eq(&right), "total duration {} != {}", left, right);

        let left = scale_fn2.current.duration;
        let right = 10_000_000_000.0;
        assert!(left.eq(&right), "transition duration {} != {}", left, right);

        let left = scale_fn2.current.y(0.0).trunc();
        let right = 200_000_000.0;
        assert!(left.eq(&right), "transition @ x = 0 {} != {}", left, right);

        let left = scale_fn2.y(scale_fn2.duration_offset).trunc();
        let right = 200_000_000.0;
        assert!(
            left.eq(&right),
            "scale_fn @ x = duration offset {} != {}",
            left,
            right
        );

        let left = scale_fn2.current.y(scale_fn2.current.duration).trunc();
        let right = 100_000_000.0;
        assert!(
            left.eq(&right),
            "transition @ x = end {} != {}",
            left,
            right
        );

        let left = scale_fn2
            .y(scale_fn2.duration_offset + scale_fn2.current.duration)
            .trunc();
        let right = 100_000_000.0;
        assert!(
            left.eq(&right),
            "scale_fn @ x = current duration {} != {}",
            left,
            right
        );

        let left = scale_fn2.current.duration;
        let right = 50_000_000_000.0;
        assert!(
            left.eq(&right),
            "spliced piece duration {} != {}",
            left,
            right
        );

        let left = scale_fn2.current.y(0.0).trunc();
        let right = 100_000_000.0;
        assert!(
            left.eq(&right),
            "spliced piece @ x = 0 {} != {}",
            left,
            right
        );

        let left = scale_fn2.current.y(scale_fn2.current.duration).trunc();
        let right = 100_000_000.0;
        assert!(
            left.eq(&right),
            "spliced piece @ x = end {} != {}",
            left,
            right
        );

        let next = scale_fn2.pieces.next();
        assert!(
            next.is_none(),
            "there should not be any pieces after spliced piece"
        );

        let mut lb = LinearBuilder::new(0.4, 1.0, Duration::from_secs(60));
        lb.append(99.0, 500.0, Duration::from_secs(60));
        lb.append(1.0, 0.5, Duration::from_secs(60));
        let hitsper = HitsPer::Second(10.0);
        let mut scale_fn = LinearScaling::new(lb, &hitsper);
        lb = LinearBuilder::new(1.2, 1.8, Duration::from_secs(60));
        let mut scale_fn2 = LinearScaling::new(lb, &hitsper);
        scale_fn2.transition_from(
            &mut scale_fn,
            Duration::from_secs(20),
            Duration::from_secs(50),
        );

        let left = scale_fn2.current.duration;
        let right = 10_000_000_000.0;
        assert!(
            left.eq(&right),
            "transition2 duration (should be cut short) {} != {}",
            left,
            right
        );

        let left = scale_fn2.current.y(0.0).trunc();
        let right = 111_111_111.0;
        assert!(left.eq(&right), "transition2 @ x = 0 {} != {}", left, right);

        let left = scale_fn2.current.y(scale_fn2.current.duration).trunc();
        let right = 55_555_555.0;
        assert!(
            left.eq(&right),
            "transition2 @ x = end {} != {}",
            left,
            right
        );

        let next = scale_fn2.pieces.next();
        assert!(
            next.is_none(),
            "there should not be any pieces after transition2"
        );
    }
}
