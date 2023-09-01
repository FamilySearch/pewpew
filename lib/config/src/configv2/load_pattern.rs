use crate::endpoints::HitsPerMinute;

use super::common::Duration;
use super::templating::{Bool, False, Template, True, VarsOnly};
use super::PropagateVars;
use derive_more::Deref;
use itertools::Itertools;
use serde::Deserialize;
use std::{
    convert::{TryFrom, TryInto},
    fmt::{self, Display},
    str::FromStr,
};
use thiserror::Error;

/// Percentage type used for pewpew config files. Percentages can be zero, greater than 100, or
/// fractional, but cannot be negatives, nans, or infinities.
#[derive(Debug, Deserialize, PartialEq, Clone, Copy, Deref)]
#[serde(try_from = "&str")]
#[derive(serde::Serialize)]
#[serde(into = "String")]
pub struct Percent(f64);

impl Display for Percent {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let value = self.0 * 100.0;
        if value.fract() == 0.0 {
            // There's no point in writing out 10.000 or 100.000
            write!(f, "{:.0}%", value)
        } else {
            write!(f, "{:.3}%", value)
        }
    }
}

impl From<Percent> for String {
    fn from(value: Percent) -> Self {
        value.to_string()
    }
}

#[derive(Debug, PartialEq, Eq, Error)]
pub enum PercentErr {
    #[error("missing '%' on the percent")]
    NoPercentSign,
    #[error("invalid float ({0})")]
    InvalidFloat(#[from] std::num::ParseFloatError),
    #[error("negative values not allowed")]
    NegativePercent,
    #[error("abnormal floats (infinity, NaN, etc.) are not valid Percents")]
    AbnormalFloat,
}

impl TryFrom<f64> for Percent {
    type Error = PercentErr;

    fn try_from(value: f64) -> Result<Self, Self::Error> {
        use PercentErr::*;

        Ok(value)
            .and_then(|p| {
                // is_normal() checks for nan, inf, subnormals, and 0, but 0 should be allowed
                (p.is_normal() || p == 0.0)
                    .then_some(p)
                    .ok_or(AbnormalFloat)
            })
            .and_then(|p| (p >= 0.0).then_some(p).ok_or(NegativePercent))
            .map(Self)
    }
}

impl FromStr for Percent {
    type Err = PercentErr;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        use PercentErr::*;

        let base = s.strip_suffix('%').ok_or(NoPercentSign)?;

        (base.parse::<f64>()? / 100.0).try_into()
    }
}

impl TryFrom<&str> for Percent {
    type Error = <Self as FromStr>::Err;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        value.parse()
    }
}

/// Defines the load pattern of how heavily pewpew should be hitting the endpoints over time.
#[derive(Deserialize, Debug, PartialEq, Clone)]
#[serde(from = "Vec<LoadPatternTemp>")]
#[serde(bound(deserialize = "Self: From<Vec<LoadPatternTemp>>"))]
#[derive(serde::Serialize)]
pub struct LoadPattern<VD: Bool>(Vec<LoadPatternSingle<VD>>);

#[cfg(feature = "convert")]
impl LoadPattern<False> {
    pub(crate) fn build(from: Vec<LoadPatternSingle<False>>) -> Self {
        Self(from)
    }
}

impl LoadPattern<True> {
    pub(crate) fn duration(&self) -> std::time::Duration {
        self.0.iter().map(|s| **s.duration()).sum()
    }
}

impl IntoIterator for LoadPattern<True> {
    type Item = LoadPatternSingle<True>;
    type IntoIter = <Vec<LoadPatternSingle<True>> as IntoIterator>::IntoIter;

    fn into_iter(self) -> Self::IntoIter {
        self.0.into_iter()
    }
}

impl PropagateVars for LoadPattern<False> {
    type Data<VD: Bool> = LoadPattern<VD>;

    fn insert_vars(self, vars: &super::Vars<True>) -> Result<Self::Data<True>, super::VarsError> {
        self.0.insert_vars(vars).map(LoadPattern)
    }
}

