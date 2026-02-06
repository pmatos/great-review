use tauri_plugin_cli::CliExt;

use crate::diff_parser::{self, DiffFile};
use crate::repo_info::{self, RepoInfo};

#[tauri::command]
pub fn get_diff(range: Option<String>) -> Result<Vec<DiffFile>, String> {
    let repo_root = repo_info::find_repo_root()?;
    let diff_text = diff_parser::run_git_diff(range.as_deref(), &repo_root)?;
    Ok(diff_parser::parse_unified_diff(&diff_text))
}

#[tauri::command]
pub fn get_repo_info_cmd() -> Result<RepoInfo, String> {
    let repo_root = repo_info::find_repo_root()?;
    repo_info::get_repo_info(&repo_root)
}

#[tauri::command]
pub fn get_startup_args(app: tauri::AppHandle) -> Result<Option<String>, String> {
    match app.cli().matches() {
        Ok(matches) => {
            if let Some(arg) = matches.args.get("range") {
                if let Some(s) = arg.value.as_str() {
                    if !s.is_empty() {
                        return Ok(Some(s.to_string()));
                    }
                }
                Ok(None)
            } else {
                Ok(None)
            }
        }
        Err(e) => Err(format!("Failed to parse CLI args: {}", e)),
    }
}
