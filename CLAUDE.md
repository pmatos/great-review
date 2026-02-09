# CLAUDE.md

## Project Overview

Great Review (`greview`) is a Tauri v2 desktop app for reviewing AI-generated code changes hunk-by-hunk. It parses git diffs, presents them in a two-panel UI, and generates a minimal prompt to paste back into Claude Code. The binary is called `greview`.

## Commands

### Frontend (React + TypeScript)

```bash
npm install                  # install dependencies
npm run dev                  # start vite dev server (port 1420)
npm run build                # tsc + vite build (required before cargo build)
npx tsc --noEmit             # type-check without emitting
npx vitest run               # run frontend tests
npx vitest run src/prompt-generator.test.ts  # single test file
npx vitest --watch            # watch mode during development
```

### Rust Backend

```bash
cd src-tauri
cargo build                  # build (must run npm run build first for frontend dist)
cargo test                   # run all Rust tests
cargo test diff_parser       # run tests in one module
cargo clippy -- -D warnings  # lint
cargo fmt                    # format
```

### Full App (run from project root, not src-tauri/)

```bash
npm run tauri dev             # dev mode with hot reload (runs both frontend + backend)
npm run tauri build           # production build → produces greview binary
```

## Architecture

This is a Tauri v2 app with two halves communicating over IPC:

**Rust backend** (`src-tauri/src/`) — runs git commands and parses output:
- `diff_parser.rs` — parses unified diff text into `DiffFile > DiffHunk > DiffLine` structs. All parsing is string-based, no git library.
- `repo_info.rs` — runs `git rev-parse` to get repo name, branch, root path.
- `commands.rs` — Tauri `#[tauri::command]` functions that the frontend calls via `invoke()`. Three commands: `get_diff`, `get_repo_info_cmd`, `get_startup_args`.
- `lib.rs` — wires modules, plugins (cli, clipboard, opener), and command handlers into the Tauri builder.

**React frontend** (`src/`) — all UI and review state:
- `types.ts` — shared TypeScript interfaces mirroring the Rust structs. These must stay in sync with the Rust `Serialize`/`Deserialize` types.
- `state.ts` — `useReducer` + React Context for review state. Hunk reviews are keyed by `"filepath::hunkIndex"` (see `getHunkKey()`).
- `tauri-api.ts` — typed wrappers around `invoke()` and clipboard plugin.
- `prompt-generator.ts` — builds the final review prompt from files + reviews.
- `App.tsx` — orchestrates everything: data loading, keyboard shortcuts, text selection, feedback flow.
- `components/` — FileTree (left panel), DiffViewer (right panel), TopBar, BottomBar, HunkToolbar (floating actions), FeedbackInput (comment/reject form).

**Data flow**: CLI args → `get_startup_args` → `get_diff(range)` → Rust parses diff → JSON over IPC → React renders hunks → user reviews → `generatePrompt()` → clipboard.

## Code Style

- Functional React components only, no class components.
- All theming via CSS custom properties in `src/index.css` — no CSS modules, no inline theme values.
- TypeScript interfaces in `types.ts` must mirror Rust `Serialize`/`Deserialize` structs exactly.

## Key Gotchas

- The binary name is `greview` (set in `Cargo.toml [[bin]]`), but the lib crate is `great_review_lib`. `main.rs` calls `great_review_lib::run()`.
- The frontend must be built (`npm run build`) before `cargo build` works, because Tauri embeds the `dist/` directory. Use `npm run tauri dev` during development to avoid this.
- Tauri v2 uses plugins for CLI args (`tauri-plugin-cli`) and clipboard (`tauri-plugin-clipboard-manager`). These are registered in `lib.rs` and configured in `tauri.conf.json` (CLI args) and `capabilities/default.json` (permissions).
- All review state is in-memory only — no persistence, no database. Closing the window loses all reviews.
- CSS custom properties for theming are defined in `src/index.css` (dark theme). All components reference these variables.
- Hunk reviews are identified by `"filepath::hunkIndex"` composite key. If the diff structure changes, stored reviews become orphaned.
