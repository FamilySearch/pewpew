module.exports = {
  stories: [
    "../src/**/story.tsx"
  ],
  addons: [
    "@storybook/addon-links",
    "@storybook/addon-essentials",
    "@storybook/addon-interactions"
  ],
  framework: "@storybook/react",
  typescript: {
    check: false,
    checkOptions: {},
    reactDocgen: 'react-docgen-typescript',
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      propFilter: (prop) => (prop.parent ? !/node_modules/.test(prop.parent.fileName) : true),
    },
  },
  core: {
    builder: "@storybook/builder-webpack5"
  },
  webpackFinal: async (config) => {
    if (!config.experiments) { config.experiments = {}; }
    config.experiments.asyncWebAssembly = true;
    if (!config.output) {
      config.output = {};
    }
    config.output.publicPath = "/";
    config.output.webassemblyModuleFilename = 'static/wasm/[modulehash].wasm';

    return config;
  },
}