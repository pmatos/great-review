import { useEffect, useRef, useState, useCallback } from "react";
import { DiffLine, DiffHunk, DiffFile, HunkAnnotation, LineType, FileStatus } from "../types";
import { getHunkKey } from "../state";
import HunkToolbar from "./HunkToolbar";
import "./DiffViewer.css";

function DiffLineRow({
  line,
  filePath,
  hunkIndex,
  hasAnnotation,
  onLineClick,
}: {
  line: DiffLine;
  filePath: string;
  hunkIndex: number;
  hasAnnotation: boolean;
  onLineClick?: (filePath: string, hunkIndex: number, lineNo: number, lineContent: string, rect: DOMRect) => void;
}) {
  const lineClass =
    line.line_type === LineType.Addition
      ? "diff-line addition"
      : line.line_type === LineType.Deletion
        ? "diff-line deletion"
        : "diff-line";

  const prefix =
    line.line_type === LineType.Addition ? "+" : line.line_type === LineType.Deletion ? "-" : " ";

  const lineNo = line.new_line_no ?? line.old_line_no;

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!onLineClick || lineNo == null) return;
    // Only trigger on single click without text selection
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onLineClick(filePath, hunkIndex, lineNo, line.content, rect);
  }, [onLineClick, filePath, hunkIndex, lineNo, line.content]);

  return (
    <div
      className={`${lineClass}${hasAnnotation ? " has-annotation" : ""}`}
      data-file={filePath}
      data-hunk={hunkIndex}
      data-line-old={line.old_line_no ?? ""}
      data-line-new={line.new_line_no ?? ""}
      onClick={handleClick}
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

function AnnotationBadge({
  annotation,
  onRemove,
}: {
  annotation: HunkAnnotation;
  onRemove: () => void;
}) {
  const label = annotation.decision === "approved"
    ? "Approved"
    : annotation.decision === "commented"
      ? annotation.comment ?? "Comment"
      : annotation.comment ?? "Rejected";

  const displayLabel = label.length > 60 ? label.slice(0, 60) + "..." : label;

  const lineInfo = annotation.selectedLines
    ? annotation.selectedLines.start === annotation.selectedLines.end
      ? `L${annotation.selectedLines.start}`
      : `L${annotation.selectedLines.start}-${annotation.selectedLines.end}`
    : null;

  return (
    <div className={`annotation-badge badge-${annotation.decision}`} title={label}>
      {lineInfo && <span className="annotation-line-ref">{lineInfo}</span>}
      <span className="annotation-text">{displayLabel}</span>
      <button
        className="annotation-remove"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        title="Remove annotation"
      >
        ×
      </button>
    </div>
  );
}

interface DiffHunkViewProps {
  hunk: DiffHunk;
  hunkIndex: number;
  filePath: string;
  annotations: HunkAnnotation[];
  isFocused: boolean;
  onHunkAction: (action: "approve" | "comment" | "reject") => void;
  onLineClick?: (filePath: string, hunkIndex: number, lineNo: number, lineContent: string, rect: DOMRect) => void;
  onRemoveAnnotation: (annotationId: string) => void;
}

function DiffHunkView({
  hunk,
  hunkIndex,
  filePath,
  annotations,
  isFocused,
  onHunkAction,
  onLineClick,
  onRemoveAnnotation,
}: DiffHunkViewProps) {
  const [headerHovered, setHeaderHovered] = useState(false);
  const classes = ["diff-hunk"];

  // Use most severe decision for border color
  if (annotations.length > 0) {
    const hasRejected = annotations.some((a) => a.decision === "rejected");
    const hasCommented = annotations.some((a) => a.decision === "commented");
    if (hasRejected) classes.push("review-rejected");
    else if (hasCommented) classes.push("review-commented");
    else classes.push("review-approved");
  }
  if (isFocused) {
    classes.push("focused");
  }

  // Build a set of line numbers that have annotations
  const annotatedLines = new Set<number>();
  for (const ann of annotations) {
    if (ann.selectedLines) {
      for (let l = ann.selectedLines.start; l <= ann.selectedLines.end; l++) {
        annotatedLines.add(l);
      }
    }
  }

  // Split annotations into line-level and hunk-level
  const hunkLevelAnns = annotations.filter((a) => !a.selectedLines);
  const lineLevelAnns = annotations.filter((a) => a.selectedLines);

  // Group line-level annotations by the last line they cover, for inline display
  const annsByEndLine = new Map<number, HunkAnnotation[]>();
  for (const ann of lineLevelAnns) {
    const end = ann.selectedLines!.end;
    const list = annsByEndLine.get(end) ?? [];
    list.push(ann);
    annsByEndLine.set(end, list);
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
      {hunk.lines.map((line, i) => {
        const lineNo = line.new_line_no ?? line.old_line_no;
        const hasAnnotation = lineNo != null && annotatedLines.has(lineNo);
        const endAnns = lineNo != null ? annsByEndLine.get(lineNo) : undefined;
        return (
          <div key={i}>
            <DiffLineRow
              line={line}
              filePath={filePath}
              hunkIndex={hunkIndex}
              hasAnnotation={hasAnnotation}
              onLineClick={onLineClick}
            />
            {endAnns && endAnns.map((ann) => (
              <AnnotationBadge
                key={ann.id}
                annotation={ann}
                onRemove={() => onRemoveAnnotation(ann.id)}
              />
            ))}
          </div>
        );
      })}
      {hunkLevelAnns.map((ann) => (
        <AnnotationBadge
          key={ann.id}
          annotation={ann}
          onRemove={() => onRemoveAnnotation(ann.id)}
        />
      ))}
    </div>
  );
}

interface DiffViewerProps {
  files: DiffFile[];
  annotations: Record<string, HunkAnnotation[]>;
  focusedHunkKey: string | null;
  onHunkAction: (filePath: string, hunkIndex: number, action: "approve" | "comment" | "reject") => void;
  onLineClick?: (filePath: string, hunkIndex: number, lineNo: number, lineContent: string, rect: DOMRect) => void;
  onRemoveAnnotation: (hunkKey: string, annotationId: string) => void;
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

export default function DiffViewer({
  files,
  annotations,
  focusedHunkKey,
  onHunkAction,
  onLineClick,
  onRemoveAnnotation,
  scrollToFile,
}: DiffViewerProps) {
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
                annotations={annotations[key] ?? []}
                isFocused={focusedHunkKey === key}
                onHunkAction={(action) => onHunkAction(file.path, hunkIndex, action)}
                onLineClick={onLineClick}
                onRemoveAnnotation={(annId) => onRemoveAnnotation(key, annId)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
