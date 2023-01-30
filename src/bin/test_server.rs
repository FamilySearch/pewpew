use log::debug;
use test_common::start_test_server;
use tokio::runtime::Runtime;

fn main() {
    env_logger::init();
    let rt = Runtime::new().unwrap();
    rt.block_on(async {
        let port = std::env::var("PORT").ok().and_then(|s| s.parse().ok());
        debug!("port = {}", port.unwrap_or_default());
        let (port, rx, handle) = start_test_server(port);

        println!("Listening on port {port}");

        handle.await;
        drop(rx);
    });
}
