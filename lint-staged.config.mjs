export default {
  "package.json": "prettier --write --plugin=prettier-plugin-packagejson",
  "*.{js,mjs,ts}": "oxlint -c oxlint.json",
  "*.ts": () => "tsc -p tsconfig.json --noEmit",
  "*": "prettier --ignore-unknown --write",
};
