use rand::distributions::{Distribution, Uniform};
use serde_json as json;

use std::{
    fs::File,
    io::{self, Read, Seek},
    iter::{self, Iterator},
};

// A type of file reader that reads json values from a file
pub struct JsonReader {
    staging_buffer: Vec<u8>,
    buffer: Vec<u8>,
    position: u64,
    positions: Vec<(io::SeekFrom, usize)>,
    random: Option<Uniform<usize>>,
    reader: File,
    repeat: bool,
}

impl JsonReader {
    pub fn new(config: &config::providers::FileProvider, file: &str) -> Result<Self, io::Error> {
        let mut jr = Self {
            staging_buffer: vec![0; 8 * (1 << 10)],
            buffer: Vec::new(),
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
            let extend_length = hint.checked_sub(self.staging_buffer.len());
            if let Some(extend_length) = extend_length {
                self.staging_buffer
                    .extend(iter::repeat(0).take(extend_length));
            }
            let buf = &mut self.staging_buffer[..hint];
            self.position += hint as u64;
            if let Err(e) = self.reader.read_exact(buf) {
                return Some(Err(e));
            }
            self.buffer.extend_from_slice(buf);
        };
        loop {
            let mut deserializer =
                json::Deserializer::from_slice(&self.buffer).into_iter::<json::Value>();
            let result = deserializer.next();
            if let Some(Ok(value)) = result {
                let length = deserializer.byte_offset();
                self.buffer.drain(..length);
                self.position += length as u64;
                return Some(Ok((value, position, length)));
            }
            if let Some(Err(e)) = result {
                if !e.is_eof() {
                    return Some(Err(e.into()));
                }
            }
            let buf = &mut self.staging_buffer[..8 * (1 << 10)];
            match self.reader.read(buf) {
                Err(e) => return Some(Err(e)),
                Ok(n) => {
                    if n == 0 {
                        return None;
                    }
                    self.buffer.extend(&buf[..n])
                }
            }
        }
    }
}

impl Seek for JsonReader {
    fn seek(&mut self, seek: io::SeekFrom) -> Result<u64, io::Error> {
        self.buffer.clear();
        let n = self.reader.seek(seek)?;
        self.position = n;
        Ok(n)
    }
}

impl Iterator for JsonReader {
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
    use config::providers::{FileProvider, FileReadFormat};
    use std::io::Write;
    use tempfile::NamedTempFile;

    const JSON_LINES: &[&str] = &[
        r#"{ "foo": 1 }"#,
        r#"{ "foo": 2, "bar": 1 }"#,
        r#"{ "foo": 3 }{ "foo": 4, "bar": 2 }"#,
    ];

    #[test]
    fn json_reader_basics_works() {
        let fp = FileProvider::default_with_format(FileReadFormat::Json);

        let expect = vec![
            json::json!({ "foo": 1 }),
            json::json!({ "foo": 2, "bar": 1 }),
            json::json!({ "foo": 3 }),
            json::json!({ "foo": 4, "bar": 2 }),
        ];

        for line_ending in &["\n", "\r\n"] {
            let mut tmp = NamedTempFile::new().unwrap();
            write!(tmp, "{}", JSON_LINES.join(line_ending)).unwrap();
            let path = tmp.path().to_str().unwrap().to_string();

            let values: Vec<_> = JsonReader::new(&fp, &path)
                .unwrap()
                .map(Result::unwrap)
                .collect();

            assert_eq!(values, expect);
        }
    }
}