impl From<Vec<LoadPatternTemp>> for LoadPattern<False> {
    fn from(value: Vec<LoadPatternTemp>) -> Self {
        Self(
            // Dummy value at the start is because `from` defaults to 0 if there is no previous
            vec![LoadPatternTemp::Linear {
                from: None,
                // This is the important part
                to: Template::Literal {
                    value: Percent(0.0),
                },
                over: Template::new_literal("1s".parse().unwrap()),
            }]
            .into_iter()
            .chain(value)
            .tuple_windows()
            .map(|(prev, curr)| match curr {
                // if `curr` has no `from` defined, take the `to` value of `prev`
                LoadPatternTemp::Linear { from, to, over } => LoadPatternSingle::Linear {
                    from: from.unwrap_or_else(|| prev.into_end()),
                    to,
                    over,
                },
            })
            .collect_vec(),
        )
    }
}

/// Single segment of a [`LoadPattern`], defining the shape and duration.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(bound = "", rename_all = "snake_case")]
pub enum LoadPatternSingle<VD: Bool> {
    Linear {
        from: Template<Percent, VarsOnly, VD>,
        to: Template<Percent, VarsOnly, VD>,
        over: Template<Duration, VarsOnly, VD>,
    },
}

impl LoadPatternSingle<True> {
    fn duration(&self) -> &Duration {
        match self {
            Self::Linear { over, .. } => over.get(),
        }
    }

    /// Returns (start, end, over)
    pub fn into_pieces<T, F>(&self, f: F, peak: &HitsPerMinute) -> (T, T, &Duration)
    where
        F: Fn(f64) -> T,
    {
        let eval = |x: &Template<Percent, VarsOnly, True, True>| f(**x.get() * **peak);
        match self {
            Self::Linear { from, to, over } => (eval(from), eval(to), over.get()),
        }
    }
}

impl PropagateVars for LoadPatternSingle<False> {
    type Data<VD: Bool> = LoadPatternSingle<VD>;

    fn insert_vars(self, vars: &super::Vars<True>) -> Result<Self::Data<True>, super::VarsError> {
        log::info!("inserting static vars into load pattern");
        match self {
            Self::Linear { from, to, over } => Ok(LoadPatternSingle::Linear {
                from: from.insert_vars(vars)?,
                to: to.insert_vars(vars)?,
                over: over.insert_vars(vars)?,
            }),
        }
    }
}

/// This temporary is used because `from` defaults to the `to` value of the previous, and that
/// cannot be acquired in the initial deserialization from the raw components
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
enum LoadPatternTemp {
    Linear {
        from: Option<Template<Percent, VarsOnly, False>>,
        to: Template<Percent, VarsOnly, False>,
        over: Template<Duration, VarsOnly, False>,
    },
}

