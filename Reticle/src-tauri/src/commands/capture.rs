use fast_image_resize::images::Image;
use fast_image_resize::Resizer;
use image::{DynamicImage, ImageFormat, RgbaImage};
use rayon::prelude::*;
use std::collections::HashMap;
use std::io::Cursor;
use tauri::command;
use xcap::{Monitor, Window};

#[derive(serde::Serialize)]
pub struct WindowInfo {
    id: String,
    title: String,
    app_name: String,
}

#[derive(serde::Serialize)]
pub struct MonitorInfo {
    id: u32,
    name: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    is_primary: bool,
}

/// Helper to resize image using SIMD-accelerated fast_image_resize
fn resize_image(image: RgbaImage, target_width: u32) -> Result<DynamicImage, String> {
    let width = image.width();
    let height = image.height();
    let target_height = (height as u64 * target_width as u64 / width as u64) as u32;

    // Create destination image container
    let mut dst_image = Image::new(
        target_width,
        target_height,
        fast_image_resize::PixelType::U8x4,
    );

    // Create Resizer instance
    let mut resizer = Resizer::new();

    // Resize
    // Note: fast_image_resize with "image" feature allows passing DynamicImage directly if it implements IntoImageView
    // We convert to Rgba8 first to ensure compatibility and consistent pixel type (U8x4)
    let src_view = Image::from_vec_u8(
        width,
        height,
        image.into_raw(),
        fast_image_resize::PixelType::U8x4,
    )
    .map_err(|e| e.to_string())?;

    resizer
        .resize(&src_view, &mut dst_image, None)
        .map_err(|e| e.to_string())?;

    // Convert back to DynamicImage
    let img_buffer = image::RgbaImage::from_raw(target_width, target_height, dst_image.into_vec())
        .ok_or("Failed to create image buffer")?;

    Ok(DynamicImage::ImageRgba8(img_buffer))
}

#[command]
pub fn get_monitors() -> Result<Vec<MonitorInfo>, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;

    let result = monitors
        .into_iter()
        .map(|m| MonitorInfo {
            id: m.id().unwrap_or(0),
            name: m.name().unwrap_or_else(|_| "Unknown Display".to_string()),
            x: m.x().unwrap_or(0),
            y: m.y().unwrap_or(0),
            width: m.width().unwrap_or(0),
            height: m.height().unwrap_or(0),
            is_primary: m.is_primary().unwrap_or(false),
        })
        .collect();

    Ok(result)
}

#[command]
pub fn get_monitor_previews() -> Result<HashMap<u32, Vec<u8>>, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;

    let results: HashMap<u32, Vec<u8>> = monitors
        .into_iter()
        .filter_map(|monitor| {
            let id = monitor.id().ok()?;
            let image = monitor.capture_image().ok()?;

            // Resize for thumbnail (max width 300px)
            let scaled = resize_image(image, 300).ok()?;

            // Pre-allocate buffer (approx 30KB for thumbnail)
            let mut bytes: Vec<u8> = Vec::with_capacity(30 * 1024);
            let mut cursor = Cursor::new(&mut bytes);

            // Use JPEG for thumbnails to reduce size and improve speed
            scaled.write_to(&mut cursor, ImageFormat::Jpeg).ok()?;

            Some((id, bytes))
        })
        .collect();

    Ok(results)
}

#[command]
pub fn get_window_thumbnails(ids: Vec<String>) -> Result<HashMap<String, Vec<u8>>, String> {
    let windows = Window::all().map_err(|e| e.to_string())?;

    // Filter windows that match the requested IDs
    let targets: Vec<Window> = windows
        .into_iter()
        .filter(|w| {
            w.id()
                .map(|id| ids.contains(&id.to_string()))
                .unwrap_or(false)
        })
        .collect();

    // Process in parallel using rayon
    let results: HashMap<String, Vec<u8>> = targets
        .par_iter()
        .filter_map(|window| {
            let id = window.id().ok()?.to_string();

            // Capture
            let image = window.capture_image().ok()?;

            // Resize for thumbnail (max width 300px)
            let scaled = resize_image(image, 300).ok()?;

            // Pre-allocate buffer
            let mut bytes: Vec<u8> = Vec::with_capacity(30 * 1024);
            let mut cursor = Cursor::new(&mut bytes);

            // Use JPEG for thumbnails to reduce size and improve speed
            scaled.write_to(&mut cursor, ImageFormat::Jpeg).ok()?;

            Some((id, bytes))
        })
        .collect();

    Ok(results)
}

