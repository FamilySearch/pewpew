import type { Configuration } from "webpack";
import type { StorybookConfig } from "@storybook/nextjs";

const config: StorybookConfig = {
  stories: ["../components/**/story.tsx"],
  addons: ["storybook/actions", "@storybook/addon-links"],
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
  webpackFinal: (webpackConfig: Configuration) => {
    if (!webpackConfig.resolve) { webpackConfig.resolve = {}; }
    webpackConfig.resolve.fallback = {
      ...(webpackConfig.resolve.fallback || {}),
      "fs": false,
      "util": false,
      "path": false,
      "assert": false,
      "crypto": false
    };
    if (!webpackConfig.experiments) { webpackConfig.experiments = {}; }
    webpackConfig.experiments.asyncWebAssembly = true;
    if (!webpackConfig.output) { webpackConfig.output = {}; }
    // config.output.publicPath = "/";
    webpackConfig.output.webassemblyModuleFilename = "static/wasm/[modulehash].wasm";
    return webpackConfig;
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