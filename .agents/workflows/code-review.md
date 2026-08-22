---
name: code-review
description: Run automated AI code review on local git diff or staged changes using Open Code Review.
---

# Workflow: AI Code Review (Open Code Review)

To perform an automated code review on current modifications:

1. **Review working directory diff (uncommitted changes)**:
   ```bash
   npm run review
   ```

2. **Preview files selected for review**:
   ```bash
   npm run review:preview
   ```

3. **Scan specific files or whole repository**:
   ```bash
   npm run review:scan -- --path <file_or_dir>
   ```

The review automatically parses the git diff, performs deterministic security checks, and uses Gemini 3.5 Flash to inspect logic, error recovery, and type contracts.
