#!/usr/bin/env bash
# scripts/release.sh — interactive release helper
#
# Usage: ./scripts/release.sh
#
# 1. Analyzes commits since the last tag, grouped by type
# 2. Proposes a semver bump (major/minor/patch)
# 3. You confirm or override
# 4. Updates CHANGELOG.md, bumps package versions, commits, tags, and pushes
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Prerequisites ──────────────────────────────────────────────────────────────

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "error: working tree has uncommitted changes. Commit or stash first." >&2
  exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != "main" ]]; then
  echo "error: must be on main branch (currently on '$BRANCH')" >&2
  exit 1
fi

git fetch --tags --quiet

# ── Resolve range ──────────────────────────────────────────────────────────────

LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
CURRENT_VERSION=$(node -p "require('./services/bot/package.json').version")

if [[ -z "$LAST_TAG" ]]; then
  RANGE_DISPLAY="(first release — full history)"
  COMMITS=$(git log --no-merges --pretty=format:"%s")
else
  RANGE_DISPLAY="${LAST_TAG}..HEAD"
  COMMITS=$(git log "${LAST_TAG}..HEAD" --no-merges --pretty=format:"%s")
fi

if [[ -z "$COMMITS" ]]; then
  echo "No commits since ${LAST_TAG}. Nothing to release."
  exit 0
fi

# ── Categorize commits ─────────────────────────────────────────────────────────
# Conventional commits convention:
#   feat!: / fix!:  → breaking (major)
#   feat:           → added (minor)
#   fix:            → fixed (patch)
#   refactor:/perf: → changed (patch)
#   test:/chore:    → internal (patch, collapsed in changelog)
#   docs:           → excluded from version bump

_grep_strip() {
  local pattern="$1" strip="$2"
  printf "%s\n" "$COMMITS" | grep -E "$pattern" | sed "s/${strip}//" || true
}

BREAKING=$(_grep_strip    "^(feat|fix|refactor|chore|perf)!:" "")
FEATURES=$(_grep_strip    "^feat: "                            "^feat: ")
FIXES=$(_grep_strip       "^fix: "                             "^fix: ")
CHANGED=$(_grep_strip     "^(refactor|perf): "                 "^[^:]*: ")
INTERNAL=$(_grep_strip    "^(test|chore): "                    "^[^:]*: ")
DOCS=$(_grep_strip        "^docs: "                            "^docs: ")
UNCATEGORIZED=$(printf "%s\n" "$COMMITS" \
  | grep -vE "^(feat|fix|refactor|perf|test|chore|docs)(!)?:" || true)

FUNCTIONAL=$(printf "%s\n" "$COMMITS" | grep -vE "^docs:" || true)

# ── Guard: docs-only ───────────────────────────────────────────────────────────

if [[ -z "$FUNCTIONAL" ]]; then
  echo "All commits since ${LAST_TAG} are docs-only. No version bump needed."
  exit 0
fi

# ── Suggest bump level ─────────────────────────────────────────────────────────

if [[ -n "$BREAKING" ]]; then
  SUGGESTED="major"
elif [[ -n "$FEATURES" ]]; then
  SUGGESTED="minor"
else
  SUGGESTED="patch"
fi

IFS='.' read -r VMAJ VMIN VPATCH <<< "$CURRENT_VERSION"

_compute_version() {
  case "$1" in
    major) echo "$((VMAJ+1)).0.0" ;;
    minor) echo "${VMAJ}.$((VMIN+1)).0" ;;
    patch) echo "${VMAJ}.${VMIN}.$((VPATCH+1))" ;;
  esac
}

NEW_VERSION=$(_compute_version "$SUGGESTED")

# ── Display summary ────────────────────────────────────────────────────────────

_section() {
  local title="$1" prefix="$2" items="$3"
  [[ -z "$items" ]] && return
  echo ""
  echo "$title"
  printf "%s\n" "$items" | sed "s/^/${prefix}/"
}

echo ""
echo "══════════════════════════════════════════════════"
echo "  Release summary  ${RANGE_DISPLAY}"
echo "══════════════════════════════════════════════════"
_section "BREAKING CHANGES:" "  ⚠  " "$BREAKING"
_section "Added:"            "  +  " "$FEATURES"
_section "Fixed:"            "  ·  " "$FIXES"
_section "Changed:"          "  ·  " "$CHANGED"
_section "Internal:"         "  ·  " "$INTERNAL"
_section "Other:"            "  ·  " "$UNCATEGORIZED"
_section "Docs (not versioned):" "  ·  " "$DOCS"
echo ""
echo "══════════════════════════════════════════════════"
echo "  Current : v${CURRENT_VERSION}"
echo "  Suggest : ${SUGGESTED}  →  v${NEW_VERSION}"
echo "══════════════════════════════════════════════════"
echo ""
read -rp "Bump type [major/minor/patch] or Enter to accept '${SUGGESTED}': " USER_BUMP
USER_BUMP="${USER_BUMP:-$SUGGESTED}"

case "$USER_BUMP" in
  major|minor|patch) ;;
  *) echo "error: must be one of: major, minor, patch" >&2; exit 1 ;;
esac

NEW_VERSION=$(_compute_version "$USER_BUMP")

echo ""
read -rp "Release v${NEW_VERSION}? [y/N] " CONFIRM
case "$CONFIRM" in
  y|Y|yes|YES) ;;
  *) echo "Aborted."; exit 0 ;;
esac

# ── Build changelog entry ──────────────────────────────────────────────────────

TODAY=$(date +%Y-%m-%d)

_md_section() {
  local heading="$1" items="$2"
  [[ -z "$items" ]] && return
  printf "\n### %s\n" "$heading"
  printf "%s\n" "$items" | sed 's/^/- /'
}

{
  printf "## [%s] — %s\n" "$NEW_VERSION" "$TODAY"
  _md_section "Breaking changes" "$BREAKING"
  _md_section "Added"            "$FEATURES"
  _md_section "Fixed"            "$FIXES"
  _md_section "Changed"          "$CHANGED"
  _md_section "Internal"         "$INTERNAL"
  _md_section "Other"            "$UNCATEGORIZED"
  printf "\n"
} > /tmp/rockybot-release-entry.md

# Prepend after the 4-line header block (title + blank + blurb + blank)
if [[ -f CHANGELOG.md ]]; then
  {
    head -4 CHANGELOG.md
    echo ""
    cat /tmp/rockybot-release-entry.md
    tail -n +5 CHANGELOG.md
  } > /tmp/rockybot-changelog.tmp
  mv /tmp/rockybot-changelog.tmp CHANGELOG.md
else
  {
    printf "# Changelog\n\n"
    printf "All notable changes to rockybot are documented here. "
    printf "Version numbers follow [Semantic Versioning](https://semver.org/). "
    printf "Documentation-only changes do not increment the version.\n\n"
    cat /tmp/rockybot-release-entry.md
  } > CHANGELOG.md
fi

rm -f /tmp/rockybot-release-entry.md

# ── Bump package versions ──────────────────────────────────────────────────────

_bump_package() {
  local pkg="$1"
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('${pkg}', 'utf8'));
    p.version = '${NEW_VERSION}';
    fs.writeFileSync('${pkg}', JSON.stringify(p, null, 2) + '\n');
  "
  echo "  bumped ${pkg}"
}

echo ""
echo "Bumping package versions to ${NEW_VERSION}…"
_bump_package "services/bot/package.json"
_bump_package "services/obsidian-bridge/package.json"

# ── Commit, tag, push ─────────────────────────────────────────────────────────

echo ""
echo "Committing and tagging…"
git add CHANGELOG.md services/bot/package.json services/obsidian-bridge/package.json
git commit -m "chore: release v${NEW_VERSION}"
git tag "v${NEW_VERSION}"

echo ""
read -rp "Push v${NEW_VERSION} to origin now? [y/N] " PUSH_CONFIRM
case "$PUSH_CONFIRM" in
  y|Y|yes|YES)
    git push origin main
    git push origin "v${NEW_VERSION}"
    echo ""
    echo "✓ v${NEW_VERSION} pushed. GitHub Actions will publish Docker images."
    ;;
  *)
    echo ""
    echo "Tag created locally. Push when ready:"
    echo "  git push origin main && git push origin v${NEW_VERSION}"
    ;;
esac
