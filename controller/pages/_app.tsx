import "react-datepicker/dist/react-datepicker.css";
import "./styles.css";
import App, { AppContext, AppInitialProps, AppProps } from "next/app";
import { LogLevel, log } from "../src/log";
import { RuntimeConfig, RuntimeConfigProvider, defaultRuntimeConfig } from "../src/runtimeConfig";
import { GlobalStyle } from "../components/Layout";
import { Router } from "next/router";
import { getBasePath } from "../src/clientutil";
import { useEffect } from "react";

// https://stackoverflow.com/questions/70791571/nextjs-use-getserversideprops-with-a-specific-url-path
// https://github.com/vercel/next.js/discussions/25681#discussioncomment-2026813
const useInterceptNextDataHref = ({
  router,
  namespace
}: {
  router: Router;
  namespace: string;
}) => {
  useEffect(() => {
    if (router.pageLoader?.getDataHref) {
      const originalGetDataHref = router.pageLoader.getDataHref;
      router.pageLoader.getDataHref = function (args: {
        href: string;
        asPath: string;
        ssg?: boolean;
        rsc?: boolean;
        locale?: string | false;
      }) {
        const r = originalGetDataHref.call(router.pageLoader, args);
        log(`useInterceptNextDataHref(${namespace})`, LogLevel.DEBUG, { args, r, namespaceR: `${namespace}${r}` });
        return r && r.startsWith("/_next/data")
          ? `${namespace}${r}`
          : r;
      };
    }
  }, [router, namespace]);
};

interface MyAppProps extends AppProps {
  runtimeConfig: RuntimeConfig;
}

/**
 * Global App function to import global CSS.
 * https://github.com/vercel/next.js/blob/master/errors/css-global.md
 * @param {*} param0
 */
export default function MyApp ({ Component, pageProps, router, runtimeConfig }: MyAppProps) {
  if (getBasePath()) {
    useInterceptNextDataHref({
      router,
      namespace: getBasePath()
    });
  }
  return (
    <RuntimeConfigProvider config={runtimeConfig}>
      <GlobalStyle />
      <Component {...pageProps} />
    </RuntimeConfigProvider>
  );
}

/**
 * Runs server-side on every request. Reads runtime environment variables and
 * passes them to all pages via the RuntimeConfigProvider, replacing the
 * publicRuntimeConfig pattern removed in Next.js 15.
 *
 * All variables here are read from process.env at request time — no rebuild
 * is needed when environment variables change between deployments.
 */
MyApp.getInitialProps = async (appContext: AppContext): Promise<AppInitialProps & { runtimeConfig: RuntimeConfig }> => {
  const appProps = await App.getInitialProps(appContext);
  const runtimeConfig: RuntimeConfig = {
    HIDE_ENVIRONMENT: process.env.HIDE_ENVIRONMENT || defaultRuntimeConfig.HIDE_ENVIRONMENT
  };
  return { ...appProps, runtimeConfig };
};
