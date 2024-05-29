import type  { DocumentContext, DocumentInitialProps } from "next/document";
import Document from "next/document";
import { ServerStyleSheet } from "styled-components";

/**
 * Each page will be wrapped with this custom content.
 * Source: https://nextjs.org/docs/advanced-features/custom-document
 * https://medium.com/swlh/server-side-rendering-styled-components-with-nextjs-1db1353e915e
 * This document is based on the ics react starter version
 */
class CustomDocument extends Document {
  // We can't remove this getInitialProps call yet. If we do, we get a flicker on server side loads
  // while it client-side loads our styles. Watching https://github.com/vercel/next.js/discussions/22065
  // Other options available with app directory instead of pages
  // https://github.com/vercel/next.js/blob/canary/examples/with-styled-components/pages/_document.tsx
  public static async getInitialProps (ctx: DocumentContext): Promise<DocumentInitialProps> {
    const sheet: ServerStyleSheet = new ServerStyleSheet();
    const originalRenderPage = ctx.renderPage;

    try {
      ctx.renderPage = () =>
        originalRenderPage({
          enhanceApp: (App) => (props) => sheet.collectStyles(<App {...props} />)
        });

      const initialProps = await Document.getInitialProps(ctx);
      return {
        ...initialProps,
        styles: [initialProps.styles, sheet.getStyleElement()]
      };
    } finally {
      sheet.seal();
    }
  }
}

export default CustomDocument;
