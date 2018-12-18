use crate::config;
use crate::load_test;
use ansi_term::{Color, Style};
use chrono::{DateTime, Local, NaiveDateTime, Utc};
use fnv::FnvHashMap;
use futures::{
    Future,
    Stream,
    sync::mpsc as futures_channel,
};
use hdrhistogram::Histogram;
use hyper::Method;
use parking_lot::Mutex;
use serde::{Serialize};
use serde_derive::{Serialize, Deserialize};
use serde_json as json;
use tokio::{
    fs::File as TokioFile,
    timer::Interval,
};
use url::Url;

use std::{
    cell::Cell,
    cmp,
    collections::BTreeMap,
    ops::AddAssign,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH}
};

mod histogram_serde {
    use base64;
    use hdrhistogram::{Histogram, serialization::{Deserializer as HDRDeserializer, Serializer as HDRSerializer, V2Serializer}};
    use serde::{self, Deserialize, Serializer, Deserializer};

    pub fn serialize<S>(
        histogram: &Histogram<u64>,
        serializer: S,
    ) -> Result<S::Ok, S::Error>
    where S: Serializer,
    {
        let mut buf = Vec::new();
        let mut v2_serializer = V2Serializer::new();
        v2_serializer.serialize(&histogram, &mut buf)
            .map_err(|_e| serde::ser::Error::custom("could not serialize HDRHistogram"))?;
        serializer.serialize_str(&base64::encode_config(&buf, base64::STANDARD_NO_PAD))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Histogram<u64>, D::Error>
    where D: Deserializer<'de>,
    {
        let string = String::deserialize(deserializer)?;
        let bytes = base64::decode_config(&string, base64::STANDARD_NO_PAD)
            .map_err(|_| serde::de::Error::custom("could not base64 decode string for HDRHistogram"))?;
        let mut hdr_deserializer = HDRDeserializer::new();
        hdr_deserializer.deserialize(&mut bytes.to_vec().as_slice())
            .map_err(|_| serde::de::Error::custom("could not deserialize HDRHistogram"))
    }
}

mod buckets_serde {
    use std::collections::BTreeMap;
    use serde::{Deserialize, Serialize, Serializer, Deserializer};
    use super::AggregateStats;

    type BucketValuesSer = (BTreeMap<String, String>, Vec<AggregateStats>);
    type BucketValues = (BTreeMap<String, String>, BTreeMap<u64, AggregateStats>);
    type Buckets = BTreeMap<usize, BucketValues>;

