import { createDefaultPreset} from 'ts-jest';

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
export default {
  setupFiles: ['dotenv/config'],
  testPathIgnorePatterns: ["/dist/"],
  testEnvironment: "node",
  transform: {
    ...tsJestTransformCfg,
  },
};