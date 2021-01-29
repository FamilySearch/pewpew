use brotli_decompressor as brotli;
use bytes::{Buf, Bytes, BytesMut};
use libflate::non_blocking::{deflate, gzip};

use std::{
    cmp,
    io::{self, Read},
    iter,
};

// a reader to help us in getting the bytes out of a response body
#[derive(Debug)]
struct BytesReader(BytesMut);

impl Read for BytesReader {
    fn read(&mut self, buf: &mut [u8]) -> Result<usize, io::Error> {
        let amt = cmp::min(buf.len(), self.0.len());
        buf[..amt].copy_from_slice(&self.0[..amt]);
        self.0.advance(amt);
        if amt == 0 {
            Err(io::ErrorKind::WouldBlock.into())
        } else {
            Ok(amt)
        }
    }
}

impl BytesReader {
    fn new() -> Self {
        BytesReader(BytesMut::with_capacity(8192))
    }
}

// the different types of compression ("Content-Encoding" header in a response) we support when parsing a body
pub enum Compression {
    Brotli,
    Deflate,
    Gzip,
    None,
}

impl Compression {
    // used to determine the typeof compression from the value specified in "Content-Encoding" header
    pub fn try_from(ce: &str) -> Option<Compression> {
        match ce {
            "br" => Compression::Brotli.into(),
            "deflate" => Compression::Deflate.into(),
            "gzip" => Compression::Gzip.into(),
            "" => Compression::None.into(),
            _ => None,
        }
    }
}

enum Inner {
    Brotli(Box<brotli::Decompressor<BytesReader>>),
    Deflate(Box<deflate::Decoder<BytesReader>>),
    Gzip(Box<gzip::Decoder<BytesReader>>),
    None,
}

pub struct BodyReader {
    buffer: BytesMut,
    inner: Inner,
}

impl BodyReader {
    pub fn new(c: Compression) -> Self {
        let inner = match c {
            Compression::Brotli => {
                Inner::Brotli(brotli::Decompressor::new(BytesReader::new(), 8192).into())
            }
            Compression::Deflate => {
                Inner::Deflate(deflate::Decoder::new(BytesReader::new()).into())
            }
            Compression::Gzip => Inner::Gzip(gzip::Decoder::new(BytesReader::new()).into()),
            Compression::None => Inner::None,
        };
        let mut buffer = BytesMut::with_capacity(8192);
        buffer.extend(iter::repeat(0).take(8192));
        BodyReader { buffer, inner }
    }

    // used to decompress incoming bytes. The bytes to decompress are passed in as `in_bytes` and the decompressed bytes are written to `out_bytes`
    pub fn decode(&mut self, in_bytes: Bytes, out_bytes: &mut BytesMut) -> Result<(), io::Error> {
        match &mut self.inner {
            Inner::Brotli(r) => {
                r.get_mut().0.extend(in_bytes);
                loop {
                    match r.read(&mut self.buffer) {
                        Ok(n) if n == 0 => break,
                        Ok(n) => out_bytes.extend_from_slice(&self.buffer[0..n]),
                        Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => break,
                        Err(e) => return Err(e),
                    }
                }
            }
            Inner::Deflate(r) => {
                r.as_inner_mut().0.extend(in_bytes);
                loop {
                    match r.read(&mut self.buffer) {
                        Ok(n) if n == 0 => break,
                        Ok(n) => out_bytes.extend_from_slice(&self.buffer[0..n]),
                        Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => break,
                        Err(e) => return Err(e),
                    }
                }
            }
            Inner::Gzip(r) => {
                r.as_inner_mut().0.extend(in_bytes);
                loop {
                    match r.read(&mut self.buffer) {
                        Ok(n) if n == 0 => break,
                        Ok(n) => out_bytes.extend_from_slice(&self.buffer[0..n]),
                        Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => break,
                        Err(e) => return Err(e),
                    }
                }
            }
            Inner::None => out_bytes.extend(in_bytes),
        };
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cmp, io::Write};

    static TRUTH: &str = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.";

    trait IntoInner: Write {
        fn into_inner(self: Box<Self>) -> Vec<u8>;
    }

    impl IntoInner for ::brotli::CompressorWriter<Vec<u8>> {
        fn into_inner(self: Box<Self>) -> Vec<u8> {
            ::brotli::CompressorWriter::into_inner(*self)
        }
    }

    impl IntoInner for libflate::gzip::Encoder<Vec<u8>> {
        fn into_inner(self: Box<Self>) -> Vec<u8> {
            self.finish().unwrap().0
        }
    }

    impl IntoInner for libflate::deflate::Encoder<Vec<u8>> {
        fn into_inner(self: Box<Self>) -> Vec<u8> {
            self.finish().unwrap().0
        }
    }

    impl IntoInner for Vec<u8> {
        fn into_inner(self: Box<Self>) -> Vec<u8> {
            *self
        }
    }

    #[test]
    fn body_reader_works() {
        let brotli = ::brotli::CompressorWriter::new(Vec::new(), 4096, 11, 22);
        let gzip = libflate::gzip::Encoder::new(Vec::new()).unwrap();
        let deflate = libflate::deflate::Encoder::new(Vec::new());

        let flavors: Vec<(Box<dyn IntoInner>, &str)> = vec![
            (Box::new(brotli), "br"),
            (Box::new(gzip), "gzip"),
            (Box::new(deflate), "deflate"),
            (Box::new(Vec::new()), ""),
        ];

        for (i, (mut writer, compression)) in flavors.into_iter().enumerate() {
            let input: Bytes = {
                writer.write_all(TRUTH.as_bytes()).unwrap();
                let vec = writer.into_inner();
                vec.into()
            };

            let compression = Compression::try_from(compression).unwrap();
            let mut reader = BodyReader::new(compression);
            let mut decoded_bytes = BytesMut::new();
            for n in (0..input.len()).step_by(4) {
                let slice = input.slice(n..cmp::min(n + 4, input.len()));
                reader.decode(slice, &mut decoded_bytes).unwrap();
            }
            let decoded_bytes = decoded_bytes.freeze();
            let left = std::str::from_utf8(&decoded_bytes).unwrap();
            assert_eq!(left, TRUTH, "index {}", i);
        }
    }
}
