use super::{
    EndpointProvidesPreProcessed,
    EndpointProvidesSendOptions,
};
use itertools::Itertools;
use jsonpath;
use pest::{
    iterators::{Pairs, Pair},
    Parser as PestParser,
};
use pest_derive::Parser;
use regex::Regex;
use serde_json as json;

use std::{
    borrow::Cow,
    collections::BTreeSet,
    fmt,
    iter,
    sync::Arc,
};

#[derive(Clone)]
enum FunctionArg {
    FunctionCall(FunctionCall),
    Value(Value),
}

#[derive(Clone)]
enum FunctionCall {
    JsonPath(Arc<jsonpath::Selector>, String),
    Repeat(usize),
}

impl fmt::Debug for FunctionCall {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            FunctionCall::JsonPath(_, selector) =>
                write!(f, "FunctionCall {{ JsonPath({}) }}", selector),
            FunctionCall::Repeat(n) =>
                write!(f, "FunctionCall {{ Repeat({}) }}", n),
        }
    }
}

impl FunctionCall {
    fn new (ident: &str, args: &[FunctionArg]) -> Self {
        if ident == "json_path" {
            match (args.len(), args.first()) {
                // TODO: if there's ever another function which returns a string, modify this to allow a nested function
                (1, Some(FunctionArg::Value(Value::JsonValue(false, json::Value::String(json_path))))) => {
                    // parse out the provider name, or if it's `request` or `response` get the second layer
                    // TODO: make this more versatile so ['request'].body is parsed properly
                    let object_name_re = Regex::new(r"^((?:request\.|response\.)?[^\[.]*)").unwrap();
                    let provider = object_name_re.captures(json_path).unwrap()
                        .get(1).expect("invalid json path query")
                        .as_str().into();
                    // jsonpath requires the query to start with `$.`, so add it in
                    let json_path = format!("$.{}", json_path);
                    let json_path = jsonpath::Selector::new(&json_path)
                         .unwrap_or_else(|e| panic!("invalid json path query, {}\n{:?}", json_path, e));
                    FunctionCall::JsonPath(Arc::new(json_path), provider)
                },
                _ => panic!("invalid arguments for json_path")
            }
        } else if ident == "repeat" {
            match (args.len(), args.first()) {
                (1, Some(FunctionArg::Value(Value::JsonValue(false, json::Value::Number(n))))) if n.is_u64() => {
                    FunctionCall::Repeat(n.as_u64().unwrap() as usize)
                },
                 _ => panic!("invalid arguments for repeat")
            }
        } else {
            panic!("unknown function reference `{}`", ident);
        }
    }

    fn evaluate<'a>(&self, d: &'a json::Value) -> impl Iterator<Item=json::Value> + Clone {
        match &self {
            FunctionCall::JsonPath(jp, _) => {
                let result = jp.find(d);
                let v: Vec<_> = result.cloned().collect();
                EitherTwoIterator::A(v.into_iter())
            },
            FunctionCall::Repeat(n) => 
                EitherTwoIterator::B(iter::repeat(json::Value::Null).take(*n)),
        }
    }

    fn get_providers(&self) -> BTreeSet<String> {
        let mut ret = BTreeSet::new();
        if let FunctionCall::JsonPath(_, p) = &self {
            ret.insert(p.clone());
        }
        ret
    }
}

fn index_json<'a>(json: &'a json::Value, index: &JsonPathSegment) -> Cow<'a, json::Value> {
    let o = match (json, index) {
        (json::Value::Object(m), JsonPathSegment::String(s)) => m.get(s),
        (json::Value::Array(a), JsonPathSegment::Number(n)) => a.get(*n),
        _ => panic!("cannot index into json {}", json)
    };
    Cow::Borrowed(o.unwrap_or(&json::Value::Null))
}

