# Repository workflow

## Stable line

Use `main` as the stable source of truth. The functional production baseline is
`da5e0eaa45d1e913f22c6236a24b11ad2b08dbdc` (Scorpion summoning and global Ranked).
Repository-only descendants may change documentation, exclusions and setup without
changing the published game. Keep previous release branches for recovery.

The old `master` line and unvalidated historical work are archives, not the base
for new features. Do not merge old experiments solely because they are uncommitted.

## Local setup

Use the versions pinned by `package-lock.json` and `server/package-lock.json`.
Install dependencies in each workspace; do not version `node_modules` or symlink
source/public directories to another mutable candidate.

Copy `.env.production.example` to the ignored `.env.production` for a production-mode
local build. These VITE values are public client configuration and match the verified
release. Never put credentials in VITE variables. Check ignored local overrides too.
Worker secrets and effective deployment configuration stay outside Git; the checked-in
Worker config is not authorization to deploy or change live flags.

## Each intervention

1. Fetch and start from current `origin/main`.
2. Create a specific branch (normally `codex/<task>`).
3. For simultaneous agents, create a registered worktree:
   `git worktree add -b codex/<task> ../rpggo-<task> origin/main`.
4. Implement only the authorized scope.
5. Run TypeScript, build, relevant tests and lint. Compare game/data/assets with the
   verified baseline for repository-only changes.
6. Inspect `git diff`, then stage explicit paths and inspect `git diff --cached`.
7. Commit and push when authorized. Check CI, hooks and hosting integrations first.
8. Obtain explicit publication authorization separately.
9. Publish with the approved maintenance/drain and recovery procedure.
10. Synchronize `main` with the verified release using a history-preserving integration.

Do not use `git add -A`, `git clean`, hard resets, force pushes or unrelated-history
merges as shortcuts. Preserve unidentified work in private verified backups first.
Do not remove a worktree or stale registration without checking its directory,
index and unique commits. Never copy a worktree's .git file into another candidate.

## Private material

Keep audit reports, security findings, credentials, QA captures, listening labs,
temporary candidates, build outputs and backups outside the public repository.
`output/` and newly generated top-level `qa/` evidence are ignored. Existing
reviewed QA fixtures remain versioned because tests depend on them; do not remove them.
A new legitimate fixture can be explicitly reviewed and added with `git add -f`;
never force-add a whole evidence directory.

Do not push archival branches until their whole history has been reviewed for
private material. Existing secrets in history require a separate response; do not
rewrite history or rotate production settings automatically during consolidation.

## Auth and security work

The Auth Worker has a separate lifecycle. Keep credentials and production snapshots
private. Establish a dedicated private repository with a pinned lockfile, sanitized
configuration examples and a verified mapping to the deployed version before changing
Auth code. Its source is not automatically incorporated into this repository.

Security work starts from the exact verified `main` commit in an independent worktree,
with findings stored outside Git. Preparing that workspace does not authorize fixes,
remote migrations, new deployments or changes to production.
