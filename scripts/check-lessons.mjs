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
 * Splitting is only safe if the halves cannot drift, which is what this checks:
 * every rule has an entry, every entry has a rule, and every link resolves.
 *
 * The staging area is normally EMPTY, and that is the healthy state: a lesson
 * ships with the gate that prevents its recurrence and both halves are then
 * deleted, so anything sitting here is knowledge that has not graduated yet.
 * Empty therefore has to pass — but an empty file must not be allowed to make
 * the checks vacuous, because that is precisely when nobody would notice they
 * had stopped working. So every rule below is proved against inline fixtures on
 * each run, and only then applied to the live files. A half-emptied staging
 * area — rules with no entries, or the reverse — still fails.
 */
const RULES = "docs/learning/lessons.md";
const EVIDENCE = "docs/learning/lessons-evidence.md";
const MAX_RULE_LENGTH = 160;

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`${path} is missing; the rules index and its evidence are both required`);
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

/** The `- ` bullets under "## Rules". Throws if that section is absent. */
function parseRules(source, label = RULES) {
  const lines = source.split(/\r?\n/);
  const heading = lines.indexOf("## Rules");
  if (heading < 0) throw new Error(`${label} has no "## Rules" section; session start reads that`);
  return lines.slice(heading + 1).filter((line) => line.startsWith("- "));
}

/** The `## ` headings that are entries. A heading inside a fence is a template. */
function parseEntries(source) {
  const entries = [];
  let fenced = false;
  for (const line of source.split(/\r?\n/)) {
    if (line.trimStart().startsWith("```")) fenced = !fenced;
    else if (!fenced && line.startsWith("## ") && line.slice(3).trim() !== "Entries") {
      entries.push(line.slice(3).trim());
    }
  }
  return entries;
}

