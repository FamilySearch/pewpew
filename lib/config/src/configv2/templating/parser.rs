//! Parser for the structure of Template syntax.

use super::{Bool, False, TemplateType, True, TryDefault};
use ast::Segment as ASeg;
use derivative::Derivative;
use nom::error::Error as NomError;
use std::{
    convert::TryFrom,
    fmt::{self, Display},
};
use thiserror::Error;

#[derive(Debug, Error, PartialEq)]
pub enum TemplateParseError {
    #[error("parser error: {0}")]
    NomErr(#[from] NomError<String>),
    #[error("template type '{0}' can only contain a primitive expression")]
    ComplexPrimitive(char),
    #[error("template type '{0}' is not allowed in this field")]
    InvalidTemplateType(char),
    #[error("unrecognized template type {0}")]
    UnrecognizedTemplateType(char),
    #[error("${{x}} templates cannot appear inside of ${{x}} templates")]
    InvalidNested,
}

impl<'a> From<NomError<&'a str>> for TemplateParseError {
    fn from(value: NomError<&'a str>) -> Self {
        let NomError { input, code } = value;
        Self::NomErr(NomError {
            input: input.to_owned(),
            code,
        })
    }
}

#[derive(PartialEq, Eq, Derivative, Clone)]
#[derivative(Debug)]
pub enum Segment<T: TemplateType, IN: Bool = False> {
    Raw(String),
    Env(String, #[derivative(Debug = "ignore")] T::EnvsAllowed),
    Var(String, #[derivative(Debug = "ignore")] T::VarsAllowed),
    Prov(String, #[derivative(Debug = "ignore")] T::ProvAllowed),
    Expr(
        Vec<Segment<T, True>>,
        /// Any Segment type other than Expr is allowed nested
        #[derivative(Debug = "ignore")]
        IN::Inverse,
    ),
}

impl<T: TemplateType, IN: Bool> Display for Segment<T, IN> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fn esc(s: &str) -> String {
            s.replace('$', "$$")
        }
        match self {
            Self::Raw(s) => write!(f, "{}", esc(s)),
            Self::Env(e, _) => write!(f, "${{e:{}}}", esc(e)),
            Self::Var(v, _) => write!(f, "${{v:{}}}", esc(v)),
            Self::Prov(p, _) => write!(f, "${{p:{}}}", esc(p)),
            Self::Expr(v, _) => {
                write!(f, "${{x:")?;
                v.iter().try_for_each(|seg| Display::fmt(seg, f))?;
                write!(f, "}}")
            }
        }
    }
}

pub fn parse_template_string<T: TemplateType>(
    input: &str,
) -> Result<Vec<Segment<T, False>>, TemplateParseError> {
    ASeg::parse_all(input)?
        .into_iter()
        .map(Segment::try_from)
        .collect()
}

impl<'a, T: TemplateType, IN: Bool> TryFrom<ASeg<'a>> for Segment<T, IN> {
    type Error = TemplateParseError;

    fn try_from(value: ASeg) -> Result<Self, Self::Error> {
        use ast::TemplateSegment as ATem;
        match value {
            ASeg::Literal(r) => Ok(Self::Raw(r.iter().map(ToString::to_string).collect())),
            ASeg::Template(ATem { tag: 'e', inner }) => {
                Self::prim_gen(Self::Env, 'e', inner, || Self::allowed_flag('e'))
            }
            ASeg::Template(ATem { tag: 'v', inner }) => {
                Self::prim_gen(Self::Var, 'v', inner, || Self::allowed_flag('v'))
            }
            ASeg::Template(ATem { tag: 'p', inner }) => {
                Self::prim_gen(Self::Prov, 'p', inner, || Self::allowed_flag('p'))
            }
            ASeg::Template(ATem { tag: 'x', inner }) => {
                let flags = Self::outer_flag('x')?;
                let inner = inner
                    .into_iter()
                    .map(Segment::<T, True>::try_from)
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(Self::Expr(inner, flags))
            }
            ASeg::Template(ATem { tag, .. }) => {
                Err(TemplateParseError::UnrecognizedTemplateType(tag))
            }
        }
    }
}

impl<T: TemplateType, IN: Bool> Segment<T, IN> {
    fn allowed_flag<D: TryDefault>(tag: char) -> Result<D, TemplateParseError> {
        D::try_default().ok_or(TemplateParseError::InvalidTemplateType(tag))
    }

