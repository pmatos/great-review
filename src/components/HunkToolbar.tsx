import React from "react";
import "./HunkToolbar.css";

interface HunkToolbarProps {
  onApprove: () => void;
  onComment: () => void;
  onReject: () => void;
  style?: React.CSSProperties;
}

const HunkToolbar: React.FC<HunkToolbarProps> = ({
  onApprove,
  onComment,
  onReject,
  style,
}) => {
  return (
    <div className="hunk-toolbar" style={style}>
      <button className="approve-btn" title="Approve" onClick={onApprove}>
        ✓
      </button>
      <button className="comment-btn" title="Comment" onClick={onComment}>
        💬
      </button>
      <button className="reject-btn" title="Reject" onClick={onReject}>
        ✗
      </button>
    </div>
  );
};

export default HunkToolbar;
