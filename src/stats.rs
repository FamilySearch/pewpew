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
use serde_json::{Serializer};
use tokio::{
    fs::File as TokioFile,
    timer::Interval,
};
use url::Url;

use std::{
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
    duration: u64,
    time: u64,
}

impl RollingAggregateStats {
    fn new (time: u64, duration: Duration) -> Self {
        RollingAggregateStats {
            buckets: BTreeMap::new(),
            duration: duration.as_secs(),
            time,
        }
    }

    fn append (&mut self, stat: &mut ResponseStat) {
        let key = stat.key.take();
        let duration = self.duration;
        let time = stat.time.duration_since(UNIX_EPOCH).expect("error in system time. Time skew.")
            .as_secs() / duration * duration;
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
        *current += &*stat;
    }

    fn persist (&self) -> impl Future<Item=(), Error=()> {
        let stats = self.clone();
        TokioFile::create(format!("stats-{}.json", self.time))
            .and_then(move |mut file| {
                if let Err(e) = stats.serialize(&mut Serializer::new(&mut file)) {
                    eprint!("{}", format!("error persisting stats {:?}\n", e))
                }
                Ok(())
            }).or_else(|e| {
                eprint!("{}", format!("error persisting stats {:?}\n", e));
                Ok(())
            })
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AggregateStats {
    duration: u64,
    #[serde(with = "histogram_serde")]
    rtt_histogram: Histogram<u64>,
    status_counts: FnvHashMap<u16, u64>,
    time: u64,
}

impl AddAssign<&ResponseStat> for AggregateStats {
    fn add_assign (&mut self, rhs: &ResponseStat) {
        self.rtt_histogram += rhs.rtt;
        self.status_counts.entry(rhs.status)
            .and_modify(|n| { *n += 1 } )
            .or_insert(1);
    }
}

impl AddAssign<&AggregateStats> for AggregateStats {
    fn add_assign (&mut self, rhs: &AggregateStats) {
        self.rtt_histogram += &rhs.rtt_histogram;
        for (status, count) in &rhs.status_counts {
            self.status_counts.entry(*status)
                .and_modify(|n| { *n += count } )
                .or_insert(*count);
        }
    }
}

fn get_epoch() -> u64 {
    UNIX_EPOCH.elapsed()
        .expect("error in system time. Time skew.")
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
    fn new (time: u64, duration: Duration) -> Self {
        AggregateStats {
            time,
            duration: duration.as_secs(),
            rtt_histogram: Histogram::new(3).expect("could not create histogram"),
            status_counts: FnvHashMap::default(),
        }
    }

    fn print_summary (&self, method: &str, url: &str) {
        eprint!("{}", Color::Yellow.dimmed().paint(format!("\n- {} {}:\n", method, url)));
        eprint!("{}", format!("  calls made: {}\n", self.rtt_histogram.len()));
        eprint!("{}", format!("  status counts: {:?}\n", self.status_counts));
        eprint!(
            "{}",
            format!(
                "  p50: {}ms, p90: {}ms, p95: {}ms, p99: {}ms, p99.9: {}ms\n",
                self.rtt_histogram.value_at_quantile(0.5),
                self.rtt_histogram.value_at_quantile(0.90),
                self.rtt_histogram.value_at_quantile(0.95),
                self.rtt_histogram.value_at_quantile(0.99),
                self.rtt_histogram.value_at_quantile(0.999),
            )
        );
        eprint!(
            "{}",
            format!(
                "  min: {}ms, max: {}ms, avg: {:.2}ms, std. dev: {:.2}ms\n",
                self.rtt_histogram.min(),
                self.rtt_histogram.max(),
                self.rtt_histogram.mean(),
                self.rtt_histogram.stdev(),
            )
        );
    }
}

pub enum StatsMessage {
    ResponseStat(ResponseStat),
    EndTime(Instant),
}

#[derive(Debug)]
pub struct ResponseStat {
    pub endpoint_id: EndpointId,
    pub key: Option<BTreeMap<String, String>>,
    pub method: Method,
    pub rtt: u64,
    pub status: u16,
    pub time: SystemTime,
    pub url: String,
}

impl From<ResponseStat> for StatsMessage {
    fn from(rs: ResponseStat) -> Self {
        StatsMessage::ResponseStat(rs)
    }
}

pub fn create_stats_channel<F>(test_complete: F)
    -> (
        futures_channel::UnboundedSender<StatsMessage>,
        impl Future<Item = (), Error = ()> + Send,
        )
    where F: Future + Send + 'static
{
    let (tx, rx) = futures_channel::unbounded::<StatsMessage>();
    let now = Instant::now();
    let start_sec = get_epoch();
    let start_minute = start_sec / 60 * 60;
    let next_minute = Duration::from_millis((60 - (start_sec - start_minute)) * 1000 + 1);
    let stats = Arc::new(Mutex::new(RollingAggregateStats::new(start_minute, Duration::from_secs(60))));
    let stats2 = stats.clone();
    let stats3 = stats.clone();
    let stats4 = stats.clone();
    let end_time: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));
    let end_time2 = end_time.clone();
    let print_stats = Interval::new(now + next_minute, Duration::from_secs(60))
        .map_err(|_| ())
        .for_each(move |_| {
            let stats = stats4.lock();
            let mut printed = false;
            let prev_time = get_epoch() / stats.duration * stats.duration - stats.duration;
            eprint!("{}", Style::new().bold().paint(format!("\nMinute Summary {}\n", create_date_diff(prev_time, prev_time + stats.duration))));
            for (stats_id, stats_map) in stats.buckets.values() {
                if let Some(stats) = stats_map.get(&prev_time) {
                    if !printed {
                        printed = true;
                    }
                    stats.print_summary(
                        stats_id.get("method").expect("stats_id missing `method`"),
                        stats_id.get("url").expect("stats_id missing `url`")
                    );
                }
            }
            if !printed {
                eprint!("{}", "no data\n");
            }
            if let Some(et) = *end_time.lock() {
                if et > Instant::now() {
                    let test_end_msg = load_test::duration_till_end_to_pretty_string(et - Instant::now());
                    eprint!("{}", format!("\n{}\n", test_end_msg));
                }
            }
            Ok(())
        });
    let receiver = Stream::for_each(rx, move |datum| {
            match datum {
                StatsMessage::ResponseStat(mut rs) => stats.lock().append(&mut rs),
                StatsMessage::EndTime(end_time) => *end_time2.lock() = Some(end_time),
            }
            Ok(())
        })
        .join(print_stats)
        .map(|_| ())
        .select(test_complete.then(|_| Ok(())))
        .then(move |_| stats2.lock().persist())
        .then(move |_| {
            let mut stats = stats3.lock();
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
            eprint!("{}", Style::new().bold().paint(format!("\nTest Summary {}\n", create_date_diff(start, end))));
            for (stats_id, time_buckets) in stats.buckets.values_mut() {
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
                    let duration = Duration::from_secs(end_time_secs - start_time_secs);
                    AggregateStats::new(start_time_secs, duration)
                };
                for agg_stats in time_buckets.values() {
                    summary += &*agg_stats;
                }
                summary.print_summary(
                    stats_id.get("method").expect("stats_id missing `method`"),
                    stats_id.get("url").expect("stats_id missing `url`"));
            }
            Ok(())
        });
    (tx, receiver)
}
