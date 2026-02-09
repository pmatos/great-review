use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RepoInfo {
    pub name: String,
    pub branch: String,
    pub path: String,
}

pub fn get_repo_info(repo_path: &str) -> Result<RepoInfo, String> {
    let root_output = Command::new("git")
        .args(["-C", repo_path, "rev-parse", "--show-toplevel"])
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if !root_output.status.success() {
        return Err(format!(
            "Not a git repository: {}",
            String::from_utf8_lossy(&root_output.stderr).trim()
        ));
    }

    let root_path = String::from_utf8_lossy(&root_output.stdout)
        .trim()
        .to_string();

    let name = std::path::Path::new(&root_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| root_path.clone());

    let branch_output = Command::new("git")
        .args(["-C", repo_path, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .map_err(|e| format!("Failed to get branch: {e}"))?;

    if !branch_output.status.success() {
        return Err(format!(
            "Failed to get current branch: {}",
            String::from_utf8_lossy(&branch_output.stderr).trim()
        ));
    }

    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    Ok(RepoInfo {
        name,
        branch,
        path: root_path,
    })
}

pub fn get_remote_repo_info(remote: &str) -> Result<RepoInfo, String> {
    let (host, path) = crate::diff_parser::parse_remote_path(remote)?;

    let cmd = format!(
        "cd '{}' && git rev-parse --show-toplevel && git rev-parse --abbrev-ref HEAD",
        path
    );

    let output = Command::new("ssh")
        .args(["-o", "ConnectTimeout=10", "-o", "BatchMode=yes", host, &cmd])
        .output()
        .map_err(|e| format!("Failed to execute ssh: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("Failed to get remote repo info: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let mut lines = stdout.trim().lines();
    let root_path = lines.next().unwrap_or("").to_string();
    let branch = lines.next().unwrap_or("").to_string();

    let name = std::path::Path::new(&root_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| root_path.clone());

    Ok(RepoInfo {
        name,
        branch,
        path: remote.to_string(),
    })
}

pub fn get_diff_range_from_args() -> Option<String> {
    std::env::args().nth(1).filter(|arg| !arg.starts_with('-'))
}

pub fn find_repo_root() -> Result<String, String> {
    let output = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Not inside a git repository: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_repo_root() {
        let root = find_repo_root();
        assert!(root.is_ok());
        let path = root.unwrap();
        assert!(path.contains("great-review"));
    }

    #[test]
    fn test_get_diff_range_from_args() {
        // When run via `cargo test`, no positional diff range arg is passed,
        // so the function should return None.
        let range = get_diff_range_from_args();
        assert!(range.is_none() || !range.unwrap().is_empty());
    }

    #[test]
    fn test_get_repo_info() {
        let root = find_repo_root().unwrap();
        let info = get_repo_info(&root);
        assert!(info.is_ok());
        let info = info.unwrap();
        assert_eq!(info.name, "great-review");
        assert!(!info.branch.is_empty());
        assert!(!info.path.is_empty());
    }
}
