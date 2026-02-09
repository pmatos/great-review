import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { DiffFile, RepoInfo, StartupArgs } from "./types";

export async function fetchDiff(range?: string, remote?: string): Promise<DiffFile[]> {
  return invoke<DiffFile[]>("get_diff", { range: range ?? null, remote: remote ?? null });
}

export async function fetchRepoInfo(remote?: string): Promise<RepoInfo> {
  return invoke<RepoInfo>("get_repo_info_cmd", { remote: remote ?? null });
}

export async function fetchStartupArgs(): Promise<StartupArgs> {
  return invoke<StartupArgs>("get_startup_args");
}

export async function copyToClipboard(text: string): Promise<void> {
  await writeText(text);
}
