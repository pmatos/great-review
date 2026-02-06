use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum LineType {
    Addition,
    Deletion,
    Context,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DiffLine {
    pub content: String,
    pub line_type: LineType,
    pub old_line_no: Option<u32>,
    pub new_line_no: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub old_count: u32,
    pub new_start: u32,
    pub new_count: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DiffFile {
    pub path: String,
    pub old_path: Option<String>,
    pub hunks: Vec<DiffHunk>,
    pub status: FileStatus,
}

fn parse_hunk_header(line: &str) -> Option<(u32, u32, u32, u32)> {
    let line = line.strip_prefix("@@ ")?;
    let end = line.find(" @@")?;
    let range_part = &line[..end];

    let mut parts = range_part.split_whitespace();
    let old_range = parts.next()?.strip_prefix('-')?;
    let new_range = parts.next()?.strip_prefix('+')?;

    let (old_start, old_count) = parse_range(old_range);
    let (new_start, new_count) = parse_range(new_range);

    Some((old_start, old_count, new_start, new_count))
}

fn parse_range(range: &str) -> (u32, u32) {
    if let Some((start, count)) = range.split_once(',') {
        (start.parse().unwrap_or(0), count.parse().unwrap_or(0))
    } else {
        (range.parse().unwrap_or(0), 1)
    }
}

pub fn parse_unified_diff(diff_text: &str) -> Vec<DiffFile> {
    let mut files: Vec<DiffFile> = Vec::new();
    let lines: Vec<&str> = diff_text.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];

        if line.starts_with("diff --git ") {
            let mut path = String::new();
            let mut old_path: Option<String> = None;
            let mut status = FileStatus::Modified;
            let mut hunks: Vec<DiffHunk> = Vec::new();

            // Extract path from "diff --git a/path b/path"
            if let Some(b_pos) = line.rfind(" b/") {
                path = line[b_pos + 3..].to_string();
            }

            i += 1;

            // Parse file metadata lines
            while i < lines.len() && !lines[i].starts_with("diff --git ") {
                let line = lines[i];

                if line.starts_with("new file mode") {
                    status = FileStatus::Added;
                } else if line.starts_with("deleted file mode") {
                    status = FileStatus::Deleted;
                } else if let Some(from) = line.strip_prefix("rename from ") {
                    old_path = Some(from.to_string());
                    status = FileStatus::Renamed;
                } else if let Some(to) = line.strip_prefix("rename to ") {
                    path = to.to_string();
                } else if line.starts_with("Binary files") {
                    // Skip binary files entirely
                    break;
                } else if line.starts_with("--- ") {
                    // old file path; we already have it from the header
                } else if line.starts_with("+++ ") {
                    // new file path; we already have it from the header
                } else if line.starts_with("@@ ") {
                    if let Some((old_start, old_count, new_start, new_count)) =
                        parse_hunk_header(line)
                    {
                        let header = line.to_string();
                        let mut hunk_lines: Vec<DiffLine> = Vec::new();
                        let mut old_line = old_start;
                        let mut new_line = new_start;

                        i += 1;

                        while i < lines.len() {
                            let hline = lines[i];

                            if hline.starts_with("diff --git ") || hline.starts_with("@@ ") {
                                break;
                            }

                            if hline == "\\ No newline at end of file" {
                                i += 1;
                                continue;
                            }

                            if let Some(content) = hline.strip_prefix('+') {
                                hunk_lines.push(DiffLine {
                                    content: content.to_string(),
                                    line_type: LineType::Addition,
                                    old_line_no: None,
                                    new_line_no: Some(new_line),
                                });
                                new_line += 1;
                            } else if let Some(content) = hline.strip_prefix('-') {
                                hunk_lines.push(DiffLine {
                                    content: content.to_string(),
                                    line_type: LineType::Deletion,
                                    old_line_no: Some(old_line),
                                    new_line_no: None,
                                });
                                old_line += 1;
                            } else if let Some(content) = hline.strip_prefix(' ') {
                                hunk_lines.push(DiffLine {
                                    content: content.to_string(),
                                    line_type: LineType::Context,
                                    old_line_no: Some(old_line),
                                    new_line_no: Some(new_line),
                                });
                                old_line += 1;
                                new_line += 1;
                            } else {
                                // Unknown line format, skip
                                i += 1;
                                continue;
                            }

                            i += 1;
                        }

                        hunks.push(DiffHunk {
                            header,
                            old_start,
                            old_count,
                            new_start,
                            new_count,
                            lines: hunk_lines,
                        });

                        continue; // Don't increment i, already at next line
                    }
                } else {
                    // Other metadata lines (index, similarity, etc.)
                }

                i += 1;
            }

            files.push(DiffFile {
                path,
                old_path,
                hunks,
                status,
            });
        } else {
            i += 1;
        }
    }

    files
}