    fn outer_flag<D: TryDefault>(_tag: char) -> Result<D, TemplateParseError> {
        D::try_default().ok_or(TemplateParseError::InvalidNested)
    }

    #[allow(dead_code)]
    fn allowed_plus_outer<D: TryDefault, D2: TryDefault>(
        tag: char,
    ) -> Result<(D, D2), TemplateParseError> {
        Self::allowed_flag(tag).and_then(|a| Self::outer_flag(tag).map(|o| (a, o)))
    }

    fn prim_gen<F, D, F2>(
        f: F,
        tag: char,
        seg: Vec<ASeg>,
        f2: F2,
    ) -> Result<Self, TemplateParseError>
    where
        F: FnOnce(String, D) -> Self,
        F2: FnOnce() -> Result<D, TemplateParseError>,
    {
        as_primitive(seg)
            .ok_or(TemplateParseError::ComplexPrimitive(tag))
            .and_then(|x| Ok(f(x, f2()?)))
    }
}

fn as_primitive(seg: Vec<ASeg>) -> Option<String> {
    match &seg[..] {
        [ASeg::Literal(r)] => Some(r.iter().map(ToString::to_string).collect()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::TemplateParseError::*;
    use super::*;
    use crate::configv2::templating::{EnvsOnly, Regular, VarsOnly};

    fn get_d<D: TryDefault>() -> D {
        D::try_default().unwrap()
    }

    #[test]
    fn env_template() {
        type ET = Segment<EnvsOnly, False>;

        let input = "${e:HOME}/file.txt";
        let tem: Vec<ET> = parse_template_string(input).unwrap();
        assert_eq!(
            tem,
            vec![
                Segment::Env("HOME".to_owned(), get_d()),
                Segment::Raw("/file.txt".to_owned())
            ]
        );
        let input = "${x:foo(${e:HOME})}/file.txt";
        let tem: Vec<ET> = parse_template_string(input).unwrap();
        assert_eq!(
            tem,
            vec![
                Segment::Expr(
                    vec![
                        Segment::Raw("foo(".to_owned()),
                        Segment::Env("HOME".to_owned(), get_d()),
                        Segment::Raw(")".to_owned()),
                    ],
                    get_d()
                ),
                Segment::Raw("/file.txt".to_owned())
            ]
        );

        let input = "${v:x}";
        let err = parse_template_string::<EnvsOnly>(input).unwrap_err();
        assert_eq!(err, InvalidTemplateType('v'));
        let input = "${p:x}";
        let err = parse_template_string::<EnvsOnly>(input).unwrap_err();
        assert_eq!(err, InvalidTemplateType('p'));

        let input = "${e:foo${p:bar}}";
        let err = parse_template_string::<EnvsOnly>(input).unwrap_err();
        assert_eq!(err, ComplexPrimitive('e'));
    }

    #[test]
    fn var_templates() {
        let input = "foo-${v:bar}";
        let tem = parse_template_string::<VarsOnly>(input).unwrap();
        assert_eq!(
            tem,
            vec![
                Segment::Raw("foo-".to_owned()),
                Segment::Var("bar".to_owned(), get_d()),
            ]
        );
        let input = "${x:foo(${v:bar})}";
        let tem = parse_template_string::<VarsOnly>(input).unwrap();
        assert_eq!(
            tem,
            vec![Segment::Expr(
                vec![
                    Segment::Raw("foo(".to_owned()),
                    Segment::Var("bar".to_owned(), get_d()),
                    Segment::Raw(")".to_owned()),
                ],
                get_d()
            )]
        );

        let input = "${e:x}";
        let err = parse_template_string::<VarsOnly>(input).unwrap_err();
        assert_eq!(err, InvalidTemplateType('e'));
        let input = "${p:x}";
        let err = parse_template_string::<VarsOnly>(input).unwrap_err();
        assert_eq!(err, InvalidTemplateType('p'));

        let input = "${v:foo${p:bar}}";
        let err = parse_template_string::<VarsOnly>(input).unwrap_err();
        assert_eq!(err, ComplexPrimitive('v'));
    }

    #[test]
    fn simple_reg_templates() {
        let input = "foo-${v:bar}-${p:baz}";
        let tem = parse_template_string::<Regular>(input).unwrap();
        assert_eq!(
            tem,
            vec![
                Segment::Raw("foo-".to_owned()),
                Segment::Var("bar".to_owned(), get_d()),
                Segment::Raw("-".to_owned()),
                Segment::Prov("baz".to_owned(), get_d())
            ]
        );

        let input = "${e:d}";
        let err = parse_template_string::<Regular>(input).unwrap_err();
        assert_eq!(err, InvalidTemplateType('e'));

        let input = "${p:foo${p:bar}}";
        let err = parse_template_string::<Regular>(input).unwrap_err();
        assert_eq!(err, ComplexPrimitive('p'));
    }

    #[test]
    fn expr_reg_templates() {
        let input = "${v:bar}${p:baz}${x:foo(${p:foo})}";
        let tem = parse_template_string::<Regular>(input).unwrap();
        assert_eq!(
            tem,
            vec![
                Segment::Var("bar".to_owned(), get_d()),
                Segment::Prov("baz".to_owned(), get_d()),
                Segment::Expr(
                    vec![
                        Segment::Raw("foo(".to_owned()),
                        Segment::Prov("foo".to_owned(), get_d()),
                        Segment::Raw(")".to_owned())
                    ],
                    get_d()
                )
            ]
        );

        let input = "${x:${x:_}}";
        let err = parse_template_string::<Regular>(input).unwrap_err();
        assert_eq!(err, InvalidNested);
    }
}

mod ast {
    //! Parser for the raw tag-content structure.
    //!
    //! Checking for the specific tag types and which ones are allowed is done by the main parser
    //! module.
    use nom::{
        branch::alt,
        bytes::complete::tag,
        character::complete::{anychar, none_of},
        combinator::{all_consuming, recognize, value},
        error::{Error as NomError, ParseError},
        multi::{many0, many1},
        sequence::{delimited, separated_pair},
        Finish, IResult, Parser,
    };
    use std::fmt::{self, Display};

    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub enum Raw<'a> {
        Literal(&'a str),
        EscapedDollarSign,
    }

    impl<'a> Display for Raw<'a> {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(
                f,
                "{}",
                match self {
                    Self::Literal(s) => s,
                    Self::EscapedDollarSign => "$",
                }
            )
        }
    }

    impl<'a> Raw<'a> {
        fn escaped<E: ParseError<&'a str>>(input: &'a str) -> IResult<&str, Self, E> {
            value(Self::EscapedDollarSign, tag("$$"))(input)
        }

        /// `inner` check is to allow for "}" in the top level source
        ///
        /// # Example:
        /// `r#"{"a": 1, "b": ${p:e}}"#`
        ///
        /// without the inner check, the last '}' can't be parsed.
        fn literal<E: ParseError<&'a str>>(inner: bool) -> impl Parser<&'a str, Raw<'a>, E> {
            recognize(many1(none_of(if inner { "$}" } else { "$" }))).map(Self::Literal)
        }

        fn parse(inner: bool) -> impl Parser<&'a str, Raw<'a>, NomError<&'a str>> {
            alt((Self::escaped, Self::literal(inner)))
        }
    }

