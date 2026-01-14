import type { Configuration } from "webpack";
import type { StorybookConfig } from "@storybook/nextjs";

const config: StorybookConfig = {
  stories: ["../src/components/**/story.tsx"],
  addons: ["@storybook/addon-links", "@storybook/essentials", "@storybook/interactions"],
  framework: {
    name: "@storybook/nextjs",
    options: {}
  },
  typescript: {
    check: false,
    checkOptions: {},
    reactDocgen: 'react-docgen-typescript',
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      propFilter: prop => prop.parent ? !/node_modules/.test(prop.parent.fileName) : true
    }
  },
  webpackFinal: async (config: Configuration) => {
    if (!config.experiments) {
      config.experiments = {};
    }
    config.experiments.asyncWebAssembly = true;
    if (!config.output) {
      config.output = {};
    }
    // config.output.publicPath = "/";
    config.output.webassemblyModuleFilename = 'static/wasm/[modulehash].wasm';
    return config;
  },
  docs: {}
};

export default config;