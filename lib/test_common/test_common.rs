use log::{debug, info};
use std::{future::Future, io, str::FromStr, sync::Arc, time::Duration};

use futures::{channel::oneshot, future::select, FutureExt};
use futures_timer::Delay;
use http::{header, StatusCode};
use hyper::{
    server::conn::AddrStream,
    service::{make_service_fn, service_fn},
    Body, Error, Request, Response, Server,
};
use parking_lot::Mutex;
use url::Url;

async fn echo_route(req: Request<Body>) -> Response<Body> {
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
    let url = Url::parse(&format!("http://127.0.0.1:8080{url}")).unwrap();
    for (k, v) in url.query_pairs() {
        match &*k {
            "echo" => echo = Some(v.to_string()),
            "wait" => wait = Some(v.to_string()),
            _ => (),
        }
    }
    if echo.is_some() {
        debug!("Echo Body = {}", echo.clone().unwrap_or_default());
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
    let ms = wait.and_then(|c| FromStr::from_str(&c).ok()).unwrap_or(0);
    let old_body = std::mem::replace(response.body_mut(), Body::empty());
    if ms > 0 {
        debug!("waiting {} ms", ms);
    }
    Delay::new(Duration::from_millis(ms)).await;
    let _ = std::mem::replace(response.body_mut(), old_body);
    response
}

pub fn start_test_server(
    port: Option<u16>,
) -> (u16, oneshot::Sender<()>, impl Future<Output = ()>) {
    let port = port.unwrap_or(0);
    let address = ([127, 0, 0, 1], port).into();

    let make_svc = make_service_fn(|_: &AddrStream| async {
        let service = service_fn(|req: Request<Body>| async {
            debug!("{:?}", req);
            let method = req.method().to_string();
            let uri = req.uri().to_string();
            let headers = req.headers().clone();
            let response = match req.uri().path() {
                "/" => echo_route(req).await,
                _ => Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(Body::empty())
                    .unwrap(),
            };
            debug!("{:?}", response);
            info!(
                "method=\"{}\" uri=\"{}\" status=\"{}\" request_headers={:?} response_headers={:?}",
                method,
                uri,
                response.status(),
                headers,
                response.headers()
            );
            Ok::<_, Error>(response)
        });
        Ok::<_, Error>(service)
    });

    let (tx, rx) = oneshot::channel();

    let server = Server::bind(&address).serve(make_svc);

    let port = server.local_addr().port();

    let future = select(server, rx);

    debug!("start_test_server tokio::spawn future");
    let handle = tokio::spawn(future).map(|_| ());

    (port, tx, handle)
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
