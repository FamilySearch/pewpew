import type { StorybookConfig } from "@storybook/nextjs";

const config: StorybookConfig = {
  stories: ["../components/**/story.tsx"],
  addons: ["@storybook/addon-actions", "@storybook/addon-links"],
  features: {
    // legacyMdx1: true,
    // storyStoreV7: false, // Opt out of on-demand story loading
    // postcss: false,
  },
  staticDirs: ["../public"],
  // In the future consider https://clacified.com/tech-science/16/how-to-set-up-storybook-v6-with-react-17
  typescript: {
    check: false,
    checkOptions: {},
    reactDocgen: "react-docgen-typescript",
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      propFilter: prop => prop.parent ? !/node_modules/.test(prop.parent.fileName) : true
    }
  },
  webpackFinal: (config) => {
    if (!config.resolve) { config.resolve = {}; }
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      "fs": false,
      "util": false,
      "path": false,
      "assert": false,
      "crypto": false,
    };
    if (!config.experiments) { config.experiments = {}; }
    config.experiments.asyncWebAssembly = true;
    if (!config.output) { config.output = {}; }
    // config.output.publicPath = "/";
    config.output.webassemblyModuleFilename = 'static/wasm/[modulehash].wasm';
    return config;
  },
  framework: {
    name: "@storybook/nextjs",
    options: {}
  },
  docs: {
    autodocs: false
  }
};

export default config;