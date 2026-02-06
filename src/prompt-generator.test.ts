import { describe, it, expect } from "vitest";
import {
  generatePrompt,
  getHunkDiffText,
  getHunkKey,
  formatSelectedText,
} from "./prompt-generator";
import {
  DiffFile,
  DiffHunk,
  HunkReview,
  LineType,
  FileStatus,
} from "./types";

function makeHunk(overrides?: Partial<DiffHunk>): DiffHunk {
  return {
    header: "@@ -1,3 +1,4 @@",
    old_start: 1,
    old_count: 3,
    new_start: 1,
    new_count: 4,
    lines: [
      { content: "  context line", line_type: LineType.Context, old_line_no: 1, new_line_no: 1 },
      { content: "  old line", line_type: LineType.Deletion, old_line_no: 2, new_line_no: null },
      { content: "  new line", line_type: LineType.Addition, old_line_no: null, new_line_no: 2 },
      { content: "  another ctx", line_type: LineType.Context, old_line_no: 3, new_line_no: 3 },
    ],
    ...overrides,
  };
}

function makeFile(path: string, hunkCount = 1): DiffFile {
  const hunks: DiffHunk[] = [];
  for (let i = 0; i < hunkCount; i++) {
    hunks.push(
      makeHunk({ header: `@@ -${i * 10 + 1},3 +${i * 10 + 1},4 @@` })
    );
  }
  return { path, old_path: null, hunks, status: FileStatus.Modified };
}

describe("getHunkKey", () => {
  it("generates key from path and index", () => {
    expect(getHunkKey("src/foo.ts", 2)).toBe("src/foo.ts::2");
  });
});

describe("formatSelectedText", () => {
  it("wraps text in backticks", () => {
    expect(formatSelectedText("some code")).toBe("`some code`");
  });
});

describe("getHunkDiffText", () => {
  it("reconstructs diff text with proper prefixes", () => {
    const hunk = makeHunk();
    const result = getHunkDiffText(hunk);
    expect(result).toBe(
      "   context line\n" +
      "-  old line\n" +
      "+  new line\n" +
      "   another ctx"
    );
  });
});

describe("generatePrompt", () => {
  it("returns empty string for no files", () => {
    expect(generatePrompt([], {})).toBe("");
  });

  it("returns all-approved message when all hunks approved", () => {
    const files = [makeFile("src/a.ts", 2), makeFile("src/b.ts", 1)];
    const reviews: Record<string, HunkReview> = {
      "src/a.ts::0": { decision: "approved" },
      "src/a.ts::1": { decision: "approved" },
      "src/b.ts::0": { decision: "approved" },
    };

    const result = generatePrompt(files, reviews);
    expect(result).toBe(
      "I've reviewed your changes. All 3 hunks approved as-is. Looks good!"
    );
  });

  it("treats unreviewed hunks as approved", () => {
    const files = [makeFile("src/a.ts", 1)];
    const result = generatePrompt(files, {});
    expect(result).toBe(
      "I've reviewed your changes. All 1 hunks approved as-is. Looks good!"
    );
  });

  it("generates comment with selected text", () => {
    const files = [makeFile("src/auth.ts", 2)];
    const reviews: Record<string, HunkReview> = {
      "src/auth.ts::0": { decision: "approved" },
      "src/auth.ts::1": {
        decision: "commented",
        comment: "This looks suspicious",
        selectedText: "doAuth()",
      },
    };

    const result = generatePrompt(files, reviews);
    expect(result).toContain("1 hunks approved as-is.");
    expect(result).toContain("The following need attention:");
    expect(result).toContain("## src/auth.ts — Hunk @@ -11,3 +11,4 @@");
    expect(result).toContain("**Comment** on `doAuth()`:");
    expect(result).toContain("This looks suspicious");
  });

  it("generates comment without selected text", () => {
    const files = [makeFile("src/auth.ts", 1)];
    const reviews: Record<string, HunkReview> = {
      "src/auth.ts::0": {
        decision: "commented",
        comment: "General remark",
      },
    };

    const result = generatePrompt(files, reviews);
    expect(result).toContain("**Comment**:");
    expect(result).toContain("General remark");
    expect(result).not.toContain("**Comment** on");
  });

  it("generates rejection with propose alternative", () => {
    const files = [makeFile("src/db.ts", 1)];
    const reviews: Record<string, HunkReview> = {
      "src/db.ts::0": {
        decision: "rejected",
        rejectMode: "propose_alternative",
        comment: "Use a connection pool instead",
      },
    };

    const result = generatePrompt(files, reviews);
    expect(result).toContain("**Rejected** (propose alternative):");
    expect(result).toContain("```diff");
    expect(result).toContain("Use a connection pool instead");
  });

  it("generates rejection with request other possibilities", () => {
    const files = [makeFile("src/db.ts", 1)];
    const reviews: Record<string, HunkReview> = {
      "src/db.ts::0": {
        decision: "rejected",
        rejectMode: "request_possibilities",
        comment: "Show me other approaches",
      },
    };

    const result = generatePrompt(files, reviews);
    expect(result).toContain("**Rejected** (request other possibilities):");
    expect(result).toContain("```diff");
    expect(result).toContain("Show me other approaches");
  });

  it("produces mixed output with approved count and actionable items", () => {
    const files = [makeFile("src/a.ts", 3), makeFile("src/b.ts", 1)];
    const reviews: Record<string, HunkReview> = {
      "src/a.ts::0": { decision: "approved" },
      "src/a.ts::1": {
        decision: "commented",
        comment: "Needs docs",
      },
      "src/a.ts::2": {
        decision: "rejected",
        rejectMode: "propose_alternative",
        comment: "Try X instead",
      },
      "src/b.ts::0": { decision: "approved" },
    };

    const result = generatePrompt(files, reviews);
    expect(result).toMatch(/^I've reviewed your changes\. 2 hunks approved as-is\./);
    expect(result).toContain("The following need attention:");
    expect(result).toContain("## src/a.ts — Hunk");
    expect(result).toContain("**Comment**:");
    expect(result).toContain("**Rejected** (propose alternative):");
    expect(result).not.toContain("src/b.ts");
  });
});
