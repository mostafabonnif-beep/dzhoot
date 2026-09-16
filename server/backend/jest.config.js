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
