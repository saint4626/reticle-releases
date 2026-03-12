use nokhwa::pixel_format::RgbFormat;
use nokhwa::utils::{CameraIndex, RequestedFormat, RequestedFormatType};
use nokhwa::Camera;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;
use tokio::io::AsyncWriteExt;
use tokio::net::windows::named_pipe::ServerOptions;

#[derive(serde::Serialize, Clone)]
pub struct WebcamDevice {
    pub name: String,
    pub index: u32,
}

pub struct WebcamRecorder {
    stop_signal: Arc<AtomicBool>,
}

impl WebcamRecorder {
    pub fn new() -> Self {
        Self {
            stop_signal: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn enumerate() -> Result<Vec<WebcamDevice>, String> {
        let cameras = nokhwa::query(nokhwa::utils::ApiBackend::Auto).map_err(|e| e.to_string())?;
        let mut devices = Vec::new();
        for camera_info in cameras {
            let index = match camera_info.index() {
                CameraIndex::Index(i) => *i,
                _ => 0, // Fallback for other index types
            };
            devices.push(WebcamDevice {
                name: camera_info.human_name(),
                index,
            });
        }
        Ok(devices)
    }

    pub fn start(&self, index: u32, output_path: PathBuf, app: AppHandle) -> Result<(), String> {
        let stop_signal = self.stop_signal.clone();
        // Reset stop signal
        stop_signal.store(false, Ordering::SeqCst);

        thread::spawn(move || {
            // Initialize Camera
            let camera_index = CameraIndex::Index(index);
            // Request Highest Resolution/FPS in RGB
            let requested =
                RequestedFormat::new::<RgbFormat>(RequestedFormatType::AbsoluteHighestFrameRate);

            let mut camera = match Camera::new(camera_index, requested) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Failed to open webcam: {}", e);
                    return;
                }
            };

            if let Err(e) = camera.open_stream() {
                eprintln!("Failed to open webcam stream: {}", e);
                return;
            }

            let resolution = camera.resolution();
            let width = resolution.width();
            let height = resolution.height();
            let frame_rate = camera.frame_rate();

            println!("Webcam started: {}x{} @ {} FPS", width, height, frame_rate);

            // Setup FFmpeg Pipe
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let pipe_name = format!(r"\\.\pipe\reticle-webcam-{}", timestamp);

            // Create Named Pipe
            let mut server = ServerOptions::new()
                .first_pipe_instance(true)
                .create(&pipe_name)
                .unwrap();

            // Spawn FFmpeg
            let path_str = output_path.to_string_lossy().to_string();
            let app_clone = app.clone();

            // Note: Webcam output is RGB (RgbFormat), so pix_fmt is rgb24
            tauri::async_runtime::spawn(async move {
                let sidecar = app_clone.shell().sidecar("ffmpeg");
                if let Ok(cmd) = sidecar {
                    let cmd = cmd.args([
                        "-f",
                        "rawvideo",
                        "-pix_fmt",
                        "rgb24",
                        "-s",
                        &format!("{}x{}", width, height),
                        "-r",
                        &frame_rate.to_string(),
                        "-i",
                        &pipe_name,
                        "-c:v",
                        "libx264",
                        "-preset",
                        "ultrafast",
                        "-y",
                        &path_str,
                    ]);

                    if let Ok((mut _rx, _)) = cmd.spawn() {
                        // FFmpeg running
                    } else {
                        eprintln!("Failed to spawn ffmpeg for webcam");
                    }
                }
            });

            // Connect pipe (blocking until FFmpeg connects)
            tauri::async_runtime::block_on(async {
                let _ = server.connect().await;
            });

            println!("Webcam pipe connected");

            loop {
                if stop_signal.load(Ordering::Relaxed) {
                    break;
                }

                if let Ok(frame) = camera.frame() {
                    let buffer = frame.buffer(); // ImageBuffer
                                                 // as_raw() is deprecated/removed in newer image crate versions used by nokhwa
                                                 // Use as_flat_samples() if available or directly access container if possible
                                                 // Actually, nokhwa uses image::ImageBuffer.
                                                 // Let's try `into_raw()` or `as_raw()` - wait, error said `as_flat_samples` not found?
                                                 // Ah, `image` crate version might be different.
                                                 // Let's try to just get the slice.
                                                 // `buffer` is `ImageBuffer<P, Vec<S>>`.
                                                 // It derefs to `[S]`.
                    let raw_data: &[u8] = buffer;

                    // Write to pipe
                    let write_result =
                        tauri::async_runtime::block_on(async { server.write_all(raw_data).await });

                    if write_result.is_err() {
                        eprintln!("Webcam pipe write error");
                        break;
                    }
                } else {
                    thread::sleep(std::time::Duration::from_millis(10));
                }
            }

            let _ = camera.stop_stream();
            println!("Webcam recorder stopped");
        });

        Ok(())
    }

    pub fn stop(&self) {
        self.stop_signal.store(true, Ordering::SeqCst);
    }
}
