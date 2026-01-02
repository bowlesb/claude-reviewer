import type { Config } from "jest";

const config: Config = {
  rootDir: "../",
  preset: "ts-jest",
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/test-config/jest.e2e.setup.ts"],
  testMatch: ["<rootDir>/tests/e2e/**/*.test.ts"],
  testTimeout: 30000,
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true }],
  },
};

export default config;
