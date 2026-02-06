import { DiffFile, DiffHunk, HunkReview, LineType } from "./types";

export function formatSelectedText(text: string): string {
  return `\`${text}\``;
}

export function getHunkDiffText(hunk: DiffHunk): string {
  return hunk.lines
    .map((line) => {
      switch (line.line_type) {
        case LineType.Addition:
          return `+${line.content}`;
        case LineType.Deletion:
          return `-${line.content}`;
        case LineType.Context:
          return ` ${line.content}`;
      }
    })
    .join("\n");
}

export function getHunkKey(filePath: string, hunkIndex: number): string {
  return `${filePath}::${hunkIndex}`;
}

export function generatePrompt(
  files: DiffFile[],
  reviews: Record<string, HunkReview>
): string {
  if (files.length === 0) return "";

  let approvedCount = 0;
  const actionableItems: string[] = [];

  for (const file of files) {
    for (let i = 0; i < file.hunks.length; i++) {
      const hunk = file.hunks[i];
      const key = getHunkKey(file.path, i);
      const review = reviews[key];

      if (!review || review.decision === "approved") {
        approvedCount++;
        continue;
      }

      const heading = `## ${file.path} — Hunk ${hunk.header}`;

      if (review.decision === "commented") {
        if (review.selectedText) {
          actionableItems.push(
            `${heading}\n**Comment** on \`${review.selectedText}\`:\n${review.comment ?? ""}`
          );
        } else {
          actionableItems.push(
            `${heading}\n**Comment**:\n${review.comment ?? ""}`
          );
        }
      } else if (review.decision === "rejected") {
        const diffBlock = "```diff\n" + getHunkDiffText(hunk) + "\n```";

        if (review.rejectMode === "propose_alternative") {
          actionableItems.push(
            `${heading}\n**Rejected** (propose alternative):\n${diffBlock}\n${review.comment ?? ""}`
          );
        } else {
          actionableItems.push(
            `${heading}\n**Rejected** (request other possibilities):\n${diffBlock}\n${review.comment ?? ""}`
          );
        }
      }
    }
  }

  if (actionableItems.length === 0) {
    return `I've reviewed your changes. All ${approvedCount} hunks approved as-is. Looks good!`;
  }

  const parts = [
    `I've reviewed your changes. ${approvedCount} hunks approved as-is.`,
    "",
    "The following need attention:",
    "",
    actionableItems.join("\n\n"),
  ];

  return parts.join("\n");
}
