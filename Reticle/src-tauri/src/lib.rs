use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};

mod audio;
mod commands;
mod tracking;
mod video;

use video::recorder::VideoRecorderState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When a second instance is launched, show and focus the existing main window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                    Target::new(TargetKind::Webview),
                ])
                .max_file_size(2 * 1024 * 1024) // 2 MB
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne) // Keeps the current log and 1 backup
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(VideoRecorderState::new())
        .setup(|app| {
            // --- System Tray Setup ---
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Show Editor", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Global shortcuts are now managed by the frontend plugin

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::capture::capture_fullscreen,
            commands::capture::get_open_windows,
            commands::capture::get_monitors,
            commands::capture::get_monitor_previews,
            commands::capture::get_window_thumbnail,
            commands::capture::get_window_thumbnails,
            commands::capture::capture_window,
            commands::export::save_image,
            commands::export::copy_to_clipboard,
            commands::export::copy_text_to_clipboard,
            commands::ocr::ocr_image,
            commands::system::open_log_folder,
            commands::system::get_hwid,
            commands::video::start_recording,
            commands::video::stop_recording,
            commands::video::confirm_recording,
            commands::video::get_audio_devices,
            commands::video::get_webcams,
            commands::video::get_available_codecs,
            commands::video::pause_recording,
            commands::video::resume_recording,
            commands::video::set_mic_muted,
            commands::video::set_sys_muted,
            commands::video::start_audio_preview,
            commands::video::stop_audio_preview,
            commands::video::get_video_info,
            commands::video::get_video_thumbnails,
            commands::video::read_tracking_data,
            commands::video_history::delete_video_files,
            commands::video::save_temp_overlay,
            commands::video::export_video_with_overlay,
            commands::video::read_video_file,
            commands::video::save_exported_video,
            commands::video::strip_audio_from_video,
            commands::video::mix_audio_tracks_for_export,
            commands::video::export_video_as_gif
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
