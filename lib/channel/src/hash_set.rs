use ahash::RandomState;
use dashmap::DashSet;
use serde::Serialize;

use std::{
    convert::TryInto,
    hash::{BuildHasher, Hasher},
    io::{Error as IOError, Write},
};

/// a hasher that takes the bytes that are written to it and returns
/// them as the hash. This is used because our custom HashSet will
/// only have hashes stored within
#[derive(Default)]
struct PassThroughHasher(u64);

impl Hasher for PassThroughHasher {
    fn write(&mut self, bytes: &[u8]) {
        if let Ok(b) = bytes.try_into() {
            self.0 = u64::from_ne_bytes(b);
        }
    }

    fn finish(&self) -> u64 {
        self.0
    }
}

/// builder for the `PassThroughHasher`. Necessary because DashSet requires
/// a `BuildHasher`
#[derive(Default, Clone, Copy)]
struct PassThroughHasherBuilder;

impl BuildHasher for PassThroughHasherBuilder {
    type Hasher = PassThroughHasher;

    fn build_hasher(&self) -> Self::Hasher {
        Default::default()
    }
}

/// The idea behind this custom HashSet and associated structs/traits:
/// we want to only store hashes within the hashset rather than storing the
/// item to be hashed. We have no need to store the original item because
/// it will be stored in the channel. Before inserting into a unique channel
/// it will hash the value and check if it's in the HashSet. After removing
/// an item from a unique channel that item's hash will be removed from the
/// hash set
pub struct HashSet {
    hasher: RandomState,
    inner: DashSet<u64, PassThroughHasherBuilder>,
}

impl HashSet {
    pub fn new() -> Self {
        Self {
            hasher: RandomState::new(),
            inner: Default::default(),
        }
    }

    /// insert a value into the hash set returning a boolean
    /// indicating whether the value was inserted into the set
    /// (it was not already in there)
    pub fn insert<H: Serialize>(&self, h: &H) -> bool {
        let hash = self.get_hash(h);
        self.inner.insert(hash)
    }

    /// removes a value from the hash set
    pub fn remove<H: Serialize>(&self, h: &H) {
        let hash = self.get_hash(h);
        self.inner.remove(&hash);
    }

    /// because json::Value does not implement Hash, we utilize the Serialize trait
    /// instead. If/when json::Value implements it, we can change the generic constraint
    /// to be for Hash instead of Serialize
    /// track: https://github.com/serde-rs/json/issues/747
    fn get_hash<H: Serialize>(&self, h: &H) -> u64 {
        let hasher = self.hasher.build_hasher();
        let mut helper = HashHelper(hasher);
        let _ = serde_json::to_writer(&mut helper, h);
        helper.0.finish()
    }
}

/// a helper struct to implment `Write` on top of a `Hasher`, we use `Write` to bridge the
/// gap between `Serialize` and `Hash`
struct HashHelper<H: Hasher>(H);

impl<H: Hasher> Write for HashHelper<H> {
    fn write(&mut self, buf: &[u8]) -> Result<usize, IOError> {
        self.0.write(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> Result<(), IOError> {
        Ok(())
    }
}