fn index_json2<'a>(mut json: &'a json::Value, indexes: &[JsonPathSegment]) -> Cow<'a, json::Value> {
    for index in indexes {
        let o = match (json, index) {
            (json::Value::Object(m), JsonPathSegment::String(s)) => m.get(s),
            (json::Value::Array(a), JsonPathSegment::Number(n)) => a.get(*n),
            _ => panic!("cannot index into json {}. Indexes: {:?}", json, indexes),
        };
        json = o.unwrap_or(&json::Value::Null)
    }
    Cow::Borrowed(json)
}

#[derive(Clone, Debug)]
struct JsonPath {
    start: JsonPathStart,
    rest: Vec<JsonPathSegment>,
}

impl JsonPath {
    fn evaluate<'a>(&self, d: &'a json::Value) -> impl Iterator<Item=json::Value> + Clone {
        match &self.start {
            JsonPathStart::FunctionCall(fnc) => {
                let rest = self.rest.clone();
                EitherTwoIterator::A(
                    fnc.evaluate(d).map(move |j| index_json2(&j, &rest).into_owned())
                )
            },
            JsonPathStart::JsonIdent(s) => {
                let j = index_json(d, &JsonPathSegment::String(s.clone()));
                EitherTwoIterator::B(
                    iter::once(index_json2(&j, &self.rest).into_owned())
                )
            }
        }
    }

    fn get_providers(&self) -> BTreeSet<String> {
        let mut ret = BTreeSet::new();
        match &self.start {
            JsonPathStart::FunctionCall(fnc) => ret.extend(fnc.get_providers()),
            JsonPathStart::JsonIdent(s) => {
                match (s.as_ref(), self.rest.first()) {
                    ("request", Some(JsonPathSegment::String(s2))) | ("response", Some(JsonPathSegment::String(s2))) =>
                        ret.insert(format!("{}.{}", s, s2)),
                    _ => ret.insert(s.clone())
                };
            },
        }
        ret
    }
}

fn bool_value(json: &json::Value) -> bool {
    match json {
        json::Value::Null => false,
        json::Value::Bool(b) => *b,
        json::Value::Number(n) if n.is_i64() => n.as_i64().unwrap() != 0,
        json::Value::Number(n) if n.is_u64() => n.as_u64().unwrap() != 0,
        json::Value::Number(n) if n.is_f64() => n.as_f64().unwrap() != 0f64,
        json::Value::Number(_) => unreachable!("number that is not an integer or float"),
        json::Value::String(s) => !s.is_empty(),
        json::Value::Object(_) | json::Value::Array(_) => true,
    }
}

fn f64_value(json: &json::Value) -> f64 {
    if let Some(f) = json.as_f64() {
        f
    } else {
        std::f64::NAN
    }
}

type Not = bool;

#[derive(Debug, Clone)]
enum Value {
    JsonPath(Not, JsonPath),
    JsonValue(Not, json::Value),
}

impl Value {
    fn evaluate<'a, 'b: 'a>(&'b self, d: &'a json::Value) -> Cow<'a, json::Value> {
        let (not, v) = match self {
            Value::JsonPath(not, path) => {
                let mut v: Vec<_> = path.evaluate(d).collect();
                let c = if v.is_empty() {
                    unreachable!("path should never return no elements");
                } else if v.len() == 1 {
                    Cow::Owned(v.pop().unwrap())
                } else {
                    Cow::Owned(json::Value::Array(v))
                };
                (*not, c)
            },
            Value::JsonValue(not, value) => (*not, Cow::Borrowed(value)),
        };
        if not {
            Cow::Owned(json::Value::Bool(!bool_value(&v)))
        } else {
            v
        }
    }

    fn evaluate_as_iter<'a>(&self, d: &'a json::Value) -> impl Iterator<Item=json::Value> + Clone {
        match self {
            Value::JsonPath(not, path) => {
                let not = *not;
                EitherThreeIterator::A(
                    iter::Iterator::flatten(
                        path.evaluate(d)
                            .map(|v| {
                                if let json::Value::Array(v) = v {
                                    EitherTwoIterator::A(v.into_iter())
                                } else {
                                    EitherTwoIterator::B(iter::once(v))
                                }
                            })
                    )
                    .map(move |v| {
                        if not {
                            json::Value::Bool(!bool_value(&v))
                        } else {
                            v
                        }
                    })
                )
            },
            Value::JsonValue(not, value) => {
                let value = if *not {
                    json::Value::Bool(!bool_value(&value))
                } else {
                    value.clone()
                };
                match value {
                    json::Value::Array(v) => EitherThreeIterator::B(v.into_iter()),
                    _ => EitherThreeIterator::C(iter::once(value)),
                }
            },
        }
    }

    fn get_providers(&self) -> BTreeSet<String> {
        if let Value::JsonPath(_, p) = self {
            p.get_providers()
        } else {
            BTreeSet::new()
        }
    }
}

