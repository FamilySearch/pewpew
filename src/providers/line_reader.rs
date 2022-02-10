use crate::util::str_to_json;
use rand::distributions::{Distribution, Uniform};
use serde_json as json;

static KB8: usize = 8 * (1 << 10);

use std::{
    fs::File,
    io::{self, Read, Seek},
    iter::{self, Iterator},
};

// A type of file reader that reads the file line by line.
// Each line is parsed as json and if invalid json, the string value for that line is used.
pub struct LineReader {
    byte_buffer: Vec<u8>,
    buf_data_len: usize,
    position: u64,
    positions: Vec<(io::SeekFrom, usize)>,
    random: Option<Uniform<usize>>,
    reader: File,
    repeat: bool,
}

impl LineReader {
    pub fn new(config: &config::FileProvider, file: &str) -> Result<Self, io::Error> {
        let mut jr = LineReader {
            byte_buffer: vec![0; KB8],
            buf_data_len: 0,
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
            self.buf_data_len = hint;
        };
        let position = self.position;
        let mut eof = false;
        loop {
            if eof && self.buf_data_len == 0 {
                return None;
            }
            let new_line_index = self.byte_buffer[..self.buf_data_len]
                .iter()
                .enumerate()
                .find_map(|(i, b)| if *b == b'\n' { Some(i) } else { None });
            if new_line_index.is_some() || eof {
                let i = new_line_index.unwrap_or(self.buf_data_len);
                self.position += (i + 1) as u64;
                let mut raw_value = &self.byte_buffer[..i];
                let mut i2 = i;
                while raw_value.ends_with(&[b'\n']) || raw_value.ends_with(&[b'\r']) {
                    i2 -= 1;
                    raw_value = &self.byte_buffer[..i2];
                }
                let value = String::from_utf8_lossy(raw_value);
                let value = str_to_json(&value);
                self.byte_buffer.drain(..i + 1);
                self.buf_data_len -= self.buf_data_len.min(i + 1);
                return Some(Ok((value, position, i)));
            } else {
                let start_length = self.buf_data_len;
                let new_length = KB8 + start_length;
                self.byte_buffer.resize(new_length, 0);
                let buf = &mut self.byte_buffer[start_length..new_length];
                match self.reader.read(buf) {
                    Err(e) => return Some(Err(e)),
                    Ok(n) => {
                        if n == 0 {
                            eof = true;
                        }
                        self.buf_data_len += n;
                    }
                }
            }
        }
    }
}

impl Seek for LineReader {
    fn seek(&mut self, seek: io::SeekFrom) -> Result<u64, io::Error> {
        self.buf_data_len = 0;
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
        let mut result = self.get_value(size_hint);
        if result.is_none() && self.repeat {
            if let Some((pos, size)) = self.positions.first().cloned() {
                if let Err(e) = self.seek(pos) {
                    return Some(Err(e));
                } else {
                    result = self.get_value(Some(size));
                }
            } else {
                return None;
            }
        }
        result.map(|r| r.map(|(v, ..)| v))
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

    #[test]
    fn lines_longer_than_buffer_work() {
        let long_line = format!("{}{}", "a".repeat(KB8), "b".repeat(10));
        let long_lines = [long_line.clone(), long_line];
        let fp = config::FileProvider::default();

        let expect = vec![json::json!(long_lines[0]), json::json!(long_lines[1])];

        for line_ending in &["\n", "\r\n"] {
            let mut tmp = NamedTempFile::new().unwrap();
            write!(tmp, "{}", long_lines.join(line_ending)).unwrap();
            let path = tmp.path().to_str().unwrap().to_string();

            let values: Vec<_> = LineReader::new(&fp, &path)
                .unwrap()
                .map(Result::unwrap)
                .collect();

            assert!(values == expect);
        }
    }

    #[test]
    fn line_reader_repeat_random_works() {
        let mut fp = config::FileProvider::default();
        fp.random = true;
        fp.repeat = true;

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
                .take(1000)
                .collect();

            assert!(values.len() == 1000);

            for value in &values {
                assert!(expect.contains(value));
            }

            let mut values: Vec<_> = values.into_iter().map(|v| v.to_string()).collect();
            values.sort_unstable();
            values.dedup();

            assert_eq!(values.len(), 5);
        }
    }
}
