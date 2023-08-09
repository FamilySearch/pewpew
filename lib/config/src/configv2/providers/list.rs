use rand::seq::SliceRandom;
use serde::Deserialize;

#[derive(Debug, Deserialize, PartialEq, Eq, Clone, serde::Serialize)]
#[serde(from = "ListProviderTmp")]
pub struct ListProvider {
    pub values: Vec<serde_json::Value>,
    pub random: bool,
    pub repeat: bool,
    pub unique: bool,
}

impl Default for ListProvider {
    fn default() -> Self {
        Self {
            values: vec![],
            random: Default::default(),
            repeat: default_repeat(),
            unique: Default::default(),
        }
    }
}

impl IntoIterator for ListProvider {
    type Item = serde_json::Value;
    type IntoIter = Box<dyn Iterator<Item = serde_json::Value> + Send>;

    fn into_iter(self) -> Self::IntoIter {
        let mut values = self.values;
        match (self.repeat, self.random) {
            (false, false) => Box::new(values.into_iter()),
            (true, false) => Box::new(values.into_iter().cycle()),
            (false, true) => {
                values.shuffle(&mut rand::thread_rng());
                Box::new(values.into_iter())
            }
            (true, true) => Box::new(std::iter::from_fn(move || {
                values.choose(&mut rand::thread_rng()).cloned()
            })),
        }
    }
}

/// List can be defined with parameters, or just a list.
///
/// JustAList definition fills in default values for other structs.
/// Gets converted into "main" list provider data so exposed APIs don't need to consider enum
/// variants and can just read the data.
#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
enum ListProviderTmp {
    JustAList(Vec<serde_json::Value>),
    Defined {
        values: Vec<serde_json::Value>,
        #[serde(default)]
        random: bool,
        #[serde(default = "default_repeat")]
        repeat: bool,
        #[serde(default)]
        unique: bool,
    },
}

impl From<ListProviderTmp> for ListProvider {
    fn from(value: ListProviderTmp) -> Self {
        match value {
            ListProviderTmp::Defined {
                values,
                random,
                repeat,
                unique,
            } => ListProvider {
                values,
                random,
                repeat,
                unique,
            },
            ListProviderTmp::JustAList(values) => ListProvider {
                values,
                ..Default::default()
            },
        }
    }
}

const fn default_repeat() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_yaml::from_str as from_yaml;

    #[test]
    fn test_implicit_defaults() {
        // default values filled in from implicit definition should match up with default()
        let ListProvider {
            values,
            random,
            repeat,
            unique,
        } = from_yaml("- hello").unwrap();
        let def = ListProvider::default();
        assert_eq!(repeat, def.repeat);
        assert_eq!(random, def.random);
        assert_eq!(unique, def.unique);
        assert_eq!(values, vec!["hello".to_owned()])
    }

    #[test]
    fn test_explicit_defaults() {
        // default values filled in from explicit definition should match up with default()
        let ListProvider {
            values,
            random,
            repeat,
            unique,
        } = from_yaml("values:\n  - hello").unwrap();
        let def = ListProvider::default();
        assert_eq!(repeat, def.repeat);
        assert_eq!(random, def.random);
        assert_eq!(unique, def.unique);
        assert_eq!(values, vec!["hello".to_owned()])
    }

    #[test]
    fn test_implicit_definition() {
        let ListProvider {
            values,
            random,
            repeat,
            unique,
        } = from_yaml("- hello\n- world\n- foo\n- bar").unwrap();
        assert_eq!(
            values,
            vec![
                "hello".to_owned(),
                "world".to_owned(),
                "foo".to_owned(),
                "bar".to_owned()
            ]
        );
        assert_eq!(random, false);
        assert_eq!(repeat, true);
        assert_eq!(unique, false);
    }

    #[test]
    fn test_explicit_definition() {
        static TEST: &str = r"
values:
  - hello
  - world
  - foo
  - bar
random: true
repeat: false
unique: true
        ";
        let ListProvider {
            values,
            random,
            repeat,
            unique,
        } = from_yaml(TEST).unwrap();
        assert_eq!(
            values,
            vec![
                "hello".to_owned(),
                "world".to_owned(),
                "foo".to_owned(),
                "bar".to_owned()
            ]
        );
        assert_eq!(random, true);
        assert_eq!(repeat, false);
        assert_eq!(unique, true);
    }
}
