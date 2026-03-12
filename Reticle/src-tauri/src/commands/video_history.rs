use std::fs;
use std::path::Path;

/// Deletes all files associated with a video session
///
/// # Arguments
/// * `video_path` - Path to the video file
/// * `audio_system_path` - Path to the system audio file
/// * `audio_mic_path` - Path to the microphone audio file
/// * `tracking_path` - Path to the tracking data file
///
/// # Returns
/// * `Ok(())` if all files were successfully deleted
/// * `Err(String)` if any file could not be deleted
///
/// # Error Handling
/// - File not found: Logs warning but continues (file may have been manually deleted)
/// - Permission denied: Returns error
/// - Other IO errors: Returns error
#[tauri::command]
pub async fn delete_video_files(
    video_path: String,
    audio_system_path: String,
    audio_mic_path: String,
    tracking_path: String,
) -> Result<(), String> {
    let paths = vec![
        ("video", video_path),
        ("system audio", audio_system_path),
        ("microphone audio", audio_mic_path),
        ("tracking data", tracking_path),
    ];

    let mut errors = Vec::new();
    let mut deleted_count = 0;

    for (file_type, path) in paths {
        if path.is_empty() {
            // Skip empty paths (optional files)
            continue;
        }

        let file_path = Path::new(&path);

        match fs::remove_file(file_path) {
            Ok(_) => {
                deleted_count += 1;
                println!("Deleted {} file: {}", file_type, path);
            }
            Err(e) => {
                match e.kind() {
                    std::io::ErrorKind::NotFound => {
                        // File doesn't exist - log warning but don't fail
                        println!(
                            "{} file not found (may have been manually deleted): {}",
                            file_type, path
                        );
                    }
                    std::io::ErrorKind::PermissionDenied => {
                        let error_msg = format!(
                            "Permission denied when deleting {} file: {}",
                            file_type, path
                        );
                        eprintln!("{}", error_msg);
                        errors.push(error_msg);
                    }
                    _ => {
                        let error_msg =
                            format!("Failed to delete {} file: {} - {}", file_type, path, e);
                        eprintln!("{}", error_msg);
                        errors.push(error_msg);
                    }
                }
            }
        }
    }

    if !errors.is_empty() {
        Err(format!(
            "Failed to delete some files: {}",
            errors.join("; ")
        ))
    } else {
        println!("Successfully deleted {} file(s)", deleted_count);
        Ok(())
    }
}
