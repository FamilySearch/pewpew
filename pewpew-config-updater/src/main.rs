fn main() {
    env_logger::init();
    let yaml = std::fs::read_to_string("pewpew-config-updater/tests/test.yaml").unwrap();
    //let _ = update_yaml_v1_to_v2(&yaml);
}
