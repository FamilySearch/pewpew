use super::print_test_error_to_console;
use crate::config;
use crate::error::TestError;

use chrono::{DateTime, Duration as ChronoDuration, Local, NaiveDateTime, Utc};
use fnv::FnvHashMap;
use futures::{
    future::Shared,
    sync::mpsc::{self as futures_channel, Sender as FCSender},
    Future, Sink, Stream,
};
use hdrhistogram::Histogram;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json as json;
use tokio::{fs::File as TokioFile, timer::Interval};
use yansi::Paint;

use std::{
    cell::Cell,
    cmp,
    collections::BTreeMap,
    ops::AddAssign,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

mod histogram_serde {
    use base64;
    use hdrhistogram::{
        serialization::{
            Deserializer as HDRDeserializer, Serializer as HDRSerializer, V2Serializer,
        },
        Histogram,
    };
    use serde::{self, Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(histogram: &Histogram<u64>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut buf = Vec::new();
        let mut v2_serializer = V2Serializer::new();
        v2_serializer
            .serialize(&histogram, &mut buf)
            .map_err(|_e| serde::ser::Error::custom("could not serialize HDRHistogram"))?;
        serializer.serialize_str(&base64::encode_config(&buf, base64::STANDARD_NO_PAD))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Histogram<u64>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let string = String::deserialize(deserializer)?;
        let bytes = base64::decode_config(&string, base64::STANDARD_NO_PAD).map_err(|_| {
            serde::de::Error::custom("could not base64 decode string for HDRHistogram")
        })?;
        let mut hdr_deserializer = HDRDeserializer::new();
        hdr_deserializer
            .deserialize(&mut bytes.to_vec().as_slice())
            .map_err(|_| serde::de::Error::custom("could not deserialize HDRHistogram"))
    }
}

mod buckets_serde {
    use super::AggregateStats;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use std::collections::BTreeMap;

    type BucketValuesSer = (BTreeMap<String, String>, Vec<AggregateStats>);
    type BucketValues = (BTreeMap<String, String>, BTreeMap<u64, AggregateStats>);
    type Buckets = BTreeMap<usize, BucketValues>;

    pub fn serialize<S>(buckets: &Buckets, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let values: Vec<(&BTreeMap<String, String>, Vec<&AggregateStats>)> = buckets
            .values()
            .map(|(stats_id, stats_map)| (stats_id, stats_map.values().collect()))
            .collect();
        values.serialize(serializer)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Buckets, D::Error>
    where
        D: Deserializer<'de>,
    {
        let values: Vec<BucketValuesSer> = Vec::deserialize(deserializer)?;
        Ok(values
            .into_iter()
            .map(|(k, v)| {
                let v = v.into_iter().map(|v| (v.time, v)).collect();
                (k, v)
            })
            .enumerate()
            .collect())
    }
}

type EndpointId = usize;
type StatsId = BTreeMap<String, String>;

#[derive(Clone, Serialize, Deserialize)]
struct RollingAggregateStats {
    #[serde(with = "buckets_serde")]
    buckets: BTreeMap<EndpointId, (StatsId, BTreeMap<u64, AggregateStats>)>,
    #[serde(skip_serializing)]
    duration: u64,
    #[serde(skip)]
    end_time: Cell<Option<Instant>>,
    #[serde(skip_serializing)]
    last_print_time: Cell<u64>,
    #[serde(skip_serializing)]
    time: u64,
}

impl RollingAggregateStats {
    fn new(time: u64, duration: Duration) -> Self {
        RollingAggregateStats {
            buckets: BTreeMap::new(),
            duration: duration.as_secs(),
            end_time: Cell::new(None),
            last_print_time: Cell::new(0),
            time,
        }
    }

    fn init(
        &mut self,
        time: SystemTime,
        endpoint_id: usize,
        stats_id: StatsId,
    ) -> Result<(), TestError> {
        if !stats_id.contains_key("url") || !stats_id.contains_key("method") {
            return Err(TestError::Internal(format!(
                "stats_id missing `url` and/or `method`. {:?}",
                stats_id
            )));
        }
        let duration = self.duration;
        let time = to_epoch(time)? / duration * duration;
        let mut stats_map = BTreeMap::new();
        stats_map.insert(
            time,
            AggregateStats::new(time, Duration::from_secs(duration)),
        );
        self.buckets.insert(endpoint_id, (stats_id, stats_map));
        Ok(())
    }

    fn append(&mut self, stat: ResponseStat) -> Result<(), TestError> {
        let duration = self.duration;
        let time = to_epoch(stat.time)? / duration * duration;
        let (_, stats_map) = self
            .buckets
            .get_mut(&stat.endpoint_id)
            .expect("Unintialized bucket");
        let current = stats_map
            .entry(time)
            .or_insert_with(|| AggregateStats::new(time, Duration::from_secs(duration)));
        current.append_response_stat(stat)?;
        Ok(())
    }

    fn persist(&self) -> impl Future<Item = (), Error = TestError> {
        let stats = self.clone();
        TokioFile::create(format!("stats-{}.json", self.time))
            .and_then(move |mut file| {
                if let Err(e) = stats.serialize(&mut json::Serializer::new(&mut file)) {
                    eprint!("{}", format!("error persisting stats {:?}\n", e))
                }
                Ok(())
            })
            .or_else(|e| {
                eprint!("{}", format!("error persisting stats {:?}\n", e));
                Ok(())
            })
    }

    fn print_summary(&self, time: u64, summary_output_format: config::SummaryOutputFormats) {
        let mut printed = false;
        self.last_print_time.set(time);
        let is_pretty_format = summary_output_format.is_pretty();
        if is_pretty_format {
            eprint!(
                "{}",
                Paint::new(format!(
                    "\nBucket Summary {}\n",
                    create_date_diff(time, time + self.duration)
                ))
                .bold()
            );
        }
        for (stats_id, stats_map) in self.buckets.values() {
            if let Some(stats) = stats_map.get(&time) {
                let did_print = stats.print_summary(stats_id, summary_output_format, true);
                if !printed && did_print {
                    printed = true;
                }
            }
        }
        if is_pretty_format {
            if !printed {
                eprint!("{}", "no data\n");
            }
            if let Some(et) = self.end_time.get() {
                if et > Instant::now() {
                    let test_end_msg = duration_till_end_to_pretty_string(et - Instant::now());
                    eprint!("{}", format!("\n{}\n", test_end_msg));
                }
            }
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AggregateStats {
    connection_errors: FnvHashMap<String, u64>,
    duration: u64, // in seconds
    end_time: u64, // epoch in seconds, when the last request was logged
    request_timeouts: u64,
    #[serde(with = "histogram_serde")]
    rtt_histogram: Histogram<u64>,
    start_time: u64, // epoch in seconds, when the first request was logged
    status_counts: FnvHashMap<u16, u64>,
    time: u64, // epoch in seconds, when the bucket time begins
}

impl AddAssign<&AggregateStats> for AggregateStats {
    fn add_assign(&mut self, rhs: &AggregateStats) {
        self.time = cmp::min(self.time, rhs.time);
        self.start_time = cmp::min(self.start_time, rhs.start_time);
        self.end_time = cmp::max(self.end_time, rhs.end_time);
        self.rtt_histogram += &rhs.rtt_histogram;
        for (status, count) in &rhs.status_counts {
            self.status_counts
                .entry(*status)
                .and_modify(|n| *n += count)
                .or_insert(*count);
        }
        for (description, count) in &rhs.connection_errors {
            self.connection_errors
                .entry(description.clone())
                .and_modify(|n| *n += count)
                .or_insert(*count);
        }
        self.request_timeouts += rhs.request_timeouts;
    }
}

fn get_epoch() -> Result<u64, TestError> {
    UNIX_EPOCH
        .elapsed()
        .map(|d| d.as_secs())
        .map_err(|_| TestError::TimeSkew)
}

fn to_epoch(time: SystemTime) -> Result<u64, TestError> {
    time.duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map_err(|_| TestError::TimeSkew)
}

fn create_date_diff(start: u64, end: u64) -> String {
    let start = DateTime::<Utc>::from_utc(NaiveDateTime::from_timestamp(start as i64, 0), Utc)
        .with_timezone(&Local);
    let end = DateTime::<Utc>::from_utc(NaiveDateTime::from_timestamp((end) as i64, 0), Utc)
        .with_timezone(&Local);
    let fmt2 = "%T %-e-%b-%Y";
    let fmt = if start.date() == end.date() {
        "%T"
    } else {
        fmt2
    };
    format!("{} to {}", start.format(fmt), end.format(fmt2))
}

impl AggregateStats {
    fn new(time: u64, duration: Duration) -> Self {
        AggregateStats {
            connection_errors: FnvHashMap::default(),
            duration: duration.as_secs(),
            end_time: 0,
            request_timeouts: 0,
            rtt_histogram: Histogram::new(3).expect("could not create histogram"),
            start_time: 0,
            status_counts: FnvHashMap::default(),
            time,
        }
    }

    fn append_response_stat(&mut self, rhs: ResponseStat) -> Result<(), TestError> {
        let time = to_epoch(rhs.time)?;
        if self.start_time == 0 {
            self.start_time = time;
        }
        self.end_time = cmp::max(self.end_time, time);
        match rhs.kind {
            StatKind::ConnectionError(description) => {
                self.connection_errors
                    .entry(description)
                    .and_modify(|count| *count += 1)
                    .or_insert(1);
            }
            StatKind::Rtt((rtt, status)) => {
                self.rtt_histogram += rtt;
                self.status_counts
                    .entry(status)
                    .and_modify(|n| *n += 1)
                    .or_insert(1);
            }
            StatKind::Timeout(to) => {
                self.rtt_histogram += to;
                self.request_timeouts += 1
            }
        }
        Ok(())
    }

    fn print_summary(
        &self,
        stats_id: &StatsId,
        format: config::SummaryOutputFormats,
        bucket_summary: bool,
    ) -> bool {
        let calls_made = self.rtt_histogram.len();
        if calls_made == 0 {
            return false;
        }
        let method = stats_id.get("method").expect("stats_id missing `method`");
        let url = stats_id.get("url").expect("stats_id missing `url`");
        let p50 = self.rtt_histogram.value_at_quantile(0.5);
        let p90 = self.rtt_histogram.value_at_quantile(0.90);
        let p95 = self.rtt_histogram.value_at_quantile(0.95);
        let p99 = self.rtt_histogram.value_at_quantile(0.99);
        let p99_9 = self.rtt_histogram.value_at_quantile(0.999);
        let min = self.rtt_histogram.min();
        let max = self.rtt_histogram.max();
        let mean = (self.rtt_histogram.mean() * 100.0).round() / 100.0;
        let stddev = (self.rtt_histogram.stdev() * 100.0).round() / 100.0;
        match format {
            config::SummaryOutputFormats::Pretty => {
                eprint!(
                    "{}",
                    Paint::yellow(format!("\n- {} {}:\n", method, url)).dimmed()
                );
                eprint!("{}", format!("  calls made: {}\n", calls_made));
                eprint!("{}", format!("  status counts: {:?}\n", self.status_counts));
                if self.request_timeouts > 0 {
                    eprint!(
                        "{}",
                        format!("  request timeouts: {:?}\n", self.request_timeouts)
                    );
                }
                if !self.connection_errors.is_empty() {
                    eprint!(
                        "{}",
                        format!("  connection errors: {:?}\n", self.connection_errors)
                    );
                }
                eprint!(
                    "{}",
                    format!(
                        "  p50: {}ms, p90: {}ms, p95: {}ms, p99: {}ms, p99.9: {}ms\n",
                        p50, p90, p95, p99, p99_9
                    )
                );
                eprint!(
                    "{}",
                    format!(
                        "  min: {}ms, max: {}ms, avg: {}ms, std. dev: {}ms\n",
                        min, max, mean, stddev
                    )
                );
            }
            config::SummaryOutputFormats::Json => {
                let summary_type = if bucket_summary { "bucket" } else { "test" };
                let output = json::json!({
                    "startTime": self.time,
                    "timestamp": self.time + self.duration,
                    "summaryType": summary_type,
                    "method": method,
                    "url": url,
                    "callCount": calls_made,
                    "statusCounts":
                        self.status_counts.iter()
                            .map(|(status, count)| json::json!({ "status": status, "count": count }))
                            .collect::<Vec<(_)>>(),
                    "requestTimeouts": self.request_timeouts,
                    "connectionErrorCount":
                        self.connection_errors.iter()
                            .fold(0, |sum, (_, c)| sum + c),
                    "connectionErrors": self.connection_errors,
                    "p50": p50,
                    "p90": p90,
                    "p95": p95,
                    "p99": p99,
                    "p99_9": p99_9,
                    "min": min,
                    "max": max,
                    "mean": mean,
                    "stddev": stddev,
                    "statsId":
                        stats_id.iter()
                            .filter(|(k, _)| k.as_str() != "method" && k.as_str() != "url")
                            .collect::<BTreeMap<_, _>>(),
                });
                eprint!("{}", format!("{}\n", output));
            }
        }
        true
    }
}

pub enum StatsMessage {
    // every endpoint sends init so the stats buckets are initialized
    Init(StatsInit),
    // every time a response is received
    ResponseStat(ResponseStat),
    // sent at the beginning of the test
    Start(Duration),
}

pub struct StatsInit {
    pub endpoint_id: EndpointId,
    pub stats_id: StatsId,
    pub time: SystemTime,
}

#[derive(Debug)]
pub struct ResponseStat {
    pub endpoint_id: EndpointId,
    pub kind: StatKind,
    pub time: SystemTime,
}

#[derive(Debug)]
pub enum StatKind {
    ConnectionError(String),
    Rtt((u64, u16)),
    Timeout(u64),
}

impl From<ResponseStat> for StatsMessage {
    fn from(rs: ResponseStat) -> Self {
        StatsMessage::ResponseStat(rs)
    }
}

impl From<StatsInit> for StatsMessage {
    fn from(si: StatsInit) -> Self {
        StatsMessage::Init(si)
    }
}

fn duration_till_end_to_pretty_string(duration: Duration) -> String {
    let long_form = duration_to_pretty_long_form(duration);
    let msg = if let Some(s) = duration_to_pretty_short_form(duration) {
        format!("{} {}", s, long_form)
    } else {
        long_form
    };
    format!("Test will end {}", msg)
}

fn duration_to_pretty_short_form(duration: Duration) -> Option<String> {
    if let Ok(duration) = ChronoDuration::from_std(duration) {
        let now = Local::now();
        let end = now + duration;
        Some(format!("around {}", end.format("%T %-e-%b-%Y")))
    } else {
        None
    }
}

fn duration_to_pretty_long_form(duration: Duration) -> String {
    const SECOND: u64 = 1;
    const MINUTE: u64 = 60;
    const HOUR: u64 = MINUTE * 60;
    const DAY: u64 = HOUR * 24;
    let mut secs = duration.as_secs();
    let mut builder: Vec<_> = vec![
        (DAY, "day"),
        (HOUR, "hour"),
        (MINUTE, "minute"),
        (SECOND, "second"),
    ]
    .into_iter()
    .filter_map(move |(unit, name)| {
        let count = secs / unit;
        if count > 0 {
            secs -= count * unit;
            if count > 1 {
                Some(format!("{} {}s", count, name))
            } else {
                Some(format!("{} {}", count, name))
            }
        } else {
            None
        }
    })
    .collect();
    let long_time = if let Some(last) = builder.pop() {
        let mut ret = builder.join(", ");
        if ret.is_empty() {
            last
        } else {
            ret.push_str(&format!(" and {}", last));
            ret
        }
    } else {
        "0 seconds".to_string()
    };
    format!("in approximately {}", long_time)
}

// essentially does nothing, but gives a place for stats to be sent
// during a try run
pub fn create_try_run_stats_channel<F>(
    test_complete: Shared<F>,
) -> (
    futures_channel::UnboundedSender<StatsMessage>,
    impl Future<Item = (), Error = ()> + Send,
)
where
    F: Future<Item = (), Error = TestError> + Send + 'static,
{
    let (tx, rx) = futures_channel::unbounded::<StatsMessage>();
    let f = Stream::for_each(rx, |_| Ok(()))
        .then(|_| Ok(()))
        .join(
            test_complete
                .then(|r| r)
                .map_err(|e| print_test_error_to_console((&*e).clone()))
                .map(|_| ()),
        )
        .then(|_| Ok(()));
    (tx, f)
}

pub fn create_stats_channel<F>(
    test_complete: Shared<F>,
    test_killer: FCSender<Result<(), TestError>>,
    config: &config::GeneralConfig,
) -> Result<
    (
        futures_channel::UnboundedSender<StatsMessage>,
        impl Future<Item = (), Error = ()> + Send,
    ),
    TestError,
>
where
    F: Future<Item = (), Error = TestError> + Send + 'static,
{
    let (tx, rx) = futures_channel::unbounded::<StatsMessage>();
    let now = Instant::now();
    let start_sec = get_epoch()?;
    let bucket_size = config.bucket_size;
    let start_bucket = start_sec / bucket_size.as_secs() * bucket_size.as_secs();
    let next_bucket =
        Duration::from_millis((bucket_size.as_secs() - (start_sec - start_bucket)) * 1000 + 1);
    let stats = Arc::new(Mutex::new(RollingAggregateStats::new(
        start_bucket,
        bucket_size,
    )));
    let stats2 = stats.clone();
    let stats3 = stats.clone();
    let stats4 = stats.clone();
    let summary_output_format = config.summary_output_format;
    let is_pretty_format = summary_output_format.is_pretty();
    let print_stats = Interval::new(now + next_bucket, bucket_size)
        .map_err(|_| TestError::Internal("something happened while printing stats".into()))
        .for_each(move |_| {
            let stats = stats4.lock();
            let epoch = match get_epoch() {
                Ok(e) => e,
                Err(e) => return Err(e),
            };
            let prev_time = epoch / stats.duration * stats.duration - stats.duration;
            stats.print_summary(prev_time, summary_output_format);
            Ok(())
        });
    let receiver = Stream::for_each(
        rx.map_err(|_| TestError::ProviderEnded(None)),
        move |datum| {
            let mut stats = stats.lock();
            match datum {
                StatsMessage::Init(init) => {
                    return stats.init(init.time, init.endpoint_id, init.stats_id);
                }
                StatsMessage::Start(d) => {
                    stats.end_time.set(Some(Instant::now() + d));
                    let test_end_message = duration_till_end_to_pretty_string(d);
                    eprint!("{}", format!("Starting load test. {}\n", test_end_message));
                }
                StatsMessage::ResponseStat(rs) => stats.append(rs)?,
            }
            Ok(())
        },
    )
    .join(print_stats)
    .map(|_| ())
    .or_else(move |e| test_killer.send(Err(e.clone())).then(move |_| Err(e)))
    .select(test_complete.map(|_| ()).map_err(|e| (&*e).clone()))
    .map_err(|e| e.0)
    .and_then(move |_| stats2.lock().persist())
    .then(move |result| {
        let stats = stats3.lock();
        let duration = stats.duration;
        let (start, mut end) = stats
            .buckets
            .values()
            .map(|(_, time_buckets)| {
                let mut bucket_values = time_buckets.values();
                let first = bucket_values
                    .next()
                    .expect("bucket unexpectedly empty")
                    .time;
                let last = bucket_values.next_back().map(|v| v.time).unwrap_or(first);
                (first, last)
            })
            .fold((u64::max_value(), 0), |(a1, b1), (a2, b2)| {
                (cmp::min(a1, a2), cmp::max(b1, b2))
            });
        end += duration;
        for (_, time_buckets) in stats.buckets.values() {
            let end_time_secs = {
                let mut bucket_values = time_buckets.values();
                let first = bucket_values
                    .next()
                    .expect("bucket unexpectedly empty")
                    .time;
                bucket_values.next_back().map(|v| v.time).unwrap_or(first)
            };
            if end_time_secs > stats.last_print_time.get() {
                stats.print_summary(end_time_secs, summary_output_format);
            }
        }
        for (i, (stats_id, time_buckets)) in stats.buckets.values().enumerate() {
            let mut summary = {
                let (start_time_secs, mut end_time_secs) = {
                    let mut bucket_values = time_buckets.values();
                    let first = bucket_values
                        .next()
                        .expect("bucket unexpectedly empty")
                        .time;
                    let last = bucket_values.next_back().map(|v| v.time).unwrap_or(first);
                    (first, last)
                };
                if start_time_secs == end_time_secs {
                    end_time_secs += duration;
                }
                let duration = Duration::from_secs(end_time_secs - start_time_secs);
                AggregateStats::new(start_time_secs, duration)
            };
            for agg_stats in time_buckets.values() {
                summary += &*agg_stats;
            }
            if i == 0 && is_pretty_format {
                eprint!(
                    "{}",
                    Paint::new(format!("\nTest Summary {}\n", create_date_diff(start, end))).bold()
                );
            }
            summary.print_summary(stats_id, summary_output_format, false);
        }
        if let Err(e) = result {
            print_test_error_to_console(e);
        }
        Ok(())
    });
    Ok((tx, receiver))
}
