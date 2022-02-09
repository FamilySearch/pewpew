use futures::{
    channel::{mpsc, oneshot},
    executor::block_on_stream,
};
use tokio::{sync::broadcast, task::spawn_blocking};

use crate::{TestEndReason, TestError};

use std::io::Write;

// The `Sender` returned from `blocking_writer` accepts two types of messages `Final` and `Other`
// `Other` messages are written out to the writer as soon as they are received
// `Final` are written after the internal `futures::mpsc::Receiver` closes
#[derive(Debug)]
pub enum MsgType {
    Final(String),
    Other(String),
}

// This is a utility function that helps with writing to "blocking" sources (files, stderr, stdout)
// it returns a tuple containing a `futures::channel::mpsc::Sender` and a `futures::channel::oneshot::Receiver`
// The `Sender` is used to send messages into the writer.
// The `Receiver` is used to signal when this writer has finished
pub fn blocking_writer<W: Write + Send + 'static>(
    mut writer: W,
    test_killer: broadcast::Sender<Result<TestEndReason, TestError>>,
    file_name: String,
) -> (mpsc::Sender<MsgType>, oneshot::Receiver<()>) {
    // create the needed channels
    let (tx, rx) = mpsc::channel(5);
    let (done_tx, done_rx) = oneshot::channel();

    // start up the blocking task
    log::trace!("{{\"blocking_writer spawn_blocking start");
    spawn_blocking(move || {
        log::trace!("{{\"blocking_writer spawn_blocking enter");
        let mut final_msg = None;

        // read messages from the `Receiver`
        for msg in block_on_stream(rx) {
            match msg {
                MsgType::Final(s) => final_msg = Some(s),
                MsgType::Other(s) => {
                    // write message to the `Writer`
                    if let Err(e) = writer.write_all(s.as_bytes()) {
                        let _ =
                            test_killer.send(Err(TestError::WritingToFile(file_name, e.into())));
                        return;
                    }
                }
            }
        }
        if let Some(s) = final_msg {
            // if there's a final message write that to the `Writer`
            if let Err(e) = writer.write_all(s.as_bytes()) {
                let _ = test_killer.send(Err(TestError::WritingToFile(file_name, e.into())));
            }
        }
        let _ = done_tx.send(());
        log::trace!("{{\"blocking_writer spawn_blocking exit");
    });
    (tx, done_rx)
}
