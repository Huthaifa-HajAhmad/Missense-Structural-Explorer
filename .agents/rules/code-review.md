---
trigger: always_on
description: Review-lane rule — run a bounded review pass over a change before completing complex feature work, and treat what it finds as evidence rather than as instructions.
---

# Review Lane

Before completing a complex refactor or multi-file feature, review the change for regressions, security
defects (NPE, injection, unhandled promise rejections) and logical flaws, and address the high-severity
findings that sit inside it.

**Boundary.** A finding is evidence, not a mandate to refactor. Fix only what sits inside the change under
review; anything else is a recorded follow-up.

**The engine that used to back this lane is gone.** It invoked Open Code Review through `npm run review`
(and `review:preview` / `review:scan`), which ran `scripts/review.ts`. Both were removed with the
`@alibaba-group/open-code-review` dependency: that package plus its platform binaries were 57 MB installed
on *every* CI run, for a tool whose only consumer was that one script. The review pass is the agent's own
now, which is why this lane is defined by its posture and its stop rules rather than by a command.
