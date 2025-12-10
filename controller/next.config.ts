import type { Compilation, Compiler, Configuration } from "webpack";
import { access, symlink } from "fs/promises";
import CopyPlugin from "copy-webpack-plugin";
import type { NextConfig } from "next";
import { join } from "path";
import { platform } from "os";

if (process.env.BASE_PATH && !process.env.BASE_PATH.startsWith("/")) {
  const errorMessage = "process.env.BASE_PATH must start with a '/' found " + process.env.BASE_PATH;
  // eslint-disable-next-line no-console
  console.error(errorMessage);
  throw new Error(errorMessage);
}
/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  // swcMinify: true,
  // Base path doesn't work because it changes the path on the local server. We actually are running via a proxy base path
  // https://nextjs.org/docs/api-reference/next.config.js/basepath
  // https://stackoverflow.com/questions/60452054/nextjs-deploy-to-a-specific-url-path
  // https://levelup.gitconnected.com/deploy-your-nextjs-application-on-a-different-base-path-i-e-not-root-1c4d210cce8a?gi=fb4f2031b0d1
  // basePath: process.env.BASE_PATH || undefined,
  // https://nextjs.org/docs/api-reference/next.config.js/cdn-support-with-asset-prefix
  assetPrefix: process.env.ASSET_PREFIX || (process.env.BASE_PATH ? process.env.BASE_PATH + "/" : undefined),
  compiler: {
    styledComponents: {
      displayName: true,
      ssr: true
      // ["styled-components", { "ssr": true, "displayName": true, "preprocess": false } ]
    }
  },
  typedRoutes: true,
  turbopack: {
    // Empty config to acknowledge Turbopack as default bundler
    // WASM files are still configured via webpack for backwards compatibility
  },
  experimental: {
    // instrumentationHook: true,
  },
  // Defaults to any but is actually type { import('webpack').Configuration }
  webpack: (config: Configuration, { isServer, dir: optionsDir }) => {
    const wasmExtensionRegExp = /\.wasm$/;

    if (!config.resolve) { config.resolve = {}; }
    if (!config.resolve.extensions) { config.resolve.extensions = []; }
    config.resolve.extensions.push(".wasm");

    config.module?.rules?.forEach((rule: any) => {
      (rule.oneOf || []).forEach((oneOf: any) => {
        if (oneOf.loader && oneOf.loader.indexOf("file-loader") >= 0) {
          // Make file-loader ignore WASM files
          oneOf.exclude.push(wasmExtensionRegExp);
        }
      });
    });

    if (!config.output) { config.output = {}; }
    config.output.webassemblyModuleFilename = "static/wasm/[modulehash].wasm";
    if (!config.experiments) { config.experiments = {}; }
    config.experiments.asyncWebAssembly = true;

    // https://github.com/vercel/next.js/issues/25852
    // Compiling we run into an issue where it can't find the config wasm.
    // On Linux the workaround is to create a symlink to the correct location
    // On Windows, the symlinks fail so we must copy the file
    if (!config.plugins) { config.plugins = []; }
    config.plugins.push(
      platform() === "win32"
      // https://github.com/vercel/next.js/issues/25852#issuecomment-1727385542
      ? new CopyPlugin({
        patterns: [
          { from: "../lib/config-wasm/pkg/config_wasm_bg.wasm", to: "./" }
        ]
      })
      // https://github.com/vercel/next.js/issues/25852#issuecomment-1057059000
      : new (class {
        apply (compiler: Compiler) {
          compiler.hooks.afterEmit.tapPromise(
            "SymlinkWebpackPlugin",
            async (compilation: Compilation) => {
              if (isServer) {
                const to = join(optionsDir, "../lib/config-wasm/pkg/config_wasm_bg.wasm");

                // Create symlinks in multiple locations for Pages Router and App Router
                const locations = [
                  join(compilation.options.output.path!, "config_wasm_bg.wasm"),
                  join(compilation.options.output.path!, "chunks/config_wasm_bg.wasm"),
                  join(compilation.options.output.path!, "app/login/config_wasm_bg.wasm")
                ];

                for (const from of locations) {
                  try {
                    await access(from);
                    // eslint-disable-next-line no-console
                    console.log(`${from} already exists`);
                    continue;
                  } catch (error: any) {
                    if (error?.code === "ENOENT") {
                      // No link exists, create it
                    } else {
                      // eslint-disable-next-line no-console
                      console.error(`access ${from} error ${error}`, error);
                      throw error;
                    }
                  }

                  try {
                    await symlink(to, from, "junction");
                    // eslint-disable-next-line no-console
                    console.log(`created symlink ${from} -> ${to}`);
                  } catch (error: any) {
                    // Ignore errors if directory doesn't exist yet
                    if (error?.code !== "ENOENT") {
                      // eslint-disable-next-line no-console
                      console.error(`symlink ${from} error ${error}`, error);
                    }
                  }
                }
              }
            }
          );
        }
      })()
    );

    return config;
  },
  distDir: "dist",
  // https://github.com/vercel/next.js/discussions/11493#discussioncomment-14606
  env: { // These are sent to the client and the server and are set at build time for static pages
    LOGGING_LEVEL: process.env.LOGGING_LEVEL || process.env.LoggingLevel || "", // Only checks if debug
    APPLICATION_NAME: process.env.APPLICATION_NAME,
    SYSTEM_NAME: process.env.SYSTEM_NAME,
    FS_SITE: process.env.FS_SITE, // Used by auth client/Layout
    BASE_PATH: process.env.BASE_PATH, // client utils/Layout
    ASSET_PREFIX: process.env.ASSET_PREFIX, // client utils/Layout
    HIDE_ENVIRONMENT: process.env.HIDE_ENVIRONMENT, // Used by Layout
    AUTH_MODE: process.env.AUTH_MODE, // Used by auth client/Layout
    AUTH_COOKIE_NAME: process.env.AUTH_COOKIE_NAME, // Used by auth client/Layout
    AUTH_HEADER_NAME: process.env.AUTH_HEADER_NAME, // Used by auth client/Layout
    // Client-side test configuration
    TEST_STATUS_REFRESH_DELAY: process.env.TEST_STATUS_REFRESH_DELAY, // pages/index.tsx
    TEST_ERRORS_MAX_DISPLAYED: process.env.TEST_ERRORS_MAX_DISPLAYED, // pages/index.tsx
    TEST_ERRORS_MAX_LINE_LENGTH: process.env.TEST_ERRORS_MAX_LINE_LENGTH, // pages/index.tsx
    // Client-side domain configuration
    CNAME_DOMAIN: process.env.CNAME_DOMAIN, // clientutil
    ROUTING_DOMAIN: process.env.ROUTING_DOMAIN, // clientutil
    TEST_LOCALHOST: process.env.TEST_LOCALHOST, // clientutil
    // Client-side cookie configuration
    AUTH_COOKIE_PATH: process.env.AUTH_COOKIE_PATH, // authclient
    REFRESH_COOKIE_NAME: process.env.REFRESH_COOKIE_NAME, // authclient
    HINT_COOKIE_NAME: process.env.HINT_COOKIE_NAME, // authclient
    COOKIE_DURATION_DAYS: process.env.COOKIE_DURATION_DAYS, // authclient
    REFRESH_COOKIE_DURATION_DAYS: process.env.REFRESH_COOKIE_DURATION_DAYS // authclient
  }
};

module.exports = nextConfig;