use super::super::templating::{Template, VarsOnly};
use super::{BufferLimit, ProviderSend};
use crate::configv2::templating::{Bool, False, True};
use crate::configv2::PropagateVars;
use derive_more::Deref;
use serde::Deserialize;
use std::convert::{TryFrom, TryInto};

#[derive(Debug, Deserialize, PartialEq, Eq, Clone, serde::Serialize)]
pub struct FileProvider<VD: Bool = True> {
    pub path: Template<String, VarsOnly, VD>,
    #[serde(default)]
    pub repeat: bool,
    #[serde(default)]
    pub unique: bool,
    pub auto_return: Option<ProviderSend>,
    #[serde(default)]
    pub buffer: BufferLimit,
    #[serde(default)]
    pub format: FileReadFormat,
    #[serde(default)]
    pub random: bool,
}

impl FileProvider<True> {
    /// Used for testing
    pub fn default_with_format(format: FileReadFormat) -> Self {
        Self {
            path: Template::new_literal("".into()),
            repeat: false,
            unique: false,
            auto_return: None,
            buffer: BufferLimit::Auto,
            format,
            random: false,
        }
    }
}

impl PropagateVars for FileProvider<False> {
    type Data<VD: Bool> = FileProvider<VD>;

    fn insert_vars(
        self,
        vars: &crate::configv2::Vars<True>,
    ) -> Result<Self::Data<True>, crate::configv2::VarsError> {
        let Self {
            path,
            repeat,
            unique,
            auto_return,
            buffer,
            format,
            random,
        } = self;

        Ok(FileProvider {
            path: path.insert_vars(vars)?,
            repeat,
            unique,
            auto_return,
            buffer,
            format,
            random,
        })
    }
}

/// How the data should be read from the file.
#[derive(Debug, Deserialize, PartialEq, Eq, Default, Clone)]
#[serde(rename_all = "snake_case")]
#[derive(serde::Serialize)]
pub enum FileReadFormat {
    /// Read one line at a time, as either a string or a JSON object.
    /// Json objects that span mulitple lines are not supported in this format.
    #[default]
    Line,
    /// Read the file as a sequence of JSON objects, separated by either whitespace of
    /// self-delineation
    Json,
    /// Read the file as a CSV, with each line being a record, and the first line possibly being
    /// the headers.
    Csv(CsvParams),
}

/// Gets read from the config file as a `char`, but stored as a `u8`.
#[derive(Debug, Deserialize, PartialEq, Eq, PartialOrd, Ord, Clone, Copy, Deref)]
#[serde(try_from = "char")]
#[derive(serde::Serialize)]
#[serde(into = "char")]
pub struct CharByte(u8);

#[cfg(feature = "convert")]
impl From<u8> for CharByte {
    fn from(value: u8) -> Self {
        Self(value)
    }
}

impl TryFrom<char> for CharByte {
    type Error = std::char::TryFromCharError;

    fn try_from(value: char) -> Result<Self, Self::Error> {
        value.try_into().map(Self)
    }
}

impl From<CharByte> for char {
    fn from(value: CharByte) -> Self {
        value.0.into()
    }
}

/// Specific data for deating records from a csv file.
///
/// Many of the "default" values described in the book are determined by the csv library's Builder
/// types, not here. This struct mainly contains possible overrides for those defaults.
#[derive(Debug, Deserialize, PartialEq, Eq, Default, Clone, serde::Serialize)]
pub struct CsvParams {
    pub comment: Option<CharByte>,
    pub delimiter: Option<CharByte>,
    #[serde(default = "default_double_quote")]
    pub double_quote: bool,
    pub escape: Option<CharByte>,
    #[serde(default)]
    pub headers: CsvHeaders,
    pub terminator: Option<CharByte>,
    pub quote: Option<CharByte>,
}

const fn default_double_quote() -> bool {
    true
}

/// Define what, if any, headers should be used for each CSV record.
#[derive(Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(untagged)]
#[derive(serde::Serialize)]
pub enum CsvHeaders {
    /// Specify if the first row should be used as headers, or if no headers should be used.
    Use(bool),
    /// Provide header values directly.
    Provide(Vec<String>),
}

impl Default for CsvHeaders {
    fn default() -> Self {
        Self::Use(false)
    }
}

#[cfg(test)]
mod tests {
    use crate::configv2::templating::False;

    use super::*;
    use serde_yaml::from_str as from_yaml;

    #[test]
    fn test_csv_headers() {
        let ch = from_yaml::<CsvHeaders>("true").unwrap();
        assert_eq!(ch, CsvHeaders::Use(true));
        let ch = from_yaml::<CsvHeaders>("- hello\n- world").unwrap();
        assert_eq!(
            ch,
            CsvHeaders::Provide(vec!["hello".to_owned(), "world".to_owned()])
        );
    }

    #[test]
    fn test_file_read_format_basic() {
        let frf = from_yaml::<FileReadFormat>("!line").unwrap();
        assert_eq!(frf, FileReadFormat::Line);
        let frf = from_yaml::<FileReadFormat>("!json").unwrap();
        assert_eq!(frf, FileReadFormat::Json);
    }