impl LoadPatternTemp {
    fn into_end(self) -> Template<Percent, VarsOnly, False> {
        match self {
            Self::Linear { to, .. } => to,
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::configv2::templating::False;

    use super::*;
    use serde_yaml::from_str as from_yaml;

    #[test]
    fn test_single_values() {
        // Percents
        type TP = Template<Percent, VarsOnly, False>;
        let per = from_yaml::<TP>("1%").unwrap();
        assert_eq!(
            per,
            Template::Literal {
                value: Percent(0.01)
            }
        );

        // Test fractional percentages
        // Using a sum of powers of 2 for `to` here to prevent float imprecision.
        let per = from_yaml::<TP>("106.25%").unwrap();
        assert_eq!(
            per,
            Template::Literal {
                value: Percent(1.0625)
            }
        );

        // Probably shouldn't, but you can
        let per = from_yaml::<TP>("1e2%").unwrap();
        assert_eq!(
            per,
            Template::Literal {
                value: Percent(1.0)
            }
        );

        // Valid floats, but not valid Percents

        // No negatives
        assert_eq!(
            from_yaml::<TP>("-100%").unwrap_err().to_string(),
            "negative values not allowed"
        );

        // No infinities, NaNs, or subnormals
        assert_eq!(
            from_yaml::<TP>("NAN%").unwrap_err().to_string(),
            "abnormal floats (infinity, NaN, etc.) are not valid Percents"
        );
        assert_eq!(
            from_yaml::<TP>("infinity%").unwrap_err().to_string(),
            "abnormal floats (infinity, NaN, etc.) are not valid Percents"
        );
        assert_eq!(
            from_yaml::<TP>("1e-308%").unwrap_err().to_string(),
            "abnormal floats (infinity, NaN, etc.) are not valid Percents"
        );

        // Zero is ok though
        let per = from_yaml::<TP>("0%").unwrap();
        assert_eq!(
            per,
            Template::Literal {
                value: Percent(0.0)
            }
        );

        // `%` is required
        assert_eq!(
            from_yaml::<TP>("50").unwrap_err().to_string(),
            "missing '%' on the percent"
        )
    }

    #[test]
    fn test_single_load_pattern() {
        let LoadPatternTemp::Linear { from, to, over } =
            from_yaml("!linear\n  from: 50%\n  to: 100%\n  over: 5m").unwrap();
        assert_eq!(
            from,
            Some(Template::Literal {
                value: Percent(0.5)
            })
        );
        assert_eq!(
            to,
            Template::Literal {
                value: Percent(1.0)
            }
        );
        assert_eq!(over, Template::new_literal(Duration::from_secs(5 * 60)));

        let LoadPatternTemp::Linear { from, to, over } =
            from_yaml("!linear\n  to: 20%\n  over: 1s").unwrap();
        assert!(matches!(from, None));
        assert_eq!(
            to,
            Template::Literal {
                value: Percent(0.2)
            }
        );
        assert_eq!(over, Template::new_literal(Duration::from_secs(1)));
    }

    #[test]
    fn test_full_load_pattern() {
        static TEST1: &str = r#"
- !linear
    from: 25%
    to: 100%
    over: 1h
        "#;

        let load = from_yaml::<LoadPattern<False>>(TEST1).unwrap();
        assert_eq!(load.0.len(), 1);
        let LoadPatternSingle::Linear { from, to, over } = load.0[0].clone();
        assert_eq!(
            from,
            Template::Literal {
                value: Percent(0.25)
            }
        );
        assert_eq!(
            to,
            Template::Literal {
                value: Percent(1.0)
            }
        );
        assert_eq!(over, Template::new_literal(Duration::from_secs(60 * 60)));

        static TEST2: &str = r#"
 - !linear
     to: 300%
     over: 5m
        "#;

        let LoadPattern::<False>(load) = from_yaml(TEST2).unwrap();
        assert_eq!(load.len(), 1);
        let LoadPatternSingle::Linear { from, to, over } = load[0].clone();
        assert_eq!(
            from,
            Template::Literal {
                value: Percent(0.0)
            }
        );
        assert_eq!(
            to,
            Template::Literal {
                value: Percent(3.0)
            }
        );
        assert_eq!(over, Template::new_literal(Duration::from_secs(5 * 60)));

        static TEST3: &str = r#"
 - !linear
     to: 62.5%
     over: 59s
 - !linear
     to: 87.5%
     over: 22s
        "#;

        let LoadPattern::<False>(load) = from_yaml(TEST3).unwrap();
        let LoadPatternSingle::Linear { from, to, over } = load[0].clone();
        assert_eq!(
            from,
            Template::Literal {
                value: Percent(0.0)
            }
        );
        assert_eq!(
            to,
            Template::Literal {
                value: Percent(0.625)
            }
        );
        assert_eq!(over, Template::new_literal(Duration::from_secs(59)));

        let LoadPatternSingle::Linear { from, to, over } = load[1].clone();
        assert_eq!(
            from,
            Template::Literal {
                value: Percent(0.625)
            }
        );
        assert_eq!(
            to,
            Template::Literal {
                value: Percent(0.875)
            }
        );
        assert_eq!(over, Template::new_literal(Duration::from_secs(22)));
    }
}
