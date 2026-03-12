use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;

#[derive(Clone, serde::Serialize)]
pub struct ExportProgress {
    pub phase: String,
    pub progress: f32,
    pub message: String,
}

/// Save temporary overlay WebM file from frontend
pub async fn save_temp_overlay(data: Vec<u8>) -> Result<String, String> {
    let temp_dir = std::env::temp_dir();
    let overlay_path = temp_dir.join(format!(
        "reticle_overlay_{}.webm",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    ));

    fs::write(&overlay_path, data).map_err(|e| format!("Failed to write overlay file: {}", e))?;

    Ok(overlay_path.to_string_lossy().to_string())
}

/// Export video with overlay compositing using FFmpeg
///
/// Strategy:
/// 1. Take original video (no overlays)
/// 2. Take overlay.webm (transparent WebM with cursor/keys/effects)
/// 3. Take audio tracks (system + mic)
/// 4. Composite using FFmpeg overlay filter
/// 5. Mix audio tracks
///
/// FFmpeg command structure:
/// ```
/// ffmpeg -i video.mp4 \
///        -i overlay.webm \
///        -i audio_sys.wav \
///        -i audio_mic.wav \
///        -filter_complex "[0:v][1:v]overlay=0:0[v]; \
///                         [2:a][3:a]amix=inputs=2:duration=first[a]" \
///        -map "[v]" -map "[a]" \
///        -c:v h264_nvenc -preset fast -crf 18 \
///        output.mp4
/// ```
pub async fn export_video_with_overlay(
    app: AppHandle,
    video_path: String,
    overlay_path: String,
    audio_system_path: String,
    audio_mic_path: String,
    output_path: String,
    codec: String,
    preset: String,
    crf: u32,
) -> Result<(), String> {
    use tauri_plugin_shell::process::CommandEvent;

    println!("[Export] Starting video export");
    println!("  Video: {}", video_path);
    println!("  Overlay: {}", overlay_path);
    println!("  Output: {}", output_path);
    println!("  Codec: {}, Preset: {}, CRF: {}", codec, preset, crf);

    // Validate inputs
    if !PathBuf::from(&video_path).exists() {
        return Err(format!("Video file not found: {}", video_path));
    }
    if !PathBuf::from(&overlay_path).exists() {
        return Err(format!("Overlay file not found: {}", overlay_path));
    }

    // Debug: Check overlay file size
    if let Ok(metadata) = fs::metadata(&overlay_path) {
        println!(
            "  Overlay file size: {} bytes ({:.2} MB)",
            metadata.len(),
            metadata.len() as f64 / 1024.0 / 1024.0
        );
    }

    // Check if audio files exist
    let has_system_audio = PathBuf::from(&audio_system_path).exists();
    let has_mic_audio = PathBuf::from(&audio_mic_path).exists();

    println!("  System audio: {}", has_system_audio);
    println!("  Mic audio: {}", has_mic_audio);

    // Build FFmpeg command
    let sidecar = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("FFmpeg not found: {}", e))?;

    let mut args = vec![
        "-y".to_string(), // Overwrite output
        "-i".to_string(),
        video_path.clone(),
        "-i".to_string(),
        overlay_path.clone(),
    ];

    // Add audio inputs
    let mut audio_input_count = 0;
    if has_system_audio {
        args.push("-i".to_string());
        args.push(audio_system_path.clone());
        audio_input_count += 1;
    }
    if has_mic_audio {
        args.push("-i".to_string());
        args.push(audio_mic_path.clone());
        audio_input_count += 1;
    }

    // Build filter_complex
    let mut filter_parts = vec![];

    // Video overlay with proper alpha handling
    // [0:v] - original video (base layer)
    // [1:v] - overlay video (transparent WebM with alpha)
    // Important: Use shortest=1 to match duration of base video
    filter_parts.push("[0:v]setsar=1[base]; [1:v]format=yuva420p,scale=iw:ih[ovr]; [base][ovr]overlay=0:0:format=auto:shortest=1[v]".to_string());

    // Audio mixing
    if audio_input_count > 0 {
        let audio_filter = match audio_input_count {
            1 => {
                if has_system_audio {
                    "[2:a]acopy[a]".to_string()
                } else {
                    "[2:a]acopy[a]".to_string()
                }
            }
            2 => {
                // Mix both audio tracks
                "[2:a][3:a]amix=inputs=2:duration=first:dropout_transition=2[a]".to_string()
            }
            _ => unreachable!(),
        };
        filter_parts.push(audio_filter);
    }

    let filter_complex = filter_parts.join("; ");

    args.push("-filter_complex".to_string());
    args.push(filter_complex);

    // Map outputs
    args.push("-map".to_string());
    args.push("[v]".to_string());

    if audio_input_count > 0 {
        args.push("-map".to_string());
        args.push("[a]".to_string());
    }

    // Video encoding settings
    args.push("-c:v".to_string());
    args.push(codec.clone());

    // Codec-specific settings
    if codec.starts_with("h264_") && codec != "libx264" {
        // Hardware encoder (NVENC, AMF, QSV)
        args.push("-preset".to_string());
        args.push(preset.clone());
        args.push("-rc".to_string());
        args.push("vbr".to_string());
        args.push("-cq".to_string());
        args.push(crf.to_string());
        args.push("-b:v".to_string());
        args.push("0".to_string()); // VBR mode
    } else {
        // Software encoder (libx264)
        args.push("-preset".to_string());
        args.push(preset.clone());
        args.push("-crf".to_string());
        args.push(crf.to_string());
    }

    // Audio encoding
    if audio_input_count > 0 {
        args.push("-c:a".to_string());
        args.push("aac".to_string());
        args.push("-b:a".to_string());
        args.push("192k".to_string());
    }

    // Pixel format for compatibility
    args.push("-pix_fmt".to_string());
    args.push("yuv420p".to_string());

    // Output
    args.push(output_path.clone());

    println!("[Export] FFmpeg command: ffmpeg {}", args.join(" "));

    // Spawn FFmpeg process
    let (mut rx, _child) = sidecar
        .args(&args)
        .spawn()
        .map_err(|e| format!("Failed to spawn FFmpeg: {}", e))?;

    // Monitor progress
    let app_clone = app.clone();
    let mut last_progress = 0.0;
    let mut stderr_buffer = String::new();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                let output = String::from_utf8_lossy(&line);
                stderr_buffer.push_str(&output);

                // Print all FFmpeg output for debugging
                if output.contains("Stream")
                    || output.contains("Video:")
                    || output.contains("Audio:")
                {
                    println!("[Export] FFmpeg: {}", output.trim());
                }

                // Parse FFmpeg progress
                // Example: "frame= 1234 fps=60 q=28.0 size= 10240kB time=00:00:20.56 bitrate=4096.0kbits/s speed=1.2x"
                if let Some(progress) = parse_ffmpeg_progress(&output) {
                    if progress > last_progress + 1.0 {
                        last_progress = progress;
                        let _ = app_clone.emit(
                            "export-progress",
                            ExportProgress {
                                phase: "compositing".to_string(),
                                progress,
                                message: format!("Compositing: {:.0}%", progress),
                            },
                        );
                    }
                }

                // Log errors
                if output.contains("Error")
                    || output.contains("error")
                    || output.contains("Invalid")
                {
                    eprintln!("[Export] FFmpeg ERROR: {}", output.trim());
                }
            }
            CommandEvent::Terminated(payload) => {
                if payload.code == Some(0) {
                    println!("[Export] FFmpeg completed successfully");
                    let _ = app_clone.emit(
                        "export-progress",
                        ExportProgress {
                            phase: "done".to_string(),
                            progress: 100.0,
                            message: "Export complete".to_string(),
                        },
                    );
                } else {
                    let error = format!("FFmpeg exited with code: {:?}", payload.code);
                    eprintln!("[Export] {}", error);
                    return Err(error);
                }
                break;
            }
            CommandEvent::Error(err) => {
                let error = format!("FFmpeg error: {}", err);
                eprintln!("[Export] {}", error);
                return Err(error);
            }
            _ => {}
        }
    }

    // Cleanup temporary overlay file (keep for debugging by default)
    // Set RETICLE_KEEP_OVERLAY=1 to keep the file, otherwise it's deleted
    let keep_overlay = std::env::var("RETICLE_KEEP_OVERLAY").is_ok()
        || std::env::var("RETICLE_DEBUG_EXPORT").is_ok();

    // Copy overlay to output directory for debugging
    let output_path_buf = PathBuf::from(&output_path);
    if let Some(output_dir) = output_path_buf.parent() {
        let debug_overlay_path = output_dir.join("debug_overlay.webm");
        if let Err(e) = fs::copy(&overlay_path, &debug_overlay_path) {
            eprintln!("[Export] Failed to copy overlay for debugging: {}", e);
        } else {
            println!(
                "[Export] Saved debug overlay to: {}",
                debug_overlay_path.display()
            );
        }
    }

    if keep_overlay {
        println!("[Export] Keeping temp overlay file at {}", overlay_path);
    } else {
        // For now, ALWAYS keep overlay for debugging
        println!(
            "[Export] Keeping temp overlay file for debugging at {}",
            overlay_path
        );
        // Uncomment to delete:
        // let _ = fs::remove_file(&overlay_path);
        // println!("[Export] Cleaned up temporary overlay file");
    }

    Ok(())
}

