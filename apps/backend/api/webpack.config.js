const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');
const TsConfigPathsPlugin = require('tsconfig-paths-webpack-plugin');

module.exports = {
  output: {
    path: join(__dirname, '../../../dist/apps/backend/api'),
    clean: true,
    // env-gating-allow: build-time bundler options (source maps, optimisation). Not a runtime
    // security control, and it runs before the application exists.
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  resolve: {
    plugins: [
      new TsConfigPathsPlugin({
        configFile: join(__dirname, 'tsconfig.app.json'),
      }),
    ],
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: [
        './src/assets',
        {
          input: './src/app/mail/templates',
          glob: '**/*.hbs',
          output: 'templates',
        },
        // Printed documents live apart from the e-mail templates. Both folders used to land in
        // `templates/`, and the e-mail's `invoice.hbs` overwrote the printed invoice's, so every
        // PDF, print view and e-mail attachment rendered the e-mail body with its placeholders.
        {
          input: './src/app/invoices/templates',
          glob: '**/*.hbs',
          output: 'templates/documents',
        },
      ],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMaps: true,
    }),
  ],
};