#[derive(Clone)]
enum EitherTwoIterator<A, B, T>
    where
        A: Iterator<Item=T> + Clone,
        B: Iterator<Item=T> + Clone,
{
    A(A),
    B(B),
}

impl<A, B, T> Iterator for EitherTwoIterator<A, B, T>
    where
        A: Iterator<Item=T> + Clone,
        B: Iterator<Item=T> + Clone,
{
    type Item=T;

    fn next(&mut self) -> Option<Self::Item> {
        match self {
            EitherTwoIterator::A(a) => a.next(),
            EitherTwoIterator::B(b) => b.next(),
        }
    }
}

#[derive(Clone)]
enum EitherThreeIterator<A, B, C, T>
    where
        A: Iterator<Item=T> + Clone,
        B: Iterator<Item=T> + Clone,
        C: Iterator<Item=T> + Clone,
{
    A(A),
    B(B),
    C(C),
}

impl<A, B, C, T> Iterator for EitherThreeIterator<A, B, C, T>
    where
        A: Iterator<Item=T> + Clone,
        B: Iterator<Item=T> + Clone,
        C: Iterator<Item=T> + Clone,
{
    type Item=T;

    fn next(&mut self) -> Option<Self::Item> {
        match self {
            EitherThreeIterator::A(a) => a.next(),
            EitherThreeIterator::B(b) => b.next(),
            EitherThreeIterator::C(c) => c.next(),
        }
    }
}

#[derive(Clone, Debug)]
enum JsonPathSegment {
    Number(usize),
    String(String),
}

#[derive(Clone, Debug)]
enum JsonPathStart {
    FunctionCall(FunctionCall),
    JsonIdent(String),
}

#[derive(Clone, PartialEq)]
enum Combiner {
    And,
    Or,
}

#[derive(Clone)]
enum Operator {
    Eq,
    Gt,
    Gte,
    Lt,
    Lte,
    Ne,
}

#[derive(Clone)]
enum Expression {
    Complex(ComplexExpression),
    Simple(SimpleExpression),
}

impl Expression {
    fn execute<'a>(&self, d: &'a json::Value) -> bool {
        match self {
            Expression::Complex(c) => c.execute(d),
            Expression::Simple(s) => s.execute(d),
        }
    }
}

#[derive(Clone)]
struct ComplexExpression {
    combiner: Combiner,
    pieces: Vec<Expression>,
}

impl ComplexExpression {
    fn execute(&self, d: &json::Value) -> bool {
        match self.combiner {
            Combiner::And => self.pieces.iter().all(|e| e.execute(d)),
            Combiner::Or => self.pieces.iter().any(|e| e.execute(d)),
        }
    }

    fn get_providers(&self) -> BTreeSet<String> {
        let mut providers = BTreeSet::new();
        for piece in &self.pieces {
            match piece {
                Expression::Simple(se) => {
                    providers.extend(se.lhs.get_providers());
                    if let Some((_, rhs)) = &se.rest {
                        providers.extend(rhs.get_providers());
                    }
                },
                Expression::Complex(ce) => providers.extend(ce.get_providers()),
            }
        }
        providers
    }
}

#[derive(Clone)]
struct SimpleExpression {
    lhs: Value,
    rest: Option<(Operator, Value)>,
}

