use rdev::{listen, EventType};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Instant;

#[cfg(target_os = "windows")]
use windows::Win32::{
    Foundation::{LPARAM, LRESULT, WPARAM},
    System::Threading::GetCurrentThreadId,
    UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetCursorInfo, GetMessageW, LoadCursorW,
        SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, CURSORINFO, CURSOR_SHOWING,
        HCURSOR, HHOOK, IDC_ARROW, IDC_HAND, IDC_IBEAM, IDC_NO, IDC_SIZEALL, IDC_SIZENESW,
        IDC_SIZENS, IDC_SIZENWSE, IDC_SIZEWE, IDC_WAIT, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL,
        WM_KEYDOWN, WM_SYSKEYDOWN,
    },
};

/// Capture context metadata
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CaptureContext {
    pub offset_x: i32,
    pub offset_y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Default, Clone)]
struct ModifierState {
    ctrl: bool,
    shift: bool,
    alt: bool,
    meta: bool,
}

impl ModifierState {
    fn to_vec(&self) -> Vec<String> {
        let mut result = Vec::new();
        if self.ctrl {
            result.push("Control".to_string());
        }
        if self.shift {
            result.push("Shift".to_string());
        }
        if self.alt {
            result.push("Alt".to_string());
        }
        if self.meta {
            result.push("Meta".to_string());
        }
        result
    }

    fn update(&mut self, key: &str, pressed: bool) {
        match key {
            "Ctrl" => self.ctrl = pressed,
            "Shift" => self.shift = pressed,
            "Alt" => self.alt = pressed,
            "Win" => self.meta = pressed,
            _ => {}
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TrackingEventData {
    Move {
        x: f64,
        y: f64,
        #[serde(rename = "cursorStyle", skip_serializing_if = "Option::is_none")]
        cursor_style: Option<String>,
    },
    Click {
        button: String,
        pressed: bool,
    },
    Scroll {
        dx: i64,
        dy: i64,
    },
    Key {
        key: String,
        pressed: bool,
        modifiers: Vec<String>,
    },
}

#[derive(Serialize, Clone)]
pub struct TrackingEvent {
    pub timestamp: u128,
    #[serde(flatten)]
    pub data: TrackingEventData,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackingData {
    pub capture_context: Option<CaptureContext>,
    pub events: Vec<TrackingEvent>,
}

// ---- Global state for keyboard hook (Windows only) ----

#[cfg(target_os = "windows")]
static KB_IS_RECORDING: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "windows")]
static KB_HOOK_THREAD_ID: AtomicU32 = AtomicU32::new(0);

#[cfg(target_os = "windows")]
fn kb_sender() -> &'static Mutex<Option<flume::Sender<TrackingEvent>>> {
    static INSTANCE: OnceLock<Mutex<Option<flume::Sender<TrackingEvent>>>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(None))
}

#[cfg(target_os = "windows")]
fn kb_start_time() -> &'static Mutex<Option<Instant>> {
    static INSTANCE: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(None))
}

#[cfg(target_os = "windows")]
fn kb_mod_state() -> &'static Mutex<ModifierState> {
    static INSTANCE: OnceLock<Mutex<ModifierState>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(ModifierState::default()))
}

