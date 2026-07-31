import { readFileSync } from "node:fs";

/**
 * Lessons live in two files on purpose.
 *
 * `lessons.md` is the one-line rule for each lesson and is what a session reads
 * at start. `lessons-evidence.md` holds the war stories and anchors and is
 * opened only when a rule is in doubt. Telling an agent to read part of one
 * large file does not work — reading a file reads all of it — so the split is
 * what actually keeps the session-start cost small.
 *
 * Two files, not one per lesson. Anthropic's progressive-disclosure guidance
 * groups reference material by domain rather than by item, and expects a
 * reference file of a hundred-odd lines to be normal. Split the evidence file by
 * subsystem if it outgrows that; splitting per lesson would trade a cheap read
 * for dozens of files and make reading all the lessons about one subsystem
 * expensive again.
 *
 * Splitting is only safe if the halves cannot drift, which is what this checks:
 * every rule has an entry, every entry has a rule, and every link resolves.
 */
const RULES = "docs/learning/lessons.md";
const EVIDENCE = "docs/learning/lessons-evidence.md";

function fail(message) {
  console.error(`Lessons check failed: ${message}`);
  process.exit(1);
}

function read(path) {
  try {
    return readFileSync(path, "utf8").split(/\r?\n/);
  } catch {
    return fail(`${path} is missing; the rules index and its evidence are both required`);
  }
}

/** GitHub's heading anchor: lowercased, punctuation dropped, spaces hyphenated. */
function slugify(heading) {
  return heading
    .toLowerCase()
    .replace(/[`'’"]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

const rulesLines = read(RULES);
const evidenceLines = read(EVIDENCE);

const rulesHeading = rulesLines.indexOf("## Rules");
if (rulesHeading < 0) fail(`${RULES} has no "## Rules" section; session start reads that`);

const rules = rulesLines.slice(rulesHeading + 1).filter((line) => line.startsWith("- "));
// A heading inside a fenced block is a template example, not a lesson.
let fenced = false;
const entries = [];
for (const line of evidenceLines) {
  if (line.trimStart().startsWith("```")) fenced = !fenced;
  else if (!fenced && line.startsWith("## ") && line.slice(3).trim() !== "Entries") {
    entries.push(line.slice(3).trim());
  }
}

if (rules.length === 0) fail(`${RULES} lists no rules`);
if (entries.length === 0) fail(`${EVIDENCE} holds no entries`);
if (rules.length !== entries.length) {
  fail(
    `${RULES} lists ${rules.length} rule(s) but ${EVIDENCE} holds ${entries.length} entr(y|ies). ` +
      `A session reading only the rules would miss the difference. Entries: ${entries
        .map((entry) => `"${entry}"`)
        .join(", ")}`,
  );
}

const anchors = new Set(entries.map(slugify));
for (const rule of rules) {
  const link = /\[evidence\]\(lessons-evidence\.md#([a-z0-9-]+)\)/.exec(rule);
  if (!link) {
    fail(`A rule has no link to its evidence, so nobody can reach it: ${rule.slice(0, 120)}`);
  }
  if (!anchors.has(link[1])) {
    fail(
      `A rule links to "${link[1]}", which no entry heading produces. ` +
        `Available: ${[...anchors].join(", ")}`,
    );
  }
}

// The index earns its keep only by staying short.
const overlong = rules.filter((rule) => rule.replace(/\s*\(\[evidence\].*$/, "").length > 160);
if (overlong.length > 0) {
  fail(
    `${overlong.length} rule(s) exceed 160 characters before their link, which defeats an index. ` +
      `First: ${overlong[0].slice(0, 120)}…`,
  );
}

const seen = new Set();
for (const rule of rules) {
  const text = rule.replace(/\s*\(\[evidence\].*$/, "");
  if (seen.has(text)) fail(`Two rules say the same thing, so two entries teach it: ${text}`);
  seen.add(text);
}

console.log(
  `Lessons check passed: ${rules.length} rules in ${RULES}, each linked to an entry in ${EVIDENCE}.`,
);
