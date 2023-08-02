use derive_more::Deref;
use serde::Deserialize;
use std::{convert::TryFrom, num::NonZeroU16, ops::Add};
use thiserror::Error;

#[derive(Debug, Deserialize, PartialEq, Eq, Clone, Copy)]
#[serde(default)]
#[derive(serde::Serialize)]
pub struct RangeProvider {
    start: i64,
    end: i64,
    step: Step,
    repeat: bool,
    pub unique: bool,
}

#[cfg(feature = "convert")]
impl RangeProvider {
    pub(crate) fn from_parts(
        start: i64,
        end: i64,
        step: NonZeroU16,
        repeat: bool,
        unique: bool,
    ) -> Self {
        Self {
            start,
            end,
            step: Step(step),
            repeat,
            unique,
        }
    }
}

impl IntoIterator for RangeProvider {
    type Item = i64;
    type IntoIter = Box<dyn Iterator<Item = i64> + Send>;

    fn into_iter(self) -> Self::IntoIter {
        let base = ((self.start)..=(self.end)).step_by(self.step.get() as usize);
        if self.repeat {
            Box::new(base.cycle())
        } else {
            Box::new(base)
        }
    }
}

impl Default for RangeProvider {
    fn default() -> Self {
        Self {
            start: 0,
            end: i64::MAX,
            step: Step::default(),
            repeat: false,
            unique: false,
        }
    }
}

/// Wrapper type for [`NonZeroU16`]
#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deref)]
#[serde(try_from = "u16")]
#[derive(serde::Serialize)]
struct Step(NonZeroU16);

#[derive(Debug, Error)]
#[error("step cannot be zero")]
struct ZeroStepError;

impl TryFrom<u16> for Step {
    type Error = ZeroStepError;

    fn try_from(value: u16) -> Result<Self, Self::Error> {
        NonZeroU16::new(value).map(Self).ok_or(ZeroStepError)
    }
}

impl Default for Step {
    fn default() -> Self {
        Self(NonZeroU16::new(1).unwrap())
    }
}

impl Add<Step> for i64 {
    type Output = i64;

    fn add(self, rhs: Step) -> Self::Output {
        self + rhs.get() as i64
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_yaml::from_str as from_yaml;

    macro_rules! step {
        ($x:expr) => {
            Step::try_from($x).unwrap()
        };
    }

    #[test]
    fn test_step() {
        assert_eq!(
            from_yaml::<Step>("0").unwrap_err().to_string(),
            "step cannot be zero"
        );
        assert_eq!(from_yaml::<Step>("2345").unwrap(), step!(2345));
    }

    #[test]
    fn test_range_provider_defaults() {
        let RangeProvider {
            start,
            end,
            step,
            repeat,
            unique,
        } = from_yaml("").unwrap();
        assert_eq!(start, 0);
        assert_eq!(end, i64::MAX);
        assert_eq!(step, step!(1));
        assert_eq!(repeat, false);
        assert_eq!(unique, false);
    }

    #[test]
    fn test_range_provider() {
        static TEST: &str = r#"
start: -126435
end: 1000000000000
step: 587
repeat: true
unique: true
        "#;
        let RangeProvider {
            start,
            end,
            step,
            repeat,
            unique,
        } = from_yaml(TEST).unwrap();
        assert_eq!(start, -126435);
        assert_eq!(end, 1_000_000_000_000);
        assert_eq!(step, step!(587));
        assert_eq!(repeat, true);
        assert_eq!(unique, true);
    }

    #[test]
    fn test_step_add() {
        assert_eq!(-1i64 + step!(1), 0i64);
    }
}
