use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

/// Video metadata returned by get_video_info
#[derive(Serialize)]
pub struct VideoInfo {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
}

/// A single thumbnail: base64-encoded JPEG image
#[derive(Serialize)]
pub struct Thumbnail {
    pub time: f64,
    pub data: String, // base64 JPEG
}

/// Get video metadata using ffmpeg -i (parses stderr output)
// #[tauri::command] - Removed to avoid duplicate definition
pub async fn get_video_info(app: AppHandle, path: String) -> Result<VideoInfo, String> {
    let sidecar = app.shell().sidecar("ffmpeg").map_err(|e| e.to_string())?;
    let (mut rx, _child) = sidecar
        .args(["-i", &path, "-hide_banner"])
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;

    let mut output = String::new();
    while let Some(event) = rx.recv().await {
        if let tauri_plugin_shell::process::CommandEvent::Stderr(line) = event {
            output.push_str(&String::from_utf8_lossy(&line));
        }
    }

    // Parse duration: "Duration: HH:MM:SS.ff"
    let duration = parse_duration(&output).unwrap_or(0.0);

    // Parse resolution: "1920x1080" or similar from "Video: ... 1920x1080"
    let (width, height) = parse_resolution(&output).unwrap_or((1920, 1080));

    // Parse FPS: "30 fps" or "29.97 fps"
    let fps = parse_fps(&output).unwrap_or(30.0);

    Ok(VideoInfo {
        duration,
        width,
        height,
        fps,
    })
}

/// Generate N thumbnail images at evenly-spaced intervals
// #[tauri::command] - Removed to avoid duplicate definition
pub async fn get_video_thumbnails(
    app: AppHandle,
    path: String,
    count: u32,
    thumb_width: Option<u32>,
) -> Result<Vec<Thumbnail>, String> {
    // First get duration
    let info = get_video_info(app.clone(), path.clone()).await?;
    if info.duration <= 0.0 {
        return Err("Video has zero duration".into());
    }

    let w = thumb_width.unwrap_or(160);
    let mut thumbnails = Vec::with_capacity(count as usize);
    let interval = info.duration / count as f64;

    for i in 0..count {
        let time = interval * i as f64;
        let time_str = format!("{:.3}", time);

        let sidecar = app.shell().sidecar("ffmpeg").map_err(|e| e.to_string())?;
        let (mut rx, _child) = sidecar
            .args([
                "-ss",
                &time_str,
                "-i",
                &path,
                "-vframes",
                "1",
                "-vf",
                &format!("scale={}:-1", w),
                "-f",
                "image2pipe",
                "-vcodec",
                "mjpeg",
                "-q:v",
                "8",
                "pipe:1",
            ])
            .spawn()
            .map_err(|e| format!("Failed to spawn ffmpeg for thumbnail: {}", e))?;

        let mut jpeg_data: Vec<u8> = Vec::new();
        while let Some(event) = rx.recv().await {
            if let tauri_plugin_shell::process::CommandEvent::Stdout(chunk) = event {
                jpeg_data.extend_from_slice(&chunk);
            }
        }

        if !jpeg_data.is_empty() {
            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg_data);
            thumbnails.push(Thumbnail { time, data: b64 });
        }
    }

    Ok(thumbnails)
}

/// Read and parse tracking.json from disk (heavy I/O on Rust side)
// #[tauri::command] - Removed to avoid duplicate definition
pub async fn read_tracking_data(path: String) -> Result<serde_json::Value, String> {
    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read tracking file: {}", e))?;

    let data: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse tracking JSON: {}", e))?;

    Ok(data)
}

// ---- Parsing helpers ----

fn parse_duration(output: &str) -> Option<f64> {
    // Matches "Duration: 00:01:23.45"
    let marker = "Duration: ";
    let start = output.find(marker)? + marker.len();
    let end = output[start..]
        .find(',')
        .map(|i| start + i)
        .unwrap_or(start + 11);
    let time_str = &output[start..end].trim();

    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() == 3 {
        let hours: f64 = parts[0].parse().ok()?;
        let minutes: f64 = parts[1].parse().ok()?;
        let seconds: f64 = parts[2].parse().ok()?;
        Some(hours * 3600.0 + minutes * 60.0 + seconds)
    } else {
        None
    }
}

fn parse_resolution(output: &str) -> Option<(u32, u32)> {
    // Matches patterns like "1920x1080" in video stream info
    let re_pattern = regex_lite::Regex::new(r"(\d{2,5})x(\d{2,5})").ok()?;
    // Find in the line containing "Video:"
    for line in output.lines() {
        if line.contains("Video:") {
            if let Some(caps) = re_pattern.captures(line) {
                let w: u32 = caps.get(1)?.as_str().parse().ok()?;
                let h: u32 = caps.get(2)?.as_str().parse().ok()?;
                if w >= 100 && h >= 100 {
                    return Some((w, h));
                }
            }
        }
    }
    None
}

fn parse_fps(output: &str) -> Option<f64> {
    // Matches "29.97 fps" or "30 fps"
    for line in output.lines() {
        if line.contains("Video:") {
            // Try to find "XX.XX fps" or "XX fps"
            if let Some(fps_idx) = line.find(" fps") {
                let before = &line[..fps_idx];
                let num_str = before.rsplit([' ', ',']).next()?;
                return num_str.trim().parse().ok();
            }
        }
    }
    None
}