/// Convert an already-rendered MP4 (with overlays) to an animated GIF using FFmpeg.
///
/// Uses two-pass palettegen for best colour quality:
///   Pass 1: ffmpeg -i input.mp4 -vf "fps=N,scale=W:-1:flags=lanczos,palettegen" palette.png
///   Pass 2: ffmpeg -i input.mp4 -i palette.png
///              -vf "fps=N,scale=W:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5"
///              output.gif
pub async fn export_video_as_gif(
    app: AppHandle,
    video_path: String,
    output_path: String,
    fps: u32,
    width: u32,
    trim_start: Option<f64>,
    trim_end: Option<f64>,
) -> Result<(), String> {
    use tauri_plugin_shell::process::CommandEvent;

    println!("[GIF Export] Starting: {} -> {}", video_path, output_path);
    println!("  fps={}, width={}, trim={:?}-{:?}", fps, width, trim_start, trim_end);

    if !PathBuf::from(&video_path).exists() {
        return Err(format!("Video file not found: {}", video_path));
    }

    let temp_dir = std::env::temp_dir();
    let palette_path = temp_dir.join(format!(
        "reticle_palette_{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    ));

    let scale_filter = format!("fps={},scale={}:-1:flags=lanczos", fps, width);

    // --- Pass 1: generate palette ---
    {
        let sidecar = app
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| format!("FFmpeg not found: {}", e))?;

        let mut args = vec!["-y".to_string()];

        if let Some(ss) = trim_start {
            if ss > 0.0 {
                args.extend(["-ss".to_string(), ss.to_string()]);
            }
        }
        args.extend(["-i".to_string(), video_path.clone()]);
        if let Some(to) = trim_end {
            let duration = to - trim_start.unwrap_or(0.0);
            args.extend(["-t".to_string(), duration.to_string()]);
        }

        args.extend([
            "-vf".to_string(),
            format!("{},palettegen=stats_mode=diff", scale_filter),
            palette_path.to_string_lossy().to_string(),
        ]);

        let (mut rx, _child) = sidecar
            .args(&args)
            .spawn()
            .map_err(|e| format!("Failed to spawn FFmpeg (pass 1): {}", e))?;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Terminated(payload) => {
                    if payload.code != Some(0) {
                        return Err(format!("FFmpeg palette pass failed: {:?}", payload.code));
                    }
                    break;
                }
                CommandEvent::Error(err) => return Err(format!("FFmpeg error (pass 1): {}", err)),
                _ => {}
            }
        }
    }

    println!("[GIF Export] Palette generated, starting pass 2");
    let _ = app.emit("export-progress", ExportProgress {
        phase: "compositing".to_string(),
        progress: 40.0,
        message: "Generating GIF...".to_string(),
    });

    // --- Pass 2: render GIF using palette ---
    {
        let sidecar = app
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| format!("FFmpeg not found: {}", e))?;

        let mut args = vec!["-y".to_string()];

        if let Some(ss) = trim_start {
            if ss > 0.0 {
                args.extend(["-ss".to_string(), ss.to_string()]);
            }
        }
        args.extend(["-i".to_string(), video_path.clone()]);
        if let Some(to) = trim_end {
            let duration = to - trim_start.unwrap_or(0.0);
            args.extend(["-t".to_string(), duration.to_string()]);
        }

        args.extend([
            "-i".to_string(),
            palette_path.to_string_lossy().to_string(),
            "-lavfi".to_string(),
            format!(
                "{} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
                scale_filter
            ),
            output_path.clone(),
        ]);

        let app_clone = app.clone();
        let (mut rx, _child) = sidecar
            .args(&args)
            .spawn()
            .map_err(|e| format!("Failed to spawn FFmpeg (pass 2): {}", e))?;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    let out = String::from_utf8_lossy(&line);
                    if let Some(secs) = parse_ffmpeg_progress(&out) {
                        let pct = (40.0 + (secs / 1.0).min(55.0)).min(95.0);
                        let _ = app_clone.emit("export-progress", ExportProgress {
                            phase: "compositing".to_string(),
                            progress: pct,
                            message: format!("Encoding GIF: {:.0}s", secs),
                        });
                    }
                }
                CommandEvent::Terminated(payload) => {
                    if payload.code == Some(0) {
                        println!("[GIF Export] Done: {}", output_path);
                        let _ = app_clone.emit("export-progress", ExportProgress {
                            phase: "done".to_string(),
                            progress: 100.0,
                            message: "GIF export complete".to_string(),
                        });
                    } else {
                        return Err(format!("FFmpeg GIF pass failed: {:?}", payload.code));
                    }
                    break;
                }
                CommandEvent::Error(err) => return Err(format!("FFmpeg error (pass 2): {}", err)),
                _ => {}
            }
        }
    }

    // Cleanup palette temp file
    let _ = fs::remove_file(&palette_path);

    // Cleanup intermediate MP4 if it looks like a temp_gif file
    // (frontend passes the temp path as video_path for GIF conversion)
    if video_path.contains("_temp_gif") {
        if let Err(e) = fs::remove_file(&video_path) {
            eprintln!("[GIF Export] Failed to remove temp MP4: {}", e);
        } else {
            println!("[GIF Export] Removed temp MP4: {}", video_path);
        }
    }

    Ok(())
}

/// Parse FFmpeg progress from stderr output
/// Returns progress percentage (0-100)
fn parse_ffmpeg_progress(output: &str) -> Option<f32> {
    // Look for "time=HH:MM:SS.MS" in output
    if let Some(time_start) = output.find("time=") {
        let time_str = &output[time_start + 5..];
        if let Some(space_pos) = time_str.find(' ') {
            let time_part = &time_str[..space_pos];

            // Parse HH:MM:SS.MS
            let parts: Vec<&str> = time_part.split(':').collect();
            if parts.len() == 3 {
                if let (Ok(hours), Ok(mins), Ok(secs)) = (
                    parts[0].parse::<f32>(),
                    parts[1].parse::<f32>(),
                    parts[2].parse::<f32>(),
                ) {
                    let total_seconds = hours * 3600.0 + mins * 60.0 + secs;

                    // We need total duration to calculate percentage
                    // For now, return raw seconds (caller can calculate percentage)
                    // TODO: Get duration from video metadata
                    return Some(total_seconds);
                }
            }
        }
    }
    None
}
