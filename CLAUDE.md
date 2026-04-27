# rockybot — project notes for Claude

## Versioning policy

rockybot uses [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

| Bump | When |
|---|---|
| **major** | Breaking changes: removed or renamed env vars, incompatible config format changes, removed features |
| **minor** | New functionality: new watchers, new callout types, new env vars, new integrations |
| **patch** | Bug fixes, internal refactors, test improvements, CI changes, dependency updates |
| *(none)* | Documentation changes only (`docs:` commits, `.md` file edits) |

Use [Conventional Commits](https://www.conventionalcommits.org/) prefixes in commit messages. The release script uses these to categorize and propose the right bump level:

- `feat:` → minor (or `feat!:` for major)
- `fix:` → patch (or `fix!:` for major)
- `refactor:`, `perf:` → patch, shown as "Changed"
- `test:`, `chore:` → patch, shown as "Internal"
- `docs:` → no version bump

## Releasing

```bash
./scripts/release.sh
```

The script:
1. Fetches latest tags from origin
2. Shows all commits since the last tag, grouped by type
3. Proposes a bump level based on commit prefixes
4. You confirm or type `major` / `minor` / `patch` to override
5. Confirms before making any changes
6. Writes a CHANGELOG.md entry, bumps `services/bot/package.json` and `services/obsidian-bridge/package.json`, commits as `chore: release vX.Y.Z`, and creates the git tag
7. Asks whether to push to origin (pushing the tag triggers GitHub Actions to publish Docker images)

**Never bump the version manually** — always go through `./scripts/release.sh` so the CHANGELOG stays in sync.

## What lives where

| Canonical version | `services/bot/package.json` |
|---|---|
| Kept in sync | `services/obsidian-bridge/package.json` |
| Release history | `CHANGELOG.md` |
| Docker image tags | Driven by git tags via GitHub Actions |

## Tests

Every bug fix and new feature must include tests. See `docs/DEVELOPMENT.md` for how to run them.
