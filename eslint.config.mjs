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
