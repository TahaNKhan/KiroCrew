// Flat ESLint config — extended for TypeScript as soon as src/ has TS files.
// T01 left a JS-only baseline; T02 closes the gap so `npx eslint .` is green
// against TS source. Uses `typescript-eslint`'s flat-config helper.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
	{
		ignores: ["dist/**", "node_modules/**", "coverage/**"],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["**/*.{js,mjs,ts}"],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "module",
		},
	},
];
