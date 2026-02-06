import React, { useState, useRef, useEffect } from "react";
import type { RejectMode } from "../types";
import "./FeedbackInput.css";

interface FeedbackInputProps {
  mode: "comment" | "reject";
  initialComment?: string;
  initialRejectMode?: RejectMode;
  onSubmit: (comment: string, rejectMode?: RejectMode) => void;
  onCancel: () => void;
}

const FeedbackInput: React.FC<FeedbackInputProps> = ({
  mode,
  initialComment = "",
  initialRejectMode = "propose_alternative",
  onSubmit,
  onCancel,
}) => {
  const [comment, setComment] = useState(initialComment);
  const [rejectMode, setRejectMode] = useState<RejectMode>(initialRejectMode);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onCancel();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      onSubmit(comment, mode === "reject" ? rejectMode : undefined);
    }
  };

  return (
    <div className="feedback-input" onKeyDown={handleKeyDown}>
      {mode === "reject" && (
        <div className="radio-group">
          <label>
            <input
              type="radio"
              name="reject-mode"
              value="propose_alternative"
              checked={rejectMode === "propose_alternative"}
              onChange={() => setRejectMode("propose_alternative")}
            />
            Propose alternative
          </label>
          <label>
            <input
              type="radio"
              name="reject-mode"
              value="request_possibilities"
              checked={rejectMode === "request_possibilities"}
              onChange={() => setRejectMode("request_possibilities")}
            />
            Request other possibilities
          </label>
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={
          mode === "reject" ? "Describe your feedback..." : "Add a comment..."
        }
      />
      <div className="actions">
        <button className="cancel-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="submit-btn"
          onClick={() =>
            onSubmit(comment, mode === "reject" ? rejectMode : undefined)
          }
        >
          Submit
        </button>
      </div>
    </div>
  );
};

export default FeedbackInput;
