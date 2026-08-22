---
trigger: always_on
description: Automated code review rule — use Open Code Review (npm run review) to verify multi-file changes before completing complex feature tasks.
---

# Automated AI Code Review Rule

Before completing complex refactors or multi-file features:
- Run `npm run review` (or `npm run review:preview` to inspect target diffs) to evaluate changes for potential regressions, security vulnerabilities (NPE, injection, unhandled promise rejections), and logical flaws using Gemini 3.5 Flash.
- Address any high-severity findings flagged by the review engine.
