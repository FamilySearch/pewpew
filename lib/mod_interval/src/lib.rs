use futures::{
    future,
    stream::{self, Stream},
    FutureExt,
};

use ether::EitherExt;

use std::{
    collections::VecDeque,
    time::{Duration, Instant},
};

#[cfg_attr(debug_assertions, derive(Debug, PartialEq))]
#[derive(Clone)]
// for this line
// x = number of seconds elapsed
// y = number of hits per second
struct LinearSegment {
    hps_ramp_per_second: f64,
    start_hps: f64,
    min_y: f64,
    y_limit: f64,
    duration: Duration,
}

impl LinearSegment {
    fn new(start_hps: f64, end_hps: f64, duration: Duration) -> Self {
        let seconds = duration.as_secs_f64();
        let hps_ramp_per_second = (end_hps - start_hps) / seconds;
        let zero_x = {
            let ramp_abs = hps_ramp_per_second.abs();
            ((8.0 * ramp_abs).sqrt() / (2.0 * ramp_abs)).recip()
        };
        let min_y = seconds.recip();

        LinearSegment {
            hps_ramp_per_second,
            start_hps,
            min_y: zero_x,
            duration,
            y_limit: min_y,
        }
    }

    fn get_hps_at(&self, time: Duration) -> f64 {
        let x = time.as_secs_f64();
        let mut y = self.hps_ramp_per_second * x + self.start_hps;
        if y.is_nan() || y < self.y_limit {
            y = self.min_y;
        }
        match y.is_finite() {
            true => y,
            false => 0.0,
        }
    }
}

// stored as per minute
pub struct PerX(f64);

impl PerX {
    pub fn minute(min: f64) -> Self {
        PerX(min)
    }

    pub fn second(sec: f64) -> Self {
        PerX(sec * 60.0)
    }

    fn as_per_second(&self) -> f64 {
        self.0 / 60.0
    }
}

// each ModInterval segment is evaluated independenty at [t0, tDuration]
// `x_offset` helps to keep track of the progression within the entire ModInterval
struct ModIntervalStreamState {
    end_time: Instant,
    current_segment: LinearSegment,
    segments: VecDeque<LinearSegment>,
    start_time: Instant,
    x_offset: Duration,
    next_start: Instant,
    following_start: Option<Instant>,
}

impl ModIntervalStreamState {
    fn calculate_next_start(&mut self, time: Instant) -> Option<Instant> {
        let mut wait_time = time - self.start_time - self.x_offset;

        // when we've reached the end of the current segment, get the next one
        if wait_time >= self.current_segment.duration {
            let segment = match self.segments.pop_front() {
                Some(s) => s,
                None => return None,
            };
            wait_time -= self.current_segment.duration;
            self.x_offset += self.current_segment.duration;
            self.current_segment = segment;
        }

        let target_hits_per_second = self.current_segment.get_hps_at(wait_time);

        // if there is no valid target hits per second
        // (happens when scaling from 0 to 0)
        wait_time = if target_hits_per_second == 0.0 {
            if self.segments.is_empty() {
                // no more segments
                return None;
            } else {
                // there are more segments, return remaining time for this segment
                self.current_segment.duration - wait_time
            }
        } else {
            // convert from hits per second to the amount of time we should wait
            Duration::from_secs_f64(target_hits_per_second.recip())
        };
        let ret = time + wait_time;
        if ret <= self.end_time {
            Some(ret)
        } else {
            None
        }
    }
}

#[cfg_attr(debug_assertions, derive(Debug, PartialEq))]
#[derive(Clone)]
pub struct ModInterval {
    segments: VecDeque<LinearSegment>,
    duration: Duration,
}

