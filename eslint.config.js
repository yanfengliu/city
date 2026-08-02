import tseslint from 'typescript-eslint';

export default tseslint.config(
  // .claude/worktrees holds agent worktrees — second full checkouts of this repo.
  // Linting them is not merely redundant: two checkouts means two candidate
  // tsconfig roots, and typescript-eslint then refuses to parse ANY file,
  // including every file in the real tree. One nested worktree took the gate
  // from clean to 542 errors, 277 of them on src/, tests/ and scripts/.
  { ignores: ['dist/**', 'node_modules/**', '.claude/**'] },
  ...tseslint.configs.recommended,
  {
    // Belt and braces for the same hazard: pin the root that the "multiple
    // candidate TSConfigRootDirs" error asks for, so a lint invocation that
    // reaches a nested checkout anyway (an explicit path, --no-ignore) still
    // parses instead of failing wholesale.
    languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
