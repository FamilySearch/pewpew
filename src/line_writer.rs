use futures::{channel::mpsc, executor::block_on_stream};
use tokio::{sync::broadcast, task::spawn_blocking};

use crate::{TestEndReason, TestError};

use std::io::Write;

pub enum MsgType {
    Final(String),
    Other(String),
}

// #[derive(Clone)]
// pub struct BlockingWriter<T> {
//     channel: mpsc::Sender<MsgType>,
//     transform: fn(T) -> MsgType,
// }

// impl<T> BlockingWriter<T> {
//     pub fn new<W: Write + Send + 'static>(mut writer: W) -> BlockingWriter<MsgType>
//     {
//         let (tx, mut rx) = mpsc::channel(5);
//         spawn_blocking(move || async move {
//             let mut final_msg = None;
//             while let Some(msg) = rx.next().await {
//                 match msg {
//                     MsgType::Final(s) => final_msg = Some(s),
//                     MsgType::Other(s) => {
//                         writer.write_all(s.as_bytes())?;
//                     }
//                 }
//             }
//             if let Some(s) = final_msg {
//                 writer.write_all(s.as_bytes())?;
//             }
//             Ok::<_, IOError>(())
//         });
//         BlockingWriter {
//             channel: tx,
//             transform: |m| m,
//         }
//     }

//     fn with_transform<T2>(self, transform: fn(T2) -> MsgType) -> BlockingWriter<T2> {
//         BlockingWriter { channel: self.channel, transform }
//     }

//     fn try_send(&mut self, msg: T) -> Result<(), ()> {
//         let msg = (self.transform)(msg);
//         self.channel.try_send(msg)
//             .map_err(|_| ())
//     }
// }

// impl<T> Sink<T> for BlockingWriter<T> {
//     type Error = mpsc::SendError;

//     fn poll_ready(
//         self: Pin<&mut Self>,
//         cx: &mut Context<'_>,
//     ) -> Poll<Result<(), Self::Error>> {
//         let this = Pin::into_inner(self);
//         Pin::new(&mut this.channel).poll_ready(cx)
//     }

//     fn start_send(self: Pin<&mut Self>, item: T) -> Result<(), Self::Error> {
//         let this = Pin::into_inner(self);
//         let item = (this.transform)(item);
//         Pin::new(&mut this.channel).start_send(item)
//     }

//     fn poll_flush(
//         self: Pin<&mut Self>,
//         cx: &mut Context<'_>,
//     ) -> Poll<Result<(), Self::Error>> {
//         let this = Pin::into_inner(self);
//         Pin::new(&mut this.channel).poll_flush(cx)
//     }

//     fn poll_close(
//         self: Pin<&mut Self>,
//         cx: &mut Context<'_>,
//     ) -> Poll<Result<(), Self::Error>> {
//         let this = Pin::into_inner(self);
//         Pin::new(&mut this.channel).poll_close(cx)
//     }
// }

pub fn blocking_writer<W: Write + Send + 'static>(
    mut writer: W,
    test_killer: broadcast::Sender<Result<TestEndReason, TestError>>,
    file_name: String,
) -> mpsc::Sender<MsgType> {
    let (tx, rx) = mpsc::channel(5);
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
                return;
            }
        }
    });
    tx
}