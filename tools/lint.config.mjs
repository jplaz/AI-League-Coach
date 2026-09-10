/*
 * Bug rules only. Nothing about style, so a red result is always worth reading.
 *
 * The globals list is the browser surface this project actually touches. Adding
 * to it is a decision, not a formality: a name that is not on this list and not
 * defined anywhere is exactly the typo this file exists to catch.
 *
 *   npm run lint      (needs eslint on the PATH; not part of running the coach)
 */
export default [{
  files: ['src/**/*.js', 'tools/**/*.mjs', 'server.mjs'],
  languageOptions: {
    ecmaVersion: 2024,
    sourceType: 'module',
    globals: {
      window: 'readonly', document: 'readonly', console: 'readonly',
      performance: 'readonly', navigator: 'readonly', location: 'readonly',
      fetch: 'readonly', localStorage: 'readonly',
      setTimeout: 'readonly', clearTimeout: 'readonly',
      setInterval: 'readonly', clearInterval: 'readonly',
      URL: 'readonly', Blob: 'readonly', Image: 'readonly',
      process: 'readonly', Buffer: 'readonly', globalThis: 'readonly',
    },
  },
  rules: {
    'no-undef': 'error',
    'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
    'no-dupe-keys': 'error',
    'no-dupe-args': 'error',
    'no-dupe-else-if': 'error',
    'no-duplicate-case': 'error',
    'no-unreachable': 'error',
    'no-fallthrough': 'error',
    'no-self-assign': 'error',
    'no-self-compare': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error',
    'no-unsafe-negation': 'error',
    'no-cond-assign': 'error',
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-const-assign': 'error',
    'no-func-assign': 'error',
    'no-import-assign': 'error',
    'no-obj-calls': 'error',
    'no-redeclare': 'error',
    'no-shadow-restricted-names': 'error',
    'no-sparse-arrays': 'error',
    'no-unsafe-finally': 'error',
    'for-direction': 'error',
    'getter-return': 'error',
    'array-callback-return': 'error',
    'no-loss-of-precision': 'error',
    'no-template-curly-in-string': 'error',
    'no-invalid-regexp': 'error',
  },
}];
