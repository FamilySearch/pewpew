use super::{
    templating::{Bool, False, Template, True, VarsOnly},
    PropagateVars,
};
use serde::Deserialize;

#[derive(Debug, Deserialize, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Logger<VD: Bool = True> {
    pub query: Option<super::query::Query<VD>>,
    pub limit: Option<u64>,
    pub to: LogTo<VD>,
    #[serde(default)]
    pub pretty: bool,
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
}

impl PropagateVars for LogTo<False> {
    type Data<VD: Bool> = LogTo<VD>;

    fn insert_vars(self, vars: &super::Vars<True>) -> Result<Self::Data<True>, super::VarsError> {
        use LogTo::*;
        match self {
            Stderr => Ok(Stderr),
            Stdout => Ok(Stdout),
            File(path) => Ok(File(path.insert_vars(vars)?)),
        }
    }
}

impl LogTo<True> {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Stdout => "stdout",
            Self::Stderr => "stderr",
            Self::File(path) => path.get().as_str(),
        }
    }
}

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
