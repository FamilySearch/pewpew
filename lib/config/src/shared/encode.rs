use std::str::FromStr;

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine};
use percent_encoding::AsciiSet;

#[derive(Copy, Clone, Debug)]
pub enum Encoding {
    Base64,
    PercentSimple,
    PercentQuery,
    Percent,
    PercentPath,
    PercentUserinfo,
    NonAlphanumeric,
}

// https://github.com/servo/rust-url/blob/master/UPGRADING.md
// Prepackaged encoding sets, like QUERY_ENCODE_SET and PATH_SEGMENT_ENCODE_SET, are no longer provided.
// You will need to read the specifications relevant to your domain and construct your own encoding sets
// by using the percent_encoding::AsciiSet builder methods on either of the base encoding sets,
// percent_encoding::CONTROLS or percent_encoding::NON_ALPHANUMERIC.

/// This encode set is used in the URL parser for query strings.
///
/// Aside from special chacters defined in the [`SIMPLE_ENCODE_SET`](struct.SIMPLE_ENCODE_SET.html),
/// space, double quote ("), hash (#), and inequality qualifiers (<), (>) are encoded.
const QUERY_ENCODE_SET: &AsciiSet = &percent_encoding::CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'<')
    .add(b'>');
/// This encode set is used for path components.
///
/// Aside from special chacters defined in the [`SIMPLE_ENCODE_SET`](struct.SIMPLE_ENCODE_SET.html),
/// space, double quote ("), hash (#), inequality qualifiers (<), (>), backtick (`),
/// question mark (?), and curly brackets ({), (}) are encoded.
const DEFAULT_ENCODE_SET: &AsciiSet = &QUERY_ENCODE_SET.add(b'`').add(b'?').add(b'{').add(b'}');
/// This encode set is used for on '/'-separated path segment
///
/// Aside from special chacters defined in the [`SIMPLE_ENCODE_SET`](struct.SIMPLE_ENCODE_SET.html),
/// space, double quote ("), hash (#), inequality qualifiers (<), (>), backtick (`),
/// question mark (?), and curly brackets ({), (}), percent sign (%), forward slash (/) are
/// encoded.
const PATH_SEGMENT_ENCODE_SET: &AsciiSet = &DEFAULT_ENCODE_SET.add(b'%').add(b'/');
/// This encode set is used for username and password.
///
/// Aside from special chacters defined in the [`SIMPLE_ENCODE_SET`](struct.SIMPLE_ENCODE_SET.html),
/// space, double quote ("), hash (#), inequality qualifiers (<), (>), backtick (`),
/// question mark (?), and curly brackets ({), (}), forward slash (/), colon (:), semi-colon (;),
/// equality (=), at (@), backslash (\\), square brackets ([), (]), caret (\^), and pipe (|) are
/// encoded.
const USERINFO_ENCODE_SET: &AsciiSet = &DEFAULT_ENCODE_SET
    .add(b'/')
    .add(b':')
    .add(b';')
    .add(b'=')
    .add(b'@')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'|');

impl Encoding {
    pub fn encode_str(self, s: &str) -> String {
        match self {
            Encoding::Base64 => STANDARD_NO_PAD.encode(s),
            Encoding::PercentSimple => {
                percent_encoding::utf8_percent_encode(s, percent_encoding::CONTROLS).to_string()
            }
            Encoding::PercentQuery => {
                percent_encoding::utf8_percent_encode(s, QUERY_ENCODE_SET).to_string()
            }
            Encoding::Percent => {
                percent_encoding::utf8_percent_encode(s, DEFAULT_ENCODE_SET).to_string()
            }
            Encoding::PercentPath => {
                percent_encoding::utf8_percent_encode(s, PATH_SEGMENT_ENCODE_SET).to_string()
            }
            Encoding::PercentUserinfo => {
                percent_encoding::utf8_percent_encode(s, USERINFO_ENCODE_SET).to_string()
            }
            Encoding::NonAlphanumeric => {
                percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC)
                    .to_string()
            }
        }
    }
}

impl FromStr for Encoding {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "base64" => Ok(Encoding::Base64),
            "percent-simple" => Ok(Encoding::PercentSimple),
            "percent-query" => Ok(Encoding::PercentQuery),
            "percent" => Ok(Encoding::Percent),
            "percent-path" => Ok(Encoding::PercentPath),
            "percent-userinfo" => Ok(Encoding::PercentUserinfo),
            "non-alphanumeric" => Ok(Encoding::NonAlphanumeric),
            _ => Err(()),
        }
    }
}

impl std::fmt::Display for Encoding {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Base64 => write!(f, "base64"),
            Self::PercentSimple => write!(f, "percent-simple"),
            Self::PercentQuery => write!(f, "percent-query"),
            Self::Percent => write!(f, "percent"),
            Self::PercentPath => write!(f, "percent-path"),
            Self::PercentUserinfo => write!(f, "percent-userinfo"),
            Self::NonAlphanumeric => write!(f, "non-alphanumeric"),
        }
    }
}
