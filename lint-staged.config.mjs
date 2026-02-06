export default {
  "package.json": "prettier --write --plugin=prettier-plugin-packagejson",
  "*.{js,mjs,ts}": "oxlint -c oxlint.json",
  "*": "prettier --ignore-unknown --write",
};
