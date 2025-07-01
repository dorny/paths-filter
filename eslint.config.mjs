// @ts-check

import jsEslint from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import * as eslintPluginImportX from 'eslint-plugin-import-x'
import * as tsEslint from 'typescript-eslint'

export default tsEslint.config(
  jsEslint.configs.recommended,
  eslintPluginImportX.flatConfigs.recommended,
  eslintPluginImportX.flatConfigs.typescript,
  ...tsEslint.configs.strictTypeChecked,
  ...tsEslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js', '*.mjs']
        },
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    ignores: ['**/coverage', '**/dist', '**/lib', '**/esbuild.config.mjs']
  },
  {
    rules: {
      '@typescript-eslint/await-thenable': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': ['warn', {ignoreIIFE: true, ignoreVoid: false}],
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', {argsIgnorePattern: '^_'}],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowNever: true,
          allowNumber: true
        }
      ],
      'import-x/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: true,
          optionalDependencies: true,
          peerDependencies: true
        }
      ],
      'import-x/order': ['warn', {'newlines-between': 'always', alphabetize: {order: 'asc'}}],
      'no-console': ['warn']
    }
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off'
    }
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tsEslint.configs.disableTypeChecked
  },
  eslintConfigPrettier
)
