// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";

export default zotero({
  overrides: [
    {
      files: ["**/*.ts"],
      rules: {
        // We disable this rule here because the template
        // contains some unused examples and variables
        "@typescript-eslint/no-unused-vars": "off",
      },
    },
    {
      // These scripts are meant to be executed in Zotero (Run JavaScript) or as ad-hoc Node scripts.
      // They use globals like Zotero/prompt/alert/fetch/console and may intentionally use empty catches.
      files: ["test/**/*.js"],
      rules: {
        "no-undef": "off",
        "no-unused-vars": "off",
        "no-empty": "off",
      },
    },
  ],
});