    pub fn serialize<S>(
        buckets: &Buckets,
        serializer: S,
    ) -> Result<S::Ok, S::Error>
    where S: Serializer,
    {
        let values: Vec<(&BTreeMap<String, String>, Vec<&AggregateStats>)> = buckets.values()
            .map(|(stats_id, stats_map)|
                (stats_id, stats_map.values().collect())
            )
            .collect();
        values.serialize(serializer)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Buckets, D::Error>
    where D: Deserializer<'de>,
    {
        let values: Vec<BucketValuesSer> = Vec::deserialize(deserializer)?;
        Ok(values.into_iter()
            .map(|(k, v)| {
                let v = v.into_iter()
                    .map(|v| (v.time, v))
                    .collect();
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

    fn append(&mut self, mut stat: ResponseStat) {
        let key = stat.key.take();
        let duration = self.duration;
        let time = to_epoch(stat.time) / duration * duration;
        let (stats_id, stats_map) = self.buckets.entry(stat.endpoint_id)
            .or_insert_with(|| {
                let mut stats_map = BTreeMap::new();
                stats_map.insert(time, AggregateStats::new(time, Duration::from_secs(duration)));
                (
                    key.unwrap_or_default(),
                    stats_map
                )
            });
        stats_id.entry("url".into())
            .and_modify(|url| {
                let mut url_a = Url::parse(url).expect("invalid url");
                let url_b = Url::parse(&stat.url).expect("invalid url");
                let mut path = String::new();
                for (a, b) in url_a.path_segments().expect("invalid url").zip(url_b.path_segments().expect("invalid url")) {
                    if a != b {
                        path.push_str("/*");
                    } else {
                        path.push_str(&format!("/{}", a));
                    }
                }
                url_a.set_path(&path);
                let mut query_params: BTreeMap<String, String> = url_a.query_pairs()
                    .map(|(k, v)| (k.into(), v.into()))
                    .collect();
                for (k, v) in url_b.query_pairs() {
                    query_params.entry(k.into())
                        .and_modify(|v2| {
                            if v != v2.as_str() {
                                *v2 = "*".into();
                            }
                        })
                        .or_insert_with(|| v.into());
                }
                if !query_params.is_empty() {
                    let mut query_params: Vec<_> = query_params.iter().collect();
                    query_params.sort_unstable_by_key(|t| t.0);
                    url_a.query_pairs_mut()
                        .clear().extend_pairs(query_params);
                }
                *url = url_a.into_string();
            })
            .or_insert_with(|| {
                stat.url.clone()
            });
        stats_id.entry("method".into())
            .or_insert_with(|| stat.method.to_string());
        let current = stats_map.entry(time)
            .or_insert_with(|| AggregateStats::new(time, Duration::from_secs(duration)));
        *current += stat;
    }

    fn persist(&self) -> impl Future<Item=(), Error=()> {
        let stats = self.clone();
        TokioFile::create(format!("stats-{}.json", self.time))
            .and_then(move |mut file| {
                if let Err(e) = stats.serialize(&mut json::Serializer::new(&mut file)) {
                    eprint!("{}", format!("error persisting stats {:?}\n", e))
                }
                Ok(())
            }).or_else(|e| {
                eprint!("{}", format!("error persisting stats {:?}\n", e));
                Ok(())
            })
    }

    fn print_summary(&self, time: u64, summary_output_format: config::SummaryOutputFormats) {
        let mut printed = false;
        self.last_print_time.set(time);
        let is_pretty_format = summary_output_format.is_pretty();
        if is_pretty_format {
            eprint!("{}", Style::new().bold().paint(format!("\nBucket Summary {}\n", create_date_diff(time, time + self.duration))));
        }
        for (stats_id, stats_map) in self.buckets.values() {
            if let Some(stats) = stats_map.get(&time) {
                if !printed {
                    printed = true;
                }
                stats.print_summary(
                    stats_id,
                    summary_output_format,
                    true
                );
            }
        }
        if is_pretty_format {
            if !printed {
                eprint!("{}", "no data\n");
            }
            if let Some(et) = self.end_time.get() {
                if et > Instant::now() {
                    let test_end_msg = load_test::duration_till_end_to_pretty_string(et - Instant::now());
                    eprint!("{}", format!("\n{}\n", test_end_msg));
                }
            }
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
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

impl AddAssign<ResponseStat> for AggregateStats {
    fn add_assign(&mut self, rhs: ResponseStat) {
        let time = to_epoch(rhs.time);
        if self.start_time == 0 {
            self.start_time = time;
        }
        self.end_time = cmp::max(self.end_time, time);
        match rhs.kind {
            StatKind::ConnectionError(description) => {
                self.connection_errors.entry(description)
                    .and_modify(|count| *count += 1)
                    .or_insert(1);
            }
            StatKind::Rtt((rtt, status)) => {
                self.rtt_histogram += rtt;
                self.status_counts.entry(status)
                    .and_modify(|n| { *n += 1 } )
                    .or_insert(1);
            },
            StatKind::Timeout(to) => {
                self.rtt_histogram += to;
                self.request_timeouts += 1
            },
        }
    }
}

impl AddAssign<&AggregateStats> for AggregateStats {
    fn add_assign(&mut self, rhs: &AggregateStats) {
        self.time = cmp::min(self.time, rhs.time);
        self.start_time = cmp::min(self.start_time, rhs.start_time);
        self.end_time = cmp::max(self.end_time, rhs.end_time);
        self.rtt_histogram += &rhs.rtt_histogram;
        for (status, count) in &rhs.status_counts {
            self.status_counts.entry(*status)
                .and_modify(|n| *n += count)
                .or_insert(*count);
        }
        for (description, count) in &rhs.connection_errors {
            self.connection_errors.entry(description.clone())
                    .and_modify(|n| *n += count)
                    .or_insert(*count);
        }
        self.request_timeouts += rhs.request_timeouts;
    }
}

fn get_epoch() -> u64 {
    UNIX_EPOCH.elapsed()
        .expect("error in system time. Time skew.")
        .as_secs()
}

fn to_epoch(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).expect("error in system time. Time skew.")
        .as_secs()
}

fn create_date_diff(start: u64, end: u64) -> String {
    let start = DateTime::<Utc>::from_utc(NaiveDateTime::from_timestamp(start as i64, 0), Utc)
        .with_timezone(&Local);
    let end = DateTime::<Utc>::from_utc(NaiveDateTime::from_timestamp((end) as i64, 0), Utc)
        .with_timezone(&Local);
    let fmt2 = "%R %-e-%b-%Y";
    let fmt = if start.date() == end.date() {
        "%R"
    } else {
        fmt2
    };
    format!("{} to {}", start.format(&fmt), end.format(&fmt2))
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

    fn print_summary(&self, stats_id: &StatsId, format: config::SummaryOutputFormats, bucket_summary: bool) {
        let calls_made = self.rtt_histogram.len() + self.request_timeouts;
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
                eprint!("{}", Color::Yellow.dimmed().paint(format!("\n- {} {}:\n", method, url)));
                eprint!("{}", format!("  calls made: {}\n", calls_made));
                eprint!("{}", format!("  status counts: {:?}\n", self.status_counts));
                if self.request_timeouts > 0 {
                    eprint!("{}", format!("  request timeouts: {:?}\n", self.request_timeouts));
                }
                if !self.connection_errors.is_empty() {
                    eprint!("{}", format!("  connection errors: {:?}\n", self.connection_errors));
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
            },
            config::SummaryOutputFormats::Json => {
                let summary_type = if bucket_summary {
                    "bucket"
                } else {
                    "test"
                };
                let output = json::json!({
                    "startTime": self.time,
                    "time": self.time + self.duration,
                    "summaryType": summary_type,
                    "method": method,
                    "url": url,
                    "callCount": calls_made,
                    "statusCounts": self.status_counts,
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
    }
}

pub enum StatsMessage {
    ResponseStat(ResponseStat),
    EndTime(Instant),
}

type StatsKey = BTreeMap<String, String>;

#[derive(Debug)]
pub struct ResponseStat {
    pub endpoint_id: EndpointId,
    pub key: Option<StatsKey>,
    pub method: Method,
    pub kind: StatKind,
    pub time: SystemTime,
    pub url: String,
}

#[derive(Debug)]
pub enum StatKind{
    ConnectionError(String),
    Rtt((u64, u16)),
    Timeout(u64),
}

impl From<ResponseStat> for StatsMessage {
    fn from(rs: ResponseStat) -> Self {
        StatsMessage::ResponseStat(rs)
    }
}

pub fn create_stats_channel<F>(test_complete: F, config: &config::GeneralConfig)
    -> (
        futures_channel::UnboundedSender<StatsMessage>,
        impl Future<Item = (), Error = ()> + Send,
        )
    where F: Future + Send + 'static
{
    let (tx, rx) = futures_channel::unbounded::<StatsMessage>();
    let now = Instant::now();
    let start_sec = get_epoch();
    let bucket_size = config.bucket_size;
    let start_bucket = start_sec / bucket_size.as_secs() * bucket_size.as_secs();
    let next_bucket = Duration::from_millis((bucket_size.as_secs() - (start_sec - start_bucket)) * 1000 + 1);
    let stats = Arc::new(Mutex::new(RollingAggregateStats::new(start_bucket, bucket_size)));
    let stats2 = stats.clone();
    let stats3 = stats.clone();
    let stats4 = stats.clone();
    let summary_output_format = config.summary_output_format;
    let is_pretty_format = summary_output_format.is_pretty();
    let print_stats = Interval::new(now + next_bucket, bucket_size)
        .map_err(|_| ())
        .for_each(move |_| {
            let stats = stats4.lock();
            let prev_time = get_epoch() / stats.duration * stats.duration - stats.duration;
            stats.print_summary(prev_time, summary_output_format);
            Ok(())
        });
    let receiver = Stream::for_each(rx, move |datum| {
            let mut stats = stats.lock();
            match datum {
                StatsMessage::EndTime(end_time) => stats.end_time.set(Some(end_time)),
                StatsMessage::ResponseStat(rs) => stats.append(rs),
            }
            Ok(())
        })
        .join(print_stats)
        .map(|_| ())
        .select(test_complete.then(|_| Ok(())))
        .then(move |_| stats2.lock().persist())
        .then(move |_| {
            let stats = stats3.lock();
            let duration = stats.duration;
            let (start, mut end) = stats.buckets.values()
                .map(|(_, time_buckets)| {
                    let mut bucket_values = time_buckets.values();
                    let first = bucket_values.next().expect("bucket unexpectedly empty").time;
                    let last = bucket_values.next_back()
                        .map(|v| v.time).unwrap_or(first);
                    (first, last)
                }).fold((u64::max_value(), 0), |(a1, b1), (a2, b2)| (cmp::min(a1, a2), cmp::max(b1, b2)));
            end += duration;
            for (i, (stats_id, time_buckets)) in stats.buckets.values().enumerate() {
                let mut summary = {
                    let (start_time_secs, mut end_time_secs) = {
                        let mut bucket_values = time_buckets.values();
                        let first = bucket_values.next().expect("bucket unexpectedly empty").time;
                        let last = bucket_values.next_back()
                            .map(|v| v.time).unwrap_or(first);
                        (first, last)
                    };
                    if start_time_secs == end_time_secs {
                        end_time_secs += duration;
                    }
                    if end_time_secs > stats.last_print_time.get() {
                        stats.print_summary(end_time_secs, summary_output_format);
                    }
                    let duration = Duration::from_secs(end_time_secs - start_time_secs);
                    AggregateStats::new(start_time_secs, duration)
                };
                for agg_stats in time_buckets.values() {
                    summary += &*agg_stats;
                }
                if i == 0 && is_pretty_format {
                    eprint!("{}", Style::new().bold().paint(format!("\nTest Summary {}\n", create_date_diff(start, end))));
                }
                summary.print_summary(
                    stats_id,
                    summary_output_format,
                    false
                );
            }
            Ok(())
        });
    (tx, receiver)
}
