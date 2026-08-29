module.exports = {
  displayName: 'client-web',
  preset: '../../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../coverage/apps/core/client-web',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  moduleNameMapper: {
    // dockview-angular publishes only an ESM bundle and declares neither `main` nor `exports`,
    // so Jest's resolver fell through to the .d.ts and failed to parse it. Every suite that
    // transitively imported the app shell — which is most of them — died on that error before a
    // single assertion ran. Point the resolver at the real bundle and transform it.
    '^dockview-angular$':
      '<rootDir>/../../../node_modules/dockview-angular/dist/fesm2022/dockview-angular.mjs',
    '^dockview-core$': '<rootDir>/../../../node_modules/dockview-core/dist/package/main.esm.mjs',
  },
  // Transform the ESM-only dependencies as well as anything ending in .mjs.
  transformIgnorePatterns: ['node_modules/(?!(dockview-angular|dockview-core)/|.*\\.mjs$)'],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
