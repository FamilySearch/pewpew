use std::thread;

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

pub fn start_test_server() {
    thread::spawn(|| {
        let sys = System::new("test");

        // start http server
        server::new(move || App::new().resource("/", |r| r.f(echo)))
            .bind("localhost:8080")
            .unwrap()
            .start();

        let _ = sys.run();
    });
}
