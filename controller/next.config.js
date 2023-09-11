// @ts-check
// These environment variables are exported to the client-side code. Do not put any variables with secure information here.

if (process.env.BASE_PATH && !process.env.BASE_PATH.startsWith("/")) {
  const errorMessage = "process.env.BASE_PATH must start with a '/' found " + process.env.BASE_PATH;
  console.error(errorMessage);
  throw new Error(errorMessage);
}
/** @type {import('next').NextConfig} */
const nextConfig = {
  swcMinify: true,
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
      ssr: true,
      // ["styled-components", { "ssr": true, "displayName": true, "preprocess": false } ]
    }
  },
  experimental: {
    typedRoutes: true,
    instrumentationHook: true,
  },
  webpack: (config) => {
    const wasmExtensionRegExp = /\.wasm$/;

    config.resolve.extensions.push(".wasm");
  
    config.module.rules.forEach(rule => {
      (rule.oneOf || []).forEach(oneOf => {
        if (oneOf.loader && oneOf.loader.indexOf("file-loader") >= 0) {
          // Make file-loader ignore WASM files
          oneOf.exclude.push(wasmExtensionRegExp);
        }
      });
    });

    config.output.webassemblyModuleFilename = 'static/wasm/[modulehash].wasm'
    if (!config.experiments) { config.experiments = {}; }
    config.experiments.asyncWebAssembly = true;
  
    return config;
  },
  distDir: "dist",
  // env: {} // env variables are set at build time, not run time. They are better optimized during the build process
  publicRuntimeConfig: { // These are sent to the client and the server and are set at run time
    LoggingLevel: process.env.LoggingLevel,
    APPLICATION_NAME: process.env.APPLICATION_NAME,
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
    HIDE_ENVIRONMENT: process.env.HIDE_ENVIRONMENT,
  },
  // https://github.com/vercel/next.js/discussions/11493#discussioncomment-14606
  env: { // These are sent to the client and the server and are set at build time
    // @ts-ignore
    LoggingLevel: process.env.LoggingLevel,
    // @ts-ignore
    APPLICATION_NAME: process.env.APPLICATION_NAME,
    // @ts-ignore
    FS_SITE: process.env.FS_SITE,
    // @ts-ignore
    BASE_PATH: process.env.BASE_PATH,
    // @ts-ignore
    ASSET_PREFIX: process.env.ASSET_PREFIX,
    // @ts-ignore
    TEST_STATUS_REFRESH_DELAY: process.env.TEST_STATUS_REFRESH_DELAY,
    // @ts-ignore
    TEST_ERRORS_MAX_DISPLAYED: process.env.TEST_ERRORS_MAX_DISPLAYED,
    // @ts-ignore
    TEST_ERRORS_MAX_LINE_LENGTH: process.env.TEST_ERRORS_MAX_LINE_LENGTH,
    // @ts-ignore
    REDIRECT_TO_S3: process.env.REDIRECT_TO_S3,
    // @ts-ignore
    UNZIP_S3_FILES: process.env.UNZIP_S3_FILES,
    // @ts-ignore
    AUTH_MODE: process.env.AUTH_MODE,
    // @ts-ignore
    AUTH_COOKIE_NAME: process.env.AUTH_COOKIE_NAME,
    // @ts-ignore
    AUTH_HEADER_NAME: process.env.AUTH_HEADER_NAME,
  }
};

module.exports = nextConfig;