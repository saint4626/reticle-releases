use crate::audio::AudioRecorder;
use crate::tracking::MouseTracker;
use crate::tracking::TrackingEvent;
use crate::video::webcam::WebcamRecorder;
use std::fs::File;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::ShellExt;
use tokio::io::AsyncWriteExt;
use tokio::net::windows::named_pipe::ServerOptions;
use windows::Win32::Foundation::RECT;
use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, GetWindowRect};
use windows_capture::{
    capture::{Context, GraphicsCaptureApiHandler},
    frame::Frame,
    graphics_capture_api::InternalCaptureControl,
    monitor::Monitor,
    settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
    },
    window::Window,
};

#[derive(Clone, serde::Serialize)]
struct VideoStatus {
    status: String,
    duration_sec: u64,
}

#[derive(Clone, serde::Serialize)]
struct VideoError {
    error: String,
}

#[derive(Clone, serde::Serialize)]
pub struct CodecInfo {
    pub id: String,
    pub name: String,
}

// Check available encoders by running ffmpeg -encoders
pub async fn check_available_codecs(app: AppHandle) -> Result<Vec<CodecInfo>, String> {
    use std::process::Command;
    use tauri_plugin_shell::process::CommandEvent;

    let sidecar = app.shell().sidecar("ffmpeg").map_err(|e| e.to_string())?;
    let (mut rx, _) = sidecar
        .args(["-hide_banner", "-encoders"])
        .spawn()
        .map_err(|e| e.to_string())?;

    let mut output = String::new();
    while let Some(event) = rx.recv().await {
        if let CommandEvent::Stdout(line) = event {
            output.push_str(&String::from_utf8_lossy(&line));
        }
    }

    // Check hardware to filter incompatible encoders
    // Detect GPU via PowerShell (wmic is removed in Windows 11 24H2+)
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let hw_info = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase())
        .unwrap_or_default();

    let has_nvidia = hw_info.contains("nvidia");
    let has_amd = hw_info.contains("amd") || hw_info.contains("radeon");
    let has_intel = hw_info.contains("intel");

    let mut codecs = vec![
        CodecInfo {
            id: "libx264".into(),
            name: "CPU (libx264)".into(),
        }, // Always available fallback
    ];

    // Check for specific GPU encoders in output AND hardware presence
    // V..... h264_nvenc           NVIDIA NVENC H.264 encoder
    // V..... h264_amf             AMD AMF H.264 encoder
    // V..... h264_qsv             Intel QSV H.264 encoder

    if output.contains("h264_nvenc") && has_nvidia {
        codecs.push(CodecInfo {
            id: "h264_nvenc".into(),
            name: "NVIDIA (NVENC)".into(),
        });
    }
    if output.contains("h264_amf") && has_amd {
        codecs.push(CodecInfo {
            id: "h264_amf".into(),
            name: "AMD (AMF)".into(),
        });
    }
    if output.contains("h264_qsv") && has_intel {
        codecs.push(CodecInfo {
            id: "h264_qsv".into(),
            name: "Intel (QSV)".into(),
        });
    }

    Ok(codecs)
}

#[derive(Clone, serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionPaths {
    pub video_path: String,
    pub audio_system_path: String,
    pub audio_mic_path: String,
    pub tracking_path: String,
    pub fps: u64,
}

pub struct VideoRecorderState {
    pub is_recording: Arc<AtomicBool>,
    pub stop_signal: Arc<AtomicBool>,
    pub is_paused: Arc<AtomicBool>, // Controls warmup/pause state
    pub audio_recorder: Arc<Mutex<AudioRecorder>>,
    pub mouse_tracker: Arc<MouseTracker>,
    pub webcam_recorder: Arc<Mutex<WebcamRecorder>>,
    pub last_session: Arc<Mutex<Option<SessionPaths>>>,
}

impl VideoRecorderState {
    pub fn new() -> Self {
        Self {
            is_recording: Arc::new(AtomicBool::new(false)),
            stop_signal: Arc::new(AtomicBool::new(false)),
            is_paused: Arc::new(AtomicBool::new(false)),
            audio_recorder: Arc::new(Mutex::new(AudioRecorder::new())),
            mouse_tracker: Arc::new(MouseTracker::new()),
            webcam_recorder: Arc::new(Mutex::new(WebcamRecorder::new())),
            last_session: Arc::new(Mutex::new(None)),
        }
    }
}

// Resources shared with the capture thread
struct CaptureResources {
    // Shared latest frame buffer: (width, height, data)
    latest_frame: Arc<Mutex<Option<(u32, u32, Vec<u8>)>>>,
    stop_signal: Arc<AtomicBool>,
    // Tuple: (dimensions_set?, (width, height))
    dimensions: Arc<(Mutex<Option<(u32, u32)>>, Condvar)>,
    target_frame_duration: Duration,
    // Optional crop area: x, y, w, h
    crop_rect: Option<(u32, u32, u32, u32)>,
}

struct CaptureHandlerImpl {
    resources: CaptureResources,
    last_frame_time: Instant,
}

