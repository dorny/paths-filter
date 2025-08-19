// eslint.config.mjs
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import jest from 'eslint-plugin-jest'
import github from 'eslint-plugin-github'

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**', '*.min.js']
  },

  js.configs.recommended,

  ...tseslint.configs.recommendedTypeChecked,

  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      jest,
      github
    },
    rules: {
      ...github.configs.internal.rules,
      'eslint-comments/no-use': 'off',
      'import/no-namespace': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        { accessibility: 'no-public' }
      ],
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/array-type': 'error',
      '@typescript-eslint/await-thenable': 'error',
      'camelcase': 'off',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true }
      ],
      '@/func-call-spacing': ['error', 'never'],
      '@/no-array-constructor': 'error',
      '@typescript-eslint/no-empty-interface': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-extraneous-class': 'error',
      '@typescript-eslint/no-for-in-array': 'error',
      '@typescript-eslint/no-inferrable-types': 'error',
      '@typescript-eslint/no-misused-new': 'error',
      '@typescript-eslint/no-namespace': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unnecessary-qualifier': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@/no-useless-constructor': 'error',
      '@typescript-eslint/no-var-requires': 'error',
      '@typescript-eslint/prefer-for-of': 'warn',
      '@typescript-eslint/prefer-function-type': 'warn',
      '@typescript-eslint/prefer-includes': 'error',
      '@typescript-eslint/prefer-string-starts-ends-with': 'error',
      '@typescript-eslint/promise-function-async': [
        'error',
        { allowAny: true }
      ],
      '@typescript-eslint/require-array-sort-compare': 'error',
      '@typescript-eslint/restrict-plus-operands': 'error',
      'semi': 'off',
      '@/semi': ['error', 'never'],
      '@typescript-eslint/unbound-method': 'error'
    }
  },

  {
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      ...jest.configs.recommended.rules
    },
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly'
      }
    }
  }
]
