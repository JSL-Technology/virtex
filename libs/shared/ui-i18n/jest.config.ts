export default {
  displayName: 'shared-ui-i18n',
  preset: '../../../jest.preset.js',
  // Node rather than jsdom: the suite here shells out to the locale verifiers and asserts on their
  // output. The Angular services in this library are exercised by the applications that inject them.
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/shared/ui-i18n',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
};