impl SimpleExpression {
    fn execute(&self, d: &json::Value) -> bool {
        let left = self.lhs.evaluate(d);
        if let Some((operator, right_value)) = &self.rest {
            let right = right_value.evaluate(d);
            match operator {
                Operator::Eq => left.eq(&right),
                Operator::Gt => f64_value(&left) > f64_value(&right),
                Operator::Gte => f64_value(&left) >= f64_value(&right),
                Operator::Lt => f64_value(&left) < f64_value(&right),
                Operator::Lte => f64_value(&left) <= f64_value(&right),
                Operator::Ne => left.ne(&right),
            }
        } else {
            bool_value(&left)
        }
    }
}

#[derive(Clone)]
enum ParsedSelect {
    Null,
    Bool(bool),
    Number(json::Number),
    Value(Value),
    Array(Vec<ParsedSelect>),
    Object(Vec<(String, ParsedSelect)>),
}

impl ParsedSelect {
    fn evaluate(&self, d: &json::Value) -> json::Value {
        match self {
            ParsedSelect::Null => json::Value::Null,
            ParsedSelect::Bool(b) => json::Value::Bool(*b),
            ParsedSelect::Number(n) => json::Value::Number(n.clone()),
            ParsedSelect::Value(v) => v.evaluate(d).into_owned(),
            ParsedSelect::Array(v) => {
                let v = v.iter().map(|p| p.evaluate(d))
                    .collect();
                json::Value::Array(v)
            },
            ParsedSelect::Object(v) => {
                let m = v.iter().map(|(k, v)| (k.clone(), v.evaluate(d)))
                    .collect();
                json::Value::Object(m)
            },
        }
    }

    fn get_providers(&self) -> BTreeSet<String> {
        let mut providers = BTreeSet::new();
        match self {
            ParsedSelect::Value(v) => {
                providers.extend(v.get_providers());
            },
            ParsedSelect::Array(v) => {
                for ps in v {
                    providers.extend(ps.get_providers());
                }
            },
            ParsedSelect::Object(v) => {
                for (_, ps) in v {
                    providers.extend(ps.get_providers());
                }
            }
            _ => ()
        }
        providers
    }
}

pub const REQUEST_STARTLINE: u8 = 0b00_000_100;
pub const REQUEST_HEADERS: u8 = 0b00_000_010;
pub const REQUEST_BODY: u8 = 0b00_000_001;
const REQUEST_ALL: u8 = REQUEST_STARTLINE | REQUEST_HEADERS | REQUEST_BODY;
pub const RESPONSE_STARTLINE: u8 = 0b00_100_000;
pub const RESPONSE_HEADERS: u8 = 0b00_010_000;
pub const RESPONSE_BODY: u8 = 0b00_001_000;
const RESPONSE_ALL: u8 = RESPONSE_STARTLINE | RESPONSE_HEADERS | RESPONSE_BODY;
const FOR_EACH: u8 = 0b01_000_000;
pub const STATS: u8 = 0b10_000_000;

#[derive(Clone, Parser)]
#[grammar = "config/select.pest"]
pub struct Select {
    join: Vec<Value>,
    providers: BTreeSet<String>,
    special_providers: u8,
    send_behavior: EndpointProvidesSendOptions,
    select: ParsedSelect,
    where_clause: Option<ComplexExpression>,
    where_clause_special_providers: u8,
}

fn providers_helper(incoming: BTreeSet<String>, outgoing: &mut BTreeSet<String>, bitwise: &mut u8) {
    for provider in incoming {
        match provider.as_ref() {
            "request.start-line" => *bitwise |= REQUEST_STARTLINE,
            "request.headers" => *bitwise |= REQUEST_HEADERS,
            "request.body" => *bitwise |= REQUEST_BODY,
            "request" => *bitwise |= REQUEST_ALL,
            "response.start-line" => *bitwise |= RESPONSE_STARTLINE,
            "response.headers" => *bitwise |= RESPONSE_HEADERS,
            "response.body" => *bitwise |= RESPONSE_BODY,
            "response" => *bitwise |= RESPONSE_ALL,
            "response.status" => (),
            "stats" => *bitwise |= STATS,
            "for_each" => *bitwise |= FOR_EACH,
            _ => { outgoing.insert(provider); }
        }
    }
}

