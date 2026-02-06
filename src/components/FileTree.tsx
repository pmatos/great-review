import { useState } from "react";
import { DiffFile, HunkReview } from "../types";
import { getHunkKey } from "../state";
import "./FileTree.css";

interface FileTreeProps {
  files: DiffFile[];
  reviews: Record<string, HunkReview>;
  focusedFile?: string;
  onFileClick: (filePath: string) => void;
}

interface TreeNode {
  name: string;
  fullPath: string;
  children: Map<string, TreeNode>;
  file?: DiffFile;
}

function buildTree(files: DiffFile[]): TreeNode {
  const root: TreeNode = { name: "", fullPath: "", children: new Map() };
  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          fullPath: parts.slice(0, i + 1).join("/"),
          children: new Map(),
        });
      }
      current = current.children.get(part)!;
    }
    current.file = file;
  }
  return root;
}

function getFileProgress(
  file: DiffFile,
  reviews: Record<string, HunkReview>
): { total: number; reviewed: number } {
  const total = file.hunks.length;
  let reviewed = 0;
  for (let i = 0; i < total; i++) {
    if (reviews[getHunkKey(file.path, i)]) {
      reviewed++;
    }
  }
  return { total, reviewed };
}

function DirectoryNode({
  node,
  reviews,
  focusedFile,
  onFileClick,
  depth,
}: {
  node: TreeNode;
  reviews: Record<string, HunkReview>;
  focusedFile?: string;
  onFileClick: (filePath: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const entries = Array.from(node.children.values());
  const dirs = entries.filter((n) => !n.file);
  const files = entries.filter((n) => n.file);

  return (
    <div className="file-tree-dir">
      <div
        className="file-tree-dir-label"
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="file-tree-arrow">{expanded ? "▼" : "▶"}</span>
        <span className="file-tree-dir-name">{node.name}/</span>
      </div>
      {expanded && (
        <div>
          {dirs.map((dir) => (
            <DirectoryNode
              key={dir.fullPath}
              node={dir}
              reviews={reviews}
              focusedFile={focusedFile}
              onFileClick={onFileClick}
              depth={depth + 1}
            />
          ))}
          {files.map((fileNode) => (
            <FileNode
              key={fileNode.fullPath}
              node={fileNode}
              reviews={reviews}
              focusedFile={focusedFile}
              onFileClick={onFileClick}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FileNode({
  node,
  reviews,
  focusedFile,
  onFileClick,
  depth,
}: {
  node: TreeNode;
  reviews: Record<string, HunkReview>;
  focusedFile?: string;
  onFileClick: (filePath: string) => void;
  depth: number;
}) {
  const file = node.file!;
  const { total, reviewed } = getFileProgress(file, reviews);
  const complete = total > 0 && reviewed === total;

  return (
    <div
      className={`file-tree-file${focusedFile === file.path ? " focused" : ""}`}
      style={{ paddingLeft: depth * 16 + 26 }}
      onClick={() => onFileClick(file.path)}
    >
      <span className="file-tree-file-name">{node.name}</span>
      <span className={`file-tree-progress${complete ? " complete" : ""}`}>
        {complete ? "✓" : "●"} {reviewed}/{total}
      </span>
    </div>
  );
}

export default function FileTree({
  files,
  reviews,
  focusedFile,
  onFileClick,
}: FileTreeProps) {
  const tree = buildTree(files);
  const entries = Array.from(tree.children.values());
  const dirs = entries.filter((n) => !n.file);
  const topFiles = entries.filter((n) => n.file);

  return (
    <div className="file-tree">
      {dirs.map((dir) => (
        <DirectoryNode
          key={dir.fullPath}
          node={dir}
          reviews={reviews}
          focusedFile={focusedFile}
          onFileClick={onFileClick}
          depth={0}
        />
      ))}
      {topFiles.map((fileNode) => (
        <FileNode
          key={fileNode.fullPath}
          node={fileNode}
          reviews={reviews}
          focusedFile={focusedFile}
          onFileClick={onFileClick}
          depth={0}
        />
      ))}
    </div>
  );
}
