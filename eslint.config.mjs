import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});

export default [{
  "ignores": [
    "guide",
    "lib",
    "**/coverage/**",
    "**/dist/**",
    "target/**",
    "tests/**",
    "next-env.d.ts",
    "common/lib",
    "controller/lib",
    "controller/storybook-static",
    "controller/next-env.d.ts",
    "eslint.config.mjs"
  ],
}, ...compat.extends(
  "eslint:recommended",
  "plugin:@typescript-eslint/stylistic",
  "plugin:@typescript-eslint/eslint-recommended",
  "plugin:@typescript-eslint/recommended",
), {
  "plugins": {
    "@typescript-eslint": typescriptEslint,
  },

  "languageOptions": {
    "parser": tsParser,
    "ecmaVersion": 5,
    "sourceType": "script",

    "parserOptions": {
      "project": [
        "./common/tsconfig.json",
        "./agent/tsconfig.json",
        "./controller/tsconfig.json",
        "./controller/tsconfig.test.json",
        "./controller/.storybook/tsconfig.json",
      ],
    },
  },

  "rules": {
    "@typescript-eslint/no-explicit-any": 0,
    "@typescript-eslint/no-non-null-assertion": 0,
    "@typescript-eslint/explicit-module-boundary-types": 0,
    "@typescript-eslint/no-empty-object-type": 1,
    "@typescript-eslint/no-unsafe-function-type": 1,
    "@typescript-eslint/no-wrapper-object-types": 1,
    "@typescript-eslint/no-inferrable-types": 0,
    "@typescript-eslint/no-unused-vars": [1, {
      "argsIgnorePattern": "^_",
      "varsIgnorePattern": "^_",
    }],
    "@typescript-eslint/await-thenable": 1,
    "@typescript-eslint/no-shadow": "warn",
    "no-shadow": "off",
    "no-prototype-builtins": 1,
    "require-await": 1,
    "class-name": 0,
    "curly": 1,
    "eqeqeq": ["error", "smart"],
    "linebreak-style": 1,
    "object-literal-sort-keys": 0,
    "only-arrow-functions": 0,
    "max-classes-per-file": 1,
    "max-line-length": 0,
    "member-ordering": 0,
    "no-angle-bracket-type-assertion": 0,
    "no-bitwise": 1,
    "no-console": 1,
    "no-tabs": 1,
    "no-multiple-empty-lines": ["error", { "max": 2, "maxEOF": 0, "maxBOF": 0 }],
    "no-empty": [1, { "allowEmptyCatch": true }],
    "no-empty-interface": 0,
    "no-reference": 0,
    "no-string-literal": 0,
    "no-trailing-spaces": 1,
    "no-unused-expressions": 1,
    "no-useless-catch": 0,
    "prefer-const": 1,
    "semi": 1,
    "sort-imports": 1,
    "space-before-function-paren": 1,
    "spaced-comment": ["error", "always", { "block": { "balanced": true } }],
    "space-infix-ops": "warn",
    "space-before-blocks": "warn",
    "keyword-spacing": "warn",
    "key-spacing": 1,
    "strict": 0,
    "comma-dangle": 1,
    "triple-equals": 0,
    "unified-signatures": 0,
    "camelcase": 1,
    "no-irregular-whitespace": 1,
    "object-shorthand": 1,
    "quotes": ["warn", "double"]
  },
}];