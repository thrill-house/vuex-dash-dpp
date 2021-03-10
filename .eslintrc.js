module.exports = {
  env: {
    browser: true,
    es6: true,
  },
  extends: ["eslint:recommended", "plugin:vue/essential"],
  globals: {
    Atomics: "readonly",
    SharedArrayBuffer: "readonly",
  },
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: "module",
  },
  plugins: ["vue"],
  rules: {
    "no-func-assign": "off",
    "no-cond-assign": "off",
    "no-unused-vars": "off",
    "no-undef": "off",
  },
};
