use std::{
    io,
    str::FromStr,
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

use futures::{Async, Future};
use http::{header, StatusCode};
use hyper::{service::service_fn_ok, Body, Request, Response, Server};
use parking_lot::Mutex;
use tokio::{self, io::AsyncWrite, timer::Delay};
use url::Url;

// fn multipart(
//     multipart: Multipart,
// ) -> impl Future<Item = HttpResponse, Error = actix_web::error::Error> {
//     multipart
//         .map_err(|_| HttpResponse::new(StatusCode::BAD_REQUEST))
//         .for_each(|field| {
//             if let Some(sha1_expect) = field.headers().get("sha1") {
//                 let sha1_expect = if let Ok(s) = sha1_expect.to_str() {
//                     s.to_string()
//                 } else {
//                     return Either::B(
//                         Err(HttpResponse::with_body(
//                             StatusCode::BAD_REQUEST,
//                             "invalid sha1 header".into(),
//                         ))
//                         .into_future(),
//                     );
//                 };
//                 let a = field
//                     .map_err(|_| HttpResponse::new(StatusCode::BAD_REQUEST))
//                     .fold(Sha1::new(), |mut sha_er, bytes| {
//                         sha_er.input(&bytes[..]);
//                         Ok::<_, HttpResponse>(sha_er)
//                     })
//                     .and_then(move |mut sha_er| {
//                         let sha1 = sha_er.result_str();
//                         if sha1.eq_ignore_ascii_case(&sha1_expect) {
//                             Ok(())
//                         } else {
//                             Err(HttpResponse::with_body(
//                                 StatusCode::BAD_REQUEST,
//                                 format!(
//                                     "sha1 doesn't match. saw: {}, expected: {}",
//                                     sha1, sha1_expect
//                                 )
//                                 .into(),
//                             ))
//                         }
//                     });
//                 Either::A(a)
//             } else {
//                 Either::B(
//                     Err(HttpResponse::with_body(
//                         StatusCode::BAD_REQUEST,
//                         "missing sha1 header".into(),
//                     ))
//                     .into_future(),
//                 )
//             }
//         })
//         .map(|_| HttpResponse::new(StatusCode::NO_CONTENT))
//         .or_else(Ok)
// }

fn echo_route(req: Request<Body>) -> Response<Body> {
    let headers = req.headers();
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .cloned()
        .unwrap_or_else(|| header::HeaderValue::from_static("text/plain"));
    let mut echo = None;
    let mut wait = None;
    let uri = req.uri();
    let url = uri
        .path_and_query()
        .map(|piece| piece.as_str())
        .unwrap_or_else(|| uri.path());
    let url = Url::parse(&format!("http://127.0.0.1:8080{}", url)).unwrap();
    for (k, v) in url.query_pairs() {
        match &*k {
            "echo" => echo = Some(v.to_string()),
            "wait" => wait = Some(v.to_string()),
            _ => (),
        }
    }
    let mut response = match (req.method(), echo) {
        (&http::Method::GET, Some(b)) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .body(b.into())
            .unwrap(),
        (&http::Method::POST, _) | (&http::Method::PUT, _) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .body(req.into_body())
            .unwrap(),
        _ => Response::builder()
            .status(StatusCode::NO_CONTENT)
            .body(Body::empty())
            .unwrap(),
    };
    let ms = wait.and_then(|c| FromStr::from_str(&*c).ok()).unwrap_or(0);
    let old_body = std::mem::replace(response.body_mut(), Body::empty());
    let delayed_body = Delay::new(Instant::now() + Duration::from_millis(ms))
        .then(move |_| Ok(old_body))
        .flatten_stream();
    let _ = std::mem::replace(response.body_mut(), Body::wrap_stream(delayed_body));
    response
}

pub fn start_test_server(port: Option<u16>) -> (u16, thread::JoinHandle<()>) {
    let port = port.unwrap_or(0);
    let address = ([127, 0, 0, 1], port).into();

    let server = Server::bind(&address).serve(|| {
        service_fn_ok(|req| match req.uri().path() {
            "/" => echo_route(req),
            _ => Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Body::empty())
                .unwrap(),
        })
    });

    let port = server.local_addr().port();

    let handle = thread::spawn(move || {
        tokio::run(server.then(|_| Ok(())));
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

impl AsyncWrite for TestWriter {
    fn shutdown(&mut self) -> Result<Async<()>, io::Error> {
        Ok(Async::Ready(()))
    }
}
