// dotenv-flow's package.json exports map declares "./config" only under the
// `require` and `node` conditions — there is no `import` or `types` entry, so
// TS 6's stricter `noUncheckedSideEffectImports` check can't resolve it via
// the package exports even though node_modules/dotenv-flow/config.d.ts exists.
// Declare it locally so the side-effect import type-checks.
declare module "dotenv-flow/config";
