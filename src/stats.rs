use crate::error::{RecoverableError, TestError};
use crate::providers;
use crate::TestEndReason;
use crate::{RunConfig, RunOutputFormat};

use bytes::Buf;
use chrono::{DateTime, Duration as ChronoDuration, Local, NaiveDateTime, Utc};
use ether::{Either, Either3};
use futures::{
    future::{join_all, poll_fn, Shared},
    sync::mpsc::{self as futures_channel, Sender as FCSender},
    Async, Future, IntoFuture, Sink, Stream,
};
use hdrhistogram::Histogram;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json as json;
use tokio::{
    fs::File as TokioFile,
    io::{write_all, AsyncWrite},
    timer::Interval,
};
use yansi::Paint;

use std::{
    collections::BTreeMap,
    fs, io, mem,
    path::Path,
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

#[derive(Deserialize, Serialize)]
#[serde(untagged)]
enum FileMessage {
    Header(FileHeader),
    Tags(FileTags),
    Buckets(TimeBucket),
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileHeader {
    test: String,
    bin: String,
    bucket_size: u64,
}

#[derive(Deserialize, Serialize)]
struct FileTags {
    index: usize,
    tags: Tags,
}

#[derive(Clone, Deserialize, Serialize)]
struct TimeBucket {
    time: u64,
    entries: BTreeMap<usize, Bucket>,
}

impl TimeBucket {
    fn new(time: u64) -> Self {
        TimeBucket {
            time,
            entries: BTreeMap::new(),
        }
    }

    fn append(&mut self, stat: ResponseStat, index: usize) {
        let entry = self.entries.entry(index).or_default();
        entry.append(stat);
    }

    fn combine(&mut self, rhs: &TimeBucket) {
        for (index, entry) in &rhs.entries {
            self.entries
                .entry(*index)
                .and_modify(|b| b.combine(entry))
                .or_insert_with(|| entry.clone());
        }
    }

    fn create_print_summary(
        &self,
        tags: &BTreeMap<Tags, usize>,
        format: RunOutputFormat,
        bucket_size: u64,
        test_complete: bool,
    ) -> String {
        let end_time = self.time + bucket_size;
        let summary_type = if test_complete { "Test" } else { "Bucket" };
        let is_pretty_format = format.is_human();
        let mut print_string = if is_pretty_format {
            format!(
                "{}",
                Paint::new(format!(
                    "\n{} Summary {}\n",
                    summary_type,
                    create_date_diff(self.time, end_time)
                ))
                .bold()
            )
        } else {
            String::new()
        };
        let end_time = if test_complete { Some(end_time) } else { None };
        // TODO: should these be ordered?
        for (tags, index) in tags {
            if let Some(bucket) = self.entries.get(index) {
                let piece = bucket.create_print_summary(tags, format, self.time, end_time);
                print_string.push_str(&piece);
            }
        }
        if is_pretty_format {
            if self.entries.is_empty() {
                print_string.push_str("no data\n");
            }
            if let Some(et) = end_time {
                let now = get_epoch();
                if et > now {
                    let test_end_msg =
                        duration_till_end_to_pretty_string(Duration::from_secs(et - now));
                    let piece = format!("\n{}\n", test_end_msg);
                    print_string.push_str(&piece);
                }
            }
        }
        print_string
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Bucket {
    #[serde(skip_serializing_if = "is_zero")]
    request_timeouts: u64,
    #[serde(with = "histogram_serde", skip_serializing_if = "Histogram::is_empty")]
    rtt_histogram: Histogram<u64>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    status_counts: BTreeMap<u16, u64>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    test_errors: BTreeMap<String, u64>,
}

impl Default for Bucket {
    fn default() -> Self {
        Bucket {
            request_timeouts: 0,
            rtt_histogram: Histogram::new(3).expect("could not create histogram"),
            status_counts: Default::default(),
            test_errors: Default::default(),
        }
    }
}

impl Bucket {
    fn append(&mut self, stat: ResponseStat) {
        match stat.kind {
            StatKind::RecoverableError(RecoverableError::Timeout(..)) => self.request_timeouts += 1,
            StatKind::RecoverableError(r) => {
                let msg = format!("{}", r);
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
        if let Some(rtt) = stat.rtt {
            self.rtt_histogram += rtt;
        }
    }

    fn combine(&mut self, rhs: &Bucket) {
        self.request_timeouts += rhs.request_timeouts;
        let _ = self.rtt_histogram.add(&rhs.rtt_histogram);
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
    }

    fn create_print_summary(
        &self,
        tags: &Tags,
        format: RunOutputFormat,
        time: u64,
        end_time: Option<u64>,
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
                let summary_type = if end_time.is_some() { "bucket" } else { "test" };
                let output = json::json!({
                    "type": "summary",
                    "startTime": time,
                    "timestamp": end_time,
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
                    "tags": tags
                });
                let piece = format!("{}\n", output);
                print_string.push_str(&piece);
            }
        }
        print_string
    }
}

#[allow(clippy::trivially_copy_pass_by_ref)]
fn is_zero(n: &u64) -> bool {
    *n == 0
}

struct Stats<C, Cf>
where
    C: AsyncWrite + Send + Sync + 'static,
    Cf: Fn() -> C + Clone + Send + Sync + 'static,
{
    bucket_size: u64,
    current: TimeBucket,
    console: Cf,
    duration: u64,
    file: fs::File,
    format: RunOutputFormat,
    previous: Option<TimeBucket>,
    tags: BTreeMap<Tags, usize>,
    totals: TimeBucket,
}

fn rounded_epoch(bucket_size: u64) -> u64 {
    round_time(get_epoch(), bucket_size)
}

fn round_time(time: u64, bucket_size: u64) -> u64 {
    time / bucket_size * bucket_size
}

impl<C, Cf> Stats<C, Cf>
where
    C: AsyncWrite + Send + Sync + 'static,
    Cf: Fn() -> C + Clone + Send + Sync + 'static,
{
    fn new(
        file_name: &Path,
        bucket_size: u64,
        format: RunOutputFormat,
        console: Cf,
    ) -> Result<Self, io::Error> {
        let file = std::fs::File::create(file_name)?;
        Ok(Stats {
            bucket_size,
            current: TimeBucket::new(rounded_epoch(bucket_size)),
            console,
            duration: 0,
            file,
            format,
            previous: None,
            tags: BTreeMap::new(),
            totals: TimeBucket::new(get_epoch()),
        })
    }

    fn check_current_bucket(&mut self) {
        let current_bucket_time = rounded_epoch(self.bucket_size);
        if self.current.time < current_bucket_time {
            let new_bucket = TimeBucket::new(current_bucket_time);
            let previous = mem::replace(&mut self.current, new_bucket);
            let previous_bucket_time = current_bucket_time - self.bucket_size;
            assert_eq!(
                previous.time, previous_bucket_time,
                "previous bucket had an unexpected time"
            );
            assert!(self.previous.is_none(), "found a left over previous bucket");
            self.totals.combine(&previous);
            self.previous = Some(previous);
        }
    }

    fn get_previous_bucket(&mut self, test_complete: bool) -> Option<TimeBucket> {
        if test_complete {
            let new_bucket = TimeBucket::new(0);
            let bucket = mem::replace(&mut self.current, new_bucket);
            self.totals.combine(&bucket);
            return Some(bucket);
        }
        self.previous.take().or_else(|| {
            self.check_current_bucket();
            self.previous.take()
        })
    }

    fn append(&mut self, stat: ResponseStat) -> impl Future<Item = (), Error = ()> {
        let mut new_tag = None;
        let index = match self.tags.get(&stat.tags) {
            Some(i) => *i,
            _ => {
                let i = self.tags.len();
                self.tags.insert((*stat.tags).clone(), i);
                new_tag = Some(FileTags {
                    index: i,
                    tags: (*stat.tags).clone(),
                });
                i
            }
        };
        self.check_current_bucket();
        self.current.append(stat, index);
        if let Some(new_tag) = new_tag {
            let a = self.write_file_message(&FileMessage::Tags(new_tag));
            Either::A(a)
        } else {
            let b = Ok(()).into_future();
            Either::B(b)
        }
    }

    fn write_file_message(&self, msg: &FileMessage) -> impl Future<Item = (), Error = ()> {
        let file = match self.file.try_clone() {
            Ok(f) => f,
            Err(_) => return Either::A(Err(()).into_future()),
        };

        let bytes = match serde_json::to_vec(msg) {
            Ok(b) => b,
            Err(_) => return Either::A(Err(()).into_future()),
        };

        let mut buf = io::Cursor::new(bytes);
        let mut file = TokioFile::from_std(file);

        let b = poll_fn(move || match file.write_buf(&mut buf) {
            Ok(Async::Ready(_)) => {
                if !buf.has_remaining() {
                    Ok(Async::Ready(()))
                } else {
                    Ok(Async::NotReady)
                }
            }
            Ok(Async::NotReady) => Ok(Async::NotReady),
            Err(_) => Err(()),
        });
        Either::B(b)
    }

    fn close_out_bucket(
        &mut self,
        test_complete: bool,
    ) -> impl Future<Item = (), Error = TestError> {
        let mut is_new_bucket = false;
        let bucket = match self.get_previous_bucket(test_complete) {
            Some(b) => b,
            None => {
                is_new_bucket = true;
                let time = rounded_epoch(self.bucket_size) - self.bucket_size;
                TimeBucket::new(time)
            }
        };
        let print_string =
            bucket.create_print_summary(&self.tags, self.format, self.bucket_size, false);
        let console_output = write_all((self.console)(), print_string).then(|_| Ok(()));
        let mut futures = vec![Either3::A(console_output)];
        if !is_new_bucket {
            let file_message = FileMessage::Buckets(bucket);
            futures.push(Either3::B(self.write_file_message(&file_message)))
        }
        if test_complete {
            let blank = TimeBucket::new(0);
            let bucket = std::mem::replace(&mut self.totals, blank);
            let print_string =
                bucket.create_print_summary(&self.tags, self.format, self.duration, true);
            let console_output = write_all((self.console)(), print_string).then(|_| Ok(()));
            futures.push(Either3::C(console_output));
        }
        join_all(futures).then(|_| Ok(()))
    }
}

type Tags = BTreeMap<String, String>;

fn get_epoch() -> u64 {
    UNIX_EPOCH
        .elapsed()
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
    pub tags: Arc<Tags>,
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
    let aggregates = Bucket::default();
    let (tx, rx) = futures_channel::unbounded::<StatsMessage>();
    let f = rx
        .fold(aggregates, move |mut summary, s| {
            if let StatsMessage::ResponseStat(rs) = s {
                summary.append(rs);
            }
            Ok(summary)
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
            write_all(console(), output).then(|_| Ok(()))
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
    let bucket_size_secs = bucket_size.as_secs();
    let start_bucket = start_sec / bucket_size_secs * bucket_size_secs;
    let next_bucket =
        Duration::from_millis((bucket_size_secs - (start_sec - start_bucket)) * 1000 + 1);
    let test_name = run_config
        .config_file
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let file_path = run_config.stats_file.clone();
    let output_format = run_config.output_format;
    let stats =
        Stats::new(&file_path, bucket_size_secs, output_format, console.clone()).map_err(|e| {
            TestError::CannotCreateStatsFile(file_path.to_string_lossy().into_owned(), e.into())
        })?;
    let stats = Arc::new(Mutex::new(stats));
    let stats3 = stats.clone();
    let stats4 = stats.clone();
    let print_stats = Interval::new(now + next_bucket, bucket_size)
        .map_err(|_e| unreachable!("something happened while printing stats"))
        .for_each(move |_| {
            let mut stats = stats4.lock();
            stats.close_out_bucket(false)
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
    let mut test_start_time = None;
    let receiver = Stream::for_each(
        rx.map_err(|_| unreachable!("Error receiving stats")),
        move |datum| {
            let mut futures = Vec::new();
            let mut stats = stats.lock();
            match datum {
                StatsMessage::Start(d) => {
                    let duration = d.as_secs();
                    let (start_time, msg) = if let Some(start_time) = test_start_time {
                        let msg = if duration == stats.duration {
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
                        stats.duration = duration;
                        let now = Instant::now();
                        let test_end_message = duration_till_end_to_pretty_string(d);
                        let bin_version = clap::crate_version!().into();
                        let msg = match output_format {
                            RunOutputFormat::Human => {
                                format!("Starting load test. {}\n", test_end_message)
                            }
                            RunOutputFormat::Json => format!(
                                "{{\"type\":\"start\",\"msg\":\"{}\",\"binVersion\":\"{}\"}}\n",
                                test_end_message, bin_version,
                            ),
                        };
                        let header = FileHeader {
                            test: test_name.clone(),
                            bin: bin_version,
                            bucket_size: bucket_size_secs,
                        };
                        let c = stats
                            .write_file_message(&FileMessage::Header(header))
                            .then(|_| Ok::<_, TestError>(()));
                        futures.push(Either3::C(c));
                        (now, msg)
                    };
                    test_start_time = Some(start_time);
                    let a = write_all(console(), msg).then(|_| Ok::<_, TestError>(()));
                    futures.push(Either3::A(a))
                }
                StatsMessage::ResponseStat(rs) => {
                    let b = stats.append(rs).then(|_| Ok::<_, TestError>(()));
                    futures.push(Either3::B(b));
                }
            }
            join_all(futures).then(|_| Ok::<_, TestError>(()))
        },
    )
    .join(print_stats)
    .map(|_| TestEndReason::Completed)
    .or_else(move |e| test_killer.send(Err(e.clone())).then(move |_| Err(e)))
    .select(test_complete.map(|e| *e).map_err(|e| (&*e).clone()))
    // .map_err(|e| e.0)
    // .and_then(move |(b, _)| stats2.lock().persist(console4()).map(move |_| b))
    .then(move |_| {
        let mut stats = stats3.lock();
        stats.close_out_bucket(true).then(|_| Ok(()))
    });
    Ok((tx, receiver))
}
