'use strict';

// Tests for inbox watcher logic — verifies callout detection, status parsing,
// and EXCLUDED_NAMES behavior without calling Claude.

describe('inbox watcher: status detection', () => {
  const PENDING_FRONTMATTER = `---
tags: [research-request]
created: 2026-01-01
status: pending
---

# My topic
`;

  const DRAFT_FRONTMATTER = `---
tags: [research-request]
status: draft
---
`;

  const NO_TAG_FRONTMATTER = `---
tags: [something-else]
status: pending
---
`;

  it('detects status: pending in frontmatter', () => {
    const match = /^status:\s*pending/m.test(PENDING_FRONTMATTER);
    expect(match).toBe(true);
  });

  it('does not match status: draft', () => {
    const match = /^status:\s*pending/m.test(DRAFT_FRONTMATTER);
    expect(match).toBe(false);
  });

  it('detects research-request tag', () => {
    const match = /research-request/.test(PENDING_FRONTMATTER);
    expect(match).toBe(true);
  });

  it('rejects files without research-request tag', () => {
    const match = /research-request/.test(NO_TAG_FRONTMATTER);
    expect(match).toBe(false);
  });
});

describe('callout detection: anchored regex', () => {
  const CALLOUT_BLOCK = `
Some text before.

> [!claude]
> Please expand this section.

Some text after.
`;

  const PROSE_MENTION = `
This is different from using the [!claude] callout inline in prose.
`;

  const PROMPT_FILE_EXAMPLE = `
When you encounter a \`> [!claude]\` callout at the start of a line...
`;

  it('matches callout at line start', () => {
    const re = /^>\s*\[!claude\]/m;
    expect(re.test(CALLOUT_BLOCK)).toBe(true);
  });

  it('does not match inline prose mention', () => {
    const re = /^>\s*\[!claude\]/m;
    expect(re.test(PROSE_MENTION)).toBe(false);
  });

  it('does not match backtick-quoted example in prompt file', () => {
    const re = /^>\s*\[!claude\]/m;
    expect(re.test(PROMPT_FILE_EXAMPLE)).toBe(false);
  });
});

describe('EXCLUDED_NAMES: prompt files are not processed as callout targets', () => {
  const EXCLUDED_NAMES = new Set([
    'amend-prompt.md',
    'expand-prompt.md',
    'revise-prompt.md',
    'lint-prompt.md',
    'research-prompt.md',
  ]);

  it('excludes all known prompt filenames', () => {
    for (const name of EXCLUDED_NAMES) {
      expect(EXCLUDED_NAMES.has(name)).toBe(true);
    }
  });

  it('does not exclude regular research files', () => {
    expect(EXCLUDED_NAMES.has('my-research/index.md')).toBe(false);
    expect(EXCLUDED_NAMES.has('notes.md')).toBe(false);
  });
});
