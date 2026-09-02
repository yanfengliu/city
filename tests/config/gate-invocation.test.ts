import { readFileSync, readdirSync } from 'fs';
import { describe, expect, it } from 'vitest';

/**
 * A pipe eats the exit code. In every POSIX shell `a | b` reports b's status,
 * so `vitest run | grep summary && git push` pushes a red suite: grep succeeded,
 * therefore the pipeline succeeded, therefore the gate "passed". The failure is
 * silent by construction — the red output scrolls past on its way into the pipe
 * while the shell reports success — and it reaches the remote, which is the one
 * place a broken gate is expensive.
 *
 * A gate command must therefore be the last command of its pipeline. Redirect
 * to a file and inspect the file afterwards; never filter a gate in flight.
 *
 * This scans every place this repo actually invokes a gate: the npm scripts, the
 * CI workflow's shell, and the git hooks.
 */

/** Commands whose exit code IS the gate verdict. */
const GATE_COMMAND =
  /\b(?:npm\s+(?:test|ci|audit|run\s+[\w:-]+)|npx\s+vitest|vitest\s+run|tsc\b|eslint\b|vite\s+build|node\s+scripts\/[\w.-]+\.m?js)/;

/** A `|` that is not part of `||` — the status-swallowing kind. */
const SWALLOWING_PIPE = /(?<!\|)\|(?!\|)/;

function offendingLines(source: string, label: string): string[] {
  return source
    .replaceAll('\r\n', '\n')
    .split('\n')
    // A YAML block scalar (`run: |`) is not a shell pipe.
    .map((line) => line.replace(/:\s*\|-?\s*$/, ':'))
    .filter((line) => !line.trimStart().startsWith('#'))
    .filter((line) => GATE_COMMAND.test(line) && SWALLOWING_PIPE.test(line))
    .map((line) => `${label}: ${line.trim()}`);
}

describe('gate invocation', () => {
  it('never pipes a gate command, because the pipe reports the wrong exit code', () => {
    const offenders: string[] = [];

    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    for (const [name, command] of Object.entries(packageJson.scripts)) {
      offenders.push(...offendingLines(command, `package.json script "${name}"`));
    }

    for (const file of readdirSync('.github/workflows')) {
      offenders.push(
        ...offendingLines(readFileSync(`.github/workflows/${file}`, 'utf8'), `workflows/${file}`),
      );
    }

    for (const file of readdirSync('.githooks')) {
      offenders.push(...offendingLines(readFileSync(`.githooks/${file}`, 'utf8'), `hooks/${file}`));
    }

    expect(
      offenders,
      'a piped gate reports the last command\'s status, so a red gate reads as green — ' +
        'redirect to a file and inspect it instead',
    ).toEqual([]);
  });

  it('scans surfaces that actually exist, so an empty scan cannot pass vacuously', () => {
    // The check above passes trivially if it read nothing. Pin the inputs.
    expect(readdirSync('.github/workflows').filter((f) => f.endsWith('.yml')).length).toBeGreaterThan(0);
    expect(readdirSync('.githooks').length).toBeGreaterThan(0);
    const scripts = (JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    }).scripts;
    expect(Object.keys(scripts).length).toBeGreaterThan(0);
    // And the detector recognises the shape it exists to reject.
    expect(GATE_COMMAND.test('npm test | tee out.txt')).toBe(true);
    expect(SWALLOWING_PIPE.test('npm test | tee out.txt')).toBe(true);
    expect(SWALLOWING_PIPE.test('npm test || exit 1')).toBe(false);
  });
});
