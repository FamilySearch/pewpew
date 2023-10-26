use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, Expr, ExprLit, ExprPath, Item, ItemFn, ItemMod, Lit, Path};

/// Write needed boilerplate code around the function to make the signature align with the one
/// required by boa engine.
///
/// The original function is defined as initially written inside the new (same named) function, and
/// is not externally accessible
#[proc_macro_attribute]
pub fn boa_fn(_attrs: TokenStream, input: TokenStream) -> TokenStream {
    let fun = parse_macro_input!(input as ItemFn);
    let name = &fun.sig.ident;
    let arg_count = fun.sig.inputs.len();
    let ac = 0..arg_count;
    quote! {
        pub(super) fn #name(_: &::boa_engine::JsValue,
            args: &[::boa_engine::JsValue],
            ctx: &mut ::boa_engine::Context) -> ::boa_engine::JsResult<boa_engine::JsValue> {
            use ::boa_engine::builtins::JsArgs;
            use self::helper::{AsJsResult, JsInput};

            // original function
            #fun

            ::log::debug!("calling expression function {:?}", stringify!(#name));
            #name (#(JsInput::from_js(args.get_or_undefined(#ac), ctx)?),*).as_js_result(ctx)
        }
    }
    .into()
}

/// creates a phf map containing all of the `#[boa_fn]` functions, as well as a function that
/// returns a new Context with all the functions inserted.
#[proc_macro_attribute]
pub fn boa_mod(_attrs: TokenStream, input: TokenStream) -> TokenStream {
    let modu = parse_macro_input!(input as ItemMod);
    let (vals, keys): (Vec<_>, Vec<_>) = modu
        .content
        .as_ref()
        .unwrap()
        .1
        .iter()
        .flat_map(|it| match it {
            // get all functions for the Context
            Item::Fn(f) => Some((
                (&f.sig.ident, f.sig.inputs.len()),
                f.attrs
                    .iter()
                    .filter(|&a| {
                        a.path()
                            // only include `#[boa_fn]` functions
                            .is_ident("boa_fn")
                    })
                    .filter_map(|a| a.parse_args::<Expr>().ok())
                    .filter_map(|e| match e {
                        Expr::Assign(ea) => match *ea.left {
                            Expr::Path(ExprPath {
                                path: Path { segments, .. },
                                ..
                            }) => match *ea.right {
                                Expr::Lit(ExprLit {
                                    lit: Lit::Str(ls), ..
                                }) => Some((
                                    segments.into_iter().next()?.ident.to_string(),
                                    ls.value(),
                                )),
                                _ => None,
                            },
                            _ => None,
                        },
                        _ => None,
                    })
                    // check the specifically defined `jsname`, or just use the function name.
                    .find_map(|(attr, name)| (attr == "jsname").then_some(name))
                    .unwrap_or(f.sig.ident.clone().to_string()),
            )),
            _ => None,
        })
        .unzip();
    let (vals, lens): (Vec<_>, Vec<_>) = vals.into_iter().unzip();
    let new_function = quote! {
        pub fn get_default_context() -> ::boa_engine::Context {
            static FUNCTIONS_MAP: ::phf::Map<&'static str, (::boa_engine::builtins::function::NativeFunctionSignature, usize)> = ::phf::phf_map! {
                #(#keys => (#vals, #lens)),*
            };
            let mut ctx = ::boa_engine::Context::default();
            for (k, (v, l)) in &FUNCTIONS_MAP {
                ctx.register_global_function(k, *l, *v);
            }
            ctx
        }
    };
    let mut modu = modu;
    modu.content
        .as_mut()
        .unwrap()
        .1
        .push(Item::Verbatim(new_function));
    quote! {
        #modu
    }
    .into()
}
