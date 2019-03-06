use std::{
    net,
    thread,
};

use actix::prelude::*;
use actix_web::{
    http::{self, header, StatusCode},
    server, App, HttpMessage, HttpRequest, HttpResponse,
};

fn echo(req: &HttpRequest) -> HttpResponse {
    let headers = req.headers();
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .cloned()
        .unwrap_or_else(|| header::HeaderValue::from_static("text/plain"));
    match *req.method() {
        http::Method::GET => {
            let q = req.query();
            if let Some(b) = q.get("echo") {
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
    }
}

pub fn start_test_server() -> u16 {
    let listener = net::TcpListener::bind("127.0.0.1:0")
        .expect("could not bind to a port");

    let port = listener.local_addr().expect("should have a local listenening address")
        .port();

    thread::spawn(move || {
        let sys = System::new("test");

        // start http server
        server::new(move || App::new().resource("/", |r| r.f(echo)))
            .listen(listener)
            .start();

        let _ = sys.run();
    });

    port
}
