import type { Configuration } from "webpack";
import type { StorybookConfig } from "@storybook/react-webpack5";

const config: StorybookConfig = {
  stories: ["../src/components/**/story.tsx"],
  addons: ["@storybook/addon-links", "@storybook/addon-webpack5-compiler-swc"],
  framework: {
    name: "@storybook/react-webpack5",
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
    config.output.webassemblyModuleFilename = 'static/wasm/[modulehash].wasm';
    if (!config.resolve) {
      config.resolve = {};
    }
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      http: false,
      path: false,
    };
    return config;
  },
  docs: {}
};

export default config;