import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useReviewState, getHunkKey, getReviewProgress, isAllReviewed } from "./state";
import { fetchDiff, fetchRepoInfo, fetchStartupArgs, copyToClipboard } from "./tauri-api";
import { generatePrompt } from "./prompt-generator";
import type { RejectMode } from "./types";
import TopBar from "./components/TopBar";
import BottomBar from "./components/BottomBar";
import FileTree from "./components/FileTree";
import DiffViewer from "./components/DiffViewer";
import HunkToolbar from "./components/HunkToolbar";
import FeedbackInput from "./components/FeedbackInput";
import "./App.css";

interface ActiveFeedback {
  hunkKey: string;
  filePath: string;
  hunkIndex: number;
  mode: "comment" | "reject";
  selectedText?: string;
}

interface SelectionToolbar {
  x: number;
  y: number;
  filePath: string;
  hunkIndex: number;
  selectedText: string;
}

function App() {
  const { state, dispatch } = useReviewState();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scrollToFile, setScrollToFile] = useState<string | undefined>();
  const [focusedFile, setFocusedFile] = useState<string | undefined>();
  const [activeFeedback, setActiveFeedback] = useState<ActiveFeedback | null>(null);
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbar | null>(null);
  const diffPanelRef = useRef<HTMLDivElement>(null);

  // Load diff and repo info on mount
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [range, repoInfo] = await Promise.all([
          fetchStartupArgs(),
          fetchRepoInfo(),
        ]);
        if (cancelled) return;
        dispatch({ type: "SET_REPO_INFO", info: repoInfo });

        const files = await fetchDiff(range ?? undefined);
        if (cancelled) return;
        dispatch({ type: "SET_DIFF", files });
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [dispatch]);

  // Build flat list of all hunk keys for navigation
  const allHunkKeys = useMemo(() => {
    const keys: string[] = [];
    for (const file of state.files) {
      for (let i = 0; i < file.hunks.length; i++) {
        keys.push(getHunkKey(file.path, i));
      }
    }
    return keys;
  }, [state.files]);

  const parseHunkKey = useCallback((key: string): { filePath: string; hunkIndex: number } | null => {
    const sep = key.lastIndexOf("::");
    if (sep === -1) return null;
    return { filePath: key.slice(0, sep), hunkIndex: parseInt(key.slice(sep + 2), 10) };
  }, []);

  // Hunk action handler
  const handleHunkAction = useCallback(
    (filePath: string, hunkIndex: number, action: "approve" | "comment" | "reject") => {
      const key = getHunkKey(filePath, hunkIndex);
      dispatch({ type: "SET_FOCUSED_HUNK", key });

      if (action === "approve") {
        dispatch({ type: "SET_REVIEW", key, review: { decision: "approved" } });
        setActiveFeedback(null);
        setSelectionToolbar(null);
      } else {
        setActiveFeedback({
          hunkKey: key,
          filePath,
          hunkIndex,
          mode: action === "comment" ? "comment" : "reject",
          selectedText: selectionToolbar?.hunkIndex === hunkIndex &&
            selectionToolbar?.filePath === filePath
            ? selectionToolbar.selectedText
            : undefined,
        });
        setSelectionToolbar(null);
      }
    },
    [dispatch, selectionToolbar],
  );

  // Feedback submission
  const handleFeedbackSubmit = useCallback(
    (comment: string, rejectMode?: RejectMode) => {
      if (!activeFeedback) return;
      const { hunkKey, mode, selectedText } = activeFeedback;
      if (mode === "comment") {
        dispatch({
          type: "SET_REVIEW",
          key: hunkKey,
          review: { decision: "commented", comment, selectedText },
        });
      } else {
        dispatch({
          type: "SET_REVIEW",
          key: hunkKey,
          review: { decision: "rejected", comment, rejectMode, selectedText },
        });
      }
      setActiveFeedback(null);
    },
    [activeFeedback, dispatch],
  );

  // Copy prompt handler
  const handleCopyPrompt = useCallback(() => {
    const prompt = generatePrompt(state.files, state.reviews);
    copyToClipboard(prompt);
  }, [state.files, state.reviews]);

  // File click handler
  const handleFileClick = useCallback((filePath: string) => {
    setFocusedFile(filePath);
    setScrollToFile(filePath);
  }, []);

  // Text selection handling for line-specific reviews
  useEffect(() => {
    const panel = diffPanelRef.current;
    if (!panel) return;

    function handleMouseUp() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        return;
      }

      const selectedText = sel.toString().trim();
      let node: Node | null = sel.anchorNode;
      let fileAttr: string | null = null;
      let hunkAttr: string | null = null;

      while (node && node !== panel) {
        if (node instanceof HTMLElement) {
          if (!fileAttr && node.dataset.file) fileAttr = node.dataset.file;
          if (!hunkAttr && node.dataset.hunk) hunkAttr = node.dataset.hunk;
          if (fileAttr && hunkAttr) break;
        }
        node = node.parentNode;
      }

      if (!fileAttr || hunkAttr === null) return;

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      setSelectionToolbar({
        x: rect.left + rect.width / 2,
        y: rect.top - 8,
        filePath: fileAttr,
        hunkIndex: parseInt(hunkAttr, 10),
        selectedText,
      });
    }

    panel.addEventListener("mouseup", handleMouseUp);
    return () => panel.removeEventListener("mouseup", handleMouseUp);
  }, []);

  // Clear selection toolbar on outside click
  useEffect(() => {
    if (!selectionToolbar) return;
    function handleClick(e: MouseEvent) {
      const toolbar = document.querySelector(".selection-toolbar");
      if (toolbar && !toolbar.contains(e.target as Node)) {
        setSelectionToolbar(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [selectionToolbar]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (tag === "textarea" || tag === "input") return;

      switch (e.key) {
        case "a": {
          if (state.focusedHunkKey) {
            const parsed = parseHunkKey(state.focusedHunkKey);
            if (parsed) handleHunkAction(parsed.filePath, parsed.hunkIndex, "approve");
          }
          break;
        }
        case "c": {
          if (state.focusedHunkKey) {
            const parsed = parseHunkKey(state.focusedHunkKey);
            if (parsed) handleHunkAction(parsed.filePath, parsed.hunkIndex, "comment");
          }
          break;
        }
        case "r": {
          if (state.focusedHunkKey) {
            const parsed = parseHunkKey(state.focusedHunkKey);
            if (parsed) handleHunkAction(parsed.filePath, parsed.hunkIndex, "reject");
          }
          break;
        }
        case "j": {
          e.preventDefault();
          const idx = state.focusedHunkKey ? allHunkKeys.indexOf(state.focusedHunkKey) : -1;
          const next = idx < allHunkKeys.length - 1 ? idx + 1 : 0;
          if (allHunkKeys.length > 0) {
            dispatch({ type: "SET_FOCUSED_HUNK", key: allHunkKeys[next] });
          }
          break;
        }
        case "k": {
          e.preventDefault();
          const idx = state.focusedHunkKey ? allHunkKeys.indexOf(state.focusedHunkKey) : 0;
          const prev = idx > 0 ? idx - 1 : allHunkKeys.length - 1;
          if (allHunkKeys.length > 0) {
            dispatch({ type: "SET_FOCUSED_HUNK", key: allHunkKeys[prev] });
          }
          break;
        }
        case "Escape": {
          setActiveFeedback(null);
          setSelectionToolbar(null);
          break;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.focusedHunkKey, allHunkKeys, dispatch, handleHunkAction, parseHunkKey]);

  const progress = getReviewProgress(state);
  const allDone = isAllReviewed(state);

  if (error) {
    return (
      <main className="app">
        <div className="error-message">{error}</div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="app">
        <div className="loading-message">Loading diff...</div>
      </main>
    );
  }

  return (
    <main className="app">
      <TopBar
        repoInfo={state.repoInfo}
        fileCount={state.files.length}
        reviewedCount={progress.reviewed}
        totalHunks={progress.total}
      />
      <div className="app-body">
        <div className="file-tree-panel">
          <FileTree
            files={state.files}
            reviews={state.reviews}
            focusedFile={focusedFile}
            onFileClick={handleFileClick}
          />
        </div>
        <div className="diff-panel" ref={diffPanelRef}>
          <DiffViewer
            files={state.files}
            reviews={state.reviews}
            focusedHunkKey={state.focusedHunkKey}
            onHunkAction={handleHunkAction}
            scrollToFile={scrollToFile}
          />
          {activeFeedback && (
            <div className="feedback-overlay">
              <div className="hunk-reference">
                {activeFeedback.filePath} — hunk #{activeFeedback.hunkIndex}
                {activeFeedback.selectedText && (
                  <> — selected: "{activeFeedback.selectedText.slice(0, 40)}
                  {activeFeedback.selectedText.length > 40 ? "..." : ""}"</>
                )}
              </div>
              <FeedbackInput
                mode={activeFeedback.mode}
                onSubmit={handleFeedbackSubmit}
                onCancel={() => setActiveFeedback(null)}
              />
            </div>
          )}
        </div>
      </div>
      <BottomBar
        approvedCount={progress.approved}
        commentedCount={progress.commented}
        rejectedCount={progress.rejected}
        allReviewed={allDone}
        onCopyPrompt={handleCopyPrompt}
      />
      {selectionToolbar && (
        <div
          className="selection-toolbar"
          style={{
            left: selectionToolbar.x,
            top: selectionToolbar.y,
            transform: "translate(-50%, -100%)",
          }}
        >
          <HunkToolbar
            onApprove={() =>
              handleHunkAction(selectionToolbar.filePath, selectionToolbar.hunkIndex, "approve")
            }
            onComment={() =>
              handleHunkAction(selectionToolbar.filePath, selectionToolbar.hunkIndex, "comment")
            }
            onReject={() =>
              handleHunkAction(selectionToolbar.filePath, selectionToolbar.hunkIndex, "reject")
            }
          />
        </div>
      )}
    </main>
  );
}

export default App;
