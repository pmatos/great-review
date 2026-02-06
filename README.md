# gr — Great Review

A desktop app for reviewing AI-generated code changes before they land. Review each hunk individually, add comments, reject what doesn't look right, then copy a single prompt back into Claude Code to continue the conversation.

## Install

Build from source (requires [Rust](https://rustup.rs/) and [Node.js](https://nodejs.org/)):

```bash
npm install
npm run tauri build
```

The binary is at `src-tauri/target/release/gr`. Copy it somewhere on your `PATH`.

## Usage

Run `gr` from any git repository:

```bash
# Review uncommitted changes (staged + unstaged)
gr

# Review a specific commit range
gr HEAD~3..HEAD
```

A window opens showing all changed hunks grouped by file.

## Reviewing

For each hunk you have three options:

- **Approve** — the change looks good
- **Comment** — leave a note (question, suggestion, clarification)
- **Reject** — request something different, with two modes:
  - *Propose alternative* — describe what you want instead
  - *Request other possibilities* — ask for different approaches

Hover over a hunk header to see the action buttons. You can also select specific text within a hunk to attach feedback to that selection.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate between hunks |
| `a` | Approve focused hunk |
| `c` | Comment on focused hunk |
| `r` | Reject focused hunk |
| `Escape` | Dismiss open textarea |

## Generating the Prompt

Once every hunk has a decision, the **Copy Prompt** button in the bottom bar becomes active. Click it to copy a formatted prompt to your clipboard, then paste it into Claude Code.

The prompt summarizes approved hunks in one line and lists each comment or rejection with file path, hunk location, your feedback, and relevant diff context.

## License

MIT
