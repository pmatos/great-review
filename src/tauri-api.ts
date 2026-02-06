import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { DiffFile, RepoInfo } from "./types";

export async function fetchDiff(range?: string): Promise<DiffFile[]> {
  return invoke<DiffFile[]>("get_diff", { range: range ?? null });
}

export async function fetchRepoInfo(): Promise<RepoInfo> {
  return invoke<RepoInfo>("get_repo_info_cmd");
}

export async function fetchStartupArgs(): Promise<string | null> {
  return invoke<string | null>("get_startup_args");
}

export async function copyToClipboard(text: string): Promise<void> {
  await writeText(text);
}