impl Select {
    pub(super) fn new(provides: EndpointProvidesPreProcessed) -> Self {
        let mut providers = BTreeSet::new();
        let mut special_providers = 0;
        let join: Vec<_> = provides.for_each.iter().map(|s| {
            let pairs = Select::parse(Rule::value_entry, s).unwrap();
            let v = parse_value(pairs);
            let p = v.get_providers();
            if p.contains("for_each") {
                panic!("cannot reference `for_each` from within `for_each`");
            }
            providers_helper(p, &mut providers, &mut special_providers);
            v
        }).collect();
        let mut where_clause_special_providers = 0;
        let where_clause = provides.where_clause.as_ref().map(|s| {
            let pairs = Select::parse(Rule::where_entry, s).unwrap();
            let ce = parse_complex_expression(pairs);
            let p = ce.get_providers();
            providers_helper(p, &mut providers, &mut where_clause_special_providers);
            ce
        });
        special_providers |= where_clause_special_providers;
        let select = parse_select(provides.select);
        let p = select.get_providers();
        providers_helper(p, &mut providers, &mut special_providers);
        Select {
            join,
            providers,
            special_providers,
            select,
            send_behavior: provides.send,
            where_clause,
            where_clause_special_providers,
        }
    }

    pub fn get_providers(&self) -> &BTreeSet<String> {
        &self.providers
    }

    pub fn get_special_providers(&self) -> u8 {
        self.special_providers
    }

    pub fn get_send_behavior(&self) -> &EndpointProvidesSendOptions {
        &self.send_behavior
    }

    pub fn get_where_clause_special_providers(&self) -> u8 {
        self.where_clause_special_providers
    }

    pub fn execute_where(&self, d: &json::Value) -> bool {
        self.where_clause.as_ref().map(|wc| wc.execute(d))
            .unwrap_or(true)
    }

    pub fn as_iter(&self, mut d: json::Value) -> impl Iterator<Item=json::Value> + Clone {
        if self.join.is_empty() {
            if let Some(wc) = &self.where_clause {
                if wc.execute(&d) {
                    EitherThreeIterator::A(iter::once(self.select.evaluate(&d)))
                } else {
                    EitherThreeIterator::B(iter::empty())
                }
            } else {
                EitherThreeIterator::A(iter::once(self.select.evaluate(&d)))
            }
        } else {
            let references_for_each = self.special_providers & FOR_EACH != 0;
            let where_clause = self.where_clause.clone();
            let select = self.select.clone();
            EitherThreeIterator::C(self.join.iter()
                .map(|v| v.evaluate_as_iter(&d))
                .multi_cartesian_product()
                .filter_map(move |v| {
                    if references_for_each {
                        d = d.clone();
                        d.as_object_mut().unwrap().insert("for_each".to_string(), json::Value::Array(v));
                    }
                    if let Some(wc) = where_clause.clone() {
                        if wc.execute(&d) {
                            Some(select.evaluate(&d))
                        } else {
                            None
                        }
                    } else {
                        Some(select.evaluate(&d))
                    }
                })
            )
        }
    }
}

fn parse_select(select: json::Value) -> ParsedSelect {
    match select {
        json::Value::Null => ParsedSelect::Null,
        json::Value::Bool(b) => ParsedSelect::Bool(b),
        json::Value::Number(n) => ParsedSelect::Number(n),
        json::Value::String(s) => {
            let pairs = Select::parse(Rule::value_entry, &s).unwrap();
            let value = parse_value(pairs);
            ParsedSelect::Value(value)
        },
        json::Value::Array(a) => {
            let new = a.into_iter().map(parse_select).collect();
            ParsedSelect::Array(new)
        },
        json::Value::Object(m) => {
            let new = m.into_iter().map(|(k, v)| (k, parse_select(v))).collect();
            ParsedSelect::Object(new)
        }
    }
}

