module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.[jt]s?(x)'],
  transform: {
    '^.+\\.[jt]sx?$': ['babel-jest', { configFile: require.resolve('./tests/babel.config.cjs') }],
  },
  moduleNameMapper: {
    '\\.(css)$': '<rootDir>/tests/helpers/styleMock.cjs',
    '\\?raw$': '<rootDir>/tests/helpers/rawModule.cjs',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/helpers/jestSetup.js'],
  collectCoverageFrom: [
    'frontend/src/game/engine/**/*.js',
    'frontend/src/game/tank-script/**/*.js',
    '!**/node_modules/**',
  ],
  coverageDirectory: '<rootDir>/coverage',
};
