import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useReviewState, getHunkKey, getReviewProgress, isAllReviewed } from "./state";
import { fetchDiff, fetchRepoInfo, fetchStartupArgs, copyToClipboard } from "./tauri-api";
import { generatePrompt } from "./prompt-generator";
import type { HunkAnnotation, RejectMode } from "./types";
import TopBar from "./components/TopBar";
import BottomBar from "./components/BottomBar";
import FileTree from "./components/FileTree";
import DiffViewer from "./components/DiffViewer";
import HunkToolbar from "./components/HunkToolbar";
import FeedbackInput from "./components/FeedbackInput";
import "./App.css";

let annotationCounter = 0;
function nextAnnotationId(): string {
  return `ann-${Date.now()}-${++annotationCounter}`;
}

interface ActiveFeedback {
  hunkKey: string;
  filePath: string;
  hunkIndex: number;
  mode: "comment" | "reject";
  selectedText?: string;
  startLine: number | null;
  endLine: number | null;
}

interface SelectionToolbar {
  x: number;
  y: number;
  filePath: string;
  hunkIndex: number;
  selectedText: string;
  startLine: number | null;
  endLine: number | null;
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

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const args = await fetchStartupArgs();
        if (cancelled) return;

        const remote = args.remote ?? undefined;
        const repoInfo = await fetchRepoInfo(remote);
        if (cancelled) return;
        dispatch({ type: "SET_REPO_INFO", info: repoInfo });

        const files = await fetchDiff(args.range ?? undefined, remote);
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

  const handleHunkAction = useCallback(
    (filePath: string, hunkIndex: number, action: "approve" | "comment" | "reject") => {
      const key = getHunkKey(filePath, hunkIndex);
      dispatch({ type: "SET_FOCUSED_HUNK", key });

      if (action === "approve") {
        const hasSelection = selectionToolbar?.hunkIndex === hunkIndex &&
            selectionToolbar?.filePath === filePath;
        const selectedLines = hasSelection && selectionToolbar.startLine != null && selectionToolbar.endLine != null
          ? { start: selectionToolbar.startLine, end: selectionToolbar.endLine }
          : undefined;
        const selectedText = hasSelection ? selectionToolbar.selectedText : undefined;
        const annotation: HunkAnnotation = {
          id: nextAnnotationId(),
          decision: "approved",
          selectedText,
          selectedLines,
        };
        dispatch({ type: "ADD_ANNOTATION", key, annotation });
        setActiveFeedback(null);
        setSelectionToolbar(null);
      } else {
        const hasSelection = selectionToolbar?.hunkIndex === hunkIndex &&
            selectionToolbar?.filePath === filePath;
        setActiveFeedback({
          hunkKey: key,
          filePath,
          hunkIndex,
          mode: action === "comment" ? "comment" : "reject",
          selectedText: hasSelection ? selectionToolbar.selectedText : undefined,
          startLine: hasSelection ? selectionToolbar.startLine : null,
          endLine: hasSelection ? selectionToolbar.endLine : null,
        });
        setSelectionToolbar(null);
      }
    },
    [dispatch, selectionToolbar],
  );

  const handleFeedbackSubmit = useCallback(
    (comment: string, rejectMode?: RejectMode) => {
      if (!activeFeedback) return;
      const { hunkKey, mode, selectedText, startLine, endLine } = activeFeedback;
      const selectedLines = startLine != null && endLine != null
        ? { start: startLine, end: endLine }
        : undefined;
      const annotation: HunkAnnotation = {
        id: nextAnnotationId(),
        decision: mode === "comment" ? "commented" : "rejected",
        comment,
        rejectMode: mode === "reject" ? rejectMode : undefined,
        selectedText,
        selectedLines,
      };
      dispatch({ type: "ADD_ANNOTATION", key: hunkKey, annotation });
      setActiveFeedback(null);
    },
    [activeFeedback, dispatch],
  );

  const handleRemoveAnnotation = useCallback(
    (hunkKey: string, annotationId: string) => {
      dispatch({ type: "REMOVE_ANNOTATION", key: hunkKey, annotationId });
    },
    [dispatch],
  );

  const handleCopyPrompt = useCallback(() => {
    const prompt = generatePrompt(state.files, state.annotations);
    copyToClipboard(prompt);
  }, [state.files, state.annotations]);

  const handleFileClick = useCallback((filePath: string) => {
    setFocusedFile(filePath);
    setScrollToFile(filePath);
  }, []);

  // Line click handler from DiffViewer
  const handleLineClick = useCallback(
    (filePath: string, hunkIndex: number, lineNo: number, lineContent: string, rect: DOMRect) => {
      const key = getHunkKey(filePath, hunkIndex);
      dispatch({ type: "SET_FOCUSED_HUNK", key });
      setSelectionToolbar({
        x: rect.left + rect.width / 2,
        y: rect.top - 8,
        filePath,
        hunkIndex,
        selectedText: lineContent,
        startLine: lineNo,
        endLine: lineNo,
      });
    },
    [dispatch],
  );

  // Text selection handling
  useEffect(() => {
    const panel = diffPanelRef.current;
    if (!panel) return;

    function findLineElement(node: Node | null): HTMLElement | null {
      while (node && node !== panel) {
        if (node instanceof HTMLElement && node.classList.contains("diff-line")) {
          return node;
        }
        node = node.parentNode;
      }
      return null;
    }

    function getLineNo(el: HTMLElement): number | null {
      const newLine = el.dataset.lineNew;
      if (newLine && newLine !== "") return parseInt(newLine, 10);
      const oldLine = el.dataset.lineOld;
      if (oldLine && oldLine !== "") return parseInt(oldLine, 10);
      return null;
    }

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

      const anchorLine = findLineElement(sel.anchorNode);
      const focusLine = findLineElement(sel.focusNode);
      let startLine: number | null = null;
      let endLine: number | null = null;
      if (anchorLine) startLine = getLineNo(anchorLine);
      if (focusLine) endLine = getLineNo(focusLine);
      if (startLine !== null && endLine !== null && startLine > endLine) {
        [startLine, endLine] = [endLine, startLine];
      }

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      setSelectionToolbar({
        x: rect.left + rect.width / 2,
        y: rect.top - 8,
        filePath: fileAttr,
        hunkIndex: parseInt(hunkAttr, 10),
        selectedText,
        startLine,
        endLine,
      });
    }

    panel.addEventListener("mouseup", handleMouseUp);
    return () => panel.removeEventListener("mouseup", handleMouseUp);
  }, [loading]);

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
            annotations={state.annotations}
            focusedFile={focusedFile}
            onFileClick={handleFileClick}
          />
        </div>
        <div className="diff-panel" ref={diffPanelRef}>
          <DiffViewer
            files={state.files}
            annotations={state.annotations}
            focusedHunkKey={state.focusedHunkKey}
            onHunkAction={handleHunkAction}
            onLineClick={handleLineClick}
            onRemoveAnnotation={handleRemoveAnnotation}
            scrollToFile={scrollToFile}
          />
          {activeFeedback && (
            <div className="feedback-overlay">
              <div className="hunk-reference">
                {activeFeedback.filePath} — hunk #{activeFeedback.hunkIndex}
                {activeFeedback.startLine != null && activeFeedback.endLine != null && (
                  activeFeedback.startLine === activeFeedback.endLine
                    ? <>, line {activeFeedback.startLine}</>
                    : <>, lines {activeFeedback.startLine}-{activeFeedback.endLine}</>
                )}
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
