import js from '@eslint/js'
import globals from 'globals'

/* Flat ESLint config. Goal: catch real regressions (undefined names, unused
   bindings, obvious mistakes) without imposing heavy style rules. Generated/
   vendored data and build outputs are ignored. */
export default [
  {
    ignores: [
      'dist/**',
      'release/**',
      'node_modules/**',
      'public/**', // static assets + vendored/minified Tesseract OCR engine
      'docs/**', // static landing page (inline scripts), not part of the app
      'src/data/**', // generated dictionary index
      'assets/cedict/**', // vendored raw CC-CEDICT source
      'assets/cedpane/**', // cached CedPane data
      'assets/char-data/**', // generated character data
      'assets/hsk-vocab/**', // generated HSK data
    ],
  },

  js.configs.recommended,

  // App + browser/extension code (JSX enabled)
  {
    files: ['**/*.{js,mjs,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest', // import attributes (`with { type: 'json' }`), top-level await, etc.
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        ...globals.webextensions,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Node-context: build/maintenance scripts and config files
  {
    files: ['assets/**/*.mjs', '*.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Tests (Node test runner + Playwright)
  {
    files: ['test/**/*.{js,mjs,jsx}', 'e2e/**/*.{js,mjs,jsx}', '**/*.test.{js,mjs,jsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
]
