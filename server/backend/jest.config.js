/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // `.js` as well as `.ts`: a `.test.js` file was silently never executed, so
  // `src/routes/catalog-helpers.test.js` had been reporting nothing since it was
  // written — a green suite that never ran it. The backend still ships a few CommonJS
  // route modules, and their tests are allowed to match them.
  testMatch: ['**/__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts', '**/*.test.js', '**/*.spec.js'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@dzhoof/shared$': '<rootDir>/../packages/shared/src/index',
  },
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  maxWorkers: 1,
  // Measured 2026-09-26: `sync-snapshot-service.test.ts` seeds 4,500 channels and takes
  // ~4.3s on an idle machine — under the default 5s per-test timeout it passed only by
  // luck, and failed the moment anything else shared the CPU (CI runners, a local
  // `--maxWorkers=4` run). Raise the budget instead of trimming the test: the seeding is
  // the point of the test (it stands in for the production 16k-channel catalog MongoDB
  // refused), so making it smaller would retire the regression it guards.
  testTimeout: 30000,
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['/node_modules/', '/test/'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
};
