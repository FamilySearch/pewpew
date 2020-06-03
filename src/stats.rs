use crate::error::{RecoverableError, TestError};
use crate::line_writer::{blocking_writer, MsgType};
use crate::providers;
use crate::TestEndReason;
use crate::{RunConfig, RunOutputFormat};

use channel::ChannelStatsReader;
use chrono::{DateTime, Duration as ChronoDuration, Local, NaiveDateTime, Utc};
use ether::Either;
use futures::{
    channel::mpsc::{self as futures_channel, Sender as FCSender},
    future::join_all,
    sink::SinkExt,
    stream, FutureExt, StreamExt,
};
use hdrhistogram::Histogram;
use serde::{Deserialize, Serialize};
use serde_json as json;
use tokio::{
    sync::broadcast,
    time::{self, Duration, Instant},
};
use yansi::Paint;

use std::{
    collections::BTreeMap,
    fs::File,
    future::Future,
    io, mem,
    path::Path,
    sync::Arc,
    task::Poll,
    time::{SystemTime, UNIX_EPOCH},
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
                let piece =
                    bucket.create_print_summary(tags, format, self.time, end_time, bucket_size);
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
        bucket_size: u64,
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
                let summary_type = if end_time.is_some() { "test" } else { "bucket" };
                let output = json::json!({
                    "type": "summary",
                    "startTime": time,
                    "timestamp": time + bucket_size,
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
                    "tags": tags.iter()
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

#[allow(clippy::trivially_copy_pass_by_ref)]
fn is_zero(n: &u64) -> bool {
    *n == 0
}

struct Stats {
    bucket_size: u64,
    current: TimeBucket,
    console: FCSender<MsgType>,
    duration: u64,
    file: FCSender<MsgType>,
    format: RunOutputFormat,
    previous: Option<TimeBucket>,
    providers: Vec<ChannelStatsReader<json::Value>>,
    tags: BTreeMap<Tags, usize>,
    totals: TimeBucket,
}

fn rounded_epoch(bucket_size: u64) -> u64 {
    round_time(get_epoch(), bucket_size)
}

fn round_time(time: u64, bucket_size: u64) -> u64 {
    time / bucket_size * bucket_size
}

impl Stats {
    fn new(
        file_name: &Path,
        bucket_size: u64,
        format: RunOutputFormat,
        console: FCSender<MsgType>,
        providers: Vec<ChannelStatsReader<json::Value>>,
        test_killer: broadcast::Sender<Result<TestEndReason, TestError>>,
    ) -> Result<Self, io::Error> {
        let file = blocking_writer(
            File::create(file_name)?,
            test_killer,
            file_name.to_string_lossy().to_string(),
        );
        Ok(Stats {
            bucket_size,
            current: TimeBucket::new(rounded_epoch(bucket_size)),
            console,
            duration: 0,
            file,
            format,
            previous: None,
            providers,
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

    async fn append(&mut self, stat: ResponseStat) {
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
        self.current.append(stat, index);
        if let Some(new_tag) = new_tag {
            self.write_file_message(FileMessage::Tags(new_tag)).await;
        }
    }

    // this fn returns an impl future instead of being async, so as not to capture a reference to `self`
    fn write_file_message(&self, msg: FileMessage) -> impl Future<Output = ()> {
        let mut file = self.file.clone();

        async move {
            let msg = match serde_json::to_string(&msg) {
                Ok(m) => m,
                Err(_) => return,
            };

            let _ = file.send(MsgType::Other(msg)).await;
        }
    }

    fn create_provider_stats_summary(&self, time: u64) -> String {
        let is_human_format = self.format.is_human();
        let mut string_to_print = if is_human_format && !self.providers.is_empty() {
            format!("{}", Paint::new("\nProvider Stats\n").bold())
        } else {
            String::new()
        };
        for reader in self.providers.iter() {
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
                let mut s = json::to_string(&stats).expect("could not serialize provider stats");
                s.push('\n');
                s
            };
            string_to_print.push_str(&piece);
        }

        string_to_print
    }

    async fn close_out_bucket(&mut self, test_complete: bool) {
        let mut is_new_bucket = false;
        let time = rounded_epoch(self.bucket_size) - self.bucket_size;
        let bucket = match self.get_previous_bucket(test_complete) {
            Some(b) => b,
            None => {
                is_new_bucket = true;
                TimeBucket::new(time)
            }
        };
        let mut print_string = if test_complete {
            String::new()
        } else {
            self.create_provider_stats_summary(time)
        };
        let piece = bucket.create_print_summary(&self.tags, self.format, self.bucket_size, false);
        print_string.push_str(&piece);

        let mut futures = Vec::new();
        if !is_new_bucket {
            let file_message = FileMessage::Buckets(bucket);
            futures.push(Either::B(self.write_file_message(file_message)))
        }
        let msg = if test_complete {
            let blank = TimeBucket::new(0);
            let bucket = std::mem::replace(&mut self.totals, blank);
            let print_string2 =
                bucket.create_print_summary(&self.tags, self.format, self.duration, true);
            print_string.push_str(&print_string2);
            MsgType::Final(print_string)
        } else {
            MsgType::Other(print_string)
        };
        let console_output = self.console.send(msg).map(|_| ());
        futures.push(Either::A(console_output));
        join_all(futures).await;
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

pub fn create_try_run_stats_channel(
    mut test_complete: broadcast::Receiver<Result<TestEndReason, TestError>>,
    mut console: FCSender<MsgType>,
) -> (
    futures_channel::UnboundedSender<StatsMessage>,
    impl Future<Output = ()> + Send,
) {
    let (tx, mut rx) = futures_channel::unbounded::<StatsMessage>();

    let f = async move {
        let mut stats = Bucket::default();

        // continue pulling values from the rx channel until it ends or the test_complete future fires
        let mut stream = stream::poll_fn(|cx| match rx.poll_next_unpin(cx) {
            p @ Poll::Ready(_) => p,
            p @ Poll::Pending => match test_complete.poll_next_unpin(cx) {
                Poll::Ready(_) => Poll::Ready(None),
                _ => p,
            },
        });

        while let Some(s) = stream.next().await {
            if let StatsMessage::ResponseStat(rs) = s {
                stats.append(rs);
            }
        }

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

        let _ = console.send(MsgType::Final(output)).await;
    };

    (tx, f)
}

pub fn create_stats_channel(
    test_killer: broadcast::Sender<Result<TestEndReason, TestError>>,
    // mut test_complete: broadcast::Receiver<Result<TestEndReason, TestError>>,
    config: &config::GeneralConfig,
    providers: &BTreeMap<String, providers::Provider>,
    mut console: FCSender<MsgType>,
    run_config: &RunConfig,
) -> Result<
    (
        futures_channel::UnboundedSender<StatsMessage>,
        impl Future<Output = ()> + Send,
    ),
    TestError,
> {
    let (tx, mut rx) = futures_channel::unbounded::<StatsMessage>();
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
    let log_provider_stats = config.log_provider_stats.is_some();
    let providers: Vec<_> = if log_provider_stats {
        providers
            .iter()
            .map(|(name, kind)| channel::ChannelStatsReader::new(name.clone(), &kind.rx))
            .collect()
    } else {
        Vec::new()
    };

    let mut test_complete = test_killer.subscribe();

    let mut stats = Stats::new(
        &file_path,
        bucket_size_secs,
        output_format,
        console.clone(),
        providers,
        test_killer,
    )
    .map_err(|e| {
        TestError::CannotCreateStatsFile(file_path.to_string_lossy().into_owned(), e.into())
    })?;

    let mut test_start_time: Option<Instant> = None;

    let receiver = async move {
        let mut print_stats_interval = time::interval_at(now + next_bucket, bucket_size);
        // create a stream which combines getting incoming messages, printing stats on an interval
        // and checking if the test has ended
        enum StreamItem {
            TestComplete,
            NewBucket,
            StatsMessage(StatsMessage),
            UpdateProviders(Vec<ChannelStatsReader<json::Value>>),
        }

        let mut stream = stream::poll_fn(move |cx| {
            match test_complete.poll_next_unpin(cx) {
                // test is not complete
                Poll::Pending => match print_stats_interval.poll_next_unpin(cx) {
                    Poll::Ready(Some(_)) => Poll::Ready(Some(StreamItem::NewBucket)),
                    _ => match rx.poll_next_unpin(cx) {
                        Poll::Ready(Some(s)) => Poll::Ready(Some(StreamItem::StatsMessage(s))),
                        Poll::Ready(None) => Poll::Ready(None),
                        Poll::Pending => Poll::Pending,
                    },
                },
                // test config is updated and there's a new set of providers
                Poll::Ready(Some(Ok(Ok(TestEndReason::ConfigUpdate(providers))))) => {
                    if log_provider_stats {
                        let providers = providers
                            .iter()
                            .map(|(name, kind)| {
                                channel::ChannelStatsReader::new(name.clone(), &kind.rx)
                            })
                            .collect();
                        Poll::Ready(Some(StreamItem::UpdateProviders(providers)))
                    } else {
                        Poll::Pending
                    }
                }
                // test is complete
                Poll::Ready(_) => Poll::Ready(Some(StreamItem::TestComplete)),
            }
        });

        while let Some(datum) = stream.next().await {
            match datum {
                StreamItem::TestComplete => {
                    stats.close_out_bucket(true).await;
                    break;
                }
                StreamItem::NewBucket => {
                    stats.close_out_bucket(false).await;
                }
                StreamItem::UpdateProviders(providers) => {
                    stats.providers = providers;
                }
                StreamItem::StatsMessage(StatsMessage::Start(d)) => {
                    let mut futures = Vec::new();
                    let (start_time, msg) = if let Some(start_time) = test_start_time {
                        let duration = start_time.elapsed() + d;
                        let msg = if (duration.as_secs_f64() - stats.duration as f64).abs() < 1.0 {
                            String::new()
                        } else {
                            stats.duration = duration.as_secs();
                            let test_end_message = duration_till_end_to_pretty_string(d);
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
                        stats.duration = d.as_secs();
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
                        let left = stats
                            .write_file_message(FileMessage::Header(header))
                            .map(|_| ());
                        futures.push(Either::A(left));
                        (now, msg)
                    };
                    test_start_time = Some(start_time);
                    let right = console.send(MsgType::Other(msg)).map(|_| ());
                    futures.push(Either::B(right));
                    join_all(futures).await;
                }
                StreamItem::StatsMessage(StatsMessage::ResponseStat(rs)) => stats.append(rs).await,
            }
        }
    };

    Ok((tx, receiver))
}
