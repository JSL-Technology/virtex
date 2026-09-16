import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    // ── Backend: intra-app module boundary enforcement ───────────────────────────
    //
    // @nx/enforce-module-boundaries only works across Nx project boundaries (libs/apps), not
    // within a single app. These rules enforce the dependency graph declared in the architecture
    // docs at the folder level by blocking the most dangerous cross-module imports.
    //
    // Direction rules enforced here:
    //  • accounting/* MUST NOT import from: invoices, accounts-payable, inventory, payroll,
    //    reconciliation, reports, sales (operational modules).
    //  • reports/* MUST NOT import entities from other modules directly (use LedgersService or
    //    explicit read-model types instead).
    //  • shared/permissions.ts is the barrel — do not add domain logic there.
    //
    // How to add a new rule: extend the `patterns` array in the relevant block below.
    // These are @typescript-eslint/no-restricted-imports zones, not Nx constraints.
    files: ['apps/backend/api/src/app/accounting/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/accounts-payable/entities/**'],
              message:
                'accounting must not import AP entities — use raw DataSource.query() or a ClosingBlockerPort.',
            },
            {
              group: ['**/invoices/entities/**'],
              message:
                'accounting must not import invoice entities — define a read-model or port instead.',
            },
            {
              group: ['**/reconciliation/entities/**'],
              message:
                'accounting must not import reconciliation entities — use raw DataSource.query().',
            },
          ],
        },
      ],
    },
  },
  {
    // Reports must not read operational tables directly. Reports reads through LedgersService
    // (which it imports via AccountingModule) and InvoicesModule (already declared).
    files: ['apps/backend/api/src/app/reports/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/payroll/entities/**', '**/hcm/entities/**'],
              message: 'reports must not read payroll entities directly — add a read-model port.',
            },
            {
              group: ['**/inventory/entities/**', '**/supply-chain/entities/**'],
              message: 'reports must not read inventory entities directly — add a read-model port.',
            },
            {
              group: ['**/customers/entities/**'],
              message:
                'reports must not read customer entities directly — use the InvoicesModule contract.',
            },
          ],
        },
      ],
    },
  },
  {
    // inventory must not know about journal structure — it posts via InventoryPostingService,
    // which speaks to JournalEntriesService. The service layer may import from journal-entries;
    // entity files and DTOs from accounting domain should not leak into product/category code.
    files: [
      'apps/backend/api/src/app/inventory/entities/**/*.ts',
      'apps/backend/api/src/app/inventory/dto/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/journal-entries/**', '**/accounting/**'],
              message:
                'inventory entities and DTOs must not import from accounting — keep the data model independent.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
