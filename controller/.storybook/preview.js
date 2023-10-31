// https://www.npmjs.com/package/storybook-addon-next-router
import { RouterContext } from "next/dist/shared/lib/router-context.shared-runtime"; // next 13.5

// https://github.com/storybookjs/storybook/blob/next/MIGRATION.md#default-export-in-previewjs
/** @type { import('@storybook/react').Preview } */
const preview = {
  nextRouter: {
    Provider: RouterContext.Provider,
  },
  // Can't get this to work
  // https://storybook.js.org/blog/integrate-nextjs-and-storybook-automatically/
  // nextjs: {
  //   router: {
  //     basePath: '/profile',
  //   },
  // }
};
export default preview;
