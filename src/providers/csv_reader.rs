use crate::util::str_to_json;
use rand::distributions::{Distribution, Uniform};
use serde_json as json;

use std::{fs::File, io, iter::Iterator};

// A type of file reader which reads a csv file.
// Each row in the csv is converted into a json value.
// There are many configurable options when parsing a csv including whether the file
// starts with a header row, or whether a custom header is specified.
// If a header is provided each json value yielded will be an object with properties
// matching the column names in the header.
// If no header is provided each json value will be an array where each index corresponds
// with a column
pub struct CsvReader {
    positions: Vec<csv::Position>,
    headers: Option<csv::StringRecord>,
    random: Option<Uniform<usize>>,
    reader: csv::Reader<File>,
    repeat: bool,
}

impl CsvReader {
    pub fn new(config: &config::FileProvider, file: &str) -> Result<Self, io::Error> {
        let file = File::open(file)?;
        let csv = &config.csv;
        let mut builder = csv::ReaderBuilder::new();
        builder.comment(csv.comment).escape(csv.escape);
        if let Some(delimiter) = csv.delimiter {
            builder.delimiter(delimiter);
        }
        let (first_row_headers, explicit_headers) = match &csv.headers {
            config::CsvHeader::Bool(b) => {
                builder.has_headers(*b);
                (*b, None)
            }
            config::CsvHeader::String(s) => (false, Some(s)),
        };
        if let Some(double_quote) = csv.double_quote {
            builder.double_quote(double_quote);
        }
        if let Some(quote) = csv.quote {
            builder.quote(quote);
        }
        if let Some(terminator) = csv.terminator {
            builder.terminator(csv::Terminator::Any(terminator));
        }
        let mut reader = builder.from_reader(file);
        let headers = if let Some(headers) = explicit_headers {
            let headers = builder
                .from_reader(headers.as_bytes())
                .headers()
                .map_err(io::Error::from)?
                .to_owned();
            reader.set_headers(headers.clone());
            Some(headers)
        } else if first_row_headers {
            reader.headers().ok().cloned()
        } else {
            None
        };
        let mut byte_record = csv::ByteRecord::new();
        let mut cr = CsvReader {
            positions: Vec::new(),
            headers,
            random: None,
            reader,
            repeat: config.repeat,
        };
        if config.random || (first_row_headers && config.repeat) {
            // get position of the csv records. Get all of them if config.random,
            // otherwise just the first. It's important to always get the first one
            // so if we need to seek back to the beginning, we can account for any
            // possible header row
            loop {
                if !config.random && !cr.positions.is_empty() {
                    break;
                }
                match cr.reader.read_byte_record(&mut byte_record) {
                    Ok(true) => {
                        if let Some(pos) = byte_record.position() {
                            cr.positions.push(pos.clone());
                        }
                    }
                    Ok(false) => break,
                    Err(e) => return Err(e.into()),
                }
            }
            let pos_index = if config.random && !cr.positions.is_empty() {
                let random = Uniform::new(0, cr.positions.len());
                let pos_index = random.sample(&mut rand::thread_rng());
                cr.random = Some(random);
                pos_index
            } else {
                0
            };
            if let Some(pos) = cr.positions.get(pos_index) {
                cr.reader.seek(pos.clone()).map_err(io::Error::from)?;
            }
        } else if config.repeat {
            cr.positions.push(csv::Position::new());
        }
        Ok(cr)
    }
}

impl Iterator for CsvReader {
    type Item = Result<json::Value, io::Error>;

    fn next(&mut self) -> Option<Self::Item> {
        let mut record = csv::StringRecord::new();
        if let Some(random) = self.random {
            if self.positions.is_empty() {
                return None;
            }
            let i = random.sample(&mut rand::thread_rng()) % self.positions.len();
            let pos = if self.repeat {
                self.positions
                    .get(i)
                    .cloned()
                    .expect("should have the position")
            } else {
                self.positions.remove(i)
            };
            if let Err(e) = self.reader.seek(pos) {
                return Some(Err(e.into()));
            }
        }
        match (self.reader.read_record(&mut record), self.repeat) {
            (Err(e), _) => return Some(Err(e.into())),
            (Ok(false), false) => return None,
            (Ok(false), true) => {
                if let Some(pos) = self.positions.first() {
                    if let Err(e) = self.reader.seek(pos.clone()) {
                        return Some(Err(e.into()));
                    }
                    return self.next();
                } else {
                    return None;
                }
            }
            _ => (),
        }
        let json = if let Some(headers) = &self.headers {
            json::Value::Object(
                headers
                    .iter()
                    .zip(record.iter())
                    .map(|(k, v)| (k.into(), str_to_json(v)))
                    .collect(),
            )
        } else {
            json::Value::Array(record.into_iter().map(str_to_json).collect())
        };
        Some(Ok(json))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    use std::io::Write;

    const CSV_LINES: &[&str] = &["a,b,c", "d,e,f", r#""[1,2,3]",99,14"#];

    #[test]
    fn csv_reader_basics_works() {
        let mut fp = config::FileProvider::default();
        fp.format = config::FileFormat::Csv;

        let expect = vec![
            json::json!(["a", "b", "c"]),
            json::json!(["d", "e", "f"]),
            json::json!([[1, 2, 3], 99, 14]),
        ];

        for line_ending in &["\n", "\r\n"] {
            let mut tmp = NamedTempFile::new().unwrap();
            write!(tmp, "{}", CSV_LINES.join(line_ending)).unwrap();
            let path = tmp.path().to_str().unwrap().to_string();

            let values: Vec<_> = CsvReader::new(&fp, &path)
                .unwrap()
                .map(Result::unwrap)
                .collect();

            assert_eq!(values, expect);
        }
    }
}
