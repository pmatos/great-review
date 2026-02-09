use serde::Serialize;
use tauri_plugin_cli::CliExt;

use crate::diff_parser::{self, DiffFile};
use crate::repo_info::{self, RepoInfo};

#[derive(Serialize)]
pub struct StartupArgs {
    pub range: Option<String>,
    pub remote: Option<String>,
}

#[tauri::command]
pub fn get_diff(range: Option<String>, remote: Option<String>) -> Result<Vec<DiffFile>, String> {
    let diff_text = if let Some(ref r) = remote {
        diff_parser::run_remote_git_diff(r, range.as_deref())?
    } else {
        let repo_root = repo_info::find_repo_root()?;
        diff_parser::run_git_diff(range.as_deref(), &repo_root)?
    };
    Ok(diff_parser::parse_unified_diff(&diff_text))
}

#[tauri::command]
pub fn get_repo_info_cmd(remote: Option<String>) -> Result<RepoInfo, String> {
    if let Some(ref r) = remote {
        repo_info::get_remote_repo_info(r)
    } else {
        let repo_root = repo_info::find_repo_root()?;
        repo_info::get_repo_info(&repo_root)
    }
}

fn extract_optional_arg(matches: &tauri_plugin_cli::Matches, name: &str) -> Option<String> {
    matches.args.get(name).and_then(|arg| {
        arg.value.as_str().and_then(|s| {
            if s.is_empty() { None } else { Some(s.to_string()) }
        })
    })
}

#[tauri::command]
pub fn get_startup_args(app: tauri::AppHandle) -> Result<StartupArgs, String> {
    match app.cli().matches() {
        Ok(matches) => Ok(StartupArgs {
            range: extract_optional_arg(&matches, "range"),
            remote: extract_optional_arg(&matches, "remote"),
        }),
        Err(e) => Err(format!("Failed to parse CLI args: {}", e)),
    }
}
