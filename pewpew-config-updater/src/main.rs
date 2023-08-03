use clap::Parser;
use std::{fs, path::PathBuf};

#[derive(Parser, Debug)]
#[command(version)]
struct Args {
    /// files to attempt conversion
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