impl GraphicsCaptureApiHandler for CaptureHandlerImpl {
    type Flags = CaptureResources;
    type Error = Box<dyn std::error::Error + Send + Sync>;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self {
            resources: ctx.flags,
            last_frame_time: Instant::now(),
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if self.resources.stop_signal.load(Ordering::Relaxed) {
            capture_control.stop();
            return Ok(());
        }

        // Limit capture rate to target FPS
        if self.last_frame_time.elapsed() < self.resources.target_frame_duration {
            return Ok(());
        }
        self.last_frame_time = Instant::now();

        let frame_w = frame.width();
        let frame_h = frame.height();

        // 1. Принудительно включаем режим обрезки (crop), если размеры нечетные.
        // Это спасет нас от ошибки Stride (косой картинки) при захвате окон.
        let mut actual_crop = self.resources.crop_rect;
        if actual_crop.is_none() && (frame_w % 2 != 0 || frame_h % 2 != 0) {
            actual_crop = Some((0, 0, frame_w, frame_h));
        }

        // 2. Вычисляем финальные размеры
        let (out_w, out_h, crop) = if let Some((cx, cy, mut cw, mut ch)) = actual_crop {
            // Гарантируем четность ДО того, как будем читать буфер построчно
            if cw % 2 != 0 {
                cw -= 1;
            }
            if ch % 2 != 0 {
                ch -= 1;
            }

            if cx + cw <= frame_w && cy + ch <= frame_h {
                (cw, ch, Some((cx, cy, cw, ch)))
            } else {
                // Фолбэк безопасности
                let mut fw = frame_w;
                let mut fh = frame_h;
                if fw % 2 != 0 {
                    fw -= 1;
                }
                if fh % 2 != 0 {
                    fh -= 1;
                }
                (fw, fh, Some((0, 0, fw, fh)))
            }
        } else {
            (frame_w, frame_h, None) // Размеры уже четные, можно копировать целиком
        };

        // Notify dimensions (Dynamic Resizing)
        {
            let (lock, cvar) = &*self.resources.dimensions;
            let mut dims = lock.lock().unwrap();

            // If dimensions changed, we MUST update them to restart FFmpeg or handle it
            // Current FFmpeg pipe implementation does NOT support resolution change mid-stream.
            // So we MUST stick to the initial dimensions.
            if let Some((init_w, init_h)) = *dims {
                if init_w != out_w || init_h != out_h {
                    // Window resized!
                    // Option A: Scale to initial size (slow)
                    // Option B: Pad/Crop to initial size (fast) -> We choose this to avoid black screen or crash

                    // We will just proceed, but we need to ensure the buffer matches init_w/h
                    // Let's force out_w/out_h to match init_w/init_h for the buffer logic below
                    // The content will be centered or top-left aligned
                }
            } else {
                *dims = Some((out_w, out_h));
                cvar.notify_all();
            }
        }

        // Retrieve STABLE dimensions (what FFmpeg expects)
        let (target_w, target_h) = {
            let (lock, _) = &*self.resources.dimensions;
            let dims = lock.lock().unwrap();
            dims.unwrap() // Should be set by now
        };

        let buffer_len = (target_w * target_h * 4) as usize;

        // Get frame buffer
        if let Ok(mut frame_buffer) = frame.buffer() {
            let src = frame_buffer.as_raw_buffer();

            // Update latest frame
            let mut guard = self.resources.latest_frame.lock().unwrap();

            // Check if we can reuse the existing vector
            let mut reuse = false;
            if let Some((w, h, ref mut vec)) = *guard {
                if w == target_w && h == target_h && vec.capacity() >= buffer_len {
                    vec.clear();
                    reuse = true;
                }
            }

            if !reuse {
                *guard = Some((target_w, target_h, Vec::with_capacity(buffer_len)));
            }

            // Now write to the vector
            if let Some((_, _, ref mut vec)) = *guard {
                // 🛑 ГЛАВНЫЙ ФИКС: Вычисляем реальный шаг строки (Stride) с учетом паддинга GPU
                // Делим общий размер сырого буфера на высоту кадра.
                let src_stride = src.len() / (frame_h as usize);

                if let Some((cx, cy, cw, ch)) = crop {
                    // Handle Resizing / Dynamic Dimensions
                    let write_w = cw.min(target_w);
                    let write_h = ch.min(target_h);
                    let write_row_bytes = (write_w * 4) as usize;

                    if write_w < target_w || write_h < target_h {
                        vec.resize(buffer_len, 0); // Fill black
                    }

                    for row in 0..write_h {
                        // Используем реальный src_stride вместо frame_w * 4
                        let src_start = ((cy + row) as usize * src_stride) + (cx as usize * 4);
                        let dst_start = row as usize * target_w as usize * 4;

                        if src_start + write_row_bytes <= src.len()
                            && dst_start + write_row_bytes <= vec.capacity()
                        {
                            if vec.len() == buffer_len {
                                vec[dst_start..dst_start + write_row_bytes]
                                    .copy_from_slice(&src[src_start..src_start + write_row_bytes]);
                            } else {
                                vec.extend_from_slice(&src[src_start..src_start + write_row_bytes]);
                            }
                        }
                    }
                } else {
                    // 🛑 ВТОРОЙ ФИКС: Удаляем оптимизацию "быстрого" копирования целиком (extend_from_slice).
                    // Если у буфера есть паддинг, прямое копирование затянет этот "мусор" в FFmpeg.
                    // Мы обязаны копировать построчно, чтобы срезать паддинг GPU.
                    let copy_w = frame_w.min(target_w);
                    let copy_h = frame_h.min(target_h);
                    let dst_stride = (target_w * 4) as usize;
                    let copy_bytes = (copy_w * 4) as usize;

                    if vec.len() < buffer_len {
                        vec.resize(buffer_len, 0); // Fill black
                    }

                    for row in 0..copy_h {
                        // Снова используем реальный src_stride
                        let src_start = row as usize * src_stride;
                        let dst_start = row as usize * dst_stride;

                        if src_start + copy_bytes <= src.len() {
                            vec[dst_start..dst_start + copy_bytes]
                                .copy_from_slice(&src[src_start..src_start + copy_bytes]);
                        }
                    }
                }
            }
        }

        Ok(())
    }
}

/// Helper function to get window position and size using Windows API
fn get_window_rect_by_title(window_title: &str) -> Result<(i32, i32, u32, u32), String> {
    unsafe {
        // Convert title to wide string for Windows API
        let wide_title: Vec<u16> = window_title
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        // Find window by title
        let hwnd = FindWindowW(None, windows::core::PCWSTR(wide_title.as_ptr()))
            .map_err(|e| format!("Failed to find window: {}", e))?;

        // Get window rectangle
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect)
            .map_err(|e| format!("Failed to get window rectangle: {}", e))?;

        // Calculate dimensions
        let width = (rect.right - rect.left) as u32;
        let height = (rect.bottom - rect.top) as u32;

        // Ensure even dimensions for YUV420P
        let width = if width % 2 != 0 { width - 1 } else { width };
        let height = if height % 2 != 0 { height - 1 } else { height };

        Ok((rect.left, rect.top, width, height))
    }
}

