use crate::error::{RecoverableError, TestError};
use crate::providers;
use crate::TestEndReason;
use crate::{RunConfig, RunOutputFormat};

use chrono::{DateTime, Duration as ChronoDuration, Local, NaiveDateTime, Utc};
use ether::Either;
use futures::{
    future::Shared,
    sync::mpsc::{self as futures_channel, Sender as FCSender},
    Future, IntoFuture, Sink, Stream,
};
use hdrhistogram::Histogram;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize, Serializer};
use serde_json as json;
use tokio::{
    fs::File as TokioFile,
    io::{write_all, AsyncWrite},
    timer::Interval,
};
use yansi::Paint;

use std::{
    cell::Cell,
    cmp,
    collections::{BTreeMap, HashMap},
    ops::AddAssign,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

mod histogram_serde {
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

type StatsId = BTreeMap<String, String>;
type Buckets = BTreeMap<StatsId, BTreeMap<u64, AggregateStats>>;

pub fn serialize_buckets<S>(buckets: &Buckets, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let values: Vec<_> = buckets
        .iter()
        .map(|(k, v)| {
            let v: Vec<_> = v.values().collect();
            (k, v)
        })
        .collect();
    values.serialize(serializer)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RollingAggregateStats {
    #[serde(serialize_with = "serialize_buckets")]
    buckets: Buckets,
    #[serde(skip_serializing)]
    duration: u64,
    #[serde(skip)]
    end_time: Option<Instant>,
    #[serde(skip)]
    file_name: PathBuf,
    #[serde(skip_serializing)]
    last_print_time: Cell<u64>,
    #[serde(skip)]
    start_time: Option<Instant>,
    test_name: Option<String>,
}

impl RollingAggregateStats {
    fn new(duration: Duration, file_name: PathBuf, test_name: Option<String>) -> Self {
        RollingAggregateStats {
            buckets: BTreeMap::new(),
            duration: duration.as_secs(),
            end_time: None,
            file_name,
            last_print_time: Cell::new(0),
            start_time: None,
            test_name,
        }
    }

    fn append(&mut self, stat: ResponseStat) -> Option<String> {
        let duration = self.duration;
        let time = to_epoch(stat.time) / duration * duration;
        let stats_map = loop {
            if let Some(sm) = self.buckets.get_mut(&stat.tags) {
                break sm;
            }
            let duration = self.duration;
            let mut stats_map = BTreeMap::new();
            stats_map.insert(
                time,
                AggregateStats::new(time, Duration::from_secs(duration)),
            );
            self.buckets.insert((*stat.tags).clone(), stats_map);
        };
        let current = stats_map
            .entry(time)
            .or_insert_with(|| AggregateStats::new(time, Duration::from_secs(duration)));
        current.append_response_stat(stat)
    }

    fn persist<C: AsyncWrite + Send + Sync + 'static>(
        &self,
        console: C,
    ) -> impl Future<Item = (), Error = TestError> {
        let stats = self.clone();
        TokioFile::create(self.file_name.clone())
            .map_err(Either::A)
            .and_then(move |mut file| {
                stats
                    .serialize(&mut json::Serializer::new(&mut file))
                    .map_err(Either::B)
            })
            .or_else(|e| {
                write_all(console, format!("error persisting stats {:?}\n", e)).then(|_| Ok(()))
            })
    }

    fn generate_summary(&self, time: u64, output_format: RunOutputFormat) -> String {
        let mut printed = false;
        self.last_print_time.set(time);
        let is_pretty_format = output_format.is_human();
        let mut print_string = if is_pretty_format {
            format!(
                "{}",
                Paint::new(format!(
                    "\nBucket Summary {}\n",
                    create_date_diff(time, time + self.duration)
                ))
                .bold()
            )
        } else {
            String::new()
        };
        for (tags, stats_map) in &self.buckets {
            if let Some(stats) = stats_map.get(&time) {
                let piece = stats.print_summary(tags, output_format, true);
                print_string.push_str(&piece);
                if !printed && !piece.is_empty() {
                    printed = true;
                }
            }
        }
        if is_pretty_format {
            if !printed {
                print_string.push_str("no data\n");
            }
            if let Some(et) = self.end_time {
                if et > Instant::now() {
                    let test_end_msg = duration_till_end_to_pretty_string(et - Instant::now());
                    let piece = format!("\n{}\n", test_end_msg);
                    print_string.push_str(&piece);
                }
            }
        }
        print_string
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AggregateStats {
    duration: u64, // in seconds
    end_time: u64, // epoch in seconds, when the last request was logged
    request_timeouts: u64,
    #[serde(with = "histogram_serde")]
    rtt_histogram: Histogram<u64>,
    start_time: u64, // epoch in seconds, when the first request was logged
    status_counts: BTreeMap<u16, u64>,
    test_errors: HashMap<String, u64>,
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
        for (description, count) in &rhs.test_errors {
            self.test_errors
                .entry(description.clone())
                .and_modify(|n| *n += count)
                .or_insert(*count);
        }
        self.request_timeouts += rhs.request_timeouts;
    }
}

fn get_epoch() -> u64 {
    UNIX_EPOCH
        .elapsed()
        .map(|d| d.as_secs())
        .unwrap_or_default()
}

fn to_epoch(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default()
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
            duration: duration.as_secs(),
            end_time: 0,
            request_timeouts: 0,
            rtt_histogram: Histogram::new(3).expect("could not create histogram"),
            start_time: 0,
            status_counts: BTreeMap::new(),
            test_errors: HashMap::default(),
            time,
        }
    }

    fn append_response_stat(&mut self, rhs: ResponseStat) -> Option<String> {
        let time = to_epoch(rhs.time);
        if self.start_time == 0 {
            self.start_time = time;
        }
        self.end_time = cmp::max(self.end_time, time);
        let mut warning = None;
        match rhs.kind {
            StatKind::RecoverableError(RecoverableError::Timeout(..)) => self.request_timeouts += 1,
            StatKind::RecoverableError(r) => {
                let msg = format!("{}", r);
                warning = Some(msg.clone());
                self.test_errors
                    .entry(msg)
                    .and_modify(|n| *n += 1)
                    .or_insert(1);
            }
            StatKind::Response(status) => {
                self.status_counts
                    .entry(status)
                    .and_modify(|n| *n += 1)
                    .or_insert(1);
            }
        }
        if let Some(rtt) = rhs.rtt {
            self.rtt_histogram += rtt;
        }
        warning
    }

    fn print_summary(
        &self,
        tags: &StatsId,
        format: RunOutputFormat,
        bucket_summary: bool,
    ) -> String {
        let calls_made = self.rtt_histogram.len();
        let mut print_string = String::new();
        if calls_made == 0 && self.test_errors.is_empty() && self.request_timeouts == 0 {
            return print_string;
        }
        const MICROS_TO_MS: f64 = 1_000.0;
        let method = tags.get("method").expect("tags missing `method`");
        let url = tags.get("url").expect("tags missing `url`");
        let p50 = self.rtt_histogram.value_at_quantile(0.5) as f64 / MICROS_TO_MS;
        let p90 = self.rtt_histogram.value_at_quantile(0.90) as f64 / MICROS_TO_MS;
        let p95 = self.rtt_histogram.value_at_quantile(0.95) as f64 / MICROS_TO_MS;
        let p99 = self.rtt_histogram.value_at_quantile(0.99) as f64 / MICROS_TO_MS;
        let p99_9 = self.rtt_histogram.value_at_quantile(0.999) as f64 / MICROS_TO_MS;
        let min = self.rtt_histogram.min() as f64 / MICROS_TO_MS;
        let max = self.rtt_histogram.max() as f64 / MICROS_TO_MS;
        let mean = self.rtt_histogram.mean().round() / MICROS_TO_MS;
        let stddev = self.rtt_histogram.stdev().round() / MICROS_TO_MS;
        match format {
            RunOutputFormat::Human => {
                let piece = format!(
                    "\n{}\n  calls made: {}\n  status counts: {:?}\n",
                    Paint::yellow(format!("- {} {}:", method, url)).dimmed(),
                    calls_made,
                    self.status_counts
                );
                print_string.push_str(&piece);
                if self.request_timeouts > 0 {
                    let piece = format!("  request timeouts: {:?}\n", self.request_timeouts);
                    print_string.push_str(&piece);
                }
                if !self.test_errors.is_empty() {
                    let piece = format!("  test errors: {:?}\n", self.test_errors);
                    print_string.push_str(&piece);
                }
                let piece = format!(
                    "  p50: {}ms, p90: {}ms, p95: {}ms, p99: {}ms, p99.9: {}ms\n  \
                     min: {}ms, max: {}ms, avg: {}ms, std. dev: {}ms\n",
                    p50, p90, p95, p99, p99_9, min, max, mean, stddev
                );
                print_string.push_str(&piece);
            }
            RunOutputFormat::Json => {
                let summary_type = if bucket_summary { "bucket" } else { "test" };
                let output = json::json!({
                    "type": "summary",
                    "startTime": self.time,
                    "timestamp": self.time + self.duration,
                    "summaryType": summary_type,
                    "method": method,
                    "url": url,
                    "callCount": calls_made,
                    "statusCounts":
                        self.status_counts.iter()
                            .map(|(status, count)| json::json!({ "status": status, "count": count }))
                            .collect::<Vec<_>>(),
                    "requestTimeouts": self.request_timeouts,
                    "testErrors":
                        self.test_errors.iter()
                            .map(|(error, count)| json::json!({ "error": error, "count": count }))
                            .collect::<Vec<_>>(),
                    "testErrorCount":
                        self.test_errors.iter()
                            .fold(0, |sum, (_, c)| sum + c),
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
                        tags.iter()
                            .filter(|(k, _)| k.as_str() != "method" && k.as_str() != "url")
                            .collect::<BTreeMap<_, _>>(),
                });
                let piece = format!("{}\n", output);
                print_string.push_str(&piece);
            }
        }
        print_string
    }
}

#[derive(Debug)]
pub enum StatsMessage {
    // every time a response is received or an endpoint error occurs
    ResponseStat(ResponseStat),
    // sent at the beginning of the test
    Start(Duration),
}

#[derive(Debug)]
pub struct ResponseStat {
    pub kind: StatKind,
    pub rtt: Option<u64>,
    pub time: SystemTime,
    pub tags: Arc<StatsId>,
}

#[derive(Debug)]
pub enum StatKind {
    RecoverableError(RecoverableError),
    Response(u16),
}

impl From<ResponseStat> for StatsMessage {
    fn from(rs: ResponseStat) -> Self {
        StatsMessage::ResponseStat(rs)
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

pub fn create_try_run_stats_channel<F, C, Cf>(
    test_complete: Shared<F>,
    console: Cf,
) -> (
    futures_channel::UnboundedSender<StatsMessage>,
    impl Future<Item = (), Error = ()> + Send,
)
where
    F: Future<Item = TestEndReason, Error = TestError> + Send + 'static,
    C: AsyncWrite + Send + Sync + 'static,
    Cf: Fn() -> C + Clone + Send + Sync + 'static,
{
    let aggregates = AggregateStats::new(0, Duration::from_secs(0));
    let (tx, rx) = futures_channel::unbounded::<StatsMessage>();
    let console2 = console.clone();
    let f = rx
        .fold(aggregates, move |mut summary, s| {
            let mut msg = None;
            if let StatsMessage::ResponseStat(rs) = s {
                let tags = rs.tags.clone();
                if let Some(s) = summary.append_response_stat(rs) {
                    let method = tags.get("method").expect("tags missing `method`");
                    let url = tags.get("url").expect("tags missing `url`");
                    let endpoint = format!("{} {}", method, url);
                    msg = Some(format!(
                        "{}",
                        Paint::yellow(format!(
                            "WARNING - recoverable error happened on endpoint `{}`: {}\n",
                            endpoint, s
                        ))
                    ));
                }
            }
            if let Some(msg) = msg {
                let b = write_all(console(), msg).then(move |_| Ok(summary));
                Either::B(b)
            } else {
                Either::A(Ok(summary).into_future())
            }
        })
        .and_then(move |stats| {
            let mut output = format!(
                "{}\n  calls made: {}\n  status counts: {:?}",
                Paint::yellow("Try run summary:"),
                stats.rtt_histogram.len(),
                stats.status_counts
            );
            if stats.request_timeouts > 0 {
                let piece = format!("\n  request timeouts: {:?}", stats.request_timeouts);
                output.push_str(&piece);
            }
            if !stats.test_errors.is_empty() {
                let piece = format!("\n  test errors: {:?}", stats.test_errors);
                output.push_str(&piece);
            }
            output.push('\n');
            write_all(console2(), output).then(|_| Ok(()))
        })
        .join(test_complete.then(|_| Ok::<_, ()>(())))
        .then(|_| Ok(()));
    (tx, f)
}

fn create_provider_stats_printer<C, Cf>(
    providers: &BTreeMap<String, providers::Provider>,
    interval: Duration,
    now: Instant,
    start_sec: u64,
    output_format: RunOutputFormat,
    console: Cf,
) -> impl Future<Item = (), Error = TestError>
where
    C: AsyncWrite + Send + Sync + 'static,
    Cf: Fn() -> C + Clone + Send + Sync + 'static,
{
    let first_print = start_sec / interval.as_secs() * interval.as_secs();
    let start_print =
        Duration::from_millis((interval.as_secs() - (start_sec - first_print)) * 1000 + 1);
    let providers: Vec<_> = providers
        .iter()
        .map(|(name, kind)| channel::ChannelStatsReader::new(name.clone(), &kind.rx))
        .collect();
    Interval::new(now + start_print, interval)
        .map_err(|_| unreachable!("something happened while printing stats"))
        .for_each(move |_| {
            let time = Local::now();
            let is_human_format = output_format.is_human();
            let mut string_to_print = if is_human_format {
                format!(
                    "{}",
                    Paint::new(format!(
                        "\nProvider Stats {}\n",
                        time.format("%T %-e-%b-%Y")
                    ))
                    .bold()
                )
            } else {
                String::new()
            };
            let time = time.timestamp();
            for reader in providers.iter() {
                let stats = reader.get_stats(time);
                let piece = if is_human_format {
                    format!(
                        "\n- {}:\n  length: {}\n  limit: {}\n  \
                         tasks waiting to send: {}\n  tasks waiting to receive: {}\n  \
                         number of receivers: {}\n  number of senders: {}\n",
                        Paint::yellow(stats.provider).dimmed(),
                        stats.len,
                        stats.limit,
                        stats.waiting_to_send,
                        stats.waiting_to_receive,
                        stats.receiver_count,
                        stats.sender_count,
                    )
                } else {
                    let mut s =
                        json::to_string(&stats).expect("could not serialize provider stats");
                    s.push('\n');
                    s
                };
                string_to_print.push_str(&piece);
            }
            write_all(console(), string_to_print).then(|_| Ok(()))
        })
}

pub fn create_stats_channel<F, Sef, Se>(
    test_complete: Shared<F>,
    test_killer: FCSender<Result<TestEndReason, TestError>>,
    config: &config::GeneralConfig,
    providers: &BTreeMap<String, providers::Provider>,
    console: Sef,
    run_config: &RunConfig,
) -> Result<
    (
        futures_channel::UnboundedSender<StatsMessage>,
        impl Future<Item = (), Error = ()> + Send,
    ),
    TestError,
>
where
    F: Future<Item = TestEndReason, Error = TestError> + Send + 'static,
    Se: AsyncWrite + Send + Sync + 'static,
    Sef: Fn() -> Se + Clone + Send + Sync + 'static,
{
    let (tx, rx) = futures_channel::unbounded::<StatsMessage>();
    let now = Instant::now();
    let start_sec = get_epoch();
    let bucket_size = config.bucket_size;
    let start_bucket = start_sec / bucket_size.as_secs() * bucket_size.as_secs();
    let next_bucket =
        Duration::from_millis((bucket_size.as_secs() - (start_sec - start_bucket)) * 1000 + 1);
    let test_name = run_config
        .config_file
        .file_stem()
        .and_then(std::ffi::OsStr::to_str);
    let file_path = run_config.stats_file.clone();
    let stats = Arc::new(Mutex::new(RollingAggregateStats::new(
        bucket_size,
        file_path,
        test_name.map(str::to_string),
    )));
    let stats2 = stats.clone();
    let stats3 = stats.clone();
    let stats4 = stats.clone();
    let output_format = run_config.output_format;
    let is_human_format = output_format.is_human();
    let console2 = console.clone();
    let console3 = console.clone();
    let console4 = console.clone();
    let print_stats = Interval::new(now + next_bucket, bucket_size)
        .map_err(|_e| unreachable!("something happened while printing stats"))
        .for_each(move |_| {
            let stats = stats4.lock();
            let epoch = get_epoch();
            let prev_time = epoch / stats.duration * stats.duration - stats.duration;
            let summary = stats.generate_summary(prev_time, output_format);
            let stats4 = stats4.clone();
            let console3 = console3.clone();
            write_all(console3(), summary).then(move |_| {
                stats4
                    .lock()
                    .persist(console3())
                    .then(|_| Ok::<_, TestError>(()))
            })
        });
    let print_stats = if let Some(interval) = config.log_provider_stats {
        let print_provider_stats = create_provider_stats_printer(
            providers,
            interval,
            now,
            start_sec,
            output_format,
            console.clone(),
        );
        let a = print_stats.join(print_provider_stats).map(|_| ());
        Either::A(a)
    } else {
        Either::B(print_stats)
    };
    let receiver = Stream::for_each(
        rx.map_err(|_| unreachable!("Error receiving stats")),
        move |datum| {
            let mut stats = stats.lock();
            match datum {
                StatsMessage::Start(d) => {
                    let (start_time, msg) = if let Some(start_time) = stats.start_time {
                        let msg = if Some(start_time + d) == stats.end_time {
                            String::new()
                        } else {
                            let test_end_message =
                                duration_till_end_to_pretty_string(start_time + d - Instant::now());
                            match output_format {
                                RunOutputFormat::Human => {
                                    format!("Test duration updated. {}\n", test_end_message)
                                }
                                RunOutputFormat::Json => format!(
                                    "{{\"type\":\"duration_updated\",\"msg\":\"{}\"}}\n",
                                    test_end_message
                                ),
                            }
                        };
                        (start_time, msg)
                    } else {
                        let now = Instant::now();
                        let test_end_message = duration_till_end_to_pretty_string(d);
                        let msg = match output_format {
                            RunOutputFormat::Human => {
                                format!("Starting load test. {}\n", test_end_message)
                            }
                            RunOutputFormat::Json => format!(
                                "{{\"type\":\"start\",\"msg\":\"{}\",\"binVersion\":\"{}\"}}\n",
                                test_end_message,
                                clap::crate_version!()
                            ),
                        };
                        (now, msg)
                    };
                    stats.start_time = Some(start_time);
                    stats.end_time = Some(start_time + d);
                    let a = write_all(console(), msg).then(|_| Ok(()));
                    Either::A(a)
                }
                StatsMessage::ResponseStat(rs) => {
                    stats.append(rs);
                    Either::B(Ok::<_, TestError>(()).into_future())
                }
            }
        },
    )
    .join(print_stats)
    .map(|_| TestEndReason::Completed)
    .or_else(move |e| test_killer.send(Err(e.clone())).then(move |_| Err(e)))
    .select(test_complete.map(|e| *e).map_err(|e| (&*e).clone()))
    .map_err(|e| e.0)
    .and_then(move |(b, _)| stats2.lock().persist(console4()).map(move |_| b))
    .then(move |_| {
        let stats = stats3.lock();
        let duration = stats.duration;
        let (start, mut end) = stats
            .buckets
            .values()
            .map(|time_buckets| {
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
        let mut print_string = String::new();
        for time_buckets in stats.buckets.values() {
            let end_time_secs = {
                let mut bucket_values = time_buckets.values();
                let first = bucket_values
                    .next()
                    .expect("bucket unexpectedly empty")
                    .time;
                bucket_values.next_back().map(|v| v.time).unwrap_or(first)
            };
            if end_time_secs > stats.last_print_time.get() {
                let summary = stats.generate_summary(end_time_secs, output_format);
                print_string.push_str(&summary);
            }
        }
        if is_human_format {
            print_string.push_str(&format!(
                "{}",
                Paint::new(format!("\nTest Summary {}\n", create_date_diff(start, end))).bold()
            ))
        };
        for (tags, time_buckets) in &stats.buckets {
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
            let piece = summary.print_summary(&tags, output_format, false);
            print_string.push_str(&piece);
        }
        write_all(console2(), print_string).then(|_| Ok(()))
    });
    Ok((tx, receiver))
}
