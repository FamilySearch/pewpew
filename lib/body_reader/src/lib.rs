use brotli_decompressor as brotli;
use bytes::{Bytes, BytesMut};
use libflate::non_blocking::{deflate, gzip};

use std::{
    cmp,
    io::{self, Read},
    iter,
};

#[derive(Debug)]
struct VecDequeReader(BytesMut);

impl Read for VecDequeReader {
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

impl VecDequeReader {
    fn new() -> Self {
        VecDequeReader(BytesMut::with_capacity(8192))
    }
}

pub enum Compression {
    Brotli,
    Deflate,
    Gzip,
    None,
}

impl Compression {
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
    Brotli(Box<brotli::Decompressor<VecDequeReader>>),
    Deflate(Box<deflate::Decoder<VecDequeReader>>),
    Gzip(Box<gzip::Decoder<VecDequeReader>>),
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
                Inner::Brotli(brotli::Decompressor::new(VecDequeReader::new(), 8192).into())
            }
            Compression::Deflate => {
                Inner::Deflate(deflate::Decoder::new(VecDequeReader::new()).into())
            }
            Compression::Gzip => Inner::Gzip(gzip::Decoder::new(VecDequeReader::new()).into()),
            Compression::None => Inner::None,
        };
        let mut buffer = BytesMut::with_capacity(8192);
        buffer.extend(iter::repeat(0).take(8192));
        BodyReader { buffer, inner }
    }

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
