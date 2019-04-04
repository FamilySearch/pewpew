use futures::Async;
use parking_lot::Mutex;

use std::{io, sync::Arc};

#[derive(Clone)]
pub struct TestWriter(Arc<Mutex<(bool, Vec<u8>)>>);

impl TestWriter {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        TestWriter(Mutex::new((false, Vec::new())).into())
    }

    pub fn get_string(&self) -> String {
        String::from_utf8(self.0.lock().1.split_off(0)).unwrap()
    }

    pub fn do_would_block_on_next_write(&self) {
        self.0.lock().0 = true;
    }
}

impl io::Write for TestWriter {
    fn write(&mut self, mut buf: &[u8]) -> std::result::Result<usize, std::io::Error> {
        if buf.len() > 1024 {
            buf = &buf[0..1024];
        }
        self.0.lock().1.write(buf)
    }

    fn flush(&mut self) -> std::result::Result<(), std::io::Error> {
        let mut inner = self.0.lock();
        if inner.0 {
            inner.0 = false;
            Err(io::ErrorKind::WouldBlock.into())
        } else {
            io::Write::flush(&mut inner.1)
        }
    }
}

impl tokio::io::AsyncWrite for TestWriter {
    fn shutdown(&mut self) -> Result<Async<()>, io::Error> {
        Ok(Async::Ready(()))
    }
}
