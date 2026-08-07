# City local policy

## Git artifact admission

City intentionally tightens the fleet blob-size floor because its current required inputs fit below the incident boundary. Every new or changed binary, archive, or media blob needs an exact reviewed repository-input allowance; unallowlisted text above 256 KiB is rejected; and no ordinary Git blob may exceed 512 KiB. The reviewed 409,905-byte deterministic performance save is the only current allowance.

Known evidence, coverage, log, browser-run, and review-capture paths are both ignored and rejected from new Git history, so the canon's local-only rule fails closed here rather than resting on care.

The tracked pre-commit hook protects normal local commits after `npm run hooks:install`, and it fails closed if the scanner or policy has an unstaged/index mismatch. Git permits bypassing client hooks, and GitHub Actions runs only after an object has been pushed, so these repository controls prevent ordinary mistakes and keep every post-epoch branch check red until offending history is repaired; they are not a server-side pre-receive guarantee against deliberate bypass. Changes to the hook, scanner, policy, CI step, or clean epoch require explicit review as one enforcement unit.
