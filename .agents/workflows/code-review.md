---
name: code-review
description: Run a bounded review pass over local changes, and decide what (if anything) to fix.
---

# Workflow: Review Pass

1. **Review the change** — the uncommitted working-tree diff, or the staged set.
2. **Report findings** with a severity and the file each sits in.
3. **Fix only what is inside the change under review.** Anything else is logged as a follow-up.

The pass reports; acting on it is a separate, bounded step.

**No bundled engine.** This workflow used to shell out to Open Code Review:

```bash
npm run review                            # review the working-tree diff
npm run review:preview                    # preview the files selected for review
npm run review:scan -- --path <file_or_dir>
```

`scripts/review.ts` and those three scripts were removed together with the
`@alibaba-group/open-code-review` dependency. It was 57 MB — including a platform binary per OS/arch —
installed on every CI run, and nothing but that one script used it. The review pass is the agent's own
now, so there is no command left to run here.
