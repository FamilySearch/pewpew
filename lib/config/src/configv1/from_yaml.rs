use crate::configv1::error::Error;

use serde_json as json;
use yaml_rust::{
    parser::Parser as YamlParser,
    scanner::{Marker, TScalarStyle, TokenType},
    Event as YamlParseEvent,
};

use std::{
    collections::BTreeMap,
    num::{NonZeroU16, NonZeroUsize},
    ops::Range,
    str::FromStr,
};

pub trait FromYaml: Sized {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self>;

    fn parse_into<R: ParseOk<Self>, I: Iterator<Item = char>>(
        decoder: &mut YamlDecoder<I>,
    ) -> ParseIntoResult<R> {
        FromYaml::parse(decoder).map(ParseOk::from)
    }

    fn from_yaml_str(s: &str) -> Result<Self, Error> {
        let mut decoder = YamlDecoder::new(s.chars());
        Self::parse_into(&mut decoder)
    }
}

impl FromYaml for json::Value {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let mut root: Option<json::Value> = None;
        let mut first_marker = None;
        loop {
            let (event, marker) = decoder.peek()?;
            if first_marker.is_none() {
                first_marker = Some(*marker);
            }
            match event {
                YamlEvent::MappingStart => match &mut root {
                    None => {
                        decoder.next()?;
                        root = Some(json::map::Map::new().into());
                    }
                    Some(json::Value::Array(a)) => {
                        let v = FromYaml::parse_into(decoder)?;
                        a.push(v);
                    }
                    _ => return Err(Error::YamlDeserialize(None, *marker)),
                },
                YamlEvent::SequenceStart => match &mut root {
                    None => {
                        decoder.next()?;
                        root = Some(json::Value::Array(Vec::new()));
                    }
                    Some(json::Value::Array(a)) => {
                        let v = FromYaml::parse_into(decoder)?;
                        a.push(v);
                    }
                    _ => return Err(Error::YamlDeserialize(None, *marker)),
                },
                YamlEvent::SequenceEnd | YamlEvent::MappingEnd => {
                    decoder.next()?;
                    break;
                }
                YamlEvent::Scalar(_, ttype, _) => {
                    let ttype = *ttype;
                    let s = match decoder.next() {
                        Ok((YamlEvent::Scalar(s, ..), _)) => s,
                        _ => unreachable!("should have gotten a scalar for next"),
                    };
                    let get_value = |s: String| match (s.as_str(), ttype) {
                        ("null", TScalarStyle::Plain) | ("NaN", TScalarStyle::Plain) => {
                            json::Value::Null
                        }
                        ("true", TScalarStyle::Plain) => true.into(),
                        ("false", TScalarStyle::Plain) => false.into(),
                        _ => {
                            if let TScalarStyle::Plain = ttype {
                                if let Ok(v) = json::Value::from_str(&s) {
                                    return v;
                                }
                            }
                            json::Value::String(s)
                        }
                    };
                    match &mut root {
                        Some(json::Value::Object(o)) => {
                            let next = FromYaml::parse_into(decoder)?;
                            o.insert(s, next);
                        }
                        Some(json::Value::Array(a)) => {
                            a.push(get_value(s));
                        }
                        _ => {
                            root = Some(get_value(s));
                            break;
                        }
                    }
                }
            }
        }
        let marker = first_marker.expect("should have a marker");
        Ok((root.unwrap_or_default(), marker))
    }
}

impl FromYaml for bool {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (event, marker) = decoder.next()?;
        match event.as_bool() {
            Some(b) => Ok((b, marker)),
            _ => Err(Error::YamlDeserialize(None, marker)),
        }
    }
}

impl FromYaml for NonZeroU16 {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (event, marker) = decoder.next()?;
        event
            .as_x()
            .map(|i| (i, marker))
            .ok_or(Error::YamlDeserialize(None, marker))
    }
}

impl FromYaml for NonZeroUsize {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (event, marker) = decoder.next()?;
        event
            .as_x()
            .map(|i| (i, marker))
            .ok_or(Error::YamlDeserialize(None, marker))
    }
}

impl FromYaml for i64 {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (event, marker) = decoder.next()?;
        event
            .as_x()
            .map(|i| (i, marker))
            .ok_or(Error::YamlDeserialize(None, marker))
    }
}

impl FromYaml for usize {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (event, marker) = decoder.next()?;
        event
            .as_x()
            .map(|i| (i, marker))
            .ok_or(Error::YamlDeserialize(None, marker))
    }
}

impl FromYaml for String {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (event, marker) = decoder.next()?;
        event
            .into_string()
            .map(|s| (s, marker))
            .map_err(|_| Error::YamlDeserialize(None, marker))
    }
}

#[derive(Debug, Clone)]
pub enum YamlEvent {
    MappingEnd,
    MappingStart,
    SequenceEnd,
    SequenceStart,
    Scalar(String, TScalarStyle, Option<(String, String)>),
}

impl YamlEvent {
    fn is_scalar(&self) -> bool {
        matches!(self, YamlEvent::Scalar(..))
    }

    fn is_nested_end(&self) -> bool {
        matches!(self, YamlEvent::MappingEnd | YamlEvent::SequenceEnd)
    }

    fn is_nested_start(&self) -> bool {
        matches!(self, YamlEvent::MappingStart | YamlEvent::SequenceStart)
    }

    pub fn into_string(self) -> Result<String, Self> {
        if let YamlEvent::Scalar(s, ..) = self {
            Ok(s)
        } else {
            Err(self)
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match &self {
            YamlEvent::Scalar(s, ..) => Some(s.as_str()),
            _ => None,
        }
    }

    pub fn as_x<F: FromStr>(&self) -> Option<F> {
        if let YamlEvent::Scalar(s, TScalarStyle::Plain, _) = self {
            F::from_str(s).ok()
        } else {
            None
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            YamlEvent::Scalar(s, TScalarStyle::Plain, _) if s.as_str() == "true" => Some(true),
            YamlEvent::Scalar(s, TScalarStyle::Plain, _) if s.as_str() == "false" => Some(false),
            _ => None,
        }
    }
}

enum AliasOrEvent {
    Alias(Range<usize>),
    Event(YamlEvent, Marker),
}

pub struct YamlDecoder<I: Iterator<Item = char>> {
    aliased_events: Vec<AliasOrEvent>,
    alias_map: BTreeMap<usize, Range<usize>>,
    parser: YamlParser<I>,
    peek: Option<(YamlEvent, Marker)>,
    reference_stack: Vec<Option<(usize, usize)>>,
    replaying_alias: Vec<Range<usize>>,
}

impl<I: Iterator<Item = char>> YamlDecoder<I> {
    pub fn new(iter: I) -> Self {
        let parser = YamlParser::new(iter);
        YamlDecoder {
            aliased_events: Vec::new(),
            alias_map: BTreeMap::new(),
            parser,
            peek: None,
            reference_stack: Vec::new(),
            replaying_alias: Vec::new(),
        }
    }

    pub fn peek(&mut self) -> Result<&(YamlEvent, Marker), Error> {
        use YamlParseEvent::*;
        if self.peek.is_some() {
            return Ok(self.peek.as_ref().unwrap());
        }
        let ret = loop {
            if let Some(range) = self.replaying_alias.last_mut() {
                if let Some(i) = range.next() {
                    match &self.aliased_events[i] {
                        AliasOrEvent::Alias(range) => self.replaying_alias.push(range.clone()),
                        AliasOrEvent::Event(e, marker) => break (e.clone(), *marker),
                    }
                } else {
                    self.replaying_alias.pop();
                }
                continue;
            }
            let (event, marker) = self.parser.next()?;
            let in_reference = !self.reference_stack.is_empty();
            let (alias_id, event) = match event {
                Nothing | StreamStart | DocumentStart => continue,
                StreamEnd | DocumentEnd => return Err(Error::YamlDeserialize(None, marker)),
                Alias(i) => {
                    if let Some(range) = self.alias_map.get(&i) {
                        self.replaying_alias.push(range.clone());
                        if in_reference {
                            self.aliased_events.push(AliasOrEvent::Alias(range.clone()));
                        }
                    }
                    continue;
                }
                Scalar(s, style, alias_id, tag) => {
                    let tag = if let Some(TokenType::Tag(a, b)) = tag {
                        Some((a, b))
                    } else {
                        None
                    };
                    (alias_id, YamlEvent::Scalar(s, style, tag))
                }
                MappingStart(alias_id) => (alias_id, YamlEvent::MappingStart),
                MappingEnd => (0, YamlEvent::MappingEnd),
                SequenceStart(alias_id) => (alias_id, YamlEvent::SequenceStart),
                SequenceEnd => (0, YamlEvent::SequenceEnd),
            };
            if in_reference || alias_id > 0 {
                self.aliased_events
                    .push(AliasOrEvent::Event(event.clone(), marker));
            }
            if alias_id > 0 {
                let i = self.aliased_events.len() - 1;
                if event.is_scalar() {
                    self.alias_map.insert(alias_id, i..i);
                } else {
                    self.reference_stack.push(Some((alias_id, i)));
                }
            } else if event.is_nested_end() {
                if let Some(Some((alias_id, i))) = self.reference_stack.pop() {
                    self.alias_map
                        .insert(alias_id, i..self.aliased_events.len());
                }
            } else if event.is_nested_start() && in_reference {
                self.reference_stack.push(None);
            }
            break (event, marker);
        };
        self.peek = Some(ret);
        Ok(self.peek.as_ref().unwrap())
    }

