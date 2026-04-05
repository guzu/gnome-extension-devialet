import js from '@eslint/js';

export default [
    js.configs.recommended,
    {
        files: ['**/*.js'],
        ignores: ['node_modules/**'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                // GJS globals
                log: 'readonly',
                logError: 'readonly',
                print: 'readonly',
                printerr: 'readonly',
                // GJS TextEncoder/TextDecoder
                TextEncoder: 'readonly',
                TextDecoder: 'readonly',
                // Console (GJS 1.72+)
                console: 'readonly',
            },
        },
        rules: {
            // Syntax and error detection
            'no-unused-vars': ['warn', {argsIgnorePattern: '^_'}],
            'no-undef': 'error',

            // Allow empty catch blocks (intentional silent error handling)
            'no-empty': ['error', {allowEmptyCatch: true}],

            // Disable rules that conflict with GJS patterns
            'no-restricted-properties': 'off',
        },
    },
    {
        ignores: ['node_modules/**'],
    },
];
