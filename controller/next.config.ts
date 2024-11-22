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
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true
  },
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
  experimental: {
    typedRoutes: true
    // instrumentationHook: true,
  },
  webpack: (config, { isServer, dir: optionsDir }) => {
    const wasmExtensionRegExp = /\.wasm$/;

    config.resolve.extensions.push(".wasm");

    config.module.rules.forEach((rule: any) => {
      (rule.oneOf || []).forEach((oneOf: any) => {
        if (oneOf.loader && oneOf.loader.indexOf("file-loader") >= 0) {
          // Make file-loader ignore WASM files
          oneOf.exclude.push(wasmExtensionRegExp);
        }
      });
    });

    config.output.webassemblyModuleFilename = "static/wasm/[modulehash].wasm";
    if (!config.experiments) { config.experiments = {}; }
    config.experiments.asyncWebAssembly = true;

    // https://github.com/vercel/next.js/issues/25852
    // Compiling we run into an issue where it can't find the config wasm.
    // On Linux the workaround is to create a symlink to the correct location
    // On Windows, the symlinks fail so we must copy the file
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
        apply (compiler: any) {
          compiler.hooks.afterEmit.tapPromise(
            "SymlinkWebpackPlugin",
            // eslint-disable-next-line @typescript-eslint/no-shadow
            async (compiler: any) => {
              if (isServer) {
                const from = join(compiler.options.output.path, "config_wasm_bg.wasm");
                const to = join(optionsDir, "../lib/config-wasm/pkg/config_wasm_bg.wasm");
                // options.dir /.../pewpew/controller
                // console.log(`from/to: ${from} -> ${to}`);

                try {
                  await access(from);
                  // eslint-disable-next-line no-console
                  console.log(`${from} already exists`);
                  return;
                } catch (error: any) {
                  if (error?.code === "ENOENT") {
                    // No link exists
                  } else {
                    // eslint-disable-next-line no-console
                    console.error(`access ${from} error ${error}`, error);
                    throw error;
                  }
                }

                await symlink(to, from, "junction");
                // eslint-disable-next-line no-console
                console.log(`created symlink ${from} -> ${to}`);
              }
            }
          );
        }
      })()
    );

    return config;
  },
  distDir: "dist",
  // env: {} // env variables are set at build time, not run time. They are better optimized during the build process
  publicRuntimeConfig: { // These are sent to the client and the server and are set at run time
    LOGGING_LEVEL: process.env.LOGGING_LEVEL || process.env.LoggingLevel,
    APPLICATION_NAME: process.env.APPLICATION_NAME,
    SYSTEM_NAME: process.env.SYSTEM_NAME,
    FS_SITE: process.env.FS_SITE,
    NODE_ENV: process.env.NODE_ENV,
    BASE_PATH: process.env.BASE_PATH,
    ASSET_PREFIX: process.env.ASSET_PREFIX,
    TEST_STATUS_REFRESH_DELAY: process.env.TEST_STATUS_REFRESH_DELAY,
    TEST_ERRORS_MAX_DISPLAYED: process.env.TEST_ERRORS_MAX_DISPLAYED,
    TEST_ERRORS_MAX_LINE_LENGTH: process.env.TEST_ERRORS_MAX_LINE_LENGTH,
    TEST_AUTH_PERMISSION: process.env.TEST_AUTH_PERMISSION,
    REDIRECT_TO_S3: process.env.REDIRECT_TO_S3,
    UNZIP_S3_FILES: process.env.UNZIP_S3_FILES,
    AUTH_MODE: process.env.AUTH_MODE,
    OPENID_ONLY_ADMIN_RUN_TESTS: process.env.OPENID_ONLY_ADMIN_RUN_TESTS,
    TEST_LOCALHOST: process.env.TEST_LOCALHOST,
    CNAME_DOMAIN: process.env.CNAME_DOMAIN,
    ROUTING_DOMAIN: process.env.ROUTING_DOMAIN,
    AUTH_COOKIE_PATH: process.env.AUTH_COOKIE_PATH,
    AUTH_COOKIE_NAME: process.env.AUTH_COOKIE_NAME,
    REFRESH_COOKIE_NAME: process.env.REFRESH_COOKIE_NAME,
    HINT_COOKIE_NAME: process.env.HINT_COOKIE_NAME,
    AUTH_HEADER_NAME: process.env.AUTH_HEADER_NAME,
    COOKIE_DURATION_DAYS: process.env.COOKIE_DURATION_DAYS,
    REFRESH_COOKIE_DURATION_DAYS: process.env.REFRESH_COOKIE_DURATION_DAYS,
    HIDE_ENVIRONMENT: process.env.HIDE_ENVIRONMENT
  },
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
    AUTH_HEADER_NAME: process.env.AUTH_HEADER_NAME // Used by auth client/Layout
  }
};

module.exports = nextConfig;