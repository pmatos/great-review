# Great Review (greview) — Design Document

## Overview

A local desktop app for reviewing AI-generated code changes hunk-by-hunk, producing a prompt to feed back into Claude Code. Built with Tauri v2 (Rust backend) and React (frontend).

## Workflow

1. Claude Code makes changes to a codebase.
2. User runs `greview` (working tree diff) or `greview HEAD~3..HEAD` (commit range).
3. Tauri launches a native window showing the diff broken into hunks.
4. User reviews each hunk: approve, comment, or reject (with alternative or request for other possibilities).
5. User clicks "Copy Prompt" — a minimal prompt is copied to clipboard containing only actionable items.
6. User pastes the prompt back into Claude Code. The cycle repeats.

## Architecture

```
┌─────────────────────────────────────┐
│         Tauri App (greview)         │
│                                     │
│  ┌───────────┐    ┌──────────────┐  │
│  │   Rust    │◀──▶│    React     │  │
│  │  Backend  │IPC │   Frontend   │  │
│  │           │    │              │  │
│  │ - git diff│    │ - File tree  │  │
│  │   parsing │    │ - Hunk list  │  │
│  │ - CLI arg │    │ - Review UI  │  │
│  │   handling│    │ - Prompt gen │  │
│  └───────────┘    └──────────────┘  │
└─────────────────────────────────────┘
```

### Rust Backend (Tauri Commands)

- `get_diff(range: Option<String>)` — runs `git diff` or `git diff <range>`, parses unified diff into structured JSON (files -> hunks -> lines).
- `get_repo_info()` — returns repo name, current branch, etc. for the title bar.
- `copy_to_clipboard(text: String)` — copies the generated prompt to system clipboard.

### React Frontend

All review state lives in-memory in the browser. No persistence needed. Calls Rust commands via `@tauri-apps/api`. Generates the final prompt client-side.

### CLI

- `greview` — review working tree diff (unstaged + staged changes).
- `greview HEAD~3..HEAD` — review a commit range.

Tauri handles CLI argument parsing and passes the range to the frontend on startup.

## UI Layout

Two-panel layout inspired by GitHub's PR review.

```
┌──────────────────────────────────────────────────────┐
│  greview — great-review     main  ●3 files  5/12     │
├────────────┬─────────────────────────────────────────┤
│            │                                         │
│ ▼ src/     │  src/auth.ts                            │
│   auth.ts  │  ┌─────────────────────────────────┐    │
│   ● 3/5    │  │ @@ -12,7 +12,9 @@               │    │
│            │  │  import { hash } from './utils'; │    │
│   db.ts    │  │ -const SECRET = "hardcoded";     │    │
│   ● 0/2    │  │ +const SECRET = env.AUTH_SECRET; │    │
│            │  │ +if (!SECRET) {                  │    │
│ ▼ lib/     │  │ +  throw new Error("missing");   │    │
│   utils.ts │  │  }                               │    │
│   ✓ 1/1    │  └─────────────────────────────────┘    │
│            │                                         │
│            │  [next hunk...]                         │
│            │                                         │
├────────────┴─────────────────────────────────────────┤
│  ✓ 6 approved  💬 3 commented  ✗ 3 rejected         │
│                                    [Copy Prompt]     │
└──────────────────────────────────────────────────────┘
```

### Top Bar

Repo name, current branch, file count, review progress (e.g. "5/12 hunks reviewed").

### Left Panel — File Tree

- Collapsible directory structure.
- Each file shows progress: `● 3/5` (3 of 5 hunks reviewed), `✓ 5/5` when complete.
- Click a file to scroll to its section in the right panel.

### Right Panel — Scrollable Diff

- Hunks grouped by file, with file headers as sticky section dividers.
- Standard diff coloring: green for additions, red for deletions.
- Line numbers for both old and new files.

### Bottom Bar — Status Summary

- Running totals: approved, commented, rejected counts.
- "Copy Prompt" button — enabled only when all hunks have been reviewed.

## Interaction Flow

### Whole-Hunk Actions

Hovering over a hunk's header area (`@@ -12,7 +12,9 @@`) shows a floating toolbar with three buttons: Approve (checkmark), Comment (bubble), Reject (X). Clicking one applies to the entire hunk.

### Selection-Specific Actions

Selecting text within a hunk (a variable name, a few lines) shows the same floating toolbar above the selection. Comment or Reject attaches feedback to that specific selection, which gets quoted in the final prompt.

### Feedback Input

After clicking Comment or Reject, an inline textarea expands directly below the hunk (or below the selected lines).

For Reject, two radio options appear above the textarea:
- **Propose alternative** — describe what you want instead.
- **Request other possibilities** — ask Claude to explore different approaches.

Type feedback, hit submit. The textarea collapses into a visible annotation badge. The hunk gets a colored left border: green (approved), yellow (commented), red (rejected).

### Changing Decisions

Click any annotation badge to re-open for editing. Click a different action button to replace the current decision entirely.

### Keyboard Shortcuts

- `a` — approve current/focused hunk
- `c` — comment on current/focused hunk
- `r` — reject current/focused hunk
- `j` / `k` — navigate between hunks
- `Escape` — dismiss open textarea

## Text Selection Tracking

Each diff line is rendered as a DOM element with data attributes:

```html
<div class="diff-line"
     data-file="src/auth.ts"
     data-hunk="2"
     data-line-old="14"
     data-line-new="16">
  <span class="line-content">const SECRET = env.AUTH_SECRET;</span>
</div>
```

Using `window.getSelection()`, we capture the selected text and walk up the DOM to find parent `.diff-line` elements, extracting file, hunk, and line info.

Three levels of granularity:

| Selection | Prompt output |
|---|---|
| Full hunk (via header hover) | Hunk reference: `@@ -12,7 +12,9 @@` |
| One or more full lines | Specific lines with content |
| Partial line (variable name, etc.) | Full line as context + quoted selection |

## Prompt Generation

Clicking "Copy Prompt" generates a minimal prompt with only actionable items. Approved hunks are summarized in one line.

Example output:

```
I've reviewed your changes. 8 hunks approved as-is.

The following need attention:

## src/auth.ts — Hunk @@ -12,7 +12,9 @@
**Comment** on `const SECRET = env.AUTH_SECRET`:
Why did you choose AUTH_SECRET over AUTH_KEY? Our other services use AUTH_KEY.

## src/auth.ts — Hunk @@ -45,3 +47,8 @@
**Rejected** (propose alternative):
\`\`\`diff
-  if (!user) return null;
+  if (!user) {
+    logger.warn("auth: user not found");
+    return null;
+  }
\`\`\`
Instead of silently returning null, throw an AuthenticationError
so the caller can handle it explicitly.

## src/db.ts — Hunk @@ -8,4 +8,10 @@
**Rejected** (request other possibilities):
This retry logic with hardcoded delays feels fragile.
Can you explore exponential backoff or a circuit breaker pattern instead?
```

Key details:
- File path and hunk header for precise location.
- Selected text quoted when comment targets a specific selection.
- Diff context included for rejections.
- Reject modes clearly labeled so Claude knows whether to implement a suggestion or explore options.

## Tech Stack

- **Tauri v2** — native window, Rust backend, system webview.
- **Rust** — git diff execution and parsing, CLI argument handling, clipboard.
- **React** — frontend UI, review state management, prompt generation.
- **Distribution** — single binary, user runs `greview` from any git repo.
