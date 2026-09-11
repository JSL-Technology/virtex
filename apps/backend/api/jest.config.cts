module.exports = {
  displayName: 'api',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/apps/backend/api',
  // Warns once, loudly, when no database is configured and the integration suites will skip —
  // so a green run without a DB cannot be mistaken for full coverage.
  globalSetup: '<rootDir>/jest.global-setup.cts',
};
