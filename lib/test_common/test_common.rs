use std::{
    io, net,
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

use actix::prelude::*;
use actix_web::{
    dev,
    http::{self, header, StatusCode},
    multipart, server, App, HttpMessage, HttpRequest, HttpResponse,
};
use crypto::{digest::Digest, sha1::Sha1};
use ether::Either;
use futures::{Async, Future, IntoFuture, Stream};
use parking_lot::Mutex;

fn echo(req: HttpRequest) -> impl Future<Item = HttpResponse, Error = actix_web::error::Error> {
    let headers = req.headers();
    let query = req.query();
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .cloned()
        .unwrap_or_else(|| header::HeaderValue::from_static("text/plain"));
    let response = match *req.method() {
        http::Method::GET => {
            if let Some(b) = query.get("echo") {
                HttpResponse::build(StatusCode::OK)
                    .header(header::CONTENT_TYPE, content_type)
                    .body(b)
            } else {
                HttpResponse::new(StatusCode::NO_CONTENT)
            }
        }
        http::Method::PUT | http::Method::POST => HttpResponse::build(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .streaming(req.payload()),
        _ => HttpResponse::new(StatusCode::NO_CONTENT),
    };
    let ms = query.get("wait").and_then(|s| s.parse().ok()).unwrap_or(0);
    tokio::timer::Delay::new(Instant::now() + Duration::from_millis(ms)).then(move |_| Ok(response))
}

fn multipart(
    req: HttpRequest,
) -> impl Future<Item = HttpResponse, Error = actix_web::error::Error> {
    req.multipart()
        .map_err(|_| HttpResponse::new(StatusCode::BAD_REQUEST))
        .for_each(|item: multipart::MultipartItem<dev::Payload>| match item {
            multipart::MultipartItem::Field(field) => {
                if let Some(sha1_expect) = field.headers().get("sha1") {
                    let sha1_expect = if let Ok(s) = sha1_expect.to_str() {
                        s.to_string()
                    } else {
                        return Either::B(
                            Err(HttpResponse::with_body(
                                StatusCode::BAD_REQUEST,
                                "invalid sha1 header",
                            ))
                            .into_future(),
                        );
                    };
                    let a = field
                        .map_err(|_| HttpResponse::new(StatusCode::BAD_REQUEST))
                        .fold(Sha1::new(), |mut sha_er, bytes| {
                            sha_er.input(&bytes[..]);
                            Ok::<_, HttpResponse>(sha_er)
                        })
                        .and_then(move |mut sha_er| {
                            let sha1 = sha_er.result_str();
                            if sha1.eq_ignore_ascii_case(&sha1_expect) {
                                Ok(())
                            } else {
                                Err(HttpResponse::with_body(
                                    StatusCode::BAD_REQUEST,
                                    format!(
                                        "sha1 doesn't match. saw: {}, expected: {}",
                                        sha1, sha1_expect
                                    ),
                                ))
                            }
                        });
                    Either::A(a)
                } else {
                    Either::B(
                        Err(HttpResponse::with_body(
                            StatusCode::BAD_REQUEST,
                            "missing sha1 header",
                        ))
                        .into_future(),
                    )
                }
            }
            _ => Either::B(Err(HttpResponse::new(StatusCode::BAD_REQUEST)).into_future()),
        })
        .map(|_| HttpResponse::new(StatusCode::NO_CONTENT))
        .or_else(Ok)
}

pub fn start_test_server(port: Option<u16>) -> (u16, thread::JoinHandle<()>) {
    let port = port.unwrap_or(0);
    let address = format!("127.0.0.1:{}", port);
    let listener = net::TcpListener::bind(address).expect("could not bind to a port");

    let port = listener
        .local_addr()
        .expect("should have a local listenening address")
        .port();

    let handle = thread::spawn(move || {
        let sys = System::new("test");

        // start http server
        server::new(move || {
            App::new()
                .resource("/", |r| r.with_async(echo))
                .resource("/multipart", |r| {
                    r.method(http::Method::POST).with_async(multipart);
                })
        })
        .listen(listener)
        .start();

        let _ = sys.run();
    });

    (port, handle)
}

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
