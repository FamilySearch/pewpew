use test_common::start_test_server;
use tokio::runtime::Runtime;

fn main() {
    let mut rt = Runtime::new().unwrap();
    rt.block_on(async {
        // todo!("get working");
        let port = std::env::var("PORT").ok().and_then(|s| s.parse().ok());
        let (port, rx, handle) = start_test_server(port);

        println!("Listening on port {}", port);

        handle.await;
        drop(rx);
    });
}
