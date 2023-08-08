//! Makes any arbitrary type T Send. Mainly used for scripting Context.
//! Uses DiplomaticBag normally, which defers operations to background shared worker thread,
//! but just contains a T in wasm32 builds, where threads are not supported and the regular
//! DiplomaticBag would cause a panic

#![allow(dead_code, clippy::needless_return, unused_imports)]

use diplomatic_bag::DiplomaticBag;

#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MakeSend<T>(DiplomaticBag<T>);

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MakeSend<T>(T);

impl<T> MakeSend<T> {
    /// Creates a new `MakeSend` from the value returned by the function.
    ///
    /// In non-wasm builds, forwards directly to [`DiplomaticBag::new`]
    pub(crate) fn new<F: FnOnce() -> T + Send>(f: F) -> Self {
        #[cfg(not(target_arch = "wasm32"))]
        {
            return Self(DiplomaticBag::new(|_| f()));
        }
        #[cfg(target_arch = "wasm32")]
        {
            return Self(f());
        }
    }

    pub(crate) fn try_new<E: Send, F: FnOnce() -> Result<T, E> + Send>(f: F) -> Result<Self, E> {
        #[cfg(not(target_arch = "wasm32"))]
        return DiplomaticBag::new(|_| f())
            .transpose()
            .map_err(DiplomaticBag::into_inner)
            .map(Self);
        #[cfg(target_arch = "wasm32")]
        f().map(Self)
    }

    pub(crate) fn as_ref(&self) -> MakeSend<&T> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            return MakeSend(self.0.as_ref());
        }
        #[cfg(target_arch = "wasm32")]
        {
            return MakeSend(&self.0);
        }
    }

    pub(crate) fn and_then<U: Send, F: FnOnce(T) -> U + Send>(self, f: F) -> U {
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.0.and_then(|_, x| f(x))
        }
        #[cfg(target_arch = "wasm32")]
        {
            f(self.0)
        }
    }
}

// Safety: Only unsafe-impled in wasm32 builds, where threads are not supported
// In non-wasm32 builds, Diplomatic Bag handles Send + Sync

#[cfg(target_arch = "wasm32")]
unsafe impl<T> Send for MakeSend<T> {}

#[cfg(target_arch = "wasm32")]
unsafe impl<T> Sync for MakeSend<T> {}
