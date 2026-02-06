import { createContext, useContext, useReducer, ReactNode, createElement } from "react";
import { DiffFile, HunkReview, RepoInfo } from "./types";

export interface ReviewState {
  files: DiffFile[];
  reviews: Record<string, HunkReview>;
  focusedHunkKey: string | null;
  repoInfo: RepoInfo | null;
}

type ReviewAction =
  | { type: "SET_DIFF"; files: DiffFile[] }
  | { type: "SET_REPO_INFO"; info: RepoInfo }
  | { type: "SET_REVIEW"; key: string; review: HunkReview }
  | { type: "CLEAR_REVIEW"; key: string }
  | { type: "SET_FOCUSED_HUNK"; key: string | null };

const initialState: ReviewState = {
  files: [],
  reviews: {},
  focusedHunkKey: null,
  repoInfo: null,
};

function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case "SET_DIFF":
      return { ...state, files: action.files };
    case "SET_REPO_INFO":
      return { ...state, repoInfo: action.info };
    case "SET_REVIEW": {
      return { ...state, reviews: { ...state.reviews, [action.key]: action.review } };
    }
    case "CLEAR_REVIEW": {
      const { [action.key]: _, ...rest } = state.reviews;
      void _;
      return { ...state, reviews: rest };
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
  for (const review of Object.values(state.reviews)) {
    if (review.decision === "approved") approved++;
    else if (review.decision === "commented") commented++;
    else if (review.decision === "rejected") rejected++;
  }
  return { total, reviewed: approved + commented + rejected, approved, commented, rejected };
}

export function isAllReviewed(state: ReviewState): boolean {
  const { total, reviewed } = getReviewProgress(state);
  return total > 0 && reviewed >= total;
}
