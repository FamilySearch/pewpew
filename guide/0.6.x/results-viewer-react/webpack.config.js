const path = require('path');
const HTMLWebpackPlugin = require('html-webpack-plugin');

const pages = ["index", "yaml"];
const entries = pages.reduce((config, page) => {
  config[page] = `./src/${page}.tsx`;
  return config;
}, {});
const htmlWebpackPlugins = pages.map((page) => new HTMLWebpackPlugin({
  template: `./src/${page}.html`,
  inject: "head",
  filename: `${page}.html`,
  chunks: [page],
}))

module.exports = {
  mode: 'development',
  devtool: 'eval-source-map',
  entry: entries,
  output: {
    filename: '[name].bundle.js',
    path: path.resolve(__dirname, '../src/results-viewer-react/'),
    webassemblyModuleFilename: 'static/wasm/[modulehash].wasm',
  },
  experiments: {
    asyncWebAssembly: true
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        use: 'ts-loader',
        include: [path.resolve(__dirname, 'src')],
        exclude: [/story\.tsx$/, /node_modules/],
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.jsx', '.ts', '.js', '.json', '...'],
  },
  plugins: [
    ...htmlWebpackPlugins
  ],
};