import "react-datepicker/dist/react-datepicker.css";
import "./styles.css";
import { LogLevel, log } from "../src/log";
import { AppProps } from "next/app";
import { Router } from "next/router";
import { getBasePath } from "../src/clientutil";
import { useEffect } from "react";

/**
 * Intercepts Next.js data fetching URLs and adds basePath prefix.
 * This is required because Next.js Pages Router doesn't natively support
 * our reverse proxy setup where the server runs on / but is accessed via
 * a basePath like /pewpew/load-test/.
 *
 * The middleware sets the basePath cookie, and this hook reads it to
 * prefix /_next/data URLs for client-side navigation.
 *
 * See: https://github.com/vercel/next.js/discussions/25681
 */
const useInterceptNextDataHref = ({
  router,
  basePath
}: {
  router: Router;
  basePath: string;
}) => {
  useEffect(() => {
    if (basePath && router.pageLoader?.getDataHref) {
      const originalGetDataHref = router.pageLoader.getDataHref;
      router.pageLoader.getDataHref = function (args: {
        href: string;
        asPath: string;
        ssg?: boolean;
        rsc?: boolean;
        locale?: string | false;
      }) {
        const result = originalGetDataHref.call(router.pageLoader, args);

        if (result && result.startsWith("/_next/data")) {
          // Next.js data URLs have format: /_next/data/[buildId]/[...page-path].json
          // If the page-path includes the basePath, we need to remove it before prepending
          // Example: /_next/data/abc123/pewpew/load-test/calendar.json
          //       -> /pewpew/load-test/_next/data/abc123/calendar.json

          const dataUrlPattern = /^\/_next\/data\/[^/]+\//;
          const match = result.match(dataUrlPattern);

          if (match) {
            const prefix = match[0]; // "/_next/data/[buildId]/"
            let pagePath = result.substring(prefix.length); // "pewpew/load-test/calendar.json"

            // Remove basePath from page path if present
            if (pagePath.startsWith(basePath.substring(1) + "/")) {
              pagePath = pagePath.substring(basePath.length);
            } else if (pagePath.startsWith(basePath.substring(1))) {
              pagePath = pagePath.substring(basePath.length - 1);
            }

            const finalUrl = `${basePath}${prefix}${pagePath}`;
            log(`useInterceptNextDataHref(${basePath})`, LogLevel.DEBUG, {
              args,
              result,
              pagePath,
              finalUrl
            });
            return finalUrl;
          }
        }

        return result;
      };
    }
  }, [router, basePath]);
};

/**
 * Global App function to import global CSS.
 * https://github.com/vercel/next.js/blob/master/errors/css-global.md
 */
export default function MyApp ({ Component, pageProps, router }: AppProps) {
  useInterceptNextDataHref({
    router,
    basePath: getBasePath()
  });
  return <Component {...pageProps} />;
}
