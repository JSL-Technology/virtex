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
       * `app-` is a feature component: a page, a widget, a form. `vx-` is a gesture shell — the
       * four primitives (`vx-list-shell`, `vx-draft-shell`, `vx-document-shell`, `vx-inbox-shell`)
       * that every screen of a given shape is built out of, and that `gesture-conformance.spec.ts`
       * enforces the use of. The distinction is deliberate and load-bearing: reading a template,
       * `vx-` marks the frame and `app-` marks what was put inside it.
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
