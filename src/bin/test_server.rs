use test_common::start_test_server;

fn main() {
    let port = std::env::var("PORT").ok().and_then(|s| s.parse().ok());
    let (port, handle) = start_test_server(port);

    println!("Listening on port {}", port);

    let _ = handle.join();
}
