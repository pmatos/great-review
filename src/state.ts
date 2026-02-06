import { createContext, useContext, useReducer, ReactNode, createElement } from "react";
import { DiffFile, HunkAnnotation, RepoInfo } from "./types";

export interface ReviewState {
  files: DiffFile[];
  annotations: Record<string, HunkAnnotation[]>;
  focusedHunkKey: string | null;
  repoInfo: RepoInfo | null;
}

type ReviewAction =
  | { type: "SET_DIFF"; files: DiffFile[] }
  | { type: "SET_REPO_INFO"; info: RepoInfo }
  | { type: "ADD_ANNOTATION"; key: string; annotation: HunkAnnotation }
  | { type: "REMOVE_ANNOTATION"; key: string; annotationId: string }
  | { type: "CLEAR_ANNOTATIONS"; key: string }
  | { type: "SET_FOCUSED_HUNK"; key: string | null };

const initialState: ReviewState = {
  files: [],
  annotations: {},
  focusedHunkKey: null,
  repoInfo: null,
};

function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case "SET_DIFF":
      return { ...state, files: action.files };
    case "SET_REPO_INFO":
      return { ...state, repoInfo: action.info };
    case "ADD_ANNOTATION": {
      const existing = state.annotations[action.key] ?? [];
      return {
        ...state,
        annotations: {
          ...state.annotations,
          [action.key]: [...existing, action.annotation],
        },
      };
    }
    case "REMOVE_ANNOTATION": {
      const list = state.annotations[action.key];
      if (!list) return state;
      const filtered = list.filter((a) => a.id !== action.annotationId);
      if (filtered.length === 0) {
        const { [action.key]: _, ...rest } = state.annotations;
        void _;
        return { ...state, annotations: rest };
      }
      return { ...state, annotations: { ...state.annotations, [action.key]: filtered } };
    }
    case "CLEAR_ANNOTATIONS": {
      const { [action.key]: _, ...rest } = state.annotations;
      void _;
      return { ...state, annotations: rest };
    }
    case "SET_FOCUSED_HUNK":
      return { ...state, focusedHunkKey: action.key };
  }
}

interface ReviewContextValue {
  state: ReviewState;
  dispatch: React.Dispatch<ReviewAction>;
}

const ReviewContext = createContext<ReviewContextValue | null>(null);

export function ReviewProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reviewReducer, initialState);
  return createElement(ReviewContext.Provider, { value: { state, dispatch } }, children);
}

export function useReviewState(): ReviewContextValue {
  const ctx = useContext(ReviewContext);
  if (!ctx) throw new Error("useReviewState must be used within ReviewProvider");
  return ctx;
}

export function getHunkKey(filePath: string, hunkIndex: number): string {
  return `${filePath}::${hunkIndex}`;
}

export function getReviewProgress(state: ReviewState): {
  total: number;
  reviewed: number;
  approved: number;
  commented: number;
  rejected: number;
} {
  let total = 0;
  for (const file of state.files) {
    total += file.hunks.length;
  }
  let approved = 0;
  let commented = 0;
  let rejected = 0;
  for (const file of state.files) {
    for (let i = 0; i < file.hunks.length; i++) {
      const key = getHunkKey(file.path, i);
      const anns = state.annotations[key];
      if (anns && anns.length > 0) {
        // A hunk counts once toward the most "severe" decision in its annotations
        const hasRejected = anns.some((a) => a.decision === "rejected");
        const hasCommented = anns.some((a) => a.decision === "commented");
        if (hasRejected) rejected++;
        else if (hasCommented) commented++;
        else approved++;
      }
    }
  }
  return { total, reviewed: approved + commented + rejected, approved, commented, rejected };
}

export function isAllReviewed(state: ReviewState): boolean {
  const { total, reviewed } = getReviewProgress(state);
  return total > 0 && reviewed >= total;
}