fn parse_function_call(pair: Pair<Rule>) -> FunctionCall {
    let mut ident = None;
    let mut args = Vec::new();
    for pair in pair.into_inner() {
        match pair.as_rule() {
            Rule::function_ident => {
                ident = Some(pair.as_str());
            },
            Rule::function_call => {
                args.push(FunctionArg::FunctionCall(parse_function_call(pair)));
            },
            Rule::value => {
                args.push(FunctionArg::Value(parse_value(pair.into_inner())));
            },
            r => unreachable!("unexpected rule for function call, `{:?}`", r)
        }
    }
    FunctionCall::new(ident.unwrap(), &args)
}

fn parse_indexed_property(pair: Pair<Rule>) -> JsonPathSegment {
    let pair = pair.into_inner().next().unwrap();
    match pair.as_rule() {
        Rule::string => JsonPathSegment::String(pair.as_str().into()),
        Rule::integer => JsonPathSegment::Number(pair.as_str().parse().unwrap()),
        r => unreachable!("unexpected rule for path segment, `{:?}`", r)
    }
}

fn parse_json_path(pair: Pair<Rule>) -> JsonPath {
    let mut start = None;
    let mut rest = Vec::new();
    for pair in pair.into_inner() {
        match pair.as_rule() {
            Rule::function_call => {
                if start.is_none() {
                    start = Some(
                        JsonPathStart::FunctionCall(parse_function_call(pair))
                    );
                } else {
                    unreachable!("encountered unexpected function call");
                }
            },
            Rule::json_ident => {
                let s = pair.as_str().into();
                if start.is_none() {
                    start = Some(JsonPathStart::JsonIdent(s));
                } else {
                    rest.push(JsonPathSegment::String(s));
                }
            },
            Rule::indexed_property => {
                if start.is_none() {
                    unreachable!("encountered unexpected indexed property");
                } else {
                    rest.push(parse_indexed_property(pair));
                }
            },
            r => unreachable!("unexpected rule for json path, `{:?}`", r)
        }
    }
    JsonPath { start: start.unwrap(), rest }
}

fn parse_value(pairs: Pairs<Rule>) -> Value {
    let mut not = false;
    for pair in pairs {
        match pair.as_rule() {
            Rule::not => {
                not = true;
            },
            Rule::boolean => {
                let b = match pair.as_str() {
                    "true" => true,
                    "false" => false,
                    s => unreachable!("unexpected boolean value, `{}`", s),
                };
                return Value::JsonValue(not, json::Value::Bool(b))
            },
            Rule::null => {
                return Value::JsonValue(not, json::Value::Null)
            },
            Rule::json_path => {
                return Value::JsonPath(not, parse_json_path(pair))
            },
            Rule::string => {
                return Value::JsonValue(not, json::Value::String(pair.as_str().into()))
            },
            Rule::integer | Rule::decimal => {
                return Value::JsonValue(
                    not,
                    json::Value::Number(std::str::FromStr::from_str(pair.as_str()).unwrap())
                )
            },
            r => unreachable!("unexpected rule for value, `{:?}`", r)
        }
    }
    unreachable!("unexpectedly reached end of function in parse_value")
}

fn parse_simple_expression(pair: Pair<Rule>) -> SimpleExpression {
    let mut lhs = None;
    let mut operator = None;
    let mut rhs = None;
    for pair in pair.into_inner() {
        match pair.as_rule() {
            Rule::value => {
                let v = Some(parse_value(pair.into_inner()));
                if lhs.is_none() {
                    lhs = v;
                } else {
                    rhs = v;
                }
            },
            Rule::operator => {
                let o = match pair.as_str() {
                    "==" => Operator::Eq,
                    "!=" => Operator::Ne,
                    ">=" => Operator::Gte,
                    "<=" => Operator::Lte,
                    ">" => Operator::Gt,
                    "<" => Operator::Lt,
                    o => unreachable!("unexpected operator, `{:?}`", o),
                };
                operator = Some(o);
            },
            r => unreachable!("unexpected rule for simple expression, `{:?}`", r)
        }
    }
    let rest = if let (Some(o), Some(r)) = (operator, rhs) {
        Some((o, r))
    } else {
        None
    };
    SimpleExpression { lhs: lhs.unwrap(), rest }
}

