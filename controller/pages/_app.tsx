import "react-datepicker/dist/react-datepicker.css";
import "./styles.css";
import { LogLevel, log } from "../src/log";
import { AppProps } from "next/app";
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

/**
 * Global App function to import global CSS.
 * https://github.com/vercel/next.js/blob/master/errors/css-global.md
 * @param {*} param0
 */
export default function MyApp ({ Component, pageProps, router }: AppProps) {
  if (getBasePath()) {
    useInterceptNextDataHref({
      router,
      namespace: getBasePath()
    });
  }
  return <Component {...pageProps} />;
}