    #[test]
    fn test_file_read_format_csv() {
        // defaults
        let frf = from_yaml::<FileReadFormat>("!csv").unwrap();
        let FileReadFormat::Csv(CsvParams {
            comment,
            delimiter,
            double_quote,
            escape,
            headers,
            terminator,
            quote,
        }) = frf
        else {
            panic!("was not csv")
        };
        assert_eq!(comment, None);
        assert_eq!(delimiter, None);
        assert_eq!(double_quote, true);
        assert_eq!(escape, None);
        assert_eq!(headers, CsvHeaders::Use(false));
        assert_eq!(terminator, None);
        assert_eq!(quote, None);

        // filled
        let frf = from_yaml::<FileReadFormat>(
            r##"
!csv
  comment: "$"
  delimiter: ";"
  double_quote: false
  escape: "&"
  headers: true
  terminator: "@"
  quote: "^"
        "##,
        )
        .unwrap();
        let FileReadFormat::Csv(CsvParams {
            comment,
            delimiter,
            double_quote,
            escape,
            headers,
            terminator,
            quote,
        }) = frf
        else {
            panic!("was not csv")
        };
        assert_eq!(comment, Some(CharByte(b'$')));
        assert_eq!(delimiter, Some(CharByte(b';')));
        assert_eq!(double_quote, false);
        assert_eq!(escape, Some(CharByte(b'&')));
        assert_eq!(headers, CsvHeaders::Use(true));
        assert_eq!(terminator, Some(CharByte(b'@')));
        assert_eq!(quote, Some(CharByte(b'^')));

        // array headers
        let frf = from_yaml(
            r#"
!csv
  headers:
    - foo
    - bar
        "#,
        )
        .unwrap();
        let FileReadFormat::Csv(CsvParams {
            comment,
            delimiter,
            double_quote,
            escape,
            headers,
            terminator,
            quote,
        }) = frf
        else {
            panic!("was not csv")
        };
        assert_eq!(comment, None);
        assert_eq!(delimiter, None);
        assert_eq!(double_quote, true);
        assert_eq!(escape, None);
        assert_eq!(
            headers,
            CsvHeaders::Provide(vec!["foo".to_owned(), "bar".to_owned()])
        );
        assert_eq!(terminator, None);
        assert_eq!(quote, None);
    }

    #[test]
    fn test_file_provider() {
        static TEST1: &str = "path: file.txt";

        let FileProvider::<False> {
            path,
            repeat,
            unique,
            auto_return,
            buffer,
            format,
            random,
        } = from_yaml(TEST1).unwrap();
        assert_eq!(
            path,
            Template::Literal {
                value: "file.txt".to_owned()
            }
        );
        assert_eq!(repeat, false);
        assert_eq!(unique, false);
        assert_eq!(auto_return, None);
        assert_eq!(buffer, BufferLimit::Auto);
        assert_eq!(format, FileReadFormat::Line);
        assert_eq!(random, false);

        static TEST2: &str = r"
path: file2.txt
repeat: true
unique: true
auto_return: !if_not_full
buffer: 9987
format: !json
random: true
        ";

        let FileProvider::<False> {
            path,
            repeat,
            unique,
            auto_return,
            buffer,
            format,
            random,
        } = from_yaml(TEST2).unwrap();
        assert_eq!(
            path,
            Template::Literal {
                value: "file2.txt".to_owned()
            }
        );
        assert_eq!(repeat, true);
        assert_eq!(unique, true);
        assert_eq!(auto_return, Some(ProviderSend::IfNotFull));
        assert_eq!(buffer, BufferLimit::Limit(9987));
        assert_eq!(format, FileReadFormat::Json);
        assert_eq!(random, true);

        static TEST3: &str = r"
path: file3.csv
format: !csv
  headers:
    - foo
    - bar";

        let FileProvider::<False> {
            path,
            repeat,
            unique,
            auto_return,
            buffer,
            format,
            random,
        } = from_yaml(TEST3).unwrap();
        assert_eq!(
            path,
            Template::Literal {
                value: "file3.csv".to_owned()
            }
        );
        assert_eq!(repeat, false);
        assert_eq!(unique, false);
        assert_eq!(auto_return, None);
        assert_eq!(buffer, BufferLimit::Auto);
        assert_eq!(random, false);
        let FileReadFormat::Csv(CsvParams {
            comment,
            delimiter,
            double_quote,
            escape,
            headers,
            terminator,
            quote,
        }) = format
        else {
            panic!("was not csv")
        };
        assert_eq!(comment, None);
        assert_eq!(delimiter, None);
        assert_eq!(double_quote, true);
        assert_eq!(escape, None);
        assert_eq!(
            headers,
            CsvHeaders::Provide(vec!["foo".to_owned(), "bar".to_owned()])
        );
        assert_eq!(terminator, None);
        assert_eq!(quote, None);
    }
}
