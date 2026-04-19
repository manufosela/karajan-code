// @ts-check
// ESLint flat config para Karajan RAG.
// Objetivo: asegurar ES2025, prohibir APIs deprecadas (var, substr, escape…)
// y mantener estilo consistente con los estándares declarados en CLAUDE.md.

import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2025,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.nodeBuiltin,
      },
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // APIs deprecadas detectables por sintaxis / globals
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='substr']",
          message: 'String.prototype.substr está deprecado. Usa substring() o slice().',
        },
        {
          selector: "CallExpression[callee.name='alert']",
          message: 'alert() está prohibido. Usa el sistema de modales del proyecto.',
        },
        {
          selector: "CallExpression[callee.name='confirm']",
          message: 'confirm() está prohibido. Usa el sistema de modales del proyecto.',
        },
        {
          selector: "CallExpression[callee.name='prompt']",
          message: 'prompt() está prohibido. Usa el sistema de modales del proyecto.',
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'escape',
          message: 'escape() está deprecado. Usa encodeURIComponent().',
        },
        {
          name: 'unescape',
          message: 'unescape() está deprecado. Usa decodeURIComponent().',
        },
      ],
    },
  },
  {
    // Tests pueden usar patrones algo más laxos si hiciera falta.
    files: ['tests/**/*.js', 'scripts/**/*.js'],
    rules: {
      'no-unused-vars': 'warn',
    },
  },
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'dist/**',
      'build/**',
      '**/*.lance',
      'data/**',
    ],
  },
];
