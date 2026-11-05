module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.[jt]s?(x)'],
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
  moduleNameMapper: {
    '\\.(css)$': '<rootDir>/tests/helpers/styleMock.cjs',
    '\\?raw$': '<rootDir>/tests/helpers/rawModule.cjs',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/helpers/jestSetup.js'],
  collectCoverageFrom: [
    'src/game/engine/**/*.js',
    'src/game/tank-script/**/*.js',
    '!**/node_modules/**',
  ],
  coverageDirectory: '<rootDir>/coverage',
};
