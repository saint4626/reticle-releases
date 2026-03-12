use hex;
use machine_uid;
use sha2::{Digest, Sha256};
use std::process::Command;
use tauri::{AppHandle, Manager, Runtime};

#[tauri::command]
pub fn get_hwid() -> Result<String, String> {
    let machine_id = machine_uid::get().map_err(|e| e.to_string())?;
    let app_secret = env!("RETICLE_SALT");
    let mut hasher = Sha256::new();
    hasher.update(format!("{}{}", machine_id, app_secret));
    let result = hasher.finalize();
    Ok(hex::encode(result))
}

#[tauri::command]
pub fn open_log_folder<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(log_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(log_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(log_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
