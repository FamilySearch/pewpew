use super::{
    templating::{Bool, False, Template, True, VarsOnly},
    PropagateVars,
};
use serde::Deserialize;

#[derive(Debug, Deserialize, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Logger<VD: Bool = True> {
    pub query: Option<super::query::Query<VD>>,
    pub to: LogTo<VD>,
    #[serde(default)]
    pub pretty: bool,
    pub limit: Option<u64>,
    #[serde(default)]
    pub kill: bool,
}

impl PropagateVars for Logger<False> {
    type Data<VD: Bool> = Logger<VD>;

    fn insert_vars(self, vars: &super::Vars<True>) -> Result<Self::Data<True>, super::VarsError> {
        Ok(Logger {
            query: self.query.insert_vars(vars)?,
            to: self.to.insert_vars(vars)?,
            pretty: self.pretty,
            limit: self.limit,
            kill: self.kill,
        })
    }
}

#[derive(Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[derive(serde::Serialize)]
pub enum LogTo<VD: Bool> {
    Stdout,
    Stderr,
    File(Template<String, VarsOnly, VD>),
    /// Allows templating of non-file paths, similar to the legacy parser. Literal string values of
    /// "stdout" and "stderr" will redirect to the corresponding target, where anything else will
    /// be a file of that name.
    ///
    /// Make sure to be extra cautious about spelling the sentinel values correctly.
    Raw {
        to: Template<String, VarsOnly, VD>,
    },
}

impl PropagateVars for LogTo<False> {
    type Data<VD: Bool> = LogTo<VD>;

    fn insert_vars(self, vars: &super::Vars<True>) -> Result<Self::Data<True>, super::VarsError> {
        use LogTo::*;
        match self {
            Stderr => Ok(Stderr),
            Stdout => Ok(Stdout),
            File(path) => Ok(File(path.insert_vars(vars)?)),
            Raw { .. } => todo!(),
        }
    }
}

impl LogTo<True> {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Stdout => "stdout",
            Self::Stderr => "stderr",
            Self::File(path) => path.get().as_str(),
            Self::Raw { .. } => todo!(),
        }
    }
}

/*
impl LogTo {
    // "Flattens" a [`LogTo::Raw`] into one of the other options by evaluating the template.
    /*fn flatten_raw(
        &self,
        _vars: &super::templating::Vars,
    ) -> Result<Self, super::templating::TemplateError<String>> {
        /*match self {
            Self::Raw(ots) => match ots.evaluate(vars)?.as_str() {
                "stdout" => Ok(Self::Stdout),
                "stderr" => Ok(Self::Stderr),
                other => Ok(Self::File(OrTemplated::new_literal(other.to_owned()))),
            },
            other => Ok(other.clone()),
        }*/
        todo!()
    }*/
}
*/

#[cfg(test)]
mod tests {
    use crate::configv2::templating::False;

    use super::*;
    use serde_yaml::from_str as from_yaml;

    #[test]
    fn test_log_to_basic() {
        let to = from_yaml::<LogTo<False>>("!stdout").unwrap();
        assert_eq!(to, LogTo::Stdout);
        let to = from_yaml::<LogTo<False>>("!stderr").unwrap();
        assert_eq!(to, LogTo::Stderr);
        let to = from_yaml::<LogTo<False>>("!file out.txt").unwrap();
        assert_eq!(
            to,
            LogTo::File(Template::Literal {
                value: "out.txt".to_owned()
            })
        );
        assert!(from_yaml::<LogTo<False>>("!stder").is_err());
    }

    // This test may need to be rewritten when the templating/vars structure is changed
    /*#[test]
    fn test_log_to_raw() {
        let to = from_yaml::<LogTo>("!raw stdout").unwrap();
        assert_eq!(to.flatten_raw(&[].into()), Ok(LogTo::Stdout));
        let to = from_yaml::<LogTo>("!raw stderr").unwrap();
        assert_eq!(to.flatten_raw(&[].into()), Ok(LogTo::Stderr));
        let to = from_yaml::<LogTo>("!raw out.txt").unwrap();
        assert_eq!(
            to.flatten_raw(&[].into()),
            Ok(LogTo::File(OrTemplated::new_literal("out.txt".to_owned())))
        );
        let to = from_yaml::<LogTo>("!raw stder").unwrap();
        assert_eq!(
            to.flatten_raw(&[].into()),
            Ok(LogTo::File(OrTemplated::new_literal("stder".to_owned())))
        );
    }*/

    #[test]
    fn test_logger_defaults() {
        let logger = from_yaml::<Logger<False>>("to: !stdout").unwrap();
        assert!(logger.query.is_none());
        assert_eq!(logger.pretty, false);
        assert_eq!(logger.limit, None);
        assert_eq!(logger.kill, false);

        assert_eq!(logger.to, LogTo::Stdout);
    }
}
