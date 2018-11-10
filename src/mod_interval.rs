use futures::try_ready;
use tokio::{
    prelude::*,
    timer::{Delay, Error as TimerError}
};

use std::{
    cmp,
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

#[derive(Debug)]
pub enum HitsPer {
    Second(u32),
    Minute(u32),
}

// x represents the time elapsed in the test
// y represents the amount of time between hits
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
        let peak_load = match peak_load {
            HitsPer::Second(n) => f64::from(*n),
            HitsPer::Minute(n) => f64::from(*n) / f64::from(NANOS_IN_SECOND), 
        };
        let duration = duration_to_nanos(self.duration);
        ModInterval::new(
            LinearScaling::new(
                self.start_percent,
                self.end_percent,
                duration,
                peak_load
            )
        )
    }
}

#[derive(Debug)]
pub struct LinearScaling {
    diff: f64,
    duration: f64,
    min_y: f64,
    peak_load: f64,
    start_percent: f64,
}

impl LinearScaling {
    pub fn new (start_percent: f64, end_percent: f64, duration: f64, peak_load: f64) -> Self {
        let min_y = duration / (start_percent.max(end_percent) * peak_load);
        LinearScaling {
            start_percent,
            diff: end_percent - start_percent,
            duration,
            peak_load,
            min_y
        }
    }
}

impl ScaleFn for LinearScaling {
    #[inline]
    fn y (&self, x: f64) -> f64 {
        let percent_through = x / self.duration;
        let percent_of_peak = self.diff * percent_through + self.start_percent;
        self.min_y.min(f64::from(NANOS_IN_SECOND) / (percent_of_peak * self.peak_load))
    }

    #[inline]
    fn max_x(&self) -> f64 {
        self.duration
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

    fn run_checks(checks: Vec<(f64, f64)>, mod_interval: ModInterval<LinearScaling>) {
        let scale_fn = mod_interval.scale_fn;
        for (i, (secs, hps)) in checks.iter().enumerate() {
            let nanos = secs * f64::from(NANOS_IN_SECOND);
            let right = 1f64 / (scale_fn.y(nanos) / f64::from(NANOS_IN_SECOND));
            let left = hps;
            let diff = right - left;
            let equal = diff < std::f64::EPSILON && diff >= 0f64;
            assert!(equal, "index {} left {} != right {}", i, left, right);
        }
    }

    #[test]
    fn scale_up() {
        // scale from 0 to 100% over 30 seconds
        let lb = LinearBuilder::new(0f64, 1f64, Duration::from_secs(30));
        // 100% = 12hps
        let hitsper = HitsPer::Second(12);
        let mod_interval = lb.build(&hitsper);
        // (t, hps) at time t we should be at hps
        let checks = vec!(
            (0.0, 0.4),
            (10.0, 4.0),
            (15.0,  6.0),
            (30f64, 12f64),
        );
        run_checks(checks, mod_interval);
    }

    #[test]
    fn scale_up2() {
        // scale from 0 to 100% over 30 seconds
        let lb = LinearBuilder::new(0.5f64, 1f64, Duration::from_secs(30));
        // 100% = 12hps
        let hitsper = HitsPer::Second(12);
        let mod_interval = lb.build(&hitsper);
        // (t, hps) at time t we should be at hps
        let checks = vec!(
            (0.0, 6.0),
            (10.0, 8.0),
            (15.0,  9.0),
            (30f64, 12f64),
        );
        run_checks(checks, mod_interval);
    }

    #[test]
    fn scale_down() {
        // scale from 100 to 0% over 30 seconds
        let lb = LinearBuilder::new(1f64, 0f64, Duration::from_secs(30));
        // 100% = 12hps
        let hitsper = HitsPer::Second(12);
        let mod_interval = lb.build(&hitsper);
        let checks = vec!(
            (0f64, 12f64),
            (15.0, 6.0),
            (20.0, 4.0),
            (30.0, 0.4),
        );
        run_checks(checks, mod_interval);
    }
}
