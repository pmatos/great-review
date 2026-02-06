mod commands;
pub mod diff_parser;
pub mod repo_info;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_cli::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_diff,
            commands::get_repo_info_cmd,
            commands::get_startup_args,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