/// Convert Windows virtual key code to key string
#[cfg(target_os = "windows")]
fn vk_to_string(vk: u32) -> String {
    match vk {
        0x41..=0x5A => char::from_u32(vk).unwrap_or('?').to_string(),
        0x30..=0x39 => char::from_u32(vk).unwrap_or('?').to_string(),
        0x70 => "F1".to_string(),
        0x71 => "F2".to_string(),
        0x72 => "F3".to_string(),
        0x73 => "F4".to_string(),
        0x74 => "F5".to_string(),
        0x75 => "F6".to_string(),
        0x76 => "F7".to_string(),
        0x77 => "F8".to_string(),
        0x78 => "F9".to_string(),
        0x79 => "F10".to_string(),
        0x7A => "F11".to_string(),
        0x7B => "F12".to_string(),
        0x0D => "Enter".to_string(),
        0x20 => "Space".to_string(),
        0x08 => "Backspace".to_string(),
        0x09 => "Tab".to_string(),
        0x1B => "Esc".to_string(),
        0x2E => "Del".to_string(),
        0x2D => "Ins".to_string(),
        0x24 => "Home".to_string(),
        0x23 => "End".to_string(),
        0x21 => "PgUp".to_string(),
        0x22 => "PgDn".to_string(),
        0x26 => "Up".to_string(),
        0x28 => "Down".to_string(),
        0x25 => "Left".to_string(),
        0x27 => "Right".to_string(),
        0x14 => "Caps".to_string(),
        0xA0 | 0xA1 | 0x10 => "Shift".to_string(),
        0xA2 | 0xA3 | 0x11 => "Ctrl".to_string(),
        0xA4 | 0xA5 | 0x12 => "Alt".to_string(),
        0x5B | 0x5C => "Win".to_string(),
        0xBD => "-".to_string(),
        0xBB => "=".to_string(),
        0xDB => "[".to_string(),
        0xDD => "]".to_string(),
        0xDC => "\\".to_string(),
        0xBA => ";".to_string(),
        0xDE => "'".to_string(),
        0xBC => ",".to_string(),
        0xBE => ".".to_string(),
        0xBF => "/".to_string(),
        0xC0 => "`".to_string(),
        0x2C => "PrtSc".to_string(),
        0x91 => "ScrLk".to_string(),
        0x13 => "Pause".to_string(),
        _ => format!("VK_{:02X}", vk),
    }
}

/// Query the current Windows cursor shape and map it to a CSS cursor name.
/// Called on every MouseMove event — cheap (single Win32 call, no I/O).
#[cfg(target_os = "windows")]
fn get_cursor_style() -> Option<String> {
    unsafe {
        // GetCursorInfo() returns the GLOBAL system cursor — works from any thread,
        // unlike GetCursor() which only returns the cursor set by the calling thread.
        let mut ci = CURSORINFO {
            cbSize: std::mem::size_of::<CURSORINFO>() as u32,
            ..Default::default()
        };
        if GetCursorInfo(&mut ci).is_err() {
            return None;
        }
        // Cursor is hidden (e.g. fullscreen game) — report nothing
        if ci.flags != CURSOR_SHOWING {
            return Some("none".to_string());
        }

        let current: HCURSOR = ci.hCursor;
        if current.is_invalid() {
            return None;
        }

        // Load standard cursor handles and compare by handle value.
        // LoadCursorW with NULL hInstance loads the shared system cursor.
        let arrow = LoadCursorW(None, IDC_ARROW).unwrap_or_default();
        let ibeam = LoadCursorW(None, IDC_IBEAM).unwrap_or_default();
        let hand = LoadCursorW(None, IDC_HAND).unwrap_or_default();
        let wait = LoadCursorW(None, IDC_WAIT).unwrap_or_default();
        let no = LoadCursorW(None, IDC_NO).unwrap_or_default();
        let size_all = LoadCursorW(None, IDC_SIZEALL).unwrap_or_default();
        let size_ns = LoadCursorW(None, IDC_SIZENS).unwrap_or_default();
        let size_we = LoadCursorW(None, IDC_SIZEWE).unwrap_or_default();
        let size_nesw = LoadCursorW(None, IDC_SIZENESW).unwrap_or_default();
        let size_nwse = LoadCursorW(None, IDC_SIZENWSE).unwrap_or_default();

        // Some apps (browsers, Electron) copy system cursors via CopyImage/CreateCursor,
        // so the handle won't match directly. We compare the raw handle value as usize
        // which is the most reliable approach without doing pixel-level comparison.
        let cur_val = current.0 as usize;

        let style = if cur_val == ibeam.0 as usize {
            "text"
        } else if cur_val == hand.0 as usize {
            "pointer"
        } else if cur_val == wait.0 as usize {
            "wait"
        } else if cur_val == no.0 as usize {
            "not-allowed"
        } else if cur_val == size_all.0 as usize {
            "move"
        } else if cur_val == size_ns.0 as usize {
            "ns-resize"
        } else if cur_val == size_we.0 as usize {
            "ew-resize"
        } else if cur_val == size_nesw.0 as usize {
            "nesw-resize"
        } else if cur_val == size_nwse.0 as usize {
            "nwse-resize"
        } else if cur_val == arrow.0 as usize {
            "default"
        } else {
            // Unknown cursor handle — could be a custom/app cursor.
            // Try to identify common patterns by checking if it matches
            // any system cursor when loaded fresh (handles are shared/cached by Windows).
            "default"
        };

        Some(style.to_string())
    }
}

