import { spawnSync } from 'child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const scanner = resolve('scripts/check-git-artifacts.mjs');
const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const temporaryRepositories: string[] = [];

type CommandResult = {
  status: number | null;
  output: string;
};

function command(cwd: string, executable: string, args: string[]): CommandResult {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function git(cwd: string, ...args: string[]): string {
  const result = command(cwd, 'git', args);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${result.output}`);
  return result.output.trim();
}

function createRepository(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'city-git-artifact-policy-'));
  temporaryRepositories.push(cwd);
  git(cwd, 'init', '--initial-branch=main');
  git(cwd, 'config', 'user.name', 'City Policy Test');
  git(cwd, 'config', 'user.email', 'city-policy@example.invalid');
  git(cwd, 'config', 'core.autocrlf', 'false');
  return cwd;
}

function write(cwd: string, path: string, contents: string | Buffer): void {
  const absolute = join(cwd, ...path.split('/'));
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

function commitAll(cwd: string, message: string): string {
  git(cwd, 'add', '--all');
  git(cwd, 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

function runScanner(cwd: string, ...args: string[]): CommandResult {
  return command(cwd, process.execPath, [scanner, ...args]);
}

function expectActionableFailure(result: CommandResult, path: string): void {
  expect(result.status).toBe(1);
  expect(result.output).toContain(`path=${JSON.stringify(path)}`);
  expect(result.output).toMatch(/commit=.+ \| path=/u);
  expect(result.output).toMatch(/blob=[0-9a-f]{40,64}/u);
  expect(result.output).toMatch(/size=\d+ bytes/u);
  expect(result.output).toContain('remediation=');
}

afterEach(() => {
  for (const cwd of temporaryRepositories.splice(0)) {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

describe('Git artifact policy configuration', () => {
  it('pins local-only evidence paths, byte ceilings, the fixture exception, and the hook', () => {
    const policy = JSON.parse(readFileSync('config/git-artifact-policy.json', 'utf8')) as {
      historyEpoch: string;
      reviewBlobBytes: number;
      absoluteBlobBytes: number;
      forbiddenPaths: string[];
      repositoryInputs: Record<string, {
        kind: string;
        format: string;
        maxBytes: number;
        reason: string;
      }>;
    };
    expect(policy.historyEpoch).toBe('0dbda4f4bd1a86f4e86140bd943c4da985ccd4bf');
    expect(policy.reviewBlobBytes).toBe(256 * 1024);
    expect(policy.absoluteBlobBytes).toBe(512 * 1024);
    expect(policy.forbiddenPaths).toEqual(expect.arrayContaining([
      'output/**',
      'benchmarks/results/**',
      '.shots/**',
      '.playwright-cli/**',
      'tmp/review-runs/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      '*.log',
      '*.lcov',
      'npm-debug.log*',
      'report.*.json',
    ]));
    expect(policy.repositoryInputs).toEqual({
      'benchmarks/fixtures/performance-city-save.json': {
        kind: 'reviewed-deterministic-input',
        format: 'text',
        maxBytes: 450_000,
        reason: expect.stringContaining('repository input'),
      },
    });
    const hook = readFileSync('.githooks/pre-commit', 'utf8').replaceAll('\r\n', '\n');
    expect(hook).toContain(
      'git ls-files --error-unmatch -- .githooks/pre-commit scripts/check-git-artifacts.mjs config/git-artifact-policy.json',
    );
    expect(hook).toContain(
      'git diff --quiet -- .githooks/pre-commit scripts/check-git-artifacts.mjs config/git-artifact-policy.json',
    );
    expect(hook).toContain('exec node scripts/check-git-artifacts.mjs --staged\n');
    const trackedHook = command(process.cwd(), 'git', [
      '-c', `safe.directory=${resolve('.').replaceAll('\\', '/')}`,
      'ls-files', '--stage', '--', '.githooks/pre-commit',
    ]);
    expect(trackedHook.status).toBe(0);
    expect(trackedHook.output).toMatch(/^100755 [0-9a-f]+ 0\t\.githooks\/pre-commit\r?\n?$/u);
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts['hooks:install'])
      .toBe('git config core.hooksPath .githooks');
    expect(packageJson.scripts['git:artifacts:staged'])
      .toBe('node scripts/check-git-artifacts.mjs --staged');
    expect(packageJson.scripts['git:artifacts:range'])
      .toBe('node scripts/check-git-artifacts.mjs --range');
    const scannerSource = readFileSync('scripts/check-git-artifacts.mjs', 'utf8');
    expect(scannerSource.indexOf("git(['cat-file', '--batch-check']"))
      .toBeLessThan(scannerSource.indexOf("spawn('git', ['cat-file', '--batch']"));
    expect(scannerSource).toContain(
      'oids.filter((oid) => blobs.get(oid).size <= maxContentBytes)',
    );
  });
});

describe('staged Git artifact scan', { timeout: 20_000 }, () => {
  it('fails closed when enforcement files are absent from or differ from the index', () => {
    const hookSource = readFileSync('.githooks/pre-commit', 'utf8');

    const missingRepo = createRepository();
    write(missingRepo, '.githooks/pre-commit', hookSource);
    chmodSync(join(missingRepo, '.githooks/pre-commit'), 0o755);
    write(missingRepo, 'README.md', 'safe\n');
    git(missingRepo, 'add', '.githooks/pre-commit', 'README.md');
    git(missingRepo, 'config', 'core.hooksPath', '.githooks');
    const missing = command(missingRepo, 'git', ['commit', '-m', 'missing enforcement']);
    expect(missing.status).toBe(1);
    expect(missing.output).toContain('must all exist in the staged index');

    const mismatchRepo = createRepository();
    write(mismatchRepo, '.githooks/pre-commit', hookSource);
    chmodSync(join(mismatchRepo, '.githooks/pre-commit'), 0o755);
    write(mismatchRepo, 'scripts/check-git-artifacts.mjs', 'console.log("staged scanner");\n');
    write(mismatchRepo, 'config/git-artifact-policy.json', '{}\n');
    write(mismatchRepo, 'README.md', 'safe\n');
    git(
      mismatchRepo,
      'add',
      '.githooks/pre-commit',
      'scripts/check-git-artifacts.mjs',
      'config/git-artifact-policy.json',
      'README.md',
    );
    write(mismatchRepo, 'scripts/check-git-artifacts.mjs', 'console.log("unstaged scanner");\n');
    git(mismatchRepo, 'config', 'core.hooksPath', '.githooks');
    const mismatch = command(mismatchRepo, 'git', ['commit', '-m', 'mismatched enforcement']);
    expect(mismatch.status).toBe(1);
    expect(mismatch.output).toContain('have unstaged changes');
  });

  it('rejects evidence paths regardless of size or LFS indirection', () => {
    const cwd = createRepository();
    const path = 'output/tiny-trace.bin';
    write(cwd, path, [
      'version https://git-lfs.github.com/spec/v1',
      'oid sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'size 900000',
      '',
    ].join('\n'));
    git(cwd, 'add', path);

    const result = runScanner(cwd, '--staged');

    expectActionableFailure(result, path);
    expect(result.output).toContain('task-run evidence paths are local-only');
    expect(result.output).toContain('LFS is not permitted for evidence');
  });

  it('rejects ignored coverage and log output regardless of size', () => {
    const cwd = createRepository();
    const paths = [
      'coverage/tiny-report.json',
      'logs/profile.log',
      'debug.log',
      'npm-debug.log.1',
      'coverage.lcov',
      'report.2026.08.02.1234.json',
    ];
    for (const path of paths) {
      write(cwd, path, '{}\n');
      git(cwd, 'add', path);
    }

    const result = runScanner(cwd, '--staged');

    for (const path of paths) {
      expectActionableFailure(result, path);
    }
  });

  it('classifies invalid UTF-8 beyond the sample window as binary', () => {
    const cwd = createRepository();
    const path = 'notes/disguised.dat';
    const contents = Buffer.alloc(20_000, 97);
    contents[12_000] = 0xff;
    write(cwd, path, contents);
    git(cwd, 'add', path);

    const result = runScanner(cwd, '--staged');

    expectActionableFailure(result, path);
    expect(result.output).toContain('binary, archive, and media inputs require');
  });

  it('reads index objects rather than unstaged working-tree contents', () => {
    const cwd = createRepository();
    const path = 'notes/current.txt';
    write(cwd, path, 'small staged text\n');
    git(cwd, 'add', path);
    write(cwd, path, 'x'.repeat(300_000));
    expect(runScanner(cwd, '--staged')).toMatchObject({ status: 0 });

    git(cwd, 'add', path);
    write(cwd, path, 'small unstaged text\n');
    const result = runScanner(cwd, '--staged');

    expectActionableFailure(result, path);
    expect(result.output).toContain('text blobs above 262144 bytes');
  });

  it('ignores an unchanged legacy violation but rejects modifying or copying it', () => {
    const cwd = createRepository();
    const legacy = 'benchmarks/results/legacy.json';
    write(cwd, legacy, '{"legacy":true}\n');
    commitAll(cwd, 'published legacy evidence');
    write(cwd, 'notes/new.txt', 'unrelated safe change\n');
    git(cwd, 'add', 'notes/new.txt');
    expect(runScanner(cwd, '--staged')).toMatchObject({ status: 0 });

    write(cwd, legacy, '{"legacy":"modified"}\n');
    git(cwd, 'add', legacy);
    const modified = runScanner(cwd, '--staged');
    expectActionableFailure(modified, legacy);

    git(cwd, 'reset', '--hard', 'HEAD');
    const copied = 'benchmarks/results/copied-legacy.json';
    write(cwd, copied, '{"legacy":true}\n');
    git(cwd, 'add', copied);
    expectActionableFailure(runScanner(cwd, '--staged'), copied);
  });

  it('does not treat a mode-only change as a new copy of a legacy blob', () => {
    const cwd = createRepository();
    const legacy = 'benchmarks/results/legacy.json';
    write(cwd, legacy, '{"legacy":true}\n');
    commitAll(cwd, 'published legacy evidence');
    git(cwd, 'update-index', '--chmod=+x', legacy);

    expect(runScanner(cwd, '--staged')).toMatchObject({ status: 0 });
  });

  it('does not inherit repository-input allowances from Object.prototype', () => {
    const cwd = createRepository();
    const path = 'constructor';
    write(cwd, path, Buffer.concat([Buffer.from([0]), Buffer.alloc(300_000, 1)]));
    git(cwd, 'add', path);

    const result = runScanner(cwd, '--staged');

    expectActionableFailure(result, path);
    expect(result.output).toContain('binary, archive, and media inputs require');
  });

  it('rejects a gitlink placed under a local-only evidence path', () => {
    const cwd = createRepository();
    write(cwd, 'README.md', 'base\n');
    const commit = commitAll(cwd, 'base');
    git(cwd, 'update-index', '--add', '--cacheinfo', `160000,${commit},output/evidence-link`);

    const result = runScanner(cwd, '--staged');

    expect(result.status).toBe(1);
    expect(result.output).toContain('path="output/evidence-link"');
    expect(result.output).toContain(`gitlink=${commit}`);
    expect(result.output).toContain('size=gitlink');
  });

  it('allows only the exact reviewed fixture within its cap', () => {
    const cwd = createRepository();
    const fixture = 'benchmarks/fixtures/performance-city-save.json';
    write(cwd, fixture, 'x'.repeat(409_905));
    git(cwd, 'add', fixture);
    expect(runScanner(cwd, '--staged')).toMatchObject({ status: 0 });

    write(cwd, fixture, 'x'.repeat(450_001));
    git(cwd, 'add', fixture);
    const overCap = runScanner(cwd, '--staged');
    expectActionableFailure(overCap, fixture);
    expect(overCap.output).toContain('allowance is capped at 450000 bytes');

    const unreviewed = 'benchmarks/fixtures/unreviewed-save.json';
    write(cwd, unreviewed, 'x'.repeat(409_905));
    git(cwd, 'add', unreviewed);
    const wrongPath = runScanner(cwd, '--staged');
    expectActionableFailure(wrongPath, unreviewed);

    git(cwd, 'reset');
    rmSync(join(cwd, 'benchmarks'), { recursive: true, force: true });
    write(cwd, fixture, [
      'version https://git-lfs.github.com/spec/v1',
      'oid sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'size 409905',
      '',
    ].join('\n'));
    git(cwd, 'add', fixture);
    const lfsSubstitution = runScanner(cwd, '--staged');
    expectActionableFailure(lfsSubstitution, fixture);
    expect(lfsSubstitution.output).toContain('LFS pointers are not permitted');

    git(cwd, 'reset');
    rmSync(join(cwd, 'benchmarks'), { recursive: true, force: true });
    write(cwd, fixture, Buffer.from([0, 1, 2, 3]));
    git(cwd, 'add', fixture);
    const binarySubstitution = runScanner(cwd, '--staged');
    expectActionableFailure(binarySubstitution, fixture);
    expect(binarySubstitution.output).toContain('text-only reviewed input allowance');
  });

  it('rejects the absolute ceiling and review-sensitive binary inputs', () => {
    const cwd = createRepository();
    const huge = 'notes/huge.txt';
    write(cwd, huge, 'x'.repeat(524_289));
    git(cwd, 'add', huge);
    const absoluteFailure = runScanner(cwd, '--staged');
    expectActionableFailure(absoluteFailure, huge);
    expect(absoluteFailure.output).toContain('may not exceed 524288 bytes');

    git(cwd, 'reset');
    rmSync(join(cwd, 'notes'), { recursive: true, force: true });
    const binary = 'assets/sprite.png';
    write(cwd, binary, 'tiny but still review-sensitive');
    git(cwd, 'add', binary);
    const binaryFailure = runScanner(cwd, '--staged');
    expectActionableFailure(binaryFailure, binary);
    expect(binaryFailure.output).toContain('binary, archive, and media inputs require');
  });
});

describe('range Git artifact scan', { timeout: 30_000 }, () => {
  it('grandfathers violations before the trusted base and rejects new ones after it', () => {
    const cwd = createRepository();
    write(cwd, 'output/published-legacy.json', '{}\n');
    const base = commitAll(cwd, 'published legacy evidence');
    write(cwd, 'README.md', 'safe change\n');
    commitAll(cwd, 'safe change');
    expect(runScanner(cwd, '--range', base, 'HEAD')).toMatchObject({ status: 0 });

    const newPath = 'output/new-evidence.json';
    write(cwd, newPath, '{}\n');
    const introduced = commitAll(cwd, 'new evidence');
    const result = runScanner(cwd, '--range', base, 'HEAD');

    expectActionableFailure(result, newPath);
    expect(result.output).toContain(`commit=${introduced}`);
  });

  it('finds evidence in a root commit and an add-then-delete history', () => {
    const rootRepo = createRepository();
    const rootPath = 'output/root-trace.json';
    write(rootRepo, rootPath, '{}\n');
    const rootCommit = commitAll(rootRepo, 'root evidence');
    const rootResult = runScanner(rootRepo, '--range', emptyTree, 'HEAD');
    expectActionableFailure(rootResult, rootPath);
    expect(rootResult.output).toContain(`commit=${rootCommit}`);

    const deletedRepo = createRepository();
    write(deletedRepo, 'README.md', 'base\n');
    const base = commitAll(deletedRepo, 'base');
    const deletedPath = 'benchmarks/results/transient.json';
    write(deletedRepo, deletedPath, '{}\n');
    const addingCommit = commitAll(deletedRepo, 'add transient evidence');
    rmSync(join(deletedRepo, 'benchmarks'), { recursive: true, force: true });
    commitAll(deletedRepo, 'delete transient evidence');

    const deletedResult = runScanner(deletedRepo, '--range', base, 'HEAD');
    expectActionableFailure(deletedResult, deletedPath);
    expect(deletedResult.output).toContain(`commit=${addingCommit}`);
  });

  it('scans blobs introduced by a merge commit against every parent', () => {
    const cwd = createRepository();
    write(cwd, 'README.md', 'base\n');
    const base = commitAll(cwd, 'base');
    git(cwd, 'checkout', '-b', 'side');
    write(cwd, 'side.txt', 'side\n');
    commitAll(cwd, 'side');
    git(cwd, 'checkout', 'main');
    write(cwd, 'main.txt', 'main\n');
    commitAll(cwd, 'main');
    git(cwd, 'merge', '--no-ff', '--no-commit', 'side');
    const path = 'output/merge-only-trace.json';
    write(cwd, path, '{}\n');
    const mergeCommit = commitAll(cwd, 'merge with local trace');

    const result = runScanner(cwd, '--range', base, 'HEAD');

    expectActionableFailure(result, path);
    expect(result.output).toContain(`commit=${mergeCommit}`);
  });

  it('does not reclassify unchanged legacy content when merging a parent that lacks it', () => {
    const cwd = createRepository();
    write(cwd, 'README.md', 'root\n');
    commitAll(cwd, 'root');
    git(cwd, 'checkout', '-b', 'side');
    write(cwd, 'side.txt', 'side\n');
    commitAll(cwd, 'side');
    git(cwd, 'checkout', 'main');
    write(cwd, 'output/published-legacy.json', '{}\n');
    const base = commitAll(cwd, 'published legacy evidence');
    git(cwd, 'merge', '--no-ff', 'side', '-m', 'merge side');

    expect(runScanner(cwd, '--range', base, 'HEAD')).toMatchObject({ status: 0 });
  });

  it('rejects stale legacy evidence restored from a side branch after the base removed it', () => {
    const cwd = createRepository();
    const path = 'output/stale-side-trace.json';
    write(cwd, path, '{}\n');
    commitAll(cwd, 'legacy evidence');
    git(cwd, 'checkout', '-b', 'side');
    write(cwd, 'side.txt', 'side branch stays alive\n');
    commitAll(cwd, 'continue side');
    git(cwd, 'checkout', 'main');
    rmSync(join(cwd, 'output'), { recursive: true, force: true });
    const base = commitAll(cwd, 'remove legacy evidence');
    git(cwd, 'merge', '--no-ff', '--no-commit', 'side');
    write(cwd, path, '{}\n');
    commitAll(cwd, 'restore stale side evidence in merge');

    expectActionableFailure(runScanner(cwd, '--range', base, 'HEAD'), path);
  });

  it('fails closed when the base is missing or the repository is shallow', () => {
    const cwd = createRepository();
    write(cwd, 'README.md', 'base\n');
    commitAll(cwd, 'base');
    const missing = runScanner(cwd, '--range', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'HEAD');
    expect(missing.status).toBe(1);
    expect(missing.output).toContain('range base');
    expect(missing.output).toContain('fetch the complete history');

    writeFileSync(join(cwd, '.git', 'shallow'), `${git(cwd, 'rev-parse', 'HEAD')}\n`);
    const shallow = runScanner(cwd, '--range', emptyTree, 'HEAD');
    expect(shallow.status).toBe(1);
    expect(shallow.output).toContain('refuses a shallow repository');
    expect(shallow.output).toContain('fetch-depth: 0');
  });
});
