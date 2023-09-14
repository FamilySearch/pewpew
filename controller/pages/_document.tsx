import Document, { DocumentContext, DocumentInitialProps, Head, Html, Main, NextScript } from "next/document";
import React from "react";
import { RenderPage } from "next/dist/shared/lib/utils";
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
  public static async getInitialProps (ctx: DocumentContext): Promise<DocumentInitialProps> {
    const sheet: ServerStyleSheet = new ServerStyleSheet();
    const originalRenderPage: RenderPage = ctx.renderPage;

    try {
      ctx.renderPage = () =>
        originalRenderPage({
          enhanceApp: (App) => (props) => sheet.collectStyles(<App {...props} />)
        });

      const initialProps = await Document.getInitialProps(ctx);
      return {
        ...initialProps,
        styles: [(
          <>
            {initialProps.styles}
            {sheet.getStyleElement()}
          </>
        )]
      };
    } finally {
      sheet.seal();
    }
  }

  public render () {
    return (
      <Html lang="en">
        <Head>
          {this.props.styles}
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default CustomDocument;