/// Low-level keyboard hook callback
#[cfg(target_os = "windows")]
unsafe extern "system" fn keyboard_hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && KB_IS_RECORDING.load(Ordering::Relaxed) {
        let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        let vk = kb.vkCode;
        let pressed = matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
        let key_str = vk_to_string(vk);

        // Read start time
        let elapsed = {
            let lock = kb_start_time().lock().unwrap();
            match *lock {
                Some(start) => start.elapsed().as_millis(),
                None => {
                    drop(lock);
                    return CallNextHookEx(Some(HHOOK::default()), code, wparam, lparam);
                }
            }
        };

        // Update modifier state and build event
        let (modifiers, event_key) = {
            let mut state = kb_mod_state().lock().unwrap();
            if pressed {
                state.update(&key_str, true);
            }
            let mut mods = state.to_vec();
            mods.retain(|m| !is_same_modifier(&key_str, m));
            if !pressed {
                state.update(&key_str, false);
            }
            (mods, key_str.clone())
        };

        let event = TrackingEvent {
            timestamp: elapsed,
            data: TrackingEventData::Key {
                key: event_key,
                pressed,
                modifiers,
            },
        };

        // Send to channel
        let lock = kb_sender().lock().unwrap();
        if let Some(tx) = lock.as_ref() {
            let _ = tx.send(event);
        }
    }

    CallNextHookEx(Some(HHOOK::default()), code, wparam, lparam)
}

pub struct MouseTracker {
    is_recording: Arc<AtomicBool>,
    start_time: Arc<Mutex<Option<Instant>>>,
    sender: Arc<Mutex<Option<flume::Sender<TrackingEvent>>>>,
    modifier_state: Arc<Mutex<ModifierState>>,
    capture_context: Arc<Mutex<Option<CaptureContext>>>,
}

