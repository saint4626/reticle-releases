use crate::audio::{AudioDevice, AudioRecorder};
use crate::video::recorder::{self, CodecInfo, VideoRecorderState};
use crate::video::webcam::WebcamDevice;
use tauri::AppHandle;

#[tauri::command]
pub async fn get_available_codecs(app: AppHandle) -> Result<Vec<CodecInfo>, String> {
    recorder::check_available_codecs(app).await
}

#[tauri::command]
pub async fn get_audio_devices() -> Result<Vec<AudioDevice>, String> {
    AudioRecorder::enumerate_input_devices()
}

#[tauri::command]
pub async fn get_webcams() -> Result<Vec<WebcamDevice>, String> {
    crate::video::webcam::WebcamRecorder::enumerate()
}

#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    state: tauri::State<'_, VideoRecorderState>,
    target: String,
    id: Option<String>,
    fps: Option<u64>,
    warmup: Option<bool>,
    mic_device: Option<String>, // Optional specific mic
    enable_mic: Option<bool>,
    enable_sys: Option<bool>,
    capture_cursor: Option<bool>,
    webcam_device: Option<String>,
    enable_webcam: Option<bool>,
    video_codec: Option<String>,
    video_output_dir: Option<String>,
) -> Result<(), String> {
    recorder::start_video_record(
        app,
        state,
        target,
        id,
        fps,
        warmup,
        mic_device,
        enable_mic,
        enable_sys,
        capture_cursor,
        webcam_device,
        enable_webcam,
        video_codec,
        video_output_dir,
    )
    .await
}

#[tauri::command]
pub async fn confirm_recording(state: tauri::State<'_, VideoRecorderState>) -> Result<(), String> {
    recorder::confirm_video_record(state).await
}

#[tauri::command]
pub async fn pause_recording(state: tauri::State<'_, VideoRecorderState>) -> Result<(), String> {
    recorder::pause_video_record(state).await
}

#[tauri::command]
pub async fn resume_recording(state: tauri::State<'_, VideoRecorderState>) -> Result<(), String> {
    recorder::resume_video_record(state).await
}

#[tauri::command]
pub async fn set_mic_muted(
    state: tauri::State<'_, VideoRecorderState>,
    muted: bool,
) -> Result<(), String> {
    recorder::set_mic_muted(state, muted)
}

#[tauri::command]
pub async fn set_sys_muted(
    state: tauri::State<'_, VideoRecorderState>,
    muted: bool,
) -> Result<(), String> {
    recorder::set_sys_muted(state, muted)
}

#[tauri::command]
pub async fn start_audio_preview(
    app: AppHandle,
    state: tauri::State<'_, VideoRecorderState>,
    device_name: Option<String>,
) -> Result<(), String> {
    let mut audio_recorder = state.audio_recorder.lock().unwrap();
    // Stop any existing streams first
    audio_recorder.stop();
    audio_recorder
        .start_mic_preview(device_name, app)
        .map(|_| ())
}

#[tauri::command]
pub async fn stop_audio_preview(state: tauri::State<'_, VideoRecorderState>) -> Result<(), String> {
    let mut audio_recorder = state.audio_recorder.lock().unwrap();
    audio_recorder.stop();
    Ok(())
}

#[tauri::command]
pub async fn stop_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, recorder::VideoRecorderState>,
) -> Result<(), String> {
    recorder::stop_video_record(app, state).await
}

// --- Video Editor commands (delegate to video::editor) ---

#[tauri::command]
pub async fn get_video_info(
    app: AppHandle,
    path: String,
) -> Result<crate::video::editor::VideoInfo, String> {
    crate::video::editor::get_video_info(app, path).await
}

#[tauri::command]
pub async fn get_video_thumbnails(
    app: AppHandle,
    path: String,
    count: u32,
    thumb_width: Option<u32>,
) -> Result<Vec<crate::video::editor::Thumbnail>, String> {
    crate::video::editor::get_video_thumbnails(app, path, count, thumb_width).await
}

#[tauri::command]
pub async fn read_tracking_data(path: String) -> Result<serde_json::Value, String> {
    crate::video::editor::read_tracking_data(path).await
}