fn parse_complex_expression(pairs: Pairs<Rule>) -> ComplexExpression {
    let mut ret = ComplexExpression {
        combiner: Combiner::And,
        pieces: Vec::new(),
    };
    let mut append_to_previous = false;
    for pair in pairs {
        let rule = pair.as_rule();
        match rule {
            Rule::simple_expression | Rule::group_expression => {
                let new = match rule {
                    Rule::simple_expression =>
                        Expression::Simple(parse_simple_expression(pair)),
                    Rule::group_expression =>
                        Expression::Complex(parse_complex_expression(pair.into_inner())),
                    _ => unreachable!("impossible"),
                };
                if append_to_previous {
                    // when we're in an "||" and we need to append an "&&"
                    append_to_previous = false;
                    if let Some(c) = {
                        match ret.pieces.last_mut().unwrap() {
                            Expression::Complex(c) => {
                                if let Combiner::And = c.combiner {
                                    Some(c)
                                } else {
                                    None
                                }
                            },
                            _ => None
                        }
                    } {
                        c.pieces.push(new);
                    } else {
                        let previous = ret.pieces.pop().unwrap();
                        let ce = ComplexExpression {
                            combiner: Combiner::And,
                            pieces: vec!(previous, new)
                        };
                        ret.pieces.push(Expression::Complex(ce));
                    }
                } else {
                    ret.pieces.push(new);
                }
            },
            Rule::combiner => {
                let c = match pair.as_str() {
                    "&&" => Combiner::And,
                    "||" => Combiner::Or,
                    c => unreachable!("unexpected combiner, `{:?}`", c),
                };
                if c != ret.combiner {
                    if ret.pieces.len() < 2 {
                        ret.combiner = c;
                    } else if c == Combiner::And {
                        append_to_previous = true;
                    } else {
                        ret = ComplexExpression {
                            combiner: c,
                            pieces: vec!(Expression::Complex(ret)),
                        }
                    }
                }
            },
            Rule::EOI => (),
            r => unreachable!("unexpected rule for complex expression, `{:?}`", r)
        }
    }
    ret
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value as JsonValue};


    fn check_results(select: JsonValue, data: JsonValue, expect: &[JsonValue], i: usize) {
        let select = create_select(select);
        let result: Vec<_> = select.as_iter(data).collect();
        assert_eq!(result.as_slice(), expect, "index {}", i)
    }

    fn create_select(json: JsonValue) -> Select {
        let eppp = json::from_value(json).unwrap();
        Select::new(eppp)
    }

    #[test]
    fn get_providers() {
        // (select json, where clause, expected providers returned from `get_providers`, expected providers in `get_special_providers`)
        let check_table = vec!(
            (json!(4), None, vec!(), 0),
            (json!("c[0].d"), None, vec!("c"), 0),
            (json!("request.body[0].d"), None, vec!(), REQUEST_BODY),
            (json!(r#"request["start-line"]"#), None, vec!(), REQUEST_STARTLINE),
            (json!("repeat(5)"), None, vec!(), 0),
            (json!(r#"json_path("c.*.d")"#), None, vec!("c"), 0),
            (json!(r#"json_path("c.*.d")"#), Some("true && false && true || response.body.id == 123"), vec!("c"), RESPONSE_BODY),
            (json!(r#"json_path("c.foo.*.d")"#), None, vec!("c"), 0),
            (json!(r#"json_path("c.foo.*.d")"#), None, vec!("c"), 0),
            (json!(r#"json_path("response.headers.*.d")"#), None, vec!(), RESPONSE_HEADERS),
            (json!(r#"for_each[0]"#), None, vec!(), FOR_EACH),
            (json!(r#"stats.rtt"#), None, vec!(), STATS),
            (
                json!({"z": 42, "dees": r#"json_path("c.*.d")"#, "x": "foo"}),
                None,
                vec!("c", "foo"),
                0
            )
        );

        for (i, (select, where_clause, providers_expect, rr_expect)) in check_table.into_iter().enumerate() {
            let s = if let Some(wc) = where_clause {
                create_select(json!({ "select": select, "where": wc }))
            } else {
                create_select(json!({ "select": select }))
            };
            let providers: Vec<_> = std::iter::FromIterator::from_iter(s.get_providers());
            let rr_providers = s.get_special_providers();
            assert_eq!(providers, providers_expect, "index {}", i);
            assert_eq!(rr_providers, rr_expect, "index {}", i);
        }

    }

    #[test]
    fn select() {
        let data = json!({
            "a": 3,
            "b": { "foo": "bar" },
            "c": [
                { "d": 1 },
                { "d": 2 },
                { "d": 3 },
            ]
        });

        // (select json, expected out data)
        let check_table = vec!(
            (json!(4), vec!(json!(4))),
            (json!("c[0].d"), vec!(json!(1))),
            (json!(r#"json_path("c.*.d")"#), vec!(json!([1, 2, 3]))),
            (json!("repeat(5)"), vec!(json!([null, null, null, null, null]))),
            (
                json!({"z": 42, "dees": r#"json_path("c.*.d")"#}),
                vec!(json!({"z": 42, "dees": [1, 2, 3]}))
            )
        );

        for (i, (select, expect)) in check_table.into_iter().enumerate() {
            let data = data.clone();
            let s = json!({ "select": select });
            check_results(s, data, &expect, i);
        }

    }

    #[test]
    fn r#where() {
        let data = json!({
            "three": 3,
            "empty_object": {},
            "empty_array": [],
        });

        let three = vec!(json!(3));
        let empty = Vec::new();

        // (where clause, expected out data)
        let check_table = vec!(
            ("three > 2", &three),
            ("three > 3", &empty),
            ("three < 4", &three),
            ("three < 2", &empty),
            ("three != 2", &three),
            ("three != 3", &empty),
            ("three >= 3", &three),
            ("three >= 4", &empty),
            ("three <= 3", &three),
            ("three <= 2", &empty),
            ("three == 3", &three),
            ("three == 4", &empty),
            ("true", &three),
            ("false", &empty),
            ("1 > 2", &empty),
            (r#""""#, &empty),
            (r#""beep""#, &three),
            ("empty_object", &three),
            ("empty_array", &three),
            ("0", &empty),
            ("0.0", &empty),
            ("-3", &three),
            ("true && false", &empty),
            ("false || true", &three),
            ("true && false || true", &three),
            ("true && (false || true)", &three),
            ("(true && false) || true", &three),
            ("true && false || true", &three),
            ("false || true && false", &empty),
            ("false || (true || false) && false", &empty),
            ("false || (true && false) && true", &empty),
            ("false || (true || false) && true", &three),
        );

        for (i, (where_clause, expect)) in check_table.into_iter().enumerate() {
            let data = data.clone();
            let select = json!({
                "select": "three",
                "where": where_clause
            });
            check_results(select, data, expect, i);
        }
    }

    #[test]
    fn for_each() {
        let data = json!({
            "a": 3,
            "b": { "foo": "bar" },
            "c": [
                { "d": 1 },
                { "d": 2 },
                { "d": 3 },
            ]
        });

        // (select, for_each, expect)
        let check_table = vec!(
            (json!("a"), vec!("repeat(5)"), vec!(json!(3), json!(3), json!(3), json!(3), json!(3))),
            (json!("for_each[0]"), vec!(r#"json_path("c.*.d")"#), vec!(json!(1), json!(2), json!(3))),
            (json!("for_each[0]"), vec!("c"), vec!(json!({ "d": 1 }), json!({ "d": 2 }), json!({ "d": 3 }))),
            (
                json!("for_each[1]"),
                vec!("repeat(2)", r#"json_path("c.*.d")"#),
                vec!(json!(1), json!(2), json!(3), json!(1), json!(2), json!(3))
            ),
        );

        for (i, (select, for_each, expect)) in check_table.into_iter().enumerate() {
            let data = data.clone();
            let select = json!({
                "select": select,
                "for_each": for_each
            });
            check_results(select, data, &expect, i);
        }

    }
}