use std::{net, thread};

use actix::prelude::*;
use actix_web::{
    dev,
    http::{self, header, StatusCode},
    multipart, server, App, HttpMessage, HttpRequest, HttpResponse,
};
use crypto::{digest::Digest, sha1::Sha1};
use ether::Either;
use futures::{Future, IntoFuture, Stream};

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

fn multipart(
    req: HttpRequest,
) -> impl Future<Item = HttpResponse, Error = actix_web::error::Error> {
    req.multipart()
        .map_err(|_| HttpResponse::new(StatusCode::INTERNAL_SERVER_ERROR))
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
                        .map_err(|_| HttpResponse::new(StatusCode::INTERNAL_SERVER_ERROR))
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

pub fn start_test_server() -> u16 {
    let listener = net::TcpListener::bind("127.0.0.1:0").expect("could not bind to a port");

    let port = listener
        .local_addr()
        .expect("should have a local listenening address")
        .port();

    thread::spawn(move || {
        let sys = System::new("test");

        // start http server
        server::new(move || {
            App::new()
                .resource("/", |r| r.f(echo))
                .resource("/multipart", |r| {
                    r.method(http::Method::POST).with_async(multipart);
                })
        })
        .listen(listener)
        .start();

        let _ = sys.run();
    });

    port
}