const ruleText = (rule) => rule.replace(/\s*\(\[evidence\].*$/, "");

/** Every way the two halves can disagree. */
function pairingProblems(rulesSource, evidenceSource, labels = {}) {
  const rulesLabel = labels.rules ?? RULES;
  const evidenceLabel = labels.evidence ?? EVIDENCE;
  const rules = parseRules(rulesSource, rulesLabel);
  const entries = parseEntries(evidenceSource);
  const problems = [];

  // An empty staging area is the healthy state; a half-empty one is not.
  if (rules.length !== entries.length) {
    problems.push(
      `${rulesLabel} lists ${rules.length} rule(s) but ${evidenceLabel} holds ${entries.length} ` +
        `entr(y|ies). A session reading only the rules would miss the difference. Entries: ` +
        entries.map((entry) => `"${entry}"`).join(", "),
    );
  }

  const anchors = new Set(entries.map(slugify));
  for (const rule of rules) {
    const link = /\[evidence\]\(lessons-evidence\.md#([a-z0-9-]+)\)/.exec(rule);
    if (!link) {
      problems.push(
        `A rule has no link to its evidence, so nobody can reach it: ${rule.slice(0, 120)}`,
      );
      continue;
    }
    if (!anchors.has(link[1])) {
      problems.push(
        `A rule links to "${link[1]}", which no entry heading produces. ` +
          `Available: ${[...anchors].join(", ")}`,
      );
    }
  }

  // The index earns its keep only by staying short.
  const overlong = rules.filter((rule) => ruleText(rule).length > MAX_RULE_LENGTH);
  if (overlong.length > 0) {
    problems.push(
      `${overlong.length} rule(s) exceed ${MAX_RULE_LENGTH} characters before their link, which ` +
        `defeats an index. First: ${overlong[0].slice(0, 120)}…`,
    );
  }

  const seen = new Set();
  for (const rule of rules) {
    const text = ruleText(rule);
    if (seen.has(text)) {
      problems.push(`Two rules say the same thing, so two entries teach it: ${text}`);
    }
    seen.add(text);
  }
  return problems;
}

/** Proves every check above still bites, against fixtures rather than live files. */
function selfTest() {
  const entry = (heading) => [`## ${heading}`, "", "body", ""];
  const evidenceOf = (...headings) =>
    ["# Lessons — evidence", "", ...headings.flatMap(entry)].join("\n");
  const rulesOf = (...bullets) => ["# Lessons", "", "## Rules", "", ...bullets].join("\n");
  const link = (heading) => `([evidence](lessons-evidence.md#${slugify(heading)}))`;

  const cases = [
    {
      name: "an empty staging area is healthy",
      rules: rulesOf(),
      evidence: evidenceOf(),
      expectProblem: false,
    },
    {
      name: "a paired lesson passes",
      rules: rulesOf(`- Ghosts lie ${link("Ghosts lie")}`),
      evidence: evidenceOf("Ghosts lie"),
      expectProblem: false,
    },
    {
      name: "a rule with no entry fails",
      rules: rulesOf(`- Ghosts lie ${link("Ghosts lie")}`),
      evidence: evidenceOf(),
      expectProblem: true,
    },
    {
      name: "an entry with no rule fails",
      rules: rulesOf(),
      evidence: evidenceOf("Ghosts lie"),
      expectProblem: true,
    },
    {
      name: "a rule linking to a heading that does not exist fails",
      rules: rulesOf(`- Ghosts lie ${link("Ghosts tell the truth")}`),
      evidence: evidenceOf("Ghosts lie"),
      expectProblem: true,
    },
    {
      name: "an unlinked rule fails",
      rules: rulesOf("- Ghosts lie"),
      evidence: evidenceOf("Ghosts lie"),
      expectProblem: true,
    },
    {
      name: "an overlong rule fails",
      rules: rulesOf(`- ${"x".repeat(MAX_RULE_LENGTH + 1)} ${link("Ghosts lie")}`),
      evidence: evidenceOf("Ghosts lie"),
      expectProblem: true,
    },
    {
      name: "two rules saying the same thing fail",
      rules: rulesOf(`- Ghosts lie ${link("Ghosts lie")}`, `- Ghosts lie ${link("Ghosts lie")}`),
      evidence: evidenceOf("Ghosts lie", "Ghosts lie"),
      expectProblem: true,
    },
    {
      // Both directions of the fence toggle: the heading inside the template is
      // not an entry, and the real entry AFTER the closing fence still is. A
      // toggle that only ever switches on would swallow every later entry.
      name: "a fenced template is skipped and entries after it are not",
      rules: rulesOf(`- Ghosts lie ${link("Ghosts lie")}`),
      evidence: [
        "# Lessons — evidence",
        "",
        "```md",
        "## Not an entry",
        "```",
        "",
        ...entry("Ghosts lie"),
      ].join("\n"),
      expectProblem: false,
    },
  ];

  for (const testCase of cases) {
    const problems = pairingProblems(testCase.rules, testCase.evidence, {
      rules: "<fixture rules>",
      evidence: "<fixture evidence>",
    });
    if (testCase.expectProblem !== problems.length > 0) {
      throw new Error(
        `lessons check is broken — self-test "${testCase.name}" expected ` +
          `${testCase.expectProblem ? "a problem" : "no problem"} and got ` +
          `${problems.length}: ${problems.join(" | ") || "none"}`,
      );
    }
  }

  let rejectedMissingSection = false;
  try {
    parseRules("# Lessons\n\nno section here\n", "<fixture rules>");
  } catch {
    rejectedMissingSection = true;
  }
  if (!rejectedMissingSection) {
    throw new Error('lessons check is broken — a file with no "## Rules" section must be rejected');
  }
  return cases.length + 1;
}

try {
  const checks = selfTest();
  const problems = pairingProblems(read(RULES), read(EVIDENCE));
  if (problems.length > 0) {
    console.error(`Lessons check failed: ${problems[0]}`);
    for (const extra of problems.slice(1)) console.error(`  also: ${extra}`);
    process.exit(1);
  }
  const count = parseRules(read(RULES)).length;
  console.log(
    count === 0
      ? `Lessons check passed: ${checks} self-tests, and the staging area is empty — every ` +
          `lesson has graduated to a gate (see docs/learning/gate-proofs.md).`
      : `Lessons check passed: ${checks} self-tests, and ${count} rule(s) in ${RULES}, ` +
          `each linked to an entry in ${EVIDENCE}.`,
  );
} catch (error) {
  console.error(`Lessons check failed: ${error.message}`);
  process.exit(1);
}
