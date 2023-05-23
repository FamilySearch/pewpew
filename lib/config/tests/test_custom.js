function foo_custom(input) {
  return input.x | 2;
}

// test that predefined functions can be called from custom
function calls_entries(input) {
  return { "normal": entries(input), "reversed": entries(input.slice(0).reverse()) };
}