impl MouseTracker {
    pub fn new() -> Self {
        let is_recording = Arc::new(AtomicBool::new(false));
        let start_time: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));
        let sender: Arc<Mutex<Option<flume::Sender<TrackingEvent>>>> = Arc::new(Mutex::new(None));
        let modifier_state: Arc<Mutex<ModifierState>> =
            Arc::new(Mutex::new(ModifierState::default()));
        let capture_context: Arc<Mutex<Option<CaptureContext>>> = Arc::new(Mutex::new(None));

        let is_recording_clone = is_recording.clone();
        let start_time_clone = start_time.clone();
        let sender_clone = sender.clone();

        // ── rdev thread: mouse move, click, scroll only ──
        thread::spawn(move || {
            if let Err(e) = listen(move |event| {
                if !is_recording_clone.load(Ordering::Relaxed) {
                    return;
                }
                let elapsed = {
                    let lock = start_time_clone.lock().unwrap();
                    match *lock {
                        Some(start) => start.elapsed().as_millis(),
                        None => return,
                    }
                };
                let data = match event.event_type {
                    EventType::MouseMove { x, y } => {
                        #[cfg(target_os = "windows")]
                        let cursor_style = get_cursor_style();
                        #[cfg(not(target_os = "windows"))]
                        let cursor_style: Option<String> = None;
                        Some(TrackingEventData::Move { x, y, cursor_style })
                    }
                    EventType::ButtonPress(btn) => Some(TrackingEventData::Click {
                        button: format!("{:?}", btn),
                        pressed: true,
                    }),
                    EventType::ButtonRelease(btn) => Some(TrackingEventData::Click {
                        button: format!("{:?}", btn),
                        pressed: false,
                    }),
                    EventType::Wheel { delta_x, delta_y } => Some(TrackingEventData::Scroll {
                        dx: delta_x,
                        dy: delta_y,
                    }),
                    // Keys handled by Windows hook
                    EventType::KeyPress(_) | EventType::KeyRelease(_) => None,
                };
                if let Some(event_data) = data {
                    let lock = sender_clone.lock().unwrap();
                    if let Some(tx) = lock.as_ref() {
                        let _ = tx.send(TrackingEvent {
                            timestamp: elapsed,
                            data: event_data,
                        });
                    }
                }
            }) {
                eprintln!("rdev error: {:?}", e);
            }
        });

        // ── Windows keyboard hook thread ──
        // Must run its own message pump for WH_KEYBOARD_LL to fire
        #[cfg(target_os = "windows")]
        thread::spawn(move || {
            unsafe {
                let _hook =
                    match SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_proc), None, 0) {
                        Ok(h) => h,
                        Err(e) => {
                            eprintln!("[KB Hook] SetWindowsHookExW failed: {:?}", e);
                            return;
                        }
                    };

                KB_HOOK_THREAD_ID.store(GetCurrentThreadId(), Ordering::SeqCst);
                eprintln!(
                    "[KB Hook] Installed successfully, thread={}",
                    GetCurrentThreadId()
                );

                // Blocking message pump — GetMessageW sleeps until a message arrives,
                // consuming zero CPU. WH_KEYBOARD_LL callbacks fire directly from
                // the Windows kernel, bypassing the message queue entirely, so this
                // does NOT block keyboard events.
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }

                #[allow(unreachable_code)]
                UnhookWindowsHookEx(_hook).ok();
            }
        });

        Self {
            is_recording,
            start_time,
            sender,
            modifier_state,
            capture_context,
        }
    }

    pub fn start(&self, tx: flume::Sender<TrackingEvent>, capture_context: Option<CaptureContext>) {
        // Set shared state BEFORE setting is_recording = true
        {
            let mut sender_lock = self.sender.lock().unwrap();
            *sender_lock = Some(tx.clone());
        }
        {
            let mut start_time_lock = self.start_time.lock().unwrap();
            *start_time_lock = Some(Instant::now());
        }
        {
            let mut context_lock = self.capture_context.lock().unwrap();
            *context_lock = capture_context;
        }

        // Sync to global statics used by hook callback
        #[cfg(target_os = "windows")]
        {
            *kb_sender().lock().unwrap() = Some(tx);
            *kb_start_time().lock().unwrap() = *self.start_time.lock().unwrap();
            *kb_mod_state().lock().unwrap() = ModifierState::default();
            KB_IS_RECORDING.store(true, Ordering::SeqCst);
        }

        self.is_recording.store(true, Ordering::SeqCst);
    }

    pub fn stop(&self) {
        self.is_recording.store(false, Ordering::SeqCst);

        #[cfg(target_os = "windows")]
        {
            KB_IS_RECORDING.store(false, Ordering::SeqCst);
            *kb_sender().lock().unwrap() = None;
            *kb_start_time().lock().unwrap() = None;
            *kb_mod_state().lock().unwrap() = ModifierState::default();
        }

        *self.sender.lock().unwrap() = None;
        *self.start_time.lock().unwrap() = None;
        *self.modifier_state.lock().unwrap() = ModifierState::default();
        *self.capture_context.lock().unwrap() = None;
    }

    #[allow(dead_code)]
    pub fn get_capture_context(&self) -> Option<CaptureContext> {
        self.capture_context.lock().unwrap().clone()
    }
}

fn is_same_modifier(key: &str, modifier: &str) -> bool {
    match (key, modifier) {
        ("Ctrl", "Control") | ("Control", "Ctrl") => true,
        ("Win", "Meta") | ("Meta", "Win") => true,
        (k, m) if k == m => true,
        _ => false,
    }
}