#[command]
pub fn get_window_thumbnail(id: String) -> Result<Vec<u8>, String> {
    let windows = Window::all().map_err(|e| e.to_string())?;

    // Find window by ID
    let window = windows
        .into_iter()
        .find(|w| match w.id() {
            Ok(wid) => wid.to_string() == id,
            Err(_) => false,
        })
        .ok_or("Window not found")?;

    let image = window.capture_image().map_err(|e| e.to_string())?;

    // Resize for thumbnail (max width 300px)
    let scaled = resize_image(image, 300)?;

    let mut bytes: Vec<u8> = Vec::with_capacity(30 * 1024);
    let mut cursor = Cursor::new(&mut bytes);

    scaled
        .write_to(&mut cursor, ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;

    Ok(bytes)
}

#[command]
pub fn get_open_windows() -> Result<Vec<WindowInfo>, String> {
    let windows = Window::all().map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for window in windows {
        // Filter out minimized or invalid windows
        if window.is_minimized().unwrap_or(true) {
            continue;
        }

        // Get window properties safely
        let title = window.title().unwrap_or_default();
        let width = window.width().unwrap_or(0);
        let height = window.height().unwrap_or(0);

        // Skip windows with empty title or small size
        if title.trim().is_empty() || width == 0 || height == 0 {
            continue;
        }

        // Get ID safely
        let id = match window.id() {
            Ok(id) => id.to_string(),
            Err(_) => continue,
        };

        // xcap sometimes fails to get app_name due to permissions (GetModuleBaseNameW failed: WIN32_ERROR(5))
        // We shouldn't fail the whole window enumeration because of this.
        let app_name = window.app_name().unwrap_or_else(|_| String::from("Unknown App"));

        result.push(WindowInfo {
            id,
            title,
            app_name,
        });
    }

    Ok(result)
}

#[command]
pub fn capture_window(id: String) -> Result<Vec<u8>, String> {
    let windows = Window::all().map_err(|e| e.to_string())?;

    let window = windows
        .into_iter()
        .find(|w| match w.id() {
            Ok(wid) => wid.to_string() == id,
            Err(_) => false,
        })
        .ok_or("Window not found")?;

    let image = window.capture_image().map_err(|e| e.to_string())?;

    // Pre-allocate buffer (estimate 500KB for full window PNG)
    let mut bytes: Vec<u8> = Vec::with_capacity(500 * 1024);
    let mut cursor = Cursor::new(&mut bytes);

    image
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|e| e.to_string())?;

    Ok(bytes)
}

#[command]
pub fn capture_fullscreen(monitor_id: Option<u32>) -> Result<Vec<u8>, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;

    // Find target monitor
    let monitor = if let Some(id) = monitor_id {
        monitors
            .into_iter()
            .find(|m| m.id().unwrap_or(0) == id)
            .ok_or("Monitor not found")?
    } else {
        // Default to primary
        monitors
            .into_iter()
            .find(|m| m.is_primary().unwrap_or(false))
            .or_else(|| Monitor::all().unwrap().into_iter().next())
            .ok_or("No monitor found")?
    };

    let image = monitor.capture_image().map_err(|e| e.to_string())?;

    // Pre-allocate buffer (estimate 2MB for fullscreen PNG)
    let mut bytes: Vec<u8> = Vec::with_capacity(2 * 1024 * 1024);
    let mut cursor = Cursor::new(&mut bytes);

    // RgbaImage is compatible with write_to
    image
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|e| e.to_string())?;

    Ok(bytes)
}