// Export commands
#[tauri::command]
pub async fn save_temp_overlay(data: Vec<u8>) -> Result<String, String> {
    crate::video::export::save_temp_overlay(data).await
}

#[tauri::command]
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
    crate::video::export::export_video_with_overlay(
        app,
        video_path,
        overlay_path,
        audio_system_path,
        audio_mic_path,
        output_path,
        codec,
        preset,
        crf,
    )
    .await
}

// New Mediabunny export commands
#[tauri::command]
pub async fn read_video_file(path: String) -> Result<Vec<u8>, String> {
    use std::fs;
    fs::read(&path).map_err(|e| format!("Failed to read video file: {}", e))
}

#[tauri::command]
pub async fn save_exported_video(data: Vec<u8>, path: String) -> Result<(), String> {
    use std::fs;
    fs::write(&path, data).map_err(|e| format!("Failed to save exported video: {}", e))
}

#[tauri::command]
pub async fn strip_audio_from_video(
    input_data: Vec<u8>,
    output_path: String,
) -> Result<(), String> {
    use std::env;
    use std::fs;
    use std::process::Command;
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    #[cfg(target_os = "windows")]
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    // Create temporary file for input video in system temp directory
    let temp_dir = env::temp_dir();
    let temp_input_path = temp_dir.join(format!(
        "reticle_temp_input_{}.mp4",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    ));

    // Write input data to temp file
    fs::write(&temp_input_path, &input_data)
        .map_err(|e| format!("Failed to write temp input: {}", e))?;

    // Run FFmpeg to copy video stream without audio
    // -an flag removes all audio streams
    let output = Command::new("ffmpeg")
        .arg("-i")
        .arg(&temp_input_path)
        .arg("-c:v")
        .arg("copy") // Copy video stream without re-encoding
        .arg("-an") // Remove audio
        .arg("-y") // Overwrite output
        .arg(&output_path)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Failed to run FFmpeg: {}", e))?;

    // Clean up temp file
    let _ = fs::remove_file(&temp_input_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg failed to strip audio: {}", stderr));
    }

    Ok(())
}

#[tauri::command]
pub async fn export_video_as_gif(
    app: AppHandle,
    video_path: String,
    output_path: String,
    fps: u32,
    width: u32,
    trim_start: Option<f64>,
    trim_end: Option<f64>,
) -> Result<(), String> {
    crate::video::export::export_video_as_gif(
        app,
        video_path,
        output_path,
        fps,
        width,
        trim_start,
        trim_end,
    )
    .await
}

