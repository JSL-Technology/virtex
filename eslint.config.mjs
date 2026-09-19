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
      // `depConstraints` decía `'*' -> ['*']`, que es la configuración por defecto del generador y
      // no restringe nada: la regla estaba instalada y activa, y no podía fallar nunca. La
      // auditoría de septiembre de 2026 la encontró así, con 1.686 violaciones de frontera debajo.
      //
      // Estas restricciones son las que sí se pueden verificar hoy, con los proyectos que existen.
      // No cubren la frontera entre los módulos de dominio —esos viven dentro de `api` y
      // `client-web`, así que Nx no los ve como proyectos— y para eso está
      // `npm run verify:boundaries`, que lee el árbol de imports directamente. Cuando los módulos
      // sean libs con su propio tag `domain:*`, sus reglas se mudan aquí y aquel verificador se
      // retira.
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // Una lib compartida no puede depender de una aplicación ni de otro scope: es lo que
            // la hace compartible. Sin esto, `shared/util-auth` podría importar de `client-web` y
            // arrastrar Angular al backend.
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            { sourceTag: 'scope:backend', onlyDependOnLibsWithTags: ['scope:backend', 'scope:shared'] },
            { sourceTag: 'scope:core', onlyDependOnLibsWithTags: ['scope:core', 'scope:shared'] },
            { sourceTag: 'scope:pos', onlyDependOnLibsWithTags: ['scope:pos', 'scope:shared'] },
            { sourceTag: 'scope:desktop', onlyDependOnLibsWithTags: ['scope:desktop', 'scope:shared'] },

            // Jerarquía por tipo: los tipos no dependen de nada, la utilidad solo de tipos, la UI
            // de ambos, y la aplicación de todo. Un ciclo entre capas es imposible por construcción.
            { sourceTag: 'type:types', onlyDependOnLibsWithTags: ['type:types'] },
            { sourceTag: 'type:util', onlyDependOnLibsWithTags: ['type:util', 'type:types'] },
            { sourceTag: 'type:ui', onlyDependOnLibsWithTags: ['type:ui', 'type:util', 'type:types'] },
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: ['type:ui', 'type:util', 'type:types', 'type:app'],
            },
            {
              sourceTag: 'type:api',
              onlyDependOnLibsWithTags: ['type:util', 'type:types', 'type:api'],
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
