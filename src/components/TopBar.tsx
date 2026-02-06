import { RepoInfo } from "../types";
import "./TopBar.css";

interface TopBarProps {
  repoInfo: RepoInfo | null;
  fileCount: number;
  reviewedCount: number;
  totalHunks: number;
}

function TopBar({ repoInfo, fileCount, reviewedCount, totalHunks }: TopBarProps) {
  return (
    <div className="top-bar" data-tauri-drag-region>
      <span className="app-name">gr</span>
      <span className="separator">—</span>
      {repoInfo ? (
        <>
          <span className="repo-name">{repoInfo.name}</span>
          <span className="branch">{repoInfo.branch}</span>
          <div className="stats">
            <span>●{fileCount} files</span>
            <span className="progress">
              {reviewedCount}/{totalHunks} hunks reviewed
            </span>
          </div>
        </>
      ) : (
        <span className="repo-name">loading...</span>
      )}
    </div>
  );
}

export default TopBar;
