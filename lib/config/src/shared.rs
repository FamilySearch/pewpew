//! Functions and types that are shared by both v1 and v2 configs.

use once_cell::sync::Lazy;
use regex::Regex;
use std::{
    str::FromStr,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub(crate) mod encode;

/// Returns a [`Duration`] based on the input [`str`], based on the config format, or `None` if the
/// string does not match the pattern.
///
/// # Panics
/// Can panic if the duration string contains a value larger than [`u64::MAX`].
pub fn duration_from_string(dur: &str) -> Option<Duration> {
    const BASE_RE: &str = r"(?i)(\d+)\s*(d|h|m|s|days?|hrs?|mins?|secs?|hours?|minutes?|seconds?)";
    static SANITY_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(&format!(r"^(?:{BASE_RE}\s*)+$")).expect("should be a valid regex")
    });
    SANITY_RE
        .is_match(dur)
        .then(|| {
            static RE: Lazy<Regex> =
                Lazy::new(|| Regex::new(BASE_RE).expect("should be a valid regex"));
            RE.captures_iter(dur)
                .map(|captures| {
                    // shouldn't panic due to how regex is set up
                    // unless a value greater then u64::MAX is used
                    let [n, unit] = (1..=2)
                        .map(|i| captures.get(i).expect("should have capture group").as_str())
                        .collect::<Vec<_>>()[..]
                    else {
                        unreachable!()
                    };
                    n.parse::<u64>().unwrap()
                        * match &unit[0..1] {
                            "d" | "D" => 60 * 60 * 24, // days
                            "h" | "H" => 60 * 60,      // hours
                            "m" | "M" => 60,           // minutes
                            "s" | "S" => 1,            // seconds
                            _ => unreachable!(),       // regex shouldn't capture anything else
                        }
                })
                .sum()
        })
        .map(Duration::from_secs)
}

pub enum Per {
    Minute,
    Second,
}

/// Returns the value, and period of that value, based on the input string.
pub(crate) fn get_hits_per(s: &str) -> Option<(f64, Per)> {
    static REGEX: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"^(?i)(\d+(?:\.\d+)?)\s*hp([ms])$").expect("should be a valid regex")
    });
    let captures = REGEX.captures(s)?;
    // None of this should ever panic due to how the regex is formed.
    let [n, tag] = (1..=2)
        .map(|i| captures.get(i).unwrap().as_str())
        .collect::<Vec<_>>()[..]
    else {
        unreachable!()
    };

    let n: f64 = n.parse().unwrap();
    Some((
        n,
        match &tag[0..1] {
            "m" | "M" => Per::Minute,
            "s" | "S" => Per::Second,
            _ => unreachable!("regex should only catch 'h' or 'm'"),
        },
    ))
}

#[derive(Copy, Clone, Debug)]
pub(crate) enum Epoch {
    Seconds,
    Milliseconds,
    Microseconds,
    Nanoseconds,
}

impl Epoch {
    pub(crate) fn get(self) -> u128 {
        // https://github.com/rustwasm/wasm-pack/issues/724#issuecomment-776892489
        // SystemTime is not supported by wasm-pack. So for wasm-pack builds, we'll use js_sys::Date
        let since_the_epoch = if cfg!(target_arch = "wasm32") {
            Duration::from_millis(js_sys::Date::now() as u64)
        } else {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_else(|_| Duration::from_secs(0))
        };
        match self {
            Epoch::Seconds => u128::from(since_the_epoch.as_secs()),
            Epoch::Milliseconds => since_the_epoch.as_millis(),
            Epoch::Microseconds => since_the_epoch.as_micros(),
            Epoch::Nanoseconds => since_the_epoch.as_nanos(),
        }
    }
}

impl FromStr for Epoch {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "s" => Ok(Self::Seconds),
            "ms" => Ok(Self::Milliseconds),
            "mu" => Ok(Self::Microseconds),
            "ns" => Ok(Self::Nanoseconds),
            _ => Err(()),
        }
    }
}

impl std::fmt::Display for Epoch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Seconds => write!(f, "epoch(\"s\")"),
            Self::Milliseconds => write!(f, "epoch(\"ms\")"),
            Self::Microseconds => write!(f, "epoch(\"mu\")"),
            Self::Nanoseconds => write!(f, "epoch(\"ns\")"),
        }
    }
}
