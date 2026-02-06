import { useEffect, useRef, useState } from "react";
import { DiffLine, DiffHunk, DiffFile, HunkReview, LineType, FileStatus } from "../types";
import { getHunkKey } from "../state";
import HunkToolbar from "./HunkToolbar";
import "./DiffViewer.css";

function DiffLineRow({ line, filePath, hunkIndex }: { line: DiffLine; filePath: string; hunkIndex: number }) {
  const lineClass =
    line.line_type === LineType.Addition
      ? "diff-line addition"
      : line.line_type === LineType.Deletion
        ? "diff-line deletion"
        : "diff-line";

  const prefix =
    line.line_type === LineType.Addition ? "+" : line.line_type === LineType.Deletion ? "-" : " ";

  return (
    <div
      className={lineClass}
      data-file={filePath}
      data-hunk={hunkIndex}
      data-line-old={line.old_line_no ?? ""}
      data-line-new={line.new_line_no ?? ""}
    >
      <div className="line-gutter">{line.old_line_no ?? ""}</div>
      <div className="line-gutter">{line.new_line_no ?? ""}</div>
      <div className="line-content">
        {prefix}
        {line.content}
      </div>
    </div>
  );
}

interface DiffHunkViewProps {
  hunk: DiffHunk;
  hunkIndex: number;
  filePath: string;
  review?: HunkReview;
  isFocused: boolean;
  onHunkAction: (action: "approve" | "comment" | "reject") => void;
}

function DiffHunkView({ hunk, hunkIndex, filePath, review, isFocused, onHunkAction }: DiffHunkViewProps) {
  const [headerHovered, setHeaderHovered] = useState(false);
  const classes = ["diff-hunk"];
  if (review) {
    classes.push(`review-${review.decision}`);
  }
  if (isFocused) {
    classes.push("focused");
  }

  return (
    <div className={classes.join(" ")} data-hunk-key={getHunkKey(filePath, hunkIndex)}>
      <div
        className="hunk-header"
        onMouseEnter={() => setHeaderHovered(true)}
        onMouseLeave={() => setHeaderHovered(false)}
      >
        <span>{hunk.header}</span>
        {headerHovered && (
          <HunkToolbar
            onApprove={() => onHunkAction("approve")}
            onComment={() => onHunkAction("comment")}
            onReject={() => onHunkAction("reject")}
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)" }}
          />
        )}
      </div>
      {hunk.lines.map((line, i) => (
        <DiffLineRow key={i} line={line} filePath={filePath} hunkIndex={hunkIndex} />
      ))}
      {review?.comment && (
        <div
          className={`annotation-badge badge-${review.decision}`}
          title={review.comment}
        >
          {review.comment.length > 60 ? review.comment.slice(0, 60) + "..." : review.comment}
        </div>
      )}
    </div>
  );
}

interface DiffViewerProps {
  files: DiffFile[];
  reviews: Record<string, HunkReview>;
  focusedHunkKey: string | null;
  onHunkAction: (filePath: string, hunkIndex: number, action: "approve" | "comment" | "reject") => void;
  scrollToFile?: string;
}

function statusBadgeClass(status: FileStatus): string {
  switch (status) {
    case FileStatus.Added:
      return "file-status-badge added";
    case FileStatus.Modified:
      return "file-status-badge modified";
    case FileStatus.Deleted:
      return "file-status-badge deleted";
    case FileStatus.Renamed:
      return "file-status-badge renamed";
  }
}

export default function DiffViewer({ files, reviews, focusedHunkKey, onHunkAction, scrollToFile }: DiffViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollToFile && containerRef.current) {
      const el = containerRef.current.querySelector(`#file-${CSS.escape(scrollToFile)}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [scrollToFile]);

  useEffect(() => {
    if (focusedHunkKey && containerRef.current) {
      const el = containerRef.current.querySelector(`[data-hunk-key="${CSS.escape(focusedHunkKey)}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusedHunkKey]);

  return (
    <div className="diff-viewer" ref={containerRef}>
      {files.map((file) => (
        <div key={file.path} className="file-section" id={`file-${file.path}`}>
          <div className="file-header">
            <span className={statusBadgeClass(file.status)}>{file.status}</span>
            <span>{file.path}</span>
          </div>
          {file.hunks.map((hunk, hunkIndex) => {
            const key = getHunkKey(file.path, hunkIndex);
            return (
              <DiffHunkView
                key={key}
                hunk={hunk}
                hunkIndex={hunkIndex}
                filePath={file.path}
                review={reviews[key]}
                isFocused={focusedHunkKey === key}
                onHunkAction={(action) => onHunkAction(file.path, hunkIndex, action)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