impl ModInterval {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        ModInterval {
            segments: VecDeque::new(),
            duration: Default::default(),
        }
    }

    pub fn transition_from(&mut self, mut old: Self, at: Duration, mut over: Duration) {
        // if either mod_interval is shorter than the `at` point, return
        if old.duration < at || self.duration < at {
            return;
        }

        if self.duration < at + over {
            over = self.duration - at;
        }

        fn find_segment(
            mod_interval: &mut ModInterval,
            time: Duration,
        ) -> (usize, &mut LinearSegment, Duration) {
            let mut x_offset = Default::default();
            let last_i = mod_interval.segments.len() - 1;
            for (i, segment) in mod_interval.segments.iter_mut().enumerate() {
                if segment.duration + x_offset > time || i == last_i {
                    return (i, segment, x_offset);
                }
                x_offset += segment.duration;
            }
            unreachable!("segment should be long enough");
        }

        // find out the starting hps for the transition from the old mod_interval
        let transition_start_hps = {
            let (_, segment, x_offset) = find_segment(&mut old, at);
            segment.get_hps_at(at - x_offset)
        };

        // find out the ending hps for the transition from self
        let (i, post_transition_segment, x_offset) = find_segment(self, at + over);

        // adjust the segment following transition to be the correct size
        let segment_x = (at + over) - x_offset;
        let transition_end_hps = post_transition_segment.get_hps_at(segment_x);
        let after_transition_segment_duration = post_transition_segment.duration - segment_x;
        if after_transition_segment_duration == Default::default() {
            self.segments.pop_back();
        } else {
            let post_transition_segment_end_hps =
                post_transition_segment.get_hps_at(post_transition_segment.duration);
            *post_transition_segment = LinearSegment::new(
                transition_end_hps,
                post_transition_segment_end_hps,
                after_transition_segment_duration,
            );
        }

        // remove segments upto where the transition goes
        self.segments.drain(..i);
        let transition_segment = LinearSegment::new(transition_start_hps, transition_end_hps, over);

        // add the transition
        self.segments.push_front(transition_segment);

        // adjust for the new duration
        self.duration -= at;
    }

    pub fn append_segment(&mut self, start: PerX, duration: Duration, end: PerX) {
        self.duration += duration;

        let start_hps = start.as_per_second();
        let end_hps = end.as_per_second();
        let segment = LinearSegment::new(start_hps, end_hps, duration);
        self.segments.push_back(segment);
    }

    pub fn into_stream(
        self,
        start_at: Option<Duration>,
    ) -> impl Stream<Item = (Instant, Option<Instant>)> {
        let mut state = None;
        let mut segments = self.segments;
        let duration = self.duration;
        stream::unfold((), move |_| {
            let now = time::now();
            if state.is_none() {
                // first time through, setup the state
                let segment = match segments.pop_front() {
                    Some(s) => s,
                    None => {
                        return future::ready(None).a();
                    }
                };
                let mut s = ModIntervalStreamState {
                    end_time: now + duration,
                    current_segment: segment,
                    segments: std::mem::take(&mut segments),
                    start_time: now.checked_sub(start_at.unwrap_or_default()).unwrap(),
                    x_offset: Default::default(),
                    next_start: now,
                    following_start: None,
                };
                s.following_start = s.calculate_next_start(now);
                state = Some(s);
            }
            let state = state.as_mut().unwrap();

            // calculate the amount of latency between the time we expected to get to this
            // point and the actual time
            let latency = now
                .checked_duration_since(state.next_start)
                .unwrap_or_default();

            // get the time (Instant) we expect it to be on the next iteration in the stream
            let next_start = match state.following_start {
                Some(following_start) => following_start,
                _ => return future::ready(None).a(),
            };
            state.next_start = next_start;

            // calculatae the time (Instant) we expect it to be in two iterations of the stream
            let following_start = state.calculate_next_start(next_start);
            state.following_start = following_start;

            // calculate the sleep time, adjusting for extra latency
            let sleep_time = next_start
                .checked_sub(latency)
                .and_then(|adjusted_trigger_time| {
                    adjusted_trigger_time.checked_duration_since(now)
                });

            match sleep_time {
                Some(t) => time::sleep(t)
                    .map(move |_| Some(((next_start, following_start), ())))
                    .b(),
                None => future::ready(Some(((next_start, following_start), ()))).a(),
            }
        })
    }
}

// time mod is an abstraction for async sleeping. It's abstracted out so we can have a test implementation
// which fakes sleeping
#[cfg(not(test))]
mod time {
    use super::*;
    use futures_timer::Delay;

    pub fn now() -> Instant {
        Instant::now()
    }

    pub async fn sleep(duration: Duration) {
        Delay::new(duration).await
    }
}

#[cfg(test)]
mod time {
    use super::*;
    use std::cell::RefCell;

    thread_local! {
        pub static TIME_KEEPER: RefCell<Option<Instant>> = RefCell::new(None);
    }

    pub fn now() -> Instant {
        TIME_KEEPER.with(|t| {
            if t.borrow().is_none() {
                *t.borrow_mut() = Some(Instant::now());
            }
            t.borrow().clone().unwrap()
        })
    }

