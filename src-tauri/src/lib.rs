mod catalog;
mod commands;
mod error;
mod migration;
mod models;
mod store;

use std::path::PathBuf;

use catalog::ProjectCatalog;
use commands::AppState;
use tokio::sync::Mutex;

fn legacy_user_data_directory() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("project-manager")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let catalog = ProjectCatalog::new(&legacy_user_data_directory());
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            catalog: Mutex::new(catalog),
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_catalog,
            commands::open_project_in_ide,
            commands::open_project_folder,
            commands::open_project_repository,
            commands::run_project_action,
            commands::update_project,
            commands::delete_project,
            commands::create_category,
            commands::update_settings,
            commands::create_empty_project,
            commands::preview_import_migration,
            commands::import_existing_project,
            commands::get_migration_plan,
            commands::execute_migrations,
            commands::retry_migration_cleanup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Tauri application");
}
