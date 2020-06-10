use futures::{
    channel::{mpsc, oneshot},
    executor::block_on_stream,
};
use tokio::{sync::broadcast, task::spawn_blocking};

use crate::{TestEndReason, TestError};

use std::io::Write;

pub enum MsgType {
    Final(String),
    Other(String),
}

pub fn blocking_writer<W: Write + Send + 'static>(
    mut writer: W,
    test_killer: broadcast::Sender<Result<TestEndReason, TestError>>,
    file_name: String,
) -> (mpsc::Sender<MsgType>, oneshot::Receiver<()>) {
    let (tx, rx) = mpsc::channel(5);
    let (done_tx, done_rx) = oneshot::channel();
    spawn_blocking(move || {
        let mut final_msg = None;
        for msg in block_on_stream(rx) {
            match msg {
                MsgType::Final(s) => final_msg = Some(s),
                MsgType::Other(s) => {
                    if let Err(e) = writer.write_all(s.as_bytes()) {
                        let _ =
                            test_killer.send(Err(TestError::WritingToFile(file_name, e.into())));
                        return;
                    }
                }
            }
        }
        if let Some(s) = final_msg {
            if let Err(e) = writer.write_all(s.as_bytes()) {
                let _ = test_killer.send(Err(TestError::WritingToFile(file_name, e.into())));
            }
        }
        let _ = done_tx.send(());
    });
    (tx, done_rx)
}
