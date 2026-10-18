module.exports = {
  displayName: 'api',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  // openid-client v6 and its dependencies (oauth4webapi, and its own nested jose) are ESM-only;
  // Jest runs the suite as CommonJS, so let ts-jest transform them instead of leaving them for a
  // bare `require`. otplib 13 is the same: its CommonJS build requires the ESM-only `@scure/base`
  // and `@noble/hashes`, nested under its `@otplib/*` plugins.
  transformIgnorePatterns: ['node_modules/(?!(?:openid-client|oauth4webapi|jose|otplib|@otplib|@scure|@noble)/)'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/apps/backend/api',
  // Warns once, loudly, when no database is configured and the integration suites will skip —
  // so a green run without a DB cannot be mistaken for full coverage.
  globalSetup: '<rootDir>/jest.global-setup.cts',
};
