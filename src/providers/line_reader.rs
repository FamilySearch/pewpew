use crate::util::str_to_json;
use futures::Stream;
use rand::distributions::{Distribution, Uniform};
use serde_json as json;

use std::{
    fs::File,
    io::{self, Read, Seek},
    iter::{self, Iterator},
};

pub struct LineReader {
    buffer: String,
    byte_buffer: Vec<u8>,
    position: u64,
    positions: Vec<(io::SeekFrom, usize)>,
    random: Option<Uniform<usize>>,
    reader: File,
    repeat: bool,
}

impl LineReader {
    pub fn new(config: &config::FileProvider, file: &str) -> Result<Self, io::Error> {
        let mut jr = LineReader {
            buffer: String::with_capacity(8 * (1 << 10)),
            byte_buffer: vec![0; 8 * (1 << 10)],
            position: 0,
            positions: Vec::new(),
            random: None,
            reader: File::open(file)?,
            repeat: config.repeat,
        };
        if config.random {
            loop {
                match jr.get_value(None) {
                    Some(Ok((_, pos, length))) => {
                        jr.positions.push((io::SeekFrom::Start(pos), length))
                    }
                    Some(Err(e)) => return Err(e),
                    None => break,
                }
            }
            if !jr.positions.is_empty() {
                let random = Uniform::new(0, jr.positions.len());
                let rand_pos = jr.positions.get(random.sample(&mut rand::thread_rng()));
                if let Some((pos, _)) = rand_pos {
                    let pos = *pos;
                    jr.seek(pos)?;
                }
                jr.random = Some(random);
            }
        } else if config.repeat {
            jr.positions.push((io::SeekFrom::Start(0), 0));
        }
        Ok(jr)
    }

    fn get_value(
        &mut self,
        size_hint: Option<usize>,
    ) -> Option<Result<(json::Value, u64, usize), io::Error>> {
        let position = self.position;
        if let Some(hint) = size_hint {
            let extend_length = hint.checked_sub(self.byte_buffer.len());
            if let Some(extend_length) = extend_length {
                self.byte_buffer.extend(iter::repeat(0).take(extend_length));
            }
            let buf = &mut self.byte_buffer[..hint];
            self.position += hint as u64;
            if let Err(e) = self.reader.read_exact(buf) {
                return Some(Err(e));
            }
            self.buffer = String::from_utf8_lossy(buf).to_string();
        };
        let mut eof = false;
        loop {
            if eof && self.buffer.is_empty() {
                return None;
            }
            let new_line_index = self.buffer.find('\n');
            if new_line_index.is_some() || eof {
                let i = new_line_index.unwrap_or_else(|| self.buffer.len() - 1);
                let range = ..=i;
                let raw_value = &self.buffer[range];
                let length = raw_value.as_bytes().len();
                self.position += length as u64;
                let value = raw_value.trim_end_matches(|c| c == '\n' || c == '\r');
                let value = str_to_json(value);
                self.buffer.replace_range(range, "");
                return Some(Ok((value, position, length)));
            } else {
                let mut buf = &mut self.byte_buffer[..8 * (1 << 10)];
                match self.reader.read(&mut buf) {
                    Err(e) => return Some(Err(e)),
                    Ok(n) => {
                        if n == 0 {
                            eof = true;
                        }
                        self.buffer.push_str(&String::from_utf8_lossy(&buf[..n]))
                    }
                }
            }
        }
    }

    pub fn into_stream(self) -> impl Stream<Item = json::Value, Error = io::Error> {
        super::into_stream(self)
    }
}

impl Seek for LineReader {
    fn seek(&mut self, seek: io::SeekFrom) -> Result<u64, io::Error> {
        self.buffer.clear();
        let n = self.reader.seek(seek)?;
        self.position = n;
        Ok(n)
    }
}

impl Iterator for LineReader {
    type Item = Result<json::Value, io::Error>;

    fn next(&mut self) -> Option<Self::Item> {
        let size_hint = if let Some(random) = self.random {
            if self.positions.is_empty() {
                return None;
            }
            let i = random.sample(&mut rand::thread_rng()) % self.positions.len();
            let (pos, size) = if self.repeat {
                self.positions[i]
            } else {
                self.positions.remove(i)
            };
            if let Err(e) = self.seek(pos) {
                return Some(Err(e));
            }
            Some(size)
        } else {
            None
        };
        let result = self.get_value(size_hint);
        if result.is_none() && self.repeat {
            if let Some((pos, size)) = self.positions.first().cloned() {
                if let Err(e) = self.seek(pos) {
                    Some(Err(e))
                } else {
                    self.get_value(Some(size)).map(|r| r.map(|(v, ..)| v))
                }
            } else {
                None
            }
        } else {
            result.map(|r| r.map(|(v, ..)| v))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    use std::io::Write;

    const LINES: &[&str] = &[
        "[1,2,3]",
        "some bunch of text",
        "{",
        r#"  "foo": "bar""#,
        "}",
    ];

    #[test]
    fn line_reader_basics_works() {
        let fp = config::FileProvider::default();

        let expect = vec![
            json::json!([1, 2, 3]),
            json::json!("some bunch of text"),
            json::json!("{"),
            json::json!(r#"  "foo": "bar""#),
            json::json!("}"),
        ];

        for line_ending in &["\n", "\r\n"] {
            let mut tmp = NamedTempFile::new().unwrap();
            write!(tmp, "{}", LINES.join(line_ending)).unwrap();
            let path = tmp.path().to_str().unwrap().to_string();

            let values: Vec<_> = LineReader::new(&fp, &path)
                .unwrap()
                .map(Result::unwrap)
                .collect();

            assert_eq!(values, expect);
        }
    }
}