#[tauri::command]
pub async fn mix_audio_tracks_for_export(
    video_path: String,
    audio_system_path: String,
    audio_mic_path: String,
    include_system: bool,
    include_mic: bool,
    sys_volume: Option<f64>,
    mic_volume: Option<f64>,
    trim_start: Option<f64>,
    trim_end: Option<f64>,
    music_path: Option<String>,
    music_volume: Option<f64>,
    music_offset: Option<f64>,
    output_path: String,
    output_format: Option<String>, // "mp4" | "webm" — determines audio codec
) -> Result<(), String> {
    use std::fs;
    use std::path::Path;
    use std::process::Command;
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    #[cfg(target_os = "windows")]
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    // WebM requires Opus or Vorbis; MP4 uses AAC
    let is_webm = output_format.as_deref() == Some("webm");
    let audio_codec = if is_webm { "libopus" } else { "aac" };
    let audio_bitrate = "128k";
    // WebM requires VP8/VP9/AV1 video codec; MP4 uses H.264
    let video_reenc_codec = if is_webm { "libvpx-vp9" } else { "libx264" };
    let video_reenc_extra: &[&str] = if is_webm {
        &[
            "-crf",
            "33",
            "-b:v",
            "0",
            "-deadline",
            "realtime",
            "-cpu-used",
            "8",
        ]
    } else {
        &["-preset", "fast", "-crf", "18"]
    };

    let has_system = include_system && Path::new(&audio_system_path).exists();
    let has_mic = include_mic && Path::new(&audio_mic_path).exists();
    let has_music = music_path
        .as_deref()
        .map(|p| Path::new(p).exists())
        .unwrap_or(false);

    let video_trim_start = trim_start.unwrap_or(0.0);
    let video_trim_end = trim_end;
    let music_ss = music_offset.unwrap_or(0.0);
    let sys_vol = sys_volume.unwrap_or(1.0);
    let mic_vol = mic_volume.unwrap_or(1.0);

    let mut args: Vec<String> = vec!["-i".to_string(), video_path.clone()];

    let mut audio_input_count = 0;
    if has_system {
        if video_trim_start > 0.0 {
            args.push("-ss".to_string());
            args.push(video_trim_start.to_string());
        }
        args.push("-i".to_string());
        args.push(audio_system_path.clone());
        audio_input_count += 1;
    }
    if has_mic {
        if video_trim_start > 0.0 {
            args.push("-ss".to_string());
            args.push(video_trim_start.to_string());
        }
        args.push("-i".to_string());
        args.push(audio_mic_path.clone());
        audio_input_count += 1;
    }

    let music_input_idx = 1 + audio_input_count;
    if has_music {
        // Seek into music file at music_offset
        if music_ss > 0.0 {
            args.push("-ss".to_string());
            args.push(music_ss.to_string());
        }
        args.push("-i".to_string());
        args.push(music_path.as_deref().unwrap().to_string());
        audio_input_count += 1;
    }

    // Build filter_complex based on selected tracks
    let needs_pts_reset = video_trim_start > 0.0;
    let vol = music_volume.unwrap_or(1.0);

    if audio_input_count == 0 {
        if needs_pts_reset {
            let mut reenc_args = vec![
                "-vf".to_string(),
                "setpts=PTS-STARTPTS".to_string(),
                "-map".to_string(),
                "0:v".to_string(),
                "-c:v".to_string(),
                video_reenc_codec.to_string(),
            ];
            for s in video_reenc_extra {
                reenc_args.push(s.to_string());
            }
            reenc_args.push("-an".to_string());
            args.extend(reenc_args);
        } else {
            args.extend_from_slice(&[
                "-map".to_string(),
                "0:v".to_string(),
                "-c:v".to_string(),
                "copy".to_string(),
                "-an".to_string(),
            ]);
        }
    } else if audio_input_count == 1 && !has_music {
        // Single non-music audio track — apply volume filter if needed
        let single_idx = 1usize;
        let single_vol = if has_system { sys_vol } else { mic_vol };
        let needs_vol = (single_vol - 1.0).abs() > 0.001;
        if needs_pts_reset || needs_vol {
            let mut fc_parts: Vec<String> = vec![];
            if needs_pts_reset {
                fc_parts.push("[0:v]setpts=PTS-STARTPTS[vout]".to_string());
            }
            if needs_vol {
                fc_parts.push(format!("[{}:a]volume={}[aout]", single_idx, single_vol));
            }
            let amap = if needs_vol {
                "[aout]".to_string()
            } else {
                format!("{}:a", single_idx)
            };
            let vmap = if needs_pts_reset { "[vout]" } else { "0:v" };
            if !fc_parts.is_empty() {
                args.extend_from_slice(&["-filter_complex".to_string(), fc_parts.join(";")]);
            }
            args.extend_from_slice(&[
                "-map".to_string(),
                vmap.to_string(),
                "-map".to_string(),
                amap,
            ]);
            if needs_pts_reset {
                let mut reenc_args = vec!["-c:v".to_string(), video_reenc_codec.to_string()];
                for s in video_reenc_extra {
                    reenc_args.push(s.to_string());
                }
                args.extend(reenc_args);
            } else {
                args.extend_from_slice(&["-c:v".to_string(), "copy".to_string()]);
            }
            args.extend_from_slice(&[
                "-c:a".to_string(),
                audio_codec.to_string(),
                "-b:a".to_string(),
                audio_bitrate.to_string(),
            ]);
        } else {
            args.extend_from_slice(&[
                "-map".to_string(),
                "0:v".to_string(),
                "-map".to_string(),
                format!("{}:a", single_idx),
                "-c:v".to_string(),
                "copy".to_string(),
                "-c:a".to_string(),
                audio_codec.to_string(),
                "-b:a".to_string(),
                audio_bitrate.to_string(),
            ]);
        }
    } else if audio_input_count == 1 && has_music {
        // Only music track
        let music_vol_filter = format!("[{}:a]volume={}[aout]", music_input_idx, vol);
        let fc = if needs_pts_reset {
            format!("[0:v]setpts=PTS-STARTPTS[vout];{}", music_vol_filter)
        } else {
            music_vol_filter
        };
        let vmap = if needs_pts_reset { "[vout]" } else { "0:v" };
        args.extend_from_slice(&["-filter_complex".to_string(), fc]);
        args.extend_from_slice(&[
            "-map".to_string(),
            vmap.to_string(),
            "-map".to_string(),
            "[aout]".to_string(),
        ]);
        if needs_pts_reset {
            let mut reenc_args = vec!["-c:v".to_string(), video_reenc_codec.to_string()];
            for s in video_reenc_extra {
                reenc_args.push(s.to_string());
            }
            args.extend(reenc_args);
        } else {
            args.extend_from_slice(&["-c:v".to_string(), "copy".to_string()]);
        }
        args.extend_from_slice(&[
            "-c:a".to_string(),
            audio_codec.to_string(),
            "-b:a".to_string(),
            audio_bitrate.to_string(),
        ]);
    } else {
        // Multiple audio tracks — build amix
        let mut audio_labels: Vec<String> = vec![];
        let mut fc_parts: Vec<String> = vec![];

        if needs_pts_reset {
            fc_parts.push("[0:v]setpts=PTS-STARTPTS[vout]".to_string());
        }

        let mut plain_idx = 1usize;
        if has_system {
            if (sys_vol - 1.0).abs() > 0.001 {
                fc_parts.push(format!("[{}:a]volume={}[sys]", plain_idx, sys_vol));
                audio_labels.push("[sys]".to_string());
            } else {
                audio_labels.push(format!("[{}:a]", plain_idx));
            }
            plain_idx += 1;
        }
        if has_mic {
            if (mic_vol - 1.0).abs() > 0.001 {
                fc_parts.push(format!("[{}:a]volume={}[mic]", plain_idx, mic_vol));
                audio_labels.push("[mic]".to_string());
            } else {
                audio_labels.push(format!("[{}:a]", plain_idx));
            }
        }
        if has_music {
            fc_parts.push(format!("[{}:a]volume={}[music]", music_input_idx, vol));
            audio_labels.push("[music]".to_string());
        }

        let n = audio_labels.len();
        let amix = format!(
            "{}amix=inputs={}:duration=first:dropout_transition=2[aout]",
            audio_labels.join(""),
            n
        );
        fc_parts.push(amix);

        let fc = fc_parts.join(";");
        let vmap = if needs_pts_reset { "[vout]" } else { "0:v" };
        args.extend_from_slice(&["-filter_complex".to_string(), fc]);
        args.extend_from_slice(&[
            "-map".to_string(),
            vmap.to_string(),
            "-map".to_string(),
            "[aout]".to_string(),
        ]);
        if needs_pts_reset {
            let mut reenc_args = vec!["-c:v".to_string(), video_reenc_codec.to_string()];
            for s in video_reenc_extra {
                reenc_args.push(s.to_string());
            }
            args.extend(reenc_args);
        } else {
            args.extend_from_slice(&["-c:v".to_string(), "copy".to_string()]);
        }
        args.extend_from_slice(&[
            "-c:a".to_string(),
            audio_codec.to_string(),
            "-b:a".to_string(),
            audio_bitrate.to_string(),
        ]);
    }

    // Always limit output duration to video length (trims music if longer than video)
    if let Some(end) = video_trim_end {
        let dur = end - video_trim_start;
        args.push("-t".to_string());
        args.push(dur.to_string());
    }

    args.extend_from_slice(&["-y".to_string(), output_path.clone()]);

    // Run FFmpeg
    let output = Command::new("ffmpeg")
        .args(&args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Failed to run FFmpeg: {}", e))?;

    // Clean up temp video file
    let _ = fs::remove_file(&video_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg failed to mix audio: {}", stderr));
    }

    Ok(())
}