/// Determines the capture context (offset and dimensions) based on recording mode
fn determine_capture_context(
    target: &str,
    id: &Option<String>,
    app: &AppHandle,
) -> Result<crate::tracking::CaptureContext, String> {
    use crate::tracking::CaptureContext;

    match target {
        "screen" => {
            // Screen mode: extract monitor position and size using Tauri API
            let monitor_id = id.as_ref().and_then(|s| s.parse::<usize>().ok());

            let monitors = app
                .available_monitors()
                .map_err(|e| format!("Failed to get monitors: {}", e))?;

            let monitor = if let Some(target_id) = monitor_id {
                if target_id < monitors.len() {
                    monitors[target_id].clone()
                } else {
                    app.primary_monitor()
                        .map_err(|e| format!("Failed to get primary monitor: {}", e))?
                        .ok_or("No primary monitor found")?
                }
            } else {
                app.primary_monitor()
                    .map_err(|e| format!("Failed to get primary monitor: {}", e))?
                    .ok_or("No primary monitor found")?
            };

            // Get monitor position and size
            let position = monitor.position();
            let size = monitor.size();

            Ok(CaptureContext {
                offset_x: position.x,
                offset_y: position.y,
                width: size.width,
                height: size.height,
            })
        }

        "area" => {
            // Area mode: parse region from id string (format: "monitor_id:x,y,w,h")
            // Add monitor offset to region offset
            let full_id = id.as_ref().ok_or("Area mode requires id parameter")?;

            let (mon_part, rect_part) = full_id
                .split_once(':')
                .ok_or("Invalid area id format, expected 'monitor_id:x,y,w,h'")?;

            // Parse monitor id
            let monitor_index = mon_part
                .parse::<usize>()
                .map_err(|_| "Invalid monitor id")?;

            // Get monitor to find its offset using Tauri API
            let monitors = app
                .available_monitors()
                .map_err(|e| format!("Failed to get monitors: {}", e))?;

            let monitor = monitors
                .get(monitor_index)
                .ok_or_else(|| format!("Monitor index {} not found", monitor_index))?;

            let mon_position = monitor.position();

            // Parse region coordinates
            let parts: Vec<&str> = rect_part.split(',').collect();
            if parts.len() != 4 {
                return Err("Invalid region format, expected 'x,y,w,h'".to_string());
            }

            let region_x = parts[0]
                .trim()
                .parse::<i32>()
                .map_err(|_| "Invalid region x coordinate")?;
            let region_y = parts[1]
                .trim()
                .parse::<i32>()
                .map_err(|_| "Invalid region y coordinate")?;
            let mut region_w = parts[2]
                .trim()
                .parse::<u32>()
                .map_err(|_| "Invalid region width")?;
            let mut region_h = parts[3]
                .trim()
                .parse::<u32>()
                .map_err(|_| "Invalid region height")?;

            // Ensure even dimensions for YUV420P
            if region_w % 2 != 0 {
                region_w -= 1;
            }
            if region_h % 2 != 0 {
                region_h -= 1;
            }

            if region_w == 0 || region_h == 0 {
                return Err("Region dimensions must be positive".to_string());
            }

            // Combine monitor offset with region offset
            Ok(CaptureContext {
                offset_x: mon_position.x + region_x,
                offset_y: mon_position.y + region_y,
                width: region_w,
                height: region_h,
            })
        }

        "window" => {
            // Window mode: get window position and size using Windows API
            let window_title = id.as_ref().ok_or("Window mode requires id parameter")?;

            // Verify window exists using windows_capture
            let _window = Window::from_name(window_title)
                .or_else(|_| Window::from_contains_name(window_title))
                .map_err(|e| format!("Window not found: {}", e))?;

            // Get window position and size using Windows API
            // IMPORTANT: This returns ALREADY ALIGNED dimensions (even numbers for YUV420P)
            let (x, y, width, height) = get_window_rect_by_title(window_title)?;

            println!("Looking for window with title: {}", window_title);

            Ok(CaptureContext {
                offset_x: x,
                offset_y: y,
                width,
                height,
            })
        }

        _ => Err(format!("Unknown target mode: {}", target)),
    }
}