pub fn run_git_diff(range: Option<&str>, repo_path: &str) -> Result<String, String> {
    let args = match range {
        Some(r) => vec!["diff", r],
        None => vec!["diff", "HEAD"],
    };

    let output = Command::new("git")
        .args(&args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to execute git diff: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else if range.is_none() {
        // Fallback: git diff (no HEAD) for repos with no commits
        let fallback = Command::new("git")
            .args(["diff"])
            .current_dir(repo_path)
            .output()
            .map_err(|e| format!("Failed to execute git diff fallback: {}", e))?;

        if fallback.status.success() {
            Ok(String::from_utf8_lossy(&fallback.stdout).to_string())
        } else {
            Err(String::from_utf8_lossy(&fallback.stderr).to_string())
        }
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_additions_only() {
        let diff = "\
diff --git a/hello.txt b/hello.txt
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/hello.txt
@@ -0,0 +1,3 @@
+line one
+line two
+line three
";
        let files = parse_unified_diff(diff);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "hello.txt");
        assert_eq!(files[0].status, FileStatus::Added);
        assert_eq!(files[0].hunks.len(), 1);
        assert_eq!(files[0].hunks[0].lines.len(), 3);
        for line in &files[0].hunks[0].lines {
            assert_eq!(line.line_type, LineType::Addition);
            assert!(line.old_line_no.is_none());
            assert!(line.new_line_no.is_some());
        }
    }

    #[test]
    fn test_parse_deletions_only() {
        let diff = "\
diff --git a/old.txt b/old.txt
deleted file mode 100644
index abc1234..0000000
--- a/old.txt
+++ /dev/null
@@ -1,3 +0,0 @@
-first line
-second line
-third line
";
        let files = parse_unified_diff(diff);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, FileStatus::Deleted);
        assert_eq!(files[0].hunks[0].lines.len(), 3);
        for line in &files[0].hunks[0].lines {
            assert_eq!(line.line_type, LineType::Deletion);
            assert!(line.old_line_no.is_some());
            assert!(line.new_line_no.is_none());
        }
    }

    #[test]
    fn test_parse_mixed_changes() {
        let diff = "\
diff --git a/file.txt b/file.txt
index abc1234..def5678 100644
--- a/file.txt
+++ b/file.txt
@@ -1,5 +1,5 @@
 line one
-line two old
+line two new
 line three
-line four old
+line four new
";
        let files = parse_unified_diff(diff);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, FileStatus::Modified);
        let lines = &files[0].hunks[0].lines;
        assert_eq!(lines.len(), 6);
        assert_eq!(lines[0].line_type, LineType::Context);
        assert_eq!(lines[1].line_type, LineType::Deletion);
        assert_eq!(lines[2].line_type, LineType::Addition);
        assert_eq!(lines[3].line_type, LineType::Context);
        assert_eq!(lines[4].line_type, LineType::Deletion);
        assert_eq!(lines[5].line_type, LineType::Addition);
    }

    #[test]
    fn test_parse_multiple_files() {
        let diff = "\
diff --git a/a.txt b/a.txt
index abc..def 100644
--- a/a.txt
+++ b/a.txt
@@ -1,2 +1,2 @@
 unchanged
-old a
+new a
diff --git a/b.txt b/b.txt
index 111..222 100644
--- a/b.txt
+++ b/b.txt
@@ -1,2 +1,2 @@
 unchanged
-old b
+new b
";
        let files = parse_unified_diff(diff);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "a.txt");
        assert_eq!(files[1].path, "b.txt");
    }

    #[test]
    fn test_parse_renamed_file() {
        let diff = "\
diff --git a/old_name.txt b/new_name.txt
similarity index 100%
rename from old_name.txt
rename to new_name.txt
";
        let files = parse_unified_diff(diff);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "new_name.txt");
        assert_eq!(files[0].old_path, Some("old_name.txt".to_string()));
        assert_eq!(files[0].status, FileStatus::Renamed);
    }

    #[test]
    fn test_parse_new_file() {
        let diff = "\
diff --git a/new.rs b/new.rs
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/new.rs
@@ -0,0 +1,2 @@
+fn main() {}
+// done
";
        let files = parse_unified_diff(diff);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, FileStatus::Added);
        assert_eq!(files[0].hunks[0].lines.len(), 2);
        assert_eq!(files[0].hunks[0].lines[0].content, "fn main() {}");
    }

    #[test]
    fn test_parse_deleted_file() {
        let diff = "\
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index abc1234..0000000
--- a/gone.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-goodbye
";
        let files = parse_unified_diff(diff);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, FileStatus::Deleted);
        assert_eq!(files[0].hunks[0].lines.len(), 1);
        assert_eq!(files[0].hunks[0].lines[0].content, "goodbye");
        assert_eq!(files[0].hunks[0].lines[0].line_type, LineType::Deletion);
    }

    #[test]
    fn test_parse_binary_files_skipped() {
        let diff = "\
diff --git a/image.png b/image.png
new file mode 100644
Binary files /dev/null and b/image.png differ
diff --git a/text.txt b/text.txt
index abc..def 100644
--- a/text.txt
+++ b/text.txt
@@ -1,1 +1,1 @@
-old
+new
";
        let files = parse_unified_diff(diff);
        assert_eq!(files.len(), 2);
        // Binary file should have no hunks
        assert_eq!(files[0].path, "image.png");
        assert!(files[0].hunks.is_empty());
        // Text file should parse normally
        assert_eq!(files[1].path, "text.txt");
        assert_eq!(files[1].hunks.len(), 1);
    }

    #[test]
    fn test_parse_empty_diff() {
        let files = parse_unified_diff("");
        assert!(files.is_empty());
    }

    #[test]
    fn test_line_numbers() {
        let diff = "\
diff --git a/nums.txt b/nums.txt
index abc..def 100644
--- a/nums.txt
+++ b/nums.txt
@@ -10,4 +10,4 @@
 context at 10
-deleted at 11
+added at 11
 context at 12
";
        let files = parse_unified_diff(diff);
        let lines = &files[0].hunks[0].lines;

        // Context line at old=10, new=10
        assert_eq!(lines[0].old_line_no, Some(10));
        assert_eq!(lines[0].new_line_no, Some(10));

        // Deletion at old=11
        assert_eq!(lines[1].old_line_no, Some(11));
        assert!(lines[1].new_line_no.is_none());

        // Addition at new=11
        assert!(lines[2].old_line_no.is_none());
        assert_eq!(lines[2].new_line_no, Some(11));

        // Context at old=12, new=12
        assert_eq!(lines[3].old_line_no, Some(12));
        assert_eq!(lines[3].new_line_no, Some(12));
    }

    #[test]
    fn test_no_newline_at_end() {
        let diff = "\
diff --git a/no_nl.txt b/no_nl.txt
index abc..def 100644
--- a/no_nl.txt
+++ b/no_nl.txt
@@ -1,1 +1,1 @@
-old content
\\ No newline at end of file
+new content
\\ No newline at end of file
";
        let files = parse_unified_diff(diff);
        let lines = &files[0].hunks[0].lines;
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].line_type, LineType::Deletion);
        assert_eq!(lines[0].content, "old content");
        assert_eq!(lines[1].line_type, LineType::Addition);
        assert_eq!(lines[1].content, "new content");
    }

    #[test]
    fn test_multiple_hunks_in_one_file() {
        let diff = "\
diff --git a/multi.txt b/multi.txt
index abc..def 100644
--- a/multi.txt
+++ b/multi.txt
@@ -1,3 +1,3 @@
 first
-old second
+new second
 third
@@ -20,3 +20,3 @@
 twentieth
-old twentyfirst
+new twentyfirst
 twentysecond
";
        let files = parse_unified_diff(diff);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].hunks.len(), 2);

        assert_eq!(files[0].hunks[0].old_start, 1);
        assert_eq!(files[0].hunks[0].new_start, 1);
        assert_eq!(files[0].hunks[0].lines.len(), 4);

        assert_eq!(files[0].hunks[1].old_start, 20);
        assert_eq!(files[0].hunks[1].new_start, 20);
        assert_eq!(files[0].hunks[1].lines.len(), 4);
    }
}
