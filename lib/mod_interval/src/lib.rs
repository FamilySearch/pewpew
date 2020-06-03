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
    m: f64,
    b: f64,
    zero_x: Option<f64>,
    duration: Duration,
}

impl LinearSegment {
    fn new(start_hps: f64, end_hps: f64, duration: Duration) -> Self {
        let seconds = duration.as_secs_f64();
        let m = (end_hps - start_hps) / seconds;
        let b = start_hps;
        let zero_x = if start_hps == 0.0 || end_hps == 0.0 {
            let m = m.abs();
            Some(1.0 / ((8.0 * m).sqrt() / (2.0 * m)))
        } else {
            None
        };

        LinearSegment {
            m,
            b,
            zero_x,
            duration,
        }
    }

    fn get_hps_at(&self, time: Duration) -> f64 {
        let x = time.as_secs_f64();
        let mut y = self.m * x + self.b;
        if let (true, Some(y2)) = (y.is_nan() || y == 0.0, self.zero_x) {
            y = y2;
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
// or in other words
struct ModIntervalStreamState {
    end_time: Instant,
    segment: LinearSegment,
    start_time: Instant,
    x_offset: Duration,
    next_start: Instant,
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

    pub fn into_stream(mut self, start_at: Option<Duration>) -> impl Stream<Item = Instant> {
        let mut state = None;
        stream::unfold((), move |_| {
            let now = time::now();
            if state.is_none() {
                // first time through, setup the state
                let segment = match self.segments.pop_front() {
                    Some(s) => s,
                    None => {
                        return future::ready(None).a();
                    }
                };
                let s = ModIntervalStreamState {
                    end_time: now + self.duration,
                    segment,
                    start_time: now - start_at.unwrap_or_default(),
                    x_offset: Default::default(),
                    next_start: now,
                };
                state = Some(s);
            }
            let state = state.as_mut().unwrap();
            let mut time = now - state.start_time - state.x_offset;

            // when we've reached the end of the current segment, get the next one
            if time >= state.segment.duration {
                let segment = match self.segments.pop_front() {
                    Some(s) => s,
                    None => {
                        return future::ready(None).a();
                    }
                };
                time -= state.segment.duration;
                state.x_offset += state.segment.duration;
                state.segment = segment;
            }

            let target_hits_per_second = state.segment.get_hps_at(time);

            // if there is no valid target hits per second
            // (happens when scaling from 0 to 0)
            let y = if target_hits_per_second == 0.0 {
                if self.segments.is_empty() {
                    // no more segments, we can end
                    return future::ready(None).a();
                } else {
                    // there are more segments, just sleep through the rest of this segment
                    state.segment.duration - time
                }
            } else {
                // convert from hits per second to the amount of time we should wait
                Duration::from_secs_f64(target_hits_per_second.recip())
            };

            let next_start = state.next_start;
            let result = next_start + y;
            state.next_start = result;

            // adjust the wait time to account for extra latency between polls, sleeps, etc
            let y = match y.checked_sub(now - next_start) {
                Some(y) => y,
                // we're past the time we should have fired, so fire now
                None => return future::ready(Some((result, ()))).a(),
            };

            // if the sleep extends past the entire ModInterval's end time then end now
            if result > state.end_time {
                return future::ready(None).a();
            }

            time::sleep(y).map(move |_| Some((result, ()))).b()
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

            let mut start = None;
            let elapsed_times: Vec<_> = block_on_stream(stream)
                .map(|instant| {
                    let start = start.get_or_insert(instant);
                    (instant - *start).as_secs_f64()
                })
                .collect();

            let expects = fs::read_to_string(format!("tests/single-segment{}.out", i))
                .unwrap()
                .lines()
                .map(FromStr::from_str)
                .collect::<Result<Vec<f64>, _>>()
                .unwrap();

            assert_eq!(
                elapsed_times, expects,
                "elapsed times were not as expected for segment at index {}",
                i
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

        let mut start = None;
        let elapsed_times: Vec<_> = block_on_stream(stream)
            .map(|instant| {
                let start = start.get_or_insert(instant);
                (instant - *start).as_secs_f64()
            })
            .collect();

        let expects = fs::read_to_string("tests/single-segment-start-at.out")
            .unwrap()
            .lines()
            .map(FromStr::from_str)
            .collect::<Result<Vec<f64>, _>>()
            .unwrap();

        assert_eq!(
            elapsed_times, expects,
            "elapsed times were not as expected for segment",
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

        let mut start = None;
        let elapsed_times: Vec<_> = block_on_stream(stream)
            .map(|instant| {
                let start = start.get_or_insert(instant);
                (instant - *start).as_secs_f64()
            })
            .collect();

        let expects = fs::read_to_string("tests/multiple-segments.out")
            .unwrap()
            .lines()
            .map(FromStr::from_str)
            .collect::<Result<Vec<f64>, _>>()
            .unwrap();

        assert_eq!(
            elapsed_times, expects,
            "elapsed times were not as expected for multiple segments"
        );
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

        let mut start = None;
        let elapsed_times: Vec<_> = block_on_stream(stream)
            .map(|instant| {
                let start = start.get_or_insert(instant);
                (instant - *start).as_secs_f64()
            })
            .collect();

        let expects = fs::read_to_string("tests/multiple-segments-start-at.out")
            .unwrap()
            .lines()
            .map(FromStr::from_str)
            .collect::<Result<Vec<f64>, _>>()
            .unwrap();

        assert_eq!(
            elapsed_times, expects,
            "elapsed times were not as expected for multiple segments"
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

        let mut start = None;
        let elapsed_times: Vec<_> = block_on_stream(stream)
            .map(|instant| {
                let start = start.get_or_insert(instant);
                (instant - *start).as_secs_f64()
            })
            .collect();

        let expects = fs::read_to_string("tests/multiple-segments-with-zero.out")
            .unwrap()
            .lines()
            .map(FromStr::from_str)
            .collect::<Result<Vec<f64>, _>>()
            .unwrap();

        assert_eq!(
            elapsed_times, expects,
            "elapsed times were not as expected for multiple segments"
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
