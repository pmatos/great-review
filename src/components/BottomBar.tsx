import { useState, useCallback } from "react";
import "./BottomBar.css";

interface BottomBarProps {
  approvedCount: number;
  commentedCount: number;
  rejectedCount: number;
  allReviewed: boolean;
  onCopyPrompt: () => void;
}

function BottomBar({
  approvedCount,
  commentedCount,
  rejectedCount,
  allReviewed,
  onCopyPrompt,
}: BottomBarProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    onCopyPrompt();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [onCopyPrompt]);

  return (
    <div className="bottom-bar">
      <div className="totals">
        <span className="approved-count">✓ {approvedCount} approved</span>
        <span className="commented-count">💬 {commentedCount} commented</span>
        <span className="rejected-count">✗ {rejectedCount} rejected</span>
      </div>
      <button
        className={`copy-btn${copied ? " copied" : ""}`}
        disabled={!allReviewed}
        onClick={handleCopy}
      >
        {copied ? "Copied!" : "Copy Prompt"}
      </button>
    </div>
  );
}

export default BottomBar;