    #[derive(Debug, PartialEq, Eq)]
    pub enum Segment<'a> {
        Literal(Vec<Raw<'a>>),
        Template(TemplateSegment<'a>),
    }

    impl<'a> Segment<'a> {
        fn parse(inner: bool) -> impl Parser<&'a str, Segment<'a>, NomError<&'a str>> {
            alt((
                many1(Raw::parse(inner)).map(Self::Literal),
                TemplateSegment::parse.map(Self::Template),
            ))
        }

        pub fn parse_all(input: &'a str) -> Result<Vec<Segment>, NomError<&str>> {
            all_consuming(many0(Self::parse(false)))(input.trim())
                .finish()
                .map(|(_, v)| v)
        }
    }

    #[derive(Debug, PartialEq, Eq)]
    pub struct TemplateSegment<'a> {
        pub tag: char,
        pub inner: Vec<Segment<'a>>,
    }

    impl<'a> TemplateSegment<'a> {
        fn parse(input: &'a str) -> IResult<&str, Self> {
            delimited(
                tag("${"),
                separated_pair(anychar, tag(":"), many1(Segment::parse(true)))
                    .map(|(tag, inner)| Self { tag, inner }),
                tag("}"),
            )(input)
        }
    }

    #[cfg(test)]
    mod tests {
        use super::{Raw, Segment, TemplateSegment};
        use nom::{Finish, Parser};

        #[test]
        fn raws() {
            let input = "foo";
            let (rem, raw) = Raw::parse(false).parse(input).unwrap();
            assert_eq!(rem, "");
            assert_eq!(raw, Raw::Literal("foo"));
            let input = "$$";
            let (rem, raw) = Raw::parse(false).parse(input).unwrap();
            assert_eq!(rem, "");
            assert_eq!(raw, Raw::EscapedDollarSign);
            let input = "foo-${v:bar}";
            let (rem, raw) = Raw::parse(false).parse(input).unwrap();
            assert_eq!(rem, "${v:bar}");
            assert_eq!(raw, Raw::Literal("foo-"));
        }

        #[test]
        fn simple_templates() {
            let input = "${e:HOME}";
            let (rem, tem) = TemplateSegment::parse(input).unwrap();
            assert_eq!(rem, "");
            assert_eq!(
                tem,
                TemplateSegment {
                    tag: 'e',
                    inner: vec![Segment::Literal(vec![Raw::Literal("HOME")])]
                }
            );
            let input = "${r:$$}";
            let (rem, tem) = TemplateSegment::parse(input).unwrap();
            assert_eq!(rem, "");
            assert_eq!(
                tem,
                TemplateSegment {
                    tag: 'r',
                    inner: vec![Segment::Literal(vec![Raw::EscapedDollarSign])]
                }
            );
            let input = "${g:foo$$bar}";
            let (rem, tem) = TemplateSegment::parse(input).unwrap();
            assert_eq!(rem, "");
            assert_eq!(
                tem,
                TemplateSegment {
                    tag: 'g',
                    inner: vec![Segment::Literal(vec![
                        Raw::Literal("foo"),
                        Raw::EscapedDollarSign,
                        Raw::Literal("bar")
                    ])]
                }
            );
        }

        #[test]
        fn nested_templates() {
            let input = "${q:${m:foo}-bar}";
            let (rem, tem) = TemplateSegment::parse(input).unwrap();
            assert_eq!(rem, "");
            assert_eq!(
                tem,
                TemplateSegment {
                    tag: 'q',
                    inner: vec![
                        Segment::Template(TemplateSegment {
                            tag: 'm',
                            inner: vec![Segment::Literal(vec![Raw::Literal("foo")])]
                        }),
                        Segment::Literal(vec![Raw::Literal("-bar")])
                    ]
                }
            );
        }

        #[test]
        fn nested_templates_2() {
            // This doesn't need to be allowed according to the specification, but the ast can
            // handle it anyway
            let input = "${%:foo$$${g:bar$$${<:hello}}}";
            let (rem, tem) = TemplateSegment::parse(input).unwrap();
            assert_eq!(rem, "");
            assert_eq!(
                tem,
                TemplateSegment {
                    tag: '%',
                    inner: vec![
                        Segment::Literal(vec![Raw::Literal("foo"), Raw::EscapedDollarSign,]),
                        Segment::Template(TemplateSegment {
                            tag: 'g',
                            inner: vec![
                                Segment::Literal(
                                    vec![Raw::Literal("bar"), Raw::EscapedDollarSign,]
                                ),
                                Segment::Template(TemplateSegment {
                                    tag: '<',
                                    inner: vec![Segment::Literal(vec![Raw::Literal("hello")])]
                                })
                            ]
                        })
                    ]
                }
            );
        }

        #[test]
        fn full_segments() {
            let input = "lorem${y:ipsum}$$dolor${#:foo-${=:bar}+${~:baz}}";
            let template_str = Segment::parse_all(input).unwrap();
            assert_eq!(
                template_str,
                vec![
                    Segment::Literal(vec![Raw::Literal("lorem")]),
                    Segment::Template(TemplateSegment {
                        tag: 'y',
                        inner: vec![Segment::Literal(vec![Raw::Literal("ipsum")])]
                    }),
                    Segment::Literal(vec![Raw::EscapedDollarSign, Raw::Literal("dolor")]),
                    Segment::Template(TemplateSegment {
                        tag: '#',
                        inner: vec![
                            Segment::Literal(vec![Raw::Literal("foo-")]),
                            Segment::Template(TemplateSegment {
                                tag: '=',
                                inner: vec![Segment::Literal(vec![Raw::Literal("bar")])]
                            }),
                            Segment::Literal(vec![Raw::Literal("+")]),
                            Segment::Template(TemplateSegment {
                                tag: '~',
                                inner: vec![Segment::Literal(vec![Raw::Literal("baz")])]
                            })
                        ]
                    })
                ]
            );
        }

        #[test]
        fn no_empty_inner() {
            let input = "${w:}";
            let _ = TemplateSegment::parse(input).finish().unwrap_err();
        }
    }
}