    pub fn next(&mut self) -> Result<(YamlEvent, Marker), Error> {
        self.peek()?;
        Ok(self.peek.take().unwrap())
    }
}

pub trait Insert: Default {
    type Value;
    fn insert(&mut self, v: Self::Value, start_event: &YamlEvent) -> Result<(), ()>;
}

impl<V> Insert for Vec<V> {
    type Value = V;
    fn insert(&mut self, v: Self::Value, start_event: &YamlEvent) -> Result<(), ()> {
        if let YamlEvent::SequenceStart = start_event {
            self.push(v);
            Ok(())
        } else {
            Err(())
        }
    }
}

#[cfg_attr(debug_assertions, derive(PartialEq, Eq))]
#[derive(Debug)]
pub struct TupleVec<K, V>(pub Vec<(K, V)>);

impl<K, V> Default for TupleVec<K, V> {
    fn default() -> Self {
        TupleVec(Vec::new())
    }
}

impl<K, V> From<Vec<(K, V)>> for TupleVec<K, V> {
    fn from(vec: Vec<(K, V)>) -> Self {
        TupleVec(vec)
    }
}

impl<K, V> Insert for TupleVec<K, V> {
    type Value = (K, V);
    fn insert(&mut self, t: (K, V), start_event: &YamlEvent) -> Result<(), ()> {
        if let YamlEvent::MappingStart = start_event {
            self.0.push(t);
            Ok(())
        } else {
            Err(())
        }
    }
}

impl<K: std::cmp::Ord, V> Insert for BTreeMap<K, V> {
    type Value = (K, V);
    fn insert(&mut self, (k, v): (K, V), start_event: &YamlEvent) -> Result<(), ()> {
        if let YamlEvent::MappingStart = start_event {
            BTreeMap::insert(self, k, v);
            Ok(())
        } else {
            Err(())
        }
    }
}

pub trait ParseOk<T = Self> {
    fn from(v: (T, Marker)) -> Self;
}

impl<T> ParseOk for T {
    fn from(v: (T, Marker)) -> Self {
        v.0
    }
}

impl<T> ParseOk<T> for (T, Marker) {
    fn from(v: (T, Marker)) -> Self {
        v
    }
}

impl<T, T2> ParseOk<(T, T2)> for (T, (T2, Marker)) {
    fn from(((t, t2), m): ((T, T2), Marker)) -> Self {
        (t, (t2, m))
    }
}

pub type ParseResult<T> = Result<(T, Marker), Error>;
type ParseIntoResult<R> = Result<R, Error>;

impl<T: FromYaml> FromYaml for (String, T) {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let event1 = FromYaml::parse_into(decoder)?;
        let (event2, marker): (T, Marker) = FromYaml::parse(decoder)?;
        Ok(((event1, event2), marker))
    }
}

impl<C> FromYaml for C
where
    C: Insert + ParseOk,
    C::Value: FromYaml,
{
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let mut ret = C::default();
        let mut first_marker = None;
        let mut first_event = None;

        loop {
            let (event, marker) = decoder.peek()?;
            let marker = *marker;
            let first_round = if first_marker.is_none() {
                first_marker = Some(marker);
                first_event = Some(event.clone());
                true
            } else {
                false
            };
            match event {
                YamlEvent::Scalar(..) => {
                    let v = FromYaml::parse_into(decoder)?;
                    let event = first_event.as_ref().expect("should have first event");
                    ret.insert(v, event)
                        .map_err(|_| Error::YamlDeserialize(None, marker))?;
                }
                YamlEvent::MappingStart | YamlEvent::SequenceStart => {
                    if first_round {
                        decoder.next()?;
                    }
                    let v = FromYaml::parse_into(decoder)?;
                    let event = first_event.as_ref().expect("should have first event");
                    ret.insert(v, event)
                        .map_err(|_| Error::YamlDeserialize(None, marker))?;
                }
                YamlEvent::SequenceEnd | YamlEvent::MappingEnd => {
                    decoder.next()?;
                    break;
                }
            }
        }

        let marker = first_marker.expect("should have a marker");
        Ok(ParseOk::from((ret, marker)))
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub enum Nullable<T> {
    Some(T),
    #[default]
    Null,
}

impl<T> From<Nullable<T>> for Option<T> {
    fn from(n: Nullable<T>) -> Option<T> {
        match n {
            Nullable::Some(t) => Some(t),
            Nullable::Null => None,
        }
    }
}

impl<T: FromYaml> FromYaml for Nullable<T> {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (event, marker) = decoder.peek()?;
        let marker = *marker;
        let is_null = match event {
            YamlEvent::Scalar(_, _, Some((bang_bang, null)))
                if bang_bang == "!!" && null == "null" =>
            {
                true
            }
            YamlEvent::Scalar(null, TScalarStyle::Plain, None) if null == "null" => true,
            _ => false,
        };
        if is_null {
            decoder.next()?;
            Ok((Nullable::Null, marker))
        } else {
            let (value, marker) = FromYaml::parse(decoder)?;
            Ok((Nullable::Some(value), marker))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use maplit::btreemap;

    #[test]
    fn from_yaml_json() {
        let values = vec![
            (
                "
                - foo
                - bar
                - a: 1
                  b: 2.345
                  c: '99.54'
                  d: true
                  e: false
                  f: NaN
                  g: 'NaN'",
                json::json!([
                    "foo",
                    "bar",
                    {
                        "a": 1,
                        "b": 2.345,
                        "c": "99.54",
                        "d": true,
                        "e": false,
                        "f": null,
                        "g": "NaN"
                    }
                ]),
            ),
            (
                "
                foo: bar
                abc: 123",
                json::json!({"foo": "bar", "abc": 123}),
            ),
        ];
        for (i, (s, j)) in values.into_iter().enumerate() {
            let j2 = json::Value::from_yaml_str(s)
                .unwrap_or_else(|e| panic!("invalid yaml {:?}\nindex {}", e, i));
            assert_eq!(j2, j, "failed at index {}", i);
        }
    }

    #[test]
    fn from_yaml_bool() {
        let values = vec![("true", Some(true)), ("false", Some(false)), ("on", None)];
        for (i, (s, b)) in values.into_iter().enumerate() {
            let b2 = bool::from_yaml_str(s);
            match (b, &b2) {
                (None, _) => assert!(b2.is_err(), "failed at index {}", i),
                (Some(b), Ok(b2)) => assert_eq!(*b2, b, "failed at index {}", i),
                _ => panic!("failed at index {} with `{:?}` and `{:?}`", i, b, b2),
            }
        }
    }

    #[test]
    fn from_yaml_non_zero_u16() {
        let values = vec![
            ("1234", Some(NonZeroU16::new(1234).unwrap())),
            ("65536", None),
            ("0", None),
            ("-47", None),
            ("on", None),
        ];
        for (i, (s, n)) in values.into_iter().enumerate() {
            let n2 = NonZeroU16::from_yaml_str(s);
            match (n, &n2) {
                (None, _) => assert!(n2.is_err(), "failed at index {}", i),
                (Some(n), Ok(n2)) => assert_eq!(*n2, n, "failed at index {}", i),
                _ => panic!("failed at index {} with `{:?}` and `{:?}`", i, n, n2),
            }
        }
    }

    #[test]
    fn from_yaml_non_zero_usize() {
        let values = vec![
            ("1234", Some(NonZeroUsize::new(1234).unwrap())),
            ("0", None),
            ("-47", None),
            ("on", None),
        ];
        for (i, (s, n)) in values.into_iter().enumerate() {
            let n2 = NonZeroUsize::from_yaml_str(s);
            match (n, &n2) {
                (None, _) => assert!(n2.is_err(), "failed at index {}", i),
                (Some(n), Ok(n2)) => assert_eq!(*n2, n, "failed at index {}", i),
                _ => panic!("failed at index {} with `{:?}` and `{:?}`", i, n, n2),
            }
        }
    }

    #[test]
    fn from_yaml_i64() {
        let values = vec![
            ("1234", Some(1234i64)),
            ("0", Some(0)),
            ("-47", Some(-47)),
            ("on", None),
        ];
        for (i, (s, n)) in values.into_iter().enumerate() {
            let n2 = i64::from_yaml_str(s);
            match (n, &n2) {
                (None, _) => assert!(n2.is_err(), "failed at index {}", i),
                (Some(n), Ok(n2)) => assert_eq!(*n2, n, "failed at index {}", i),
                _ => panic!("failed at index {} with `{:?}` and `{:?}`", i, n, n2),
            }
        }
    }

    #[test]
    fn from_yaml_usize() {
        let values = vec![
            ("1234", Some(1234usize)),
            ("0", Some(0)),
            ("-47", None),
            ("on", None),
        ];
        for (i, (s, n)) in values.into_iter().enumerate() {
            let n2 = usize::from_yaml_str(s);
            match (n, &n2) {
                (None, _) => assert!(n2.is_err(), "failed at index {}", i),
                (Some(n), Ok(n2)) => assert_eq!(*n2, n, "failed at index {}", i),
                _ => panic!("failed at index {} with `{:?}` and `{:?}`", i, n, n2),
            }
        }
    }

    #[test]
    fn from_yaml_string() {
        let values = vec![
            ("1234", Some("1234")),
            ("foo bar baz", Some("foo bar baz")),
            ("'foo bar baz'", Some("foo bar baz")),
            (r#""foo bar baz""#, Some("foo bar baz")),
            ("foo: bar", None),
            ("- foo", None),
        ];
        for (i, (s, n)) in values.into_iter().enumerate() {
            let n2 = String::from_yaml_str(s);
            match (n, &n2) {
                (None, _) => assert!(n2.is_err(), "failed at index {}", i),
                (Some(n), Ok(n2)) => assert_eq!(*n2, n, "failed at index {}", i),
                _ => panic!("failed at index {} with `{:?}` and `{:?}`", i, n, n2),
            }
        }
    }

    #[test]
    fn from_yaml_vec() {
        let values = vec![
            (
                "
                - 123
                - 456
                ",
                Some(vec![123i64, 456]),
            ),
            ("foo: 123", None),
            ("'foo bar baz'", None),
            ("foo: bar", None),
            ("- foo", None),
        ];
        for (i, (s, n)) in values.into_iter().enumerate() {
            let n2: Result<Vec<i64>, _> = Vec::from_yaml_str(s);
            match (&n, &n2) {
                (None, _) => assert!(n2.is_err(), "failed at index {}", i),
                (Some(n), Ok(n2)) => assert_eq!(n2, n, "failed at index {}", i),
                _ => panic!("failed at index {} with `{:?}` and `{:?}`", i, n, n2),
            }
        }
    }

    #[test]
    fn from_yaml_nullable() {
        let values = vec![
            (
                "
                - 123
                - 456
                ",
                None,
            ),
            (
                "
                foo: 123
                bar: 456
                ",
                None,
            ),
            (
                "'foo bar baz'",
                Some(Nullable::Some("foo bar baz".to_string())),
            ),
            ("!!null 'foo bar baz'", Some(Nullable::Null)),
            ("null", Some(Nullable::Null)),
            ("foo: bar", None),
            ("- foo", None),
        ];
        for (i, (s, n)) in values.into_iter().enumerate() {
            let n2 = Nullable::from_yaml_str(s);
            match (&n, &n2) {
                (None, _) => assert!(n2.is_err(), "failed at index {} with {:?}", i, n2),
                (Some(n), Ok(n2)) => assert_eq!(n2, n, "failed at index {}", i),
                _ => panic!("failed at index {} with `{:?}` and `{:?}`", i, n, n2),
            }
        }
    }

    #[test]
    fn from_yaml_btreemap() {
        let values = vec![
            (
                "
                - 123
                - 456
                ",
                None,
            ),
            (
                "
                foo: 123
                bar: 456
                ",
                Some(btreemap! {
                    "foo".to_string() => 123i64,
                    "bar".to_string() => 456i64
                }),
            ),
            ("'foo bar baz'", None),
            ("foo: bar", None),
            ("- foo", None),
        ];
        for (i, (s, n)) in values.into_iter().enumerate() {
            let n2: Result<BTreeMap<String, i64>, _> = BTreeMap::from_yaml_str(s);
            match (&n, &n2) {
                (None, _) => assert!(n2.is_err(), "failed at index {} with {:?}", i, n2),
                (Some(n), Ok(n2)) => assert_eq!(n2, n, "failed at index {}", i),
                _ => panic!("failed at index {} with `{:?}` and `{:?}`", i, n, n2),
            }
        }
    }
}