    pub async fn sleep(duration: Duration) {
        TIME_KEEPER.with(|t| {
            let new = t.borrow().as_ref().take().map(|i| *i + duration);
            *t.borrow_mut() = new;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::executor::block_on_stream;
    use std::{fs, str::FromStr};

    fn check_times<I: Iterator<Item = (Instant, Option<Instant>)>>(
        iter: I,
        file_name: &str,
        index: Option<usize>,
    ) {
        let mut start = None;

        let (elapsed_times, diffs) = iter.fold(
            (Vec::new(), Vec::new()),
            |(mut values, mut diffs), (instant, next_instant)| {
                let start = start.get_or_insert(instant);
                let now = time::now();
                match index {
                    Some(i) => {
                        assert!(
                            now >= instant,
                            "mod_interval stream didn't sleep at index {}. Returned instant was {}ms in the future",
                            i,
                            (instant - now).as_millis(),
                        );
                    }
                    None => {
                        assert!(
                            now >= instant,
                            "mod_interval stream didn't sleep. Returned instant was {}ms in the future",
                            (instant - now).as_millis(),
                        );
                    }
                }
                values.push((instant - *start).as_secs_f64());
                if let Some(i) = next_instant {
                    diffs.push((i - instant).as_micros());
                };
                (values, diffs)
            },
        );

        let (expect_times, expect_diffs, _) = fs::read_to_string(file_name)
            .unwrap()
            .lines()
            .map(FromStr::from_str)
            .try_fold(
                (Vec::new(), Vec::new(), None),
                |(mut values, mut diffs, previous), current| {
                    current.map(move |v| {
                        values.push(v);
                        if let Some(p) = previous {
                            diffs.push((v * 1_000_000.0) as u128 - (p * 1_000_000.0) as u128);
                        }
                        (values, diffs, Some(v))
                    })
                },
            )
            .unwrap();

        if let Some(index) = index {
            assert_eq!(
                elapsed_times, expect_times,
                "elapsed times were not as expected for segment at index {}",
                index
            );
        } else {
            assert_eq!(
                elapsed_times, expect_times,
                "elapsed times were not as expected for segment"
            );
        }

        assert_eq!(
            diffs.len(),
            expect_diffs.len(),
            "diffs have the differing lengths\nleft: `{:?}`\nright: `{:?}`",
            diffs,
            expect_diffs
        );
        for (i, (l, r)) in diffs.into_iter().zip(expect_diffs).enumerate() {
            let diff = l.max(r) - r.min(l);
            assert!(diff <= 1, "diffs should be less than 1, saw a diff of {} at index {}\nleft value: `{}`\nright value: `{}`", diff, i, l, r);
        }
    }

    // https://github.com/rust-lang/rust/releases/tag/1.63.0
    // Compatibility Notes
    // Rounding is now used when converting a float to a Duration. The converted duration can differ slightly from what it was.
    // https://github.com/rust-lang/rust/pull/96051/
    #[test]
    fn single_segment() {
        // start perx, duration, end perx
        let segments = [
            (0.0, 30, 12.0),
            (30.0, 30, 0.0),
            (0.0, 120, 30.0),
            (0.0, 15, 0.0),
        ];
        for (i, (start, duration, end)) in segments.iter().enumerate() {
            let mut mod_interval = ModInterval::new();
            mod_interval.append_segment(
                PerX::second(*start),
                Duration::from_secs(*duration),
                PerX::second(*end),
            );
            let stream = Box::pin(mod_interval.into_stream(None));

            check_times(
                block_on_stream(stream),
                &format!("tests/single-segment{}.out", i),
                Some(i),
            );
        }
    }

    #[test]
    fn single_segment_low_start_rate() {
        // start perx, duration, end perx
        let segments = [(0.3, 60, 30.0), (1.0, 30, 1.0), (1.0, 60, 1.0)];
        for (i, (start, duration, end)) in segments.iter().enumerate() {
            let mut mod_interval = ModInterval::new();
            mod_interval.append_segment(
                PerX::minute(*start),
                Duration::from_secs(*duration),
                PerX::minute(*end),
            );
            let stream = Box::pin(mod_interval.into_stream(None));

            check_times(
                block_on_stream(stream),
                &format!("tests/single-segment-low-start-rate{}.out", i),
                Some(i),
            );
        }
    }

    #[test]
    fn single_segment_start_at() {
        let (start, duration, end) = (0.0, 30, 12.0);

        let mut mod_interval = ModInterval::new();
        mod_interval.append_segment(
            PerX::second(start),
            Duration::from_secs(duration),
            PerX::second(end),
        );
        let stream = Box::pin(mod_interval.into_stream(Some(Duration::from_secs(15))));

        check_times(
            block_on_stream(stream),
            "tests/single-segment-start-at.out",
            None,
        );
    }

    #[test]
    fn multiple_segments() {
        // start perx, duration, end perx
        let segments = [(0.0, 30, 5.0), (5.0, 30, 30.0), (30.0, 30, 10.0)];
        let mut mod_interval = ModInterval::new();
        for (start, duration, end) in segments.iter() {
            mod_interval.append_segment(
                PerX::second(*start),
                Duration::from_secs(*duration),
                PerX::second(*end),
            );
        }

        let stream = Box::pin(mod_interval.into_stream(None));

        check_times(block_on_stream(stream), "tests/multiple-segments.out", None);
    }

    #[test]
    fn multiple_segments_start_at() {
        // start perx, duration, end perx
        let segments = [(0.0, 30, 5.0), (5.0, 30, 30.0), (30.0, 30, 10.0)];
        let mut mod_interval = ModInterval::new();
        for (start, duration, end) in segments.iter() {
            mod_interval.append_segment(
                PerX::second(*start),
                Duration::from_secs(*duration),
                PerX::second(*end),
            );
        }

        let stream = Box::pin(mod_interval.into_stream(Some(Duration::from_secs(75))));

        check_times(
            block_on_stream(stream),
            "tests/multiple-segments-start-at.out",
            None,
        );
    }

    #[test]
    fn multiple_segments_with_zero() {
        // start perx, duration, end perx
        let segments = [(0.0, 30, 5.0), (0.0, 30, 0.0), (30.0, 30, 10.0)];
        let mut mod_interval = ModInterval::new();
        for (start, duration, end) in segments.iter() {
            mod_interval.append_segment(
                PerX::second(*start),
                Duration::from_secs(*duration),
                PerX::second(*end),
            );
        }

        let stream = Box::pin(mod_interval.into_stream(None));

        check_times(
            block_on_stream(stream),
            "tests/multiple-segments-with-zero.out",
            None,
        );
    }

    #[test]
    fn transition_works() {
        // start perx, duration, end perx
        let segments = [(0.0, 30, 5.0), (0.0, 30, 0.0), (30.0, 30, 10.0)];
        let mut old_mod_interval = ModInterval::new();
        for (start, duration, end) in segments.iter() {
            old_mod_interval.append_segment(
                PerX::second(*start),
                Duration::from_secs(*duration),
                PerX::second(*end),
            );
        }

        let segments = [(0.0, 30, 10.0), (10.0, 30, 30.0), (30.0, 30, 50.0)];
        let mut new_mod_interval = ModInterval::new();
        for (start, duration, end) in segments.iter() {
            new_mod_interval.append_segment(
                PerX::second(*start),
                Duration::from_secs(*duration),
                PerX::second(*end),
            );
        }

        new_mod_interval.transition_from(
            old_mod_interval,
            Duration::from_secs(45),
            Duration::from_secs(15),
        );

        let segments = [(0.0, 15, 30.0), (30.0, 30, 50.0)];
        let mut expect_mod_interval = ModInterval::new();
        for (start, duration, end) in segments.iter() {
            expect_mod_interval.append_segment(
                PerX::second(*start),
                Duration::from_secs(*duration),
                PerX::second(*end),
            );
        }

        assert_eq!(new_mod_interval, expect_mod_interval);
    }

    #[test]
    fn transition_too_long_works() {
        // start perx, duration, end perx
        let segments = [(0.0, 30, 5.0), (0.0, 30, 0.0), (30.0, 30, 10.0)];
        let mut old_mod_interval = ModInterval::new();
        for (start, duration, end) in segments.iter() {
            old_mod_interval.append_segment(
                PerX::second(*start),
                Duration::from_secs(*duration),
                PerX::second(*end),
            );
        }

        let segments = [(0.0, 30, 10.0), (10.0, 30, 30.0), (30.0, 30, 50.0)];
        let mut new_mod_interval = ModInterval::new();
        for (start, duration, end) in segments.iter() {
            new_mod_interval.append_segment(
                PerX::second(*start),
                Duration::from_secs(*duration),
                PerX::second(*end),
            );
        }

        new_mod_interval.transition_from(
            old_mod_interval,
            Duration::from_secs(45),
            Duration::from_secs(90),
        );

        let mut expect_mod_interval = ModInterval::new();
        expect_mod_interval.append_segment(
            PerX::second(0.0),
            Duration::from_secs(45),
            PerX::second(50.0),
        );

        assert_eq!(new_mod_interval, expect_mod_interval);
    }
}