// Command to start recording (internal implementation, exposed via wrapper)
pub async fn start_video_record(
    app: AppHandle,
    state: tauri::State<'_, VideoRecorderState>,
    target: String,
    id: Option<String>,
    fps: Option<u64>,
    warmup: Option<bool>,
    mic_device: Option<String>,
    enable_mic: Option<bool>,
    enable_sys: Option<bool>,
    capture_cursor: Option<bool>,
    webcam_device: Option<String>,
    enable_webcam: Option<bool>,
    video_codec: Option<String>,
    video_output_dir: Option<String>,
) -> Result<(), String> {
    println!("start_video_record called with: target={}, id={:?}, fps={:?}, mic={:?}, enable_mic={:?}, enable_sys={:?}, capture_cursor={:?}, webcam={:?}, enable_webcam={:?}, codec={:?}", 
        target, id, fps, mic_device, enable_mic, enable_sys, capture_cursor, webcam_device, enable_webcam, video_codec);

    // Check if already recording
    if state.is_recording.load(Ordering::SeqCst) {
        return Err("Already recording".into());
    }

    let target_fps = fps.unwrap_or(30).max(1).min(120);
    // Use unwrap_or(true) for backward compatibility, but if passed explicitly as false it should be false.
    let do_mic = enable_mic.unwrap_or(true);
    let do_sys = enable_sys.unwrap_or(true);
    let do_cursor = capture_cursor.unwrap_or(true);

    println!(
        "Config: do_mic={}, do_sys={}, do_cursor={}",
        do_mic, do_sys, do_cursor
    );

    // Warmup mode: Start paused
    let do_warmup = warmup.unwrap_or(false);
    state.is_paused.store(do_warmup, Ordering::SeqCst);
    println!("Initial paused state: {}", do_warmup);

    println!(
        "Starting video record: target={}, id={:?}, fps={}, warmup={}",
        target, id, target_fps, do_warmup
    );

    // Determine capture context for coordinate transformation
    let capture_context = determine_capture_context(&target, &id, &app).ok();
    if let Some(ref ctx) = capture_context {
        println!(
            "Capture context: offset=({}, {}), size={}x{}",
            ctx.offset_x, ctx.offset_y, ctx.width, ctx.height
        );
    } else {
        println!(
            "Warning: Failed to determine capture context, tracking coordinates may be incorrect"
        );
    }

    // Spawn Overlay Window if Area mode
    if target == "area" {
        if let Some(ref full_id) = id {
            if let Some((mon_id_str, rect_part)) = full_id.split_once(':') {
                let parts: Vec<&str> = rect_part.split(',').collect();
                let monitor_index = mon_id_str.parse::<usize>().unwrap_or(0);
                let _mon_id_string = mon_id_str.to_string(); // Clone for async block

                if parts.len() == 4 {
                    // Parse as f64 for window size
                    let x = parts[0].trim().parse::<f64>().unwrap_or(0.0);
                    let y = parts[1].trim().parse::<f64>().unwrap_or(0.0);
                    let w = parts[2].trim().parse::<f64>().unwrap_or(0.0);
                    let h = parts[3].trim().parse::<f64>().unwrap_or(0.0);

                    if w > 0.0 && h > 0.0 {
                        let app_overlay = app.clone();
                        tauri::async_runtime::spawn(async move {
                            // Find Monitor
                            let monitors = app_overlay.available_monitors().unwrap_or_default();
                            let monitor = if monitor_index < monitors.len() {
                                monitors[monitor_index].clone()
                            } else {
                                monitors
                                    .first()
                                    .cloned()
                                    .unwrap_or(app_overlay.primary_monitor().unwrap().unwrap())
                            };

                            let mon_pos = monitor.position();
                            let mon_size = monitor.size();
                            let scale_factor = monitor.scale_factor();

                            // Pass x, y directly as they are likely relative to the monitor
                            let url = format!(
                                "index.html?overlay=true&w={}&h={}&x={}&y={}&scale={}",
                                w, h, x, y, scale_factor
                            );

                            let overlay_win = WebviewWindowBuilder::new(
                                &app_overlay,
                                "record_overlay",
                                WebviewUrl::App(url.into()),
                            )
                            .decorations(false)
                            .transparent(true)
                            .always_on_top(true)
                            .skip_taskbar(true)
                            .visible(false)
                            .resizable(false)
                            .shadow(false)
                            .build();

                            match overlay_win {
                                Ok(win) => {
                                    let _ = win.set_ignore_cursor_events(true);
                                    // Set window to cover the entire monitor
                                    let _ = win.set_position(tauri::Position::Physical(*mon_pos));
                                    let _ = win.set_size(tauri::Size::Physical(*mon_size));

                                    // Wait a bit for Vue to initialize before showing
                                    tokio::time::sleep(tokio::time::Duration::from_millis(300))
                                        .await;

                                    let _ = win.show();
                                }
                                Err(e) => eprintln!("Failed to create overlay window: {}", e),
                            }
                        });
                    }
                }
            }
        }
    }

    // Create channels for frames: Sender -> Encoder, Encoder -> Recycler -> Sender
    // Use unbounded to prevent blocking Pacing Thread during FFmpeg cold start (fixes 2-4s jump/freeze)
    let (tx, rx) = flume::unbounded::<Vec<u8>>();
    // let (recycle_tx, recycle_rx) = flume::unbounded::<Vec<u8>>(); // Not used with new architecture

    state.is_recording.store(true, Ordering::SeqCst);
    state.stop_signal.store(false, Ordering::SeqCst);

    let _app_clone = app.clone();
    let stop_signal_clone = state.stop_signal.clone();
    let is_paused_clone = state.is_paused.clone(); // Clone for Audio

    // Shared dimensions with Condvar
    let dimensions = Arc::new((Mutex::new(None), Condvar::new()));
    let dimensions_clone = dimensions.clone();
    let dimensions_pacing = dimensions.clone(); // Clone for pacing thread

    // Shared latest frame
    let latest_frame: Arc<Mutex<Option<(u32, u32, Vec<u8>)>>> = Arc::new(Mutex::new(None));
    let latest_frame_clone = latest_frame.clone();

    // Pacing Thread
    let pacing_tx = tx.clone();
    let pacing_stop = state.stop_signal.clone();
    let pacing_frame = latest_frame.clone();
    let pacing_paused = state.is_paused.clone(); // Clone for Pacing thread

    // Move tracking channel creation here
    let (tracking_tx, tracking_rx) = flume::unbounded::<TrackingEvent>();
    let mouse_tracker_enc = state.mouse_tracker.clone();
    let tracking_tx_pacing = tracking_tx.clone(); // Clone for Pacing thread
    let capture_context_pacing = capture_context.clone(); // Clone for Pacing thread

    thread::spawn(move || {
        let frame_interval = Duration::from_micros(1_000_000 / target_fps);

        // Wait for dimensions to be available before starting the loop
        // This ensures we can generate blank frames of correct size if needed
        let (width, height) = {
            let (lock, cvar) = &*dimensions_pacing;
            let mut dims = lock.lock().unwrap();
            while dims.is_none() {
                if pacing_stop.load(Ordering::Relaxed) {
                    println!("Pacing thread stopped before dimensions");
                    return;
                }
                let result = cvar.wait_timeout(dims, Duration::from_millis(100)).unwrap();
                dims = result.0;
            }
            dims.unwrap()
        };

        println!(
            "Pacing thread started for {}x{} @ {} FPS",
            width, height, target_fps
        );

        // Start Mouse Tracking aligned with video start
        // But if paused (warmup), we wait until unpaused!
        while pacing_paused.load(Ordering::SeqCst) {
            if pacing_stop.load(Ordering::Relaxed) {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }

        // Start tracking NOW (synced with first frame)
        mouse_tracker_enc.start(tracking_tx_pacing, capture_context_pacing);

        let mut next_frame_time = Instant::now();
        let buffer_size = (width * height * 4) as usize;

        loop {
            if pacing_stop.load(Ordering::Relaxed) {
                break;
            }

            // Handle Paused State
            if pacing_paused.load(Ordering::SeqCst) {
                // While paused, we just sleep and do NOT send frames.
                // We reset next_frame_time so we don't try to catch up when resumed.
                thread::sleep(Duration::from_millis(100));
                next_frame_time = Instant::now();
                continue;
            }

            // Sleep until next frame
            let now = Instant::now();
            if next_frame_time > now {
                thread::sleep(next_frame_time - now);
            }
            next_frame_time += frame_interval;

            // Send latest frame or blank if missing
            let frame_data = {
                let guard = pacing_frame.lock().unwrap();
                if let Some((w, h, ref data)) = *guard {
                    // Check if dimensions match (handle resize or init)
                    if w == width && h == height {
                        Some(data.clone())
                    } else {
                        // Dimensions changed? For now just send blank or old size?
                        // Ideally we should handle resize, but pipe is fixed size.
                        // Send blank of correct size to keep pipe happy.
                        None
                    }
                } else {
                    None
                }
            };

            let data_to_send = frame_data.unwrap_or_else(|| vec![0u8; buffer_size]);

            if let Err(_) = pacing_tx.send(data_to_send) {
                break;
            }
        }
        println!("Pacing thread finished");
    });

    let target_frame_duration = Duration::from_micros(1_000_000 / target_fps);

    // Spawn capture thread
    let app_clone_capture = app.clone(); // Clone for capture thread
    thread::spawn(move || {
        // ... capture logic ...

        let mut crop_rect_val = None;
        let mut monitor_id_to_find = id.clone();

        if target == "area" {
            if let Some(ref full_id) = id {
                if let Some((mon_part, rect_part)) = full_id.split_once(':') {
                    // Parse rect
                    let parts: Vec<&str> = rect_part.split(',').collect();
                    if parts.len() == 4 {
                        let x = parts[0].trim().parse::<u32>().unwrap_or(0);
                        let y = parts[1].trim().parse::<u32>().unwrap_or(0);
                        let mut w = parts[2].trim().parse::<u32>().unwrap_or(0);
                        let mut h = parts[3].trim().parse::<u32>().unwrap_or(0);

                        // Ensure even dimensions for YUV420P
                        if w % 2 != 0 {
                            w -= 1;
                        }
                        if h % 2 != 0 {
                            h -= 1;
                        }

                        if w > 0 && h > 0 {
                            crop_rect_val = Some((x, y, w, h));
                        }
                    }
                    monitor_id_to_find = Some(mon_part.to_string());
                }
            }
        }

        let flags = CaptureResources {
            latest_frame: latest_frame_clone,
            stop_signal: stop_signal_clone,
            dimensions: dimensions_clone,
            target_frame_duration,
            crop_rect: crop_rect_val,
        };

        if target == "window" {
            let window_title = id.clone().unwrap_or_default();
            println!("Looking for window with title: {}", window_title);

            let window = match Window::from_name(&window_title) {
                Ok(w) => w,
                Err(_) => {
                    // Try contains as fallback
                    match Window::from_contains_name(&window_title) {
                        Ok(w) => w,
                        Err(e) => {
                            let _ = app_clone_capture.emit(
                                "video-error",
                                VideoError {
                                    error: format!("Window not found: {}", e),
                                },
                            );
                            return;
                        }
                    }
                }
            };

            let settings = Settings::new(
                window,
                if do_cursor {
                    CursorCaptureSettings::Default
                } else {
                    CursorCaptureSettings::WithoutCursor
                },
                DrawBorderSettings::Default,
                SecondaryWindowSettings::Default,
                MinimumUpdateIntervalSettings::Default,
                DirtyRegionSettings::Default,
                ColorFormat::Bgra8,
                flags,
            );

            if let Err(e) = CaptureHandlerImpl::start(settings) {
                eprintln!("Capture error: {}", e);
                let _ = app_clone_capture.emit(
                    "video-error",
                    VideoError {
                        error: format!("Capture error: {}", e),
                    },
                );
            }
        } else {
            // Handle monitor selection gracefully
            let monitor = if let Some(ref id_str) = monitor_id_to_find {
                // Try to parse as usize (Handle or Index)
                if let Ok(target_id) = id_str.parse::<usize>() {
                    Monitor::enumerate().ok().and_then(|ms| {
                        // 2. Fallback: Index (0..N)
                        if target_id < ms.len() {
                            return Some(ms[target_id].clone());
                        }
                        None
                    })
                } else {
                    None
                }
            } else {
                None
            };

            let monitor = match monitor {
                Some(m) => m,
                None => match Monitor::primary() {
                    Ok(m) => m,
                    Err(e) => {
                        eprintln!("Failed to find primary monitor: {}", e);
                        let _ = app_clone_capture.emit(
                            "video-error",
                            VideoError {
                                error: "No monitor found".into(),
                            },
                        );
                        return;
                    }
                },
            };

            // Create settings with correct types explicitly
            let settings = Settings::new(
                monitor,
                if do_cursor {
                    CursorCaptureSettings::Default
                } else {
                    CursorCaptureSettings::WithoutCursor
                },
                DrawBorderSettings::Default,
                SecondaryWindowSettings::Default,
                MinimumUpdateIntervalSettings::Default,
                DirtyRegionSettings::Default,
                ColorFormat::Bgra8,
                flags,
            );

            if let Err(e) = CaptureHandlerImpl::start(settings) {
                eprintln!("Capture error: {}", e);
                let _ = app_clone_capture.emit(
                    "video-error",
                    VideoError {
                        error: format!("Capture error: {}", e),
                    },
                );
            }
        }

        println!("Capture thread finished");
    });

    let app_clone_enc = app.clone();
    let stop_signal_enc = state.stop_signal.clone();
    let audio_recorder_enc = state.audio_recorder.clone(); // Clone Arc to move into async block
                                                           // let mouse_tracker_enc = state.mouse_tracker.clone(); // Moved to pacing thread

    // Start Mouse Tracking - MOVED TO PACING THREAD
    // let (tracking_tx, tracking_rx) = flume::unbounded::<TrackingEvent>();
    // mouse_tracker_enc.start(tracking_tx);

    // Prepare output paths
    let reticle_dir = if let Some(ref dir) = video_output_dir {
        std::path::PathBuf::from(dir)
    } else {
        let video_dir = dirs::video_dir().unwrap_or(std::path::PathBuf::from("."));
        video_dir.join("Reticle")
    };
    if !reticle_dir.exists() {
        std::fs::create_dir_all(&reticle_dir).expect("Failed to create Reticle directory");
    }

    let timestamp_str = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let video_filename = format!("recording_{}.mp4", timestamp_str);
    let tracking_filename = format!("tracking_{}.json", timestamp_str);
    let webcam_filename = format!("webcam_{}.mp4", timestamp_str);

    let video_path = reticle_dir.join(&video_filename);
    let tracking_path = reticle_dir.join(&tracking_filename);
    let webcam_path = reticle_dir.join(&webcam_filename);

    println!("Recording to: {:?}", video_path);

    // Store session paths for later retrieval on stop
    {
        let sys_out_path = reticle_dir
            .join(format!("audio_system_{}.wav", timestamp_str))
            .to_string_lossy()
            .to_string();
        let mic_out_path = reticle_dir
            .join(format!("audio_mic_{}.wav", timestamp_str))
            .to_string_lossy()
            .to_string();
        let mut session = state.last_session.lock().unwrap();
        *session = Some(SessionPaths {
            video_path: video_path.to_string_lossy().to_string(),
            audio_system_path: sys_out_path,
            audio_mic_path: mic_out_path,
            tracking_path: tracking_path.to_string_lossy().to_string(),
            fps: target_fps,
        });
    }

    // Start Webcam
    let do_webcam = enable_webcam.unwrap_or(false);
    if do_webcam {
        if let Some(device_str) = &webcam_device {
            let target_index = if let Ok(idx) = device_str.parse::<u32>() {
                idx
            } else {
                if let Ok(devices) = crate::video::webcam::WebcamRecorder::enumerate() {
                    devices
                        .into_iter()
                        .find(|d| &d.name == device_str)
                        .map(|d| d.index)
                        .unwrap_or(0)
                } else {
                    0
                }
            };

            let webcam_recorder = state.webcam_recorder.lock().unwrap();
            // Assuming start doesn't block significantly
            if let Err(e) = webcam_recorder.start(target_index, webcam_path, app.clone()) {
                eprintln!("Failed to start webcam: {}", e);
                // We don't abort main recording, just log error
                let _ = app.emit(
                    "video-error",
                    VideoError {
                        error: format!("Webcam error: {}", e),
                    },
                );
            }
        }
    }

    // Spawn Tracking Writer
    let tracking_path_clone = tracking_path.clone();
    let capture_context_writer = capture_context.clone(); // Clone for tracking writer
    thread::spawn(move || {
        // Collect all events first
        let mut events = Vec::new();
        while let Ok(event) = tracking_rx.recv() {
            events.push(event);
        }

        // Create TrackingData with capture context and events
        let tracking_data = crate::tracking::TrackingData {
            capture_context: capture_context_writer,
            events,
        };

        // Write to file
        match File::create(&tracking_path_clone) {
            Ok(mut file) => {
                if let Ok(json) = serde_json::to_string_pretty(&tracking_data) {
                    let _ = file.write_all(json.as_bytes());
                } else {
                    eprintln!("Failed to serialize tracking data");
                }
            }
            Err(e) => {
                eprintln!("Failed to create tracking file: {}", e);
            }
        }

        println!("Tracking writer finished");
    });

    // Spawn Encoding (FFmpeg) thread
    let video_path_string = video_path.to_string_lossy().to_string();
    let app_clone_audio = app.clone(); // Clone for audio/encoding thread
    tauri::async_runtime::spawn(async move {
        // Wait for dimensions using Condvar
        let (lock, cvar) = &*dimensions;
        let (mut w, mut h) = {
            let mut dims = lock.lock().unwrap();
            while dims.is_none() {
                // Check if we should stop waiting
                if stop_signal_enc.load(Ordering::Relaxed) {
                    println!("Encoder stopped before dimensions received");
                    return;
                }

                // Wait with timeout to periodically check stop signal
                let result = cvar.wait_timeout(dims, Duration::from_millis(100)).unwrap();
                dims = result.0;
            }
            dims.unwrap()
        };

        // Ensure even dimensions for YUV420P
        if w % 2 != 0 {
            w -= 1;
        }
        if h % 2 != 0 {
            h -= 1;
        }

        println!("Video dimensions: {}x{}", w, h);

        // Generate unique pipe names
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let video_pipe_name = format!(r"\\.\pipe\reticle-video-{}", timestamp);
        let audio_sys_pipe_name = format!(r"\\.\pipe\reticle-audio-sys-{}", timestamp);
        let audio_mic_pipe_name = format!(r"\\.\pipe\reticle-audio-mic-{}", timestamp);

        // Create Named Pipes
        let mut video_server = ServerOptions::new()
            .first_pipe_instance(true)
            .create(&video_pipe_name)
            .unwrap();

        let mut audio_sys_server = ServerOptions::new()
            .first_pipe_instance(true)
            .create(&audio_sys_pipe_name)
            .unwrap();

        let mut audio_mic_server = ServerOptions::new()
            .first_pipe_instance(true)
            .create(&audio_mic_pipe_name)
            .unwrap();

        // Start Audio Capture
        let (sys_tx, sys_rx) = flume::unbounded::<Vec<u8>>();
        let (mic_tx, mic_rx) = flume::unbounded::<Vec<u8>>();
        let mut sys_sample_rate = 44100;
        let mut mic_sample_rate = 44100;
        let mut sys_audio_enabled = false;
        let mut mic_audio_enabled = false;

        {
            let mut audio_recorder = audio_recorder_enc.lock().unwrap();

            // Start System Audio
            if do_sys {
                match audio_recorder.start_system(sys_tx, is_paused_clone.clone()) {
                    Ok(rate) => {
                        sys_sample_rate = rate;
                        sys_audio_enabled = true;
                        println!("System audio capture started at {} Hz", rate);
                    }
                    Err(e) => {
                        println!("System audio capture failed: {}", e);
                    }
                }
            }

            // Start Mic Audio
            if do_mic {
                match audio_recorder.start_mic(mic_device, mic_tx, is_paused_clone, app_clone_audio)
                {
                    Ok(rate) => {
                        mic_sample_rate = rate;
                        mic_audio_enabled = true;
                        println!("Mic audio capture started at {} Hz", rate);
                    }
                    Err(e) => {
                        println!("Mic audio capture failed: {}", e);
                    }
                }
            }
        }

        // Spawn Pipe Writers
        // Video Writer
        let video_rx_clone = rx.clone();
        tauri::async_runtime::spawn(async move {
            // Wait for client to connect
            video_server.connect().await.unwrap();
            println!("FFmpeg connected to video pipe");

            while let Ok(frame_data) = video_rx_clone.recv() {
                if let Err(_) = video_server.write_all(&frame_data).await {
                    break;
                }
            }
        });

        if sys_audio_enabled {
            println!("Starting System Audio pipe writer");
            let _pipe_name_clone = audio_sys_pipe_name.clone();
            tauri::async_runtime::spawn(async move {
                audio_sys_server.connect().await.unwrap();
                println!("FFmpeg connected to system audio pipe");

                let silence_duration = std::time::Duration::from_millis(100);
                let silence_samples = (sys_sample_rate as f32 * 0.1) as usize;
                let silence_bytes = silence_samples * 2 * 4; // stereo * f32
                let silence_vec = vec![0u8; silence_bytes];
                let mut total_bytes = 0;

                loop {
                    match tokio::time::timeout(silence_duration, sys_rx.recv_async()).await {
                        Ok(Ok(data)) => {
                            total_bytes += data.len();
                            if let Err(_) = audio_sys_server.write_all(&data).await {
                                break;
                            }
                        }
                        Ok(Err(_)) => {
                            break; // Channel closed
                        }
                        Err(_) => {
                            // Timeout - send silence
                            if let Err(_) = audio_sys_server.write_all(&silence_vec).await {
                                break;
                            }
                        }
                    }
                }
                println!(
                    "System Audio writer finished. Total real bytes: {}",
                    total_bytes
                );
            });
        }

        if mic_audio_enabled {
            println!("Starting Mic Audio pipe writer");
            let _pipe_name_clone = audio_mic_pipe_name.clone();
            tauri::async_runtime::spawn(async move {
                audio_mic_server.connect().await.unwrap();
                println!("FFmpeg connected to mic audio pipe");

                let silence_duration = std::time::Duration::from_millis(100);
                let silence_samples = (mic_sample_rate as f32 * 0.1) as usize;
                let silence_bytes = silence_samples * 2 * 4; // stereo * f32
                let silence_vec = vec![0u8; silence_bytes];
                let mut total_bytes = 0;

                loop {
                    match tokio::time::timeout(silence_duration, mic_rx.recv_async()).await {
                        Ok(Ok(data)) => {
                            total_bytes += data.len();
                            if let Err(_) = audio_mic_server.write_all(&data).await {
                                break;
                            }
                        }
                        Ok(Err(_)) => {
                            break; // Channel closed
                        }
                        Err(_) => {
                            // Timeout - send silence
                            if let Err(_) = audio_mic_server.write_all(&silence_vec).await {
                                break;
                            }
                        }
                    }
                }
                println!(
                    "Mic Audio writer finished. Total real bytes: {}",
                    total_bytes
                );
            });
        } else {
            println!("Mic audio disabled - pipe writer not started");
        }

        let sidecar = app_clone_enc.shell().sidecar("ffmpeg");
        if let Err(e) = sidecar {
            let _ = app_clone_enc.emit(
                "video-error",
                VideoError {
                    error: format!("FFmpeg not found: {}", e),
                },
            );
            return;
        }
        let sidecar = sidecar.unwrap();

        // Output paths
        let video_out = video_path_string;
        let sys_out = reticle_dir
            .join(format!("audio_system_{}.wav", timestamp_str))
            .to_string_lossy()
            .to_string();
        let mic_out = reticle_dir
            .join(format!("audio_mic_{}.wav", timestamp_str))
            .to_string_lossy()
            .to_string();

        // Arguments for FFmpeg
        let size_arg = format!("{}x{}", w, h);
        let fps_arg = target_fps.to_string();

        // Use Vec<String> to own the arguments and avoid lifetime issues
        let mut args: Vec<String> = vec![
            "-f".into(),
            "rawvideo".into(),
            "-pix_fmt".into(),
            "bgra".into(),
            "-s".into(),
            size_arg,
            "-r".into(),
            fps_arg,
            "-i".into(),
            video_pipe_name,
        ];

        let mut input_idx = 1;
        let mut sys_idx = -1;
        let mut mic_idx = -1;

        if sys_audio_enabled {
            let s_rate = sys_sample_rate.to_string();
            args.extend([
                "-f".into(),
                "f32le".into(),
                "-ar".into(),
                s_rate,
                "-ac".into(),
                "2".into(),
                "-i".into(),
                audio_sys_pipe_name,
            ]);
            sys_idx = input_idx;
            input_idx += 1;
        }

        if mic_audio_enabled {
            let s_rate = mic_sample_rate.to_string();
            args.extend([
                "-f".into(),
                "f32le".into(),
                "-ar".into(),
                s_rate,
                "-ac".into(),
                "2".into(),
                "-i".into(),
                audio_mic_pipe_name,
            ]);
            mic_idx = input_idx;
            // input_idx += 1; // Removed unused assignment to fix warning
        }

        // Video Output (with System audio if available)
        let codec_name = video_codec.unwrap_or("libx264".into());

        // Dynamic preset for hardware encoders
        let preset_val = if codec_name.contains("nvenc") {
            "p1" // Fastest preset for NVIDIA (low latency)
        } else if codec_name.contains("amf") {
            "speed" // Fast preset for AMD
        } else if codec_name.contains("qsv") {
            "veryfast" // Fast preset for Intel
        } else {
            "ultrafast" // For CPU (libx264)
        };

        args.extend([
            "-map".into(),
            "0:v".into(),
            "-c:v".into(),
            codec_name.clone(),
            "-preset".into(),
            preset_val.into(),
        ]);

        // Fix for NVENC pixel format compatibility
        if codec_name.contains("nvenc") || codec_name.contains("amf") || codec_name.contains("qsv")
        {
            // Hardware encoders often strictly require yuv420p
            args.extend(["-pix_fmt".into(), "yuv420p".into()]);
        } else {
            // libx264 also prefers yuv420p for compatibility
            args.extend(["-pix_fmt".into(), "yuv420p".into()]);
        }

        if sys_audio_enabled || mic_audio_enabled {
            // Need to filter_complex to mix audio streams if both are enabled
            // Or just map them as separate audio tracks if container supports it (MP4 usually takes one main track or needs specific mapping)
            // But user likely wants them mixed.

            if sys_audio_enabled && mic_audio_enabled {
                args.extend([
                    "-filter_complex".into(),
                    format!(
                        "[{}:a][{}:a]amix=inputs=2:duration=longest[aout]",
                        sys_idx, mic_idx
                    ),
                    "-map".into(),
                    "[aout]".into(),
                ]);
            } else if sys_audio_enabled {
                args.extend(["-map".into(), format!("{}:a", sys_idx)]);
            } else if mic_audio_enabled {
                args.extend(["-map".into(), format!("{}:a", mic_idx)]);
            }

            args.extend(["-c:a".into(), "aac".into()]);
        }

        // Web compatibility flags
        args.extend([
            "-movflags".into(),
            "+faststart".into(),
            "-y".into(),
            video_out,
        ]);

        // Separate System Audio Output
        if sys_audio_enabled {
            args.extend([
                "-map".into(),
                format!("{}:a", sys_idx),
                "-c:a".into(),
                "pcm_s16le".into(), // Standard WAV PCM
                "-y".into(),
                sys_out,
            ]);
        }

        // Separate Mic Audio Output
        if mic_audio_enabled {
            args.extend([
                "-map".into(),
                format!("{}:a", mic_idx),
                "-c:a".into(),
                "pcm_s16le".into(),
                "-y".into(),
                mic_out,
            ]);
        }

        let cmd = sidecar.args(&args);

        let spawned = cmd.spawn();
        if let Err(e) = spawned {
            let _ = app_clone_enc.emit(
                "video-error",
                VideoError {
                    error: format!("Failed to spawn ffmpeg: {}", e),
                },
            );
            return;
        }

        // We don't need to write to child stdin anymore
        let (mut _rx_sidecar, mut _child) = spawned.unwrap();

        // Wait for process to finish?
        // Or just let it run. Tauri Command child doesn't expose `wait` easily in async way without blocking?
        // Actually `spawn` returns a `Child` which has `wait`?
        // No, Tauri's `Child` isn't standard `std::process::Child`.
        // It has `write` and event listeners.
        // We can listen for "close" event?
        // `Command` spawn returns (Receiver<CommandEvent>, Child).
        // We can loop over receiver to wait for exit.

        while let Some(event) = _rx_sidecar.recv().await {
            match event {
                tauri_plugin_shell::process::CommandEvent::Terminated(payload) => {
                    println!("FFmpeg terminated: {:?}", payload);
                    break;
                }
                tauri_plugin_shell::process::CommandEvent::Error(err) => {
                    println!("FFmpeg error: {}", err);
                }
                _ => {}
            }
        }

        println!("Encoding finished");
    });

    app.emit(
        "video-status",
        VideoStatus {
            status: "recording".into(),
            duration_sec: 0,
        },
    )
    .unwrap();
    Ok(())
}

#[tauri::command]
pub async fn confirm_video_record(
    state: tauri::State<'_, VideoRecorderState>,
) -> Result<(), String> {
    if !state.is_recording.load(Ordering::SeqCst) {
        return Err("Not recording".into());
    }
    state.is_paused.store(false, Ordering::SeqCst);
    println!("Recording confirmed/unpaused");
    Ok(())
}

#[tauri::command]
pub async fn pause_video_record(state: tauri::State<'_, VideoRecorderState>) -> Result<(), String> {
    if !state.is_recording.load(Ordering::SeqCst) {
        return Err("Not recording".into());
    }
    state.is_paused.store(true, Ordering::SeqCst);
    println!("Recording paused");
    Ok(())
}

#[tauri::command]
pub async fn resume_video_record(
    state: tauri::State<'_, VideoRecorderState>,
) -> Result<(), String> {
    if !state.is_recording.load(Ordering::SeqCst) {
        return Err("Not recording".into());
    }
    state.is_paused.store(false, Ordering::SeqCst);
    println!("Recording resumed");
    Ok(())
}

pub fn set_mic_muted(
    state: tauri::State<'_, VideoRecorderState>,
    muted: bool,
) -> Result<(), String> {
    if let Ok(audio) = state.audio_recorder.lock() {
        audio.set_mic_muted(muted);
        println!("Mic muted: {}", muted);
        Ok(())
    } else {
        Err("Failed to lock audio recorder".into())
    }
}

pub fn set_sys_muted(
    state: tauri::State<'_, VideoRecorderState>,
    muted: bool,
) -> Result<(), String> {
    if let Ok(audio) = state.audio_recorder.lock() {
        audio.set_sys_muted(muted);
        println!("Sys muted: {}", muted);
        Ok(())
    } else {
        Err("Failed to lock audio recorder".into())
    }
}

#[tauri::command]
pub async fn stop_video_record(
    app: AppHandle,
    state: tauri::State<'_, VideoRecorderState>,
) -> Result<(), String> {
    println!("Stopping video record");

    // Signal stop
    state.is_recording.store(false, Ordering::SeqCst);
    state.stop_signal.store(true, Ordering::SeqCst);

    // Stop audio
    if let Ok(mut audio) = state.audio_recorder.lock() {
        audio.stop();
    }

    // Stop tracker
    state.mouse_tracker.stop();

    // Stop Webcam
    if let Ok(webcam) = state.webcam_recorder.lock() {
        webcam.stop();
    }

    // Close Overlay Window
    if let Some(overlay) = app.get_webview_window("record_overlay") {
        let _ = overlay.close();
    }

    // Emit session-ready with file paths so frontend can open editor
    let session = {
        let lock = state.last_session.lock().unwrap();
        lock.clone()
    };

    if let Some(session) = session {
        let _ = app.emit("video-session-ready", session);
    }

    app.emit(
        "video-status",
        VideoStatus {
            status: "stopped".into(),
            duration_sec: 0,
        },
    )
    .unwrap();
    Ok(())
}
