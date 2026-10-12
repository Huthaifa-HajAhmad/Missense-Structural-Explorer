# Insights and Literature preview

Run the existing Vite development server, then open `/tools/review-preview/index.html`. The fixture UI renders the real app wrapper and inspector. All publications and provider responses are illustrative; live API calls are disabled. Select the workspace, example and theme from the preview header.

Run `node tools/review-preview/check.mjs` against port 5187, or set `REVIEW_PREVIEW_URL` to the preview URL. The checker locates the repository's existing Playwright installation and local browser; `PLAYWRIGHT_MODULE` and `BROWSER_PATH` may override them. It writes check results and light/dark/narrow screenshots under `scratch/review-preview/`. Restart Vite after changing preview fixtures: this repository excludes `tools/` from its file watcher.

See `doc/REVIEW_WORKSPACES_REVIEW.md` for contracts, findings, fixture scope and limitations.
