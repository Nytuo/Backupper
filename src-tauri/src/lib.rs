mod commands;
pub mod config;
pub mod errors;
pub mod restic;
pub mod updater;

#[cfg(desktop)]
use tauri::Emitter;

struct AppHandleEmitter(tauri::AppHandle);

impl restic::ProgressEmitter for AppHandleEmitter {
    fn emit(&self, event_name: &'static str, payload: serde_json::Value) {
        let _ = tauri::Emitter::emit(&self.0, event_name, payload);
    }
}

fn init_keyring_store() {
    #[cfg(target_os = "macos")]
    if let Ok(store) = apple_native_keyring_store::keychain::Store::new() {
        keyring_core::set_default_store(store);
    }
    #[cfg(target_os = "windows")]
    if let Ok(store) = windows_native_keyring_store::Store::new() {
        keyring_core::set_default_store(store);
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    if let Ok(store) = zbus_secret_service_keyring_store::Store::new() {
        keyring_core::set_default_store(store);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_keyring_store();

    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                let update_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(3000)).await;
                    match updater::check_for_update(update_handle.clone()).await {
                        Ok(Some(info)) => {
                            let _ = update_handle.emit("updater-update-available", &info);
                        }
                        Ok(None) => {}
                        Err(e) => eprintln!("[updater] check failed: {e}"),
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::detect_restic,
            commands::list_repos,
            commands::create_repo,
            commands::update_repo,
            commands::run_backup,
            commands::list_snapshots,
            commands::list_snapshot_files,
            commands::restore_snapshot,
            commands::add_replica,
            commands::run_replicate,
            updater::check_for_update,
            updater::install_update,
            updater::open_releases_page,
            updater::restart_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
