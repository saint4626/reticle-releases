use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Instant;
use tauri::Emitter;

#[derive(serde::Serialize)]
pub struct AudioDevice {
    pub name: String,
    pub is_default: bool,
}

#[derive(Clone, serde::Serialize)]
struct MicLevelEvent {
    level: f32,
}

pub struct AudioRecorder {
    stop_txs: Vec<flume::Sender<()>>,
    is_recording: Arc<AtomicBool>,
    mic_muted: Arc<AtomicBool>,
    sys_muted: Arc<AtomicBool>,
}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            stop_txs: Vec::new(),
            is_recording: Arc::new(AtomicBool::new(false)),
            mic_muted: Arc::new(AtomicBool::new(false)),
            sys_muted: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn set_mic_muted(&self, muted: bool) {
        self.mic_muted.store(muted, Ordering::SeqCst);
    }

    pub fn set_sys_muted(&self, muted: bool) {
        self.sys_muted.store(muted, Ordering::SeqCst);
    }

    pub fn enumerate_input_devices() -> Result<Vec<AudioDevice>, String> {
        let host = cpal::default_host();
        let default_in = host.default_input_device().and_then(|d| d.name().ok());

        let devices = host.input_devices().map_err(|e| e.to_string())?;
        let mut result = Vec::new();

        for device in devices {
            if let Ok(name) = device.name() {
                result.push(AudioDevice {
                    is_default: default_in.as_deref() == Some(&name),
                    name,
                });
            }
        }

        Ok(result)
    }

    pub fn start_system(
        &mut self,
        sender: flume::Sender<Vec<u8>>,
        is_paused: Arc<AtomicBool>,
    ) -> Result<u32, String> {
        self.sys_muted.store(false, Ordering::SeqCst);
        self.start_stream(true, None, Some(sender), is_paused, None)
    }

    pub fn start_mic(
        &mut self,
        device_name: Option<String>,
        sender: flume::Sender<Vec<u8>>,
        is_paused: Arc<AtomicBool>,
        app: tauri::AppHandle,
    ) -> Result<u32, String> {
        self.mic_muted.store(false, Ordering::SeqCst);
        self.start_stream(false, device_name, Some(sender), is_paused, Some(app))
    }

    pub fn start_mic_preview(
        &mut self,
        device_name: Option<String>,
        app: tauri::AppHandle,
    ) -> Result<u32, String> {
        // Create a dummy paused flag that is always "true" so we don't try to process audio (though sender is None anyway)
        // Actually, if sender is None, process_audio isn't called, so is_paused doesn't matter much for processing,
        // BUT we want RMS.
        let is_paused = Arc::new(AtomicBool::new(true));
        self.start_stream(false, device_name, None, is_paused, Some(app))
    }

    fn start_stream(
        &mut self,
        is_output: bool,
        device_name: Option<String>,
        sender: Option<flume::Sender<Vec<u8>>>,
        is_paused: Arc<AtomicBool>,
        app: Option<tauri::AppHandle>,
    ) -> Result<u32, String> {
        let (tx, rx) = flume::bounded::<()>(1);
        self.stop_txs.push(tx);

        let is_recording = self.is_recording.clone();
        is_recording.store(true, Ordering::SeqCst);

        let is_muted = if is_output {
            self.sys_muted.clone()
        } else {
            self.mic_muted.clone()
        };

        let host = cpal::default_host();
        let device = if is_output {
            host.default_output_device()
                .ok_or("No default output device found")?
        } else {
            if let Some(name) = device_name.as_ref() {
                // Fix: use as_ref to not move device_name
                host.input_devices()
                    .map_err(|e| e.to_string())?
                    .find(|d| d.name().map(|n| n == *name).unwrap_or(false))
                    .ok_or(format!("Input device '{}' not found", name))?
            } else {
                host.default_input_device()
                    .ok_or("No default input device found")?
            }
        };

        let config = if is_output {
            device.default_output_config().map_err(|e| e.to_string())?
        } else {
            device.default_input_config().map_err(|e| e.to_string())?
        };

        let sample_rate = config.sample_rate().0;
        let stream_config: cpal::StreamConfig = config.into();

        println!(
            "Audio device ({:?}): {}",
            if is_output { "System" } else { "Mic" },
            device.name().unwrap_or("Unknown".into())
        );
        println!("Audio config: sample_rate={}", sample_rate);

        let err_fn = |err| eprintln!("an error occurred on stream: {}", err);

        // Spawn thread to hold the stream
        thread::spawn(move || {
            let mut last_emit_time = Instant::now();

            let stream_result = if is_output {
                device.build_input_stream(
                    &stream_config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        if !is_recording.load(Ordering::Relaxed) {
                            return;
                        }
                        // Skip audio while paused (warmup)
                        if is_paused.load(Ordering::Relaxed) {
                            return;
                        }

                        // Check mute state
                        if is_muted.load(Ordering::Relaxed) {
                            // Send silence
                            let silence = vec![0.0f32; data.len()];
                            if let Some(tx) = &sender {
                                Self::process_audio(&silence, tx);
                            }
                        } else {
                            if let Some(tx) = &sender {
                                Self::process_audio(data, tx);
                            }
                        }
                    },
                    err_fn,
                    None,
                )
            } else {
                device.build_input_stream(
                    &stream_config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        if !is_recording.load(Ordering::Relaxed) {
                            return;
                        }

                        // Metering (RMS) - Run even if paused to show levels in UI during warmup
                        if let Some(app_handle) = &app {
                            if last_emit_time.elapsed().as_millis() >= 100 {
                                let mut sum_sq = 0.0;
                                for &sample in data {
                                    sum_sq += sample * sample;
                                }
                                let rms = (sum_sq / data.len() as f32).sqrt();
                                // Clamp and scale if needed (RMS is usually 0.0-1.0)
                                let _ = app_handle.emit("mic-level", MicLevelEvent { level: rms });
                                last_emit_time = Instant::now();
                            }
                        }

                        // Skip audio while paused (warmup)
                        if is_paused.load(Ordering::Relaxed) {
                            return;
                        }

                        // Check mute state
                        if is_muted.load(Ordering::Relaxed) {
                            // Send silence
                            let silence = vec![0.0f32; data.len()];
                            if let Some(tx) = &sender {
                                Self::process_audio(&silence, tx);
                            }
                        } else {
                            if let Some(tx) = &sender {
                                Self::process_audio(data, tx);
                            }
                        }
                    },
                    err_fn,
                    None,
                )
            };

            if let Ok(stream) = stream_result {
                if let Err(e) = stream.play() {
                    eprintln!("Failed to play audio stream: {}", e);
                    return;
                }

                // Keep thread alive until stop signal
                let _ = rx.recv();
            } else {
                eprintln!(
                    "Failed to build audio stream: {}",
                    stream_result.err().unwrap()
                );
            }
        });

        Ok(sample_rate)
    }

    fn process_audio(data: &[f32], sender: &flume::Sender<Vec<u8>>) {
        // Simple conversion to f32 raw bytes (f32le)
        let mut bytes = Vec::with_capacity(data.len() * 4);
        for &sample in data {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }

        if let Err(_) = sender.send(bytes) {
            // Channel closed
        }
    }

    pub fn stop(&mut self) {
        self.is_recording.store(false, Ordering::SeqCst);
        for tx in self.stop_txs.drain(..) {
            let _ = tx.send(());
        }
    }
}
