use arboard::Clipboard;
use chrono::Local;
use image::load_from_memory;
use std::fs;
use std::path::PathBuf;
use tauri::command;

#[command]
pub fn save_image(bytes: Vec<u8>, target_dir: Option<String>) -> Result<String, String> {
    // Use custom target_dir if provided, otherwise default to Pictures/Reticle
    let pictures_dir = if let Some(ref dir) = target_dir {
        PathBuf::from(dir)
    } else {
        dirs::picture_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Reticle")
    };

    if !pictures_dir.exists() {
        fs::create_dir_all(&pictures_dir).map_err(|e| e.to_string())?;
    }

    let timestamp = Local::now().format("%Y-%m-%d_%H-%M-%S");
    let filename = format!("Reticle_{}.png", timestamp);
    let path = pictures_dir.join(filename);

    fs::write(&path, bytes).map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().to_string())
}

#[command]
pub fn copy_to_clipboard(bytes: Vec<u8>) -> Result<(), String> {
    let image = load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let rgba = image.to_rgba8();

    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;

    let img_data = arboard::ImageData {
        width: rgba.width() as usize,
        height: rgba.height() as usize,
        bytes: std::borrow::Cow::Borrowed(rgba.as_raw()),
    };

    clipboard.set_image(img_data).map_err(|e| e.to_string())?;

    Ok(())
}

#[command]
pub fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())?;
    Ok(())
}
