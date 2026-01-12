const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  setupFiles: ['dotenv/config'],
  testPathIgnorePatterns: ["/dist/"],
  testEnvironment: "node",
  transform: {
    ...tsJestTransformCfg,
  },
};