// Relies on older version of jsonpath_lib
//#[cfg(feature = "legacy")]
//pub mod configv1;

mod configv2;
pub use configv2::*;

mod shared;

pub use shared::duration_from_string;

pub(crate) mod make_send;
