#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const SAMPLE_BYTES = 8192;
const BINARY_EXTENSIONS = new Set([
  '.7z', '.avi', '.bin', '.blend', '.bmp', '.bz2', '.class', '.dll', '.dmg',
  '.doc', '.docx', '.eot', '.exe', '.flac', '.gif', '.glb', '.gz', '.ico',
  '.jar', '.jpeg', '.jpg', '.m4a', '.mkv', '.mov', '.mp3', '.mp4', '.o',
  '.ogg', '.otf', '.pdf', '.png', '.ppt', '.pptx', '.psd', '.rar', '.so',
  '.tar', '.tgz', '.tif', '.tiff', '.ttf', '.wav', '.webm', '.webp', '.woff',
  '.woff2', '.xls', '.xlsx', '.xz', '.zip',
]);

function fail(message) {
  throw new Error(message);
}

function git(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: options.cwd,
    encoding: options.encoding ?? 'utf8',
    input: options.input,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) fail(`git ${args[0]} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    fail(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

function resolveCommit(spec, label, cwd) {
  try {
    return git(['rev-parse', '--verify', `${spec}^{commit}`], { cwd }).trim();
  } catch {
    fail(`${label} ${JSON.stringify(spec)} is missing or is not a commit; fetch the complete history and retry`);
  }
}

function readPolicy() {
  const policyUrl = new URL('../config/git-artifact-policy.json', import.meta.url);
  const policy = JSON.parse(readFileSync(policyUrl, 'utf8'));
  if (!/^[0-9a-f]{40,64}$/u.test(policy.historyEpoch)) {
    fail('config historyEpoch must be a full Git object ID for the reviewed clean policy boundary');
  }
  if (!Number.isSafeInteger(policy.reviewBlobBytes) || policy.reviewBlobBytes <= 0) {
    fail('config reviewBlobBytes must be a positive integer');
  }
  if (!Number.isSafeInteger(policy.absoluteBlobBytes)
      || policy.absoluteBlobBytes <= policy.reviewBlobBytes) {
    fail('config absoluteBlobBytes must be an integer above reviewBlobBytes');
  }
  if (!Array.isArray(policy.forbiddenPaths) || policy.forbiddenPaths.length === 0
      || policy.forbiddenPaths.some((pattern) => typeof pattern !== 'string'
        || pattern.length === 0
        || (pattern.includes('*')
          && !((!pattern.includes('/') && pattern !== '*') || /^[^*]+\/\*\*$/u.test(pattern))))) {
    fail('config forbiddenPaths must contain only exact paths, directory/** prefixes, or basename * globs');
  }
  if (!policy.repositoryInputs || Array.isArray(policy.repositoryInputs)
      || typeof policy.repositoryInputs !== 'object') {
    fail('config repositoryInputs must be an object keyed by exact Git path');
  }
  for (const [path, allowance] of Object.entries(policy.repositoryInputs)) {
    if (!path || path.includes('**') || allowance?.kind !== 'reviewed-deterministic-input'
        || !['text', 'binary'].includes(allowance.format)
        || !Number.isSafeInteger(allowance.maxBytes) || allowance.maxBytes <= 0
        || allowance.maxBytes > policy.absoluteBlobBytes
        || typeof allowance.reason !== 'string' || allowance.reason.trim().length < 20) {
      fail(`config repositoryInputs entry ${JSON.stringify(path)} is not a complete exact reviewed-input allowance`);
    }
  }
  return policy;
}

function splitNul(buffer) {
  const fields = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 0) {
      fields.push(buffer.subarray(start, index));
      start = index + 1;
    }
  }
  if (start !== buffer.length) fail('Git returned a non-NUL-terminated path record');
  return fields;
}

function parseRawEntries(raw, commit) {
  const fields = splitNul(raw);
  const entries = [];
  for (let index = 0; index < fields.length; index += 2) {
    if (fields[index].length === 0) continue;
    if (index + 1 >= fields.length) fail(`Git returned an incomplete diff record for ${commit}`);
    const metadata = fields[index].toString('ascii');
    const match = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z][0-9]*)$/.exec(metadata);
    if (!match) fail(`Git returned an invalid diff record for ${commit}`);
    let path;
    try {
      path = new TextDecoder('utf-8', { fatal: true }).decode(fields[index + 1]);
    } catch {
      fail(`Git returned a non-UTF-8 path record for ${commit}; rename the path to portable UTF-8 before continuing`);
    }
    const newMode = match[2];
    const oldOid = match[3];
    const newOid = match[4];
    if (match[5] === 'U' || (/^0+$/.test(newOid) && newMode !== '000000')) {
      fail(`index path ${JSON.stringify(path)} is unresolved; resolve the conflict before committing`);
    }
    if (newMode !== '000000' && !/^0+$/.test(newOid) && oldOid !== newOid) {
      entries.push({
        commit,
        path,
        oid: newOid,
        objectType: newMode === '160000' ? 'gitlink' : 'blob',
      });
    }
  }
  return entries;
}

function stagedEntries(cwd) {
  const hasHead = spawnSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
    cwd, encoding: 'utf8', windowsHide: true,
  }).status === 0;
  const args = ['diff', '--cached', '--no-ext-diff', '--no-renames', '--no-abbrev', '--raw', '-z'];
  if (hasHead) args.push('HEAD');
  const raw = git(args, { cwd, encoding: 'buffer' });
  return parseRawEntries(raw, '(staged index)');
}

function diffEntries(oldTree, commit, cwd) {
  const raw = git([
    'diff-tree', '--no-commit-id', '--no-abbrev', '-r',
    '--no-renames', '--raw', '-z', oldTree, commit,
  ], { cwd, encoding: 'buffer' });
  return parseRawEntries(raw, commit);
}

function commitEntries(commit, cwd) {
  const lineage = git(['rev-list', '--parents', '-n', '1', commit], { cwd })
    .trim().split(/\s+/u);
  const parents = lineage.slice(1);
  if (parents.length === 0) return diffEntries(EMPTY_TREE, commit, cwd);
  // First-parent comparison models the tree change being admitted to the branch.
  // rev-list visits side-parent commits separately, while this comparison still
  // catches stale side content that a merge restores after the base deleted it.
  return diffEntries(parents[0], commit, cwd);
}

function rangeEntries(baseSpec, headSpec, cwd) {
  const shallow = git(['rev-parse', '--is-shallow-repository'], { cwd }).trim();
  if (shallow !== 'false') {
    fail('range scan refuses a shallow repository; fetch the complete history (fetch-depth: 0) and retry');
  }
  const head = resolveCommit(headSpec, 'range head', cwd);
  let base;
  if (baseSpec === EMPTY_TREE) {
    base = EMPTY_TREE;
  } else {
    base = resolveCommit(baseSpec, 'range base', cwd);
    const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', base, head], {
      cwd, encoding: 'utf8', windowsHide: true,
    });
    if (ancestry.error) fail(`git merge-base could not start: ${ancestry.error.message}`);
    if (ancestry.status !== 0) {
      fail(`range base ${base} is not an ancestor of head ${head}; fetch the correct base and retry`);
    }
  }
  const revisionArgs = ['rev-list', '--reverse', '--topo-order', head];
  if (base !== EMPTY_TREE) revisionArgs.push(`^${base}`);
  const revisions = git(revisionArgs, { cwd })
    .split(/\r?\n/u).filter(Boolean);
  return revisions.flatMap((commit) => commitEntries(commit, cwd));
}

async function inspectBlobs(oids, cwd, maxContentBytes) {
  if (oids.length === 0) return new Map();
  const input = `${oids.join('\n')}\n`;
  const checked = git(['cat-file', '--batch-check'], { cwd, input })
    .trim().split(/\r?\n/u);
  if (checked.length !== oids.length) fail('git cat-file --batch-check returned an incomplete result');
  const blobs = new Map();
  for (let index = 0; index < oids.length; index++) {
    const match = /^([0-9a-f]+) (\S+) (\d+)$/u.exec(checked[index]);
    const requestedOid = oids[index];
    if (!match || match[1] !== requestedOid || match[2] !== 'blob') {
      fail(`Git object ${requestedOid} is missing or is not a blob (${checked[index]})`);
    }
    const size = Number(match[3]);
    if (!Number.isSafeInteger(size)) fail(`Git blob ${requestedOid} has an unsupported size`);
    blobs.set(requestedOid, { size });
  }
  const contentOids = oids.filter((oid) => blobs.get(oid).size <= maxContentBytes);
  if (contentOids.length === 0) return blobs;
  const child = spawn('git', ['cat-file', '--batch'], {
    cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  const close = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  const stderr = [];
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  child.stdin.on('error', () => {});
  child.stdin.end(`${contentOids.join('\n')}\n`);
  const iterator = child.stdout[Symbol.asyncIterator]();
  let buffered = Buffer.alloc(0);

  async function fill() {
    const next = await iterator.next();
    if (next.done) fail('git cat-file ended before returning every requested blob');
    buffered = buffered.length === 0 ? next.value : Buffer.concat([buffered, next.value]);
  }

  async function line() {
    const parts = [];
    while (true) {
      const newline = buffered.indexOf(10);
      if (newline >= 0) {
        parts.push(buffered.subarray(0, newline));
        buffered = buffered.subarray(newline + 1);
        return Buffer.concat(parts).toString('ascii');
      }
      if (buffered.length > 0) parts.push(buffered);
      buffered = Buffer.alloc(0);
      await fill();
    }
  }

  async function consume(size) {
    const sample = [];
    let sampled = 0;
    let remaining = size;
    let containsNul = false;
    let validUtf8 = true;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    while (remaining > 0) {
      if (buffered.length === 0) await fill();
      const take = Math.min(remaining, buffered.length);
      const chunk = buffered.subarray(0, take);
      const sampleTake = Math.min(take, SAMPLE_BYTES - sampled);
      if (sampleTake > 0) {
        sample.push(chunk.subarray(0, sampleTake));
        sampled += sampleTake;
      }
      containsNul ||= chunk.includes(0);
      if (validUtf8) {
        try {
          decoder.decode(chunk, { stream: true });
        } catch {
          validUtf8 = false;
        }
      }
      buffered = buffered.subarray(take);
      remaining -= take;
    }
    if (validUtf8) {
      try {
        decoder.decode();
      } catch {
        validUtf8 = false;
      }
    }
    if (buffered.length === 0) await fill();
    if (buffered[0] !== 10) fail('git cat-file returned a malformed blob terminator');
    buffered = buffered.subarray(1);
    return { sample: Buffer.concat(sample), containsNul, validUtf8 };
  }

  for (const requestedOid of contentOids) {
    const header = await line();
    const match = /^([0-9a-f]+) (\S+) (\d+)$/.exec(header);
    if (!match || match[1] !== requestedOid || match[2] !== 'blob') {
      fail(`Git object ${requestedOid} is missing or is not a blob (${header})`);
    }
    const size = Number(match[3]);
    if (size !== blobs.get(requestedOid).size) {
      fail(`Git object ${requestedOid} changed size between metadata and content inspection`);
    }
    blobs.set(requestedOid, { size, ...await consume(size) });
  }
  const exitCode = await close;
  if (exitCode !== 0) {
    fail(`git cat-file failed: ${Buffer.concat(stderr).toString('utf8').trim()}`);
  }
  return blobs;
}

function matchesForbidden(path, patterns) {
  const normalizedPath = path.toLowerCase();
  return patterns.some((pattern) => {
    const normalizedPattern = pattern.toLowerCase();
    if (normalizedPattern.includes('*') && !normalizedPattern.includes('/')) {
      const basename = normalizedPath.split('/').at(-1);
      const expression = normalizedPattern.split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
        .join('.*');
      return new RegExp(`^${expression}$`, 'u').test(basename);
    }
    if (!normalizedPattern.endsWith('/**')) return normalizedPath === normalizedPattern;
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  });
}

function classify(entry, blob, policy) {
  const forbidden = matchesForbidden(entry.path, policy.forbiddenPaths);
  const allowance = Object.hasOwn(policy.repositoryInputs, entry.path)
    ? policy.repositoryInputs[entry.path]
    : undefined;
  if (forbidden) {
    return 'task-run evidence paths are local-only. Remove this path from Git and keep the artifact under an ignored local output path only; retain concise conclusions and reproducible provenance in docs. LFS is not permitted for evidence';
  }
  if (blob.size > policy.absoluteBlobBytes) {
    return `ordinary Git blobs may not exceed ${policy.absoluteBlobBytes} bytes. Remove the blob; a required large repository input needs explicit user approval plus a documented external-store or LFS pointer allowance`;
  }
  const lfsPointer = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\r?$/u
    .test(blob.sample.toString('utf8').split('\n', 1)[0]);
  const binary = lfsPointer || blob.containsNul || !blob.validUtf8
    || BINARY_EXTENSIONS.has(extname(entry.path).toLowerCase());
  if (allowance && blob.size > allowance.maxBytes) {
    return `the exact reviewed input allowance is capped at ${allowance.maxBytes} bytes. Reduce it or obtain a fresh review before changing the cap`;
  }
  if (lfsPointer) {
    return 'Git LFS pointers are not permitted by the current City policy. A future exception requires explicit approval and an exact allowance that documents external ownership, retrieval, and retention; evidence may not use LFS';
  }
  if (allowance?.format === 'text' && binary) {
    return 'binary content is not permitted by this text-only reviewed input allowance. Restore the reviewed text input or obtain a fresh exact-path review';
  }
  if (allowance?.format === 'binary' && !binary) {
    return 'text content is not permitted by this binary-only reviewed input allowance. Restore the reviewed binary input or obtain a fresh exact-path review';
  }
  if (!allowance && binary) {
    return 'binary, archive, and media inputs require an exact reviewed repository-input allowance. Remove it, or obtain explicit approval and document why Git is the correct durable home';
  }
  if (!allowance && blob.size > policy.reviewBlobBytes) {
    return `text blobs above ${policy.reviewBlobBytes} bytes require an exact reviewed repository-input allowance. Reduce/remove it, or document and review the deterministic input before allowlisting it`;
  }
  return null;
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) !== 24) {
    fail(`this repository gate requires Node 24; current runtime is ${process.version}`);
  }
  const policy = readPolicy();
  const cwd = git(['rev-parse', '--show-toplevel']).trim();
  let mode;
  let entries;
  if (process.argv.length === 3 && process.argv[2] === '--staged') {
    mode = 'staged index';
    entries = stagedEntries(cwd);
  } else if (process.argv.length === 5 && process.argv[2] === '--range') {
    mode = `range ${process.argv[3]}..${process.argv[4]}`;
    entries = rangeEntries(process.argv[3], process.argv[4], cwd);
  } else {
    fail('usage: node scripts/check-git-artifacts.mjs --staged | --range BASE HEAD');
  }
  const uniqueEntries = [...new Map(entries.map((entry) => [
    `${entry.commit}\0${entry.path}\0${entry.objectType}\0${entry.oid}`, entry,
  ])).values()];
  const blobEntries = uniqueEntries.filter((entry) => entry.objectType === 'blob');
  const oids = [...new Set(blobEntries.map((entry) => entry.oid))];
  const blobs = await inspectBlobs(oids, cwd, policy.absoluteBlobBytes);
  const violations = [];
  for (const entry of uniqueEntries) {
    if (entry.objectType === 'gitlink') {
      if (matchesForbidden(entry.path, policy.forbiddenPaths)) {
        violations.push({
          ...entry,
          size: null,
          remediation: 'task-run evidence paths may not contain a Git submodule. Remove the gitlink and keep task artifacts outside Git under an ignored local path',
        });
      }
      continue;
    }
    const blob = blobs.get(entry.oid);
    const remediation = classify(entry, blob, policy);
    if (remediation) violations.push({ ...entry, size: blob.size, remediation });
  }
  if (violations.length > 0) {
    const details = violations.map((violation) => [
      `commit=${violation.commit}`,
      `path=${JSON.stringify(violation.path)}`,
      violation.objectType === 'gitlink'
        ? `gitlink=${violation.oid}`
        : `blob=${violation.oid}`,
      violation.size === null ? 'size=gitlink' : `size=${violation.size} bytes`,
      `remediation=${violation.remediation}`,
    ].join(' | '));
    fail(`Git artifact policy rejected ${violations.length} introduced object(s):\n${details.join('\n')}`);
  }
  console.log(`Git artifact policy passed (${mode}; ${uniqueEntries.length} path/object introduction(s), ${oids.length} unique blob(s)).`);
}

main().catch((error) => {
  console.error(`Git artifact policy could not complete: ${error.message}`);
  process.exitCode = 1;
});
