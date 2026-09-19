import nx from '@nx/eslint-plugin';
import baseConfig from '../../../eslint.config.mjs';

export default [
  ...baseConfig,
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      /*
       * Two prefixes, because the product has two kinds of component.
       *
       * `app-` is a feature component: a page, a widget, a form for one particular thing. `vx-` is
       * a SYSTEM PRIMITIVE — a piece that knows nothing about the domain and that other components
       * are built out of. Today that is the four gesture shells (`vx-list-shell`, `vx-draft-shell`,
       * `vx-document-shell`, `vx-inbox-shell`), whose use `gesture-conformance.spec.ts` enforces,
       * and the shared form controls (`vx-select`). The distinction is deliberate and load-bearing:
       * reading a template, `vx-` marks what the product is made of and `app-` marks what was made
       * with it.
       *
       * The rule's actual purpose — no unprefixed selector that could collide with an element name
       * or another library — is served by either.
       */
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: ['app', 'vx'],
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    // Override or add rules here
    rules: {},
  },
];
