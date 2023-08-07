use clap::Parser;
use std::{fs, path::PathBuf};

#[derive(Parser, Debug)]
#[command(version)]
#[command(
    about = "Tool to help automate updating pewpew config files from 0.5.x to 0.6.x.
Some changes will still need to be done manually."
)]
struct Args {
    /// files to attempt conversion
    ///
    /// output result will be written to same path with a modified extension
    files: Vec<PathBuf>,
}

fn main() {
    env_logger::init();
    let Args { files } = Args::parse();
    for mut file in files {
        log::debug!("starting on file {file:?}");
        let text = match fs::read_to_string(&file) {
            Ok(s) => s,
            Err(e) => {
                log::error!("error reading file {file:?}: {e}");
                continue;
            }
        };
        let out_text = match config::convert::update_v1_to_v2(&text) {
            Ok(s) => s,
            Err(e) => {
                log::error!("error converting config file {file:?}: {e}");
                continue;
            }
        };
        log::debug!("finished converting {file:?}");
        file.set_extension("updated_v2.yaml");

        let Err(e) = fs::write(&file, &out_text) else {
            continue;
        };
        log::error!("error writing to {file:?}: {e}")
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, path::PathBuf};

    #[test]
    fn updater_simple() {
        // from the intro section of the book
        let v1 = r#"
        load_pattern:
          - linear:
              to: 100%
              over: 5m
          - linear:
              to: 100%
              over: 2m
        endpoints:
          - method: GET
            url: http://localhost/foo
            peak_load: 42hpm
            headers:
              Accept: text/plain
          - method: GET
            url: http://localhost/bar
            headers:
              Accept-Language: en-us
              Accept: application/json
            peak_load: 15hps
        "#;
        let v2 = r#"
        load_pattern:
          - !linear
              to: 100%
              over: 5m
          - !linear
              to: 100%
              over: 2m
        endpoints:
          - method: GET
            url: http://localhost/foo
            peak_load: 42hpm
            headers:
              Accept: text/plain
          - method: GET
            url: http://localhost/bar
            headers:
              Accept-Language: en-us
              Accept: application/json
            peak_load: 15hps
        "#;
        let updated = config::convert::update_v1_to_v2(v1).unwrap();
        // I don't directly check the updated string here, because a lot of default values get
        // filled in.
        //
        // Instead, a LoadTest made from the autoupdated config text is compared to one made from
        // manually updated config text.
        let lt_a =
            config::LoadTest::from_yaml(&updated, PathBuf::new().into(), &BTreeMap::new()).unwrap();
        let lt_b =
            config::LoadTest::from_yaml(v2, PathBuf::new().into(), &BTreeMap::new()).unwrap();
        assert_eq!(lt_a, lt_b);
    }
}
