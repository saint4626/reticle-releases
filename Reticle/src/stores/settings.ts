import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { register, unregisterAll, isRegistered } from '@tauri-apps/plugin-global-shortcut';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { info, error } from '@tauri-apps/plugin-log';
import i18n from '../i18n';

export interface ShortcutsConfig {
    showApp: string;
    fullscreen: string;
    region: string;
    window: string;
    recordFullscreen: string;
    recordRegion: string;
    recordWindow: string;
    pauseRecording: string;
    stopRecording: string;
    captureToolbar: string;
}

export type OcrEngine = 'windows_native' | 'ppocr_v5';

const DEFAULT_SHORTCUTS: ShortcutsConfig = {
    showApp: 'CommandOrControl+Shift+S',
    fullscreen: 'PrintScreen',
    region: 'Shift+PrintScreen',
    window: 'CommandOrControl+PrintScreen',
    recordFullscreen: 'Shift+F9',
    recordRegion: 'Shift+F10',
    recordWindow: 'Shift+F11',
    pauseRecording: 'Shift+F8',
    stopRecording: 'Shift+Escape',
    captureToolbar: 'CommandOrControl+Shift+C',
};

export const useSettingsStore = defineStore('settings', () => {
    const isReady = ref(false);
    const isRecording = ref(false);

    // Settings state
    const locale = ref<string>('en');
    const autostart = ref<boolean>(false);
    const shortcuts = ref<ShortcutsConfig>({ ...DEFAULT_SHORTCUTS });

    // Autosave settings
    const autoSaveEnabled = ref<boolean>(false);
    const autoSaveScreenshotFolder = ref<string>('');
    const autoSaveVideoFolder = ref<string>('');
    const ocrEngine = ref<OcrEngine>('windows_native');

    // Load settings from localStorage
    function loadSettings() {
        const savedLocale = localStorage.getItem('locale');
        if (savedLocale) {
            locale.value = savedLocale;
            i18n.global.locale.value = savedLocale as any;
        } else {
            locale.value = i18n.global.locale.value as string;
        }

        const savedShortcuts = localStorage.getItem('shortcuts');
        if (savedShortcuts) {
            try {
                const parsed = JSON.parse(savedShortcuts);
                // Migration: fix conflicting stopRecording default
                if (parsed.stopRecording === 'PrintScreen') {
                    parsed.stopRecording = 'Shift+Escape';
                }
                if (parsed.pauseRecording === 'Shift+F12') {
                    parsed.pauseRecording = 'Shift+F8';
                }
                shortcuts.value = { ...DEFAULT_SHORTCUTS, ...parsed };
            } catch (e) {
                console.error('Failed to parse saved shortcuts', e);
            }
        }

        // Load autosave settings
        const savedAutoSave = localStorage.getItem('autoSaveEnabled');
        if (savedAutoSave !== null) autoSaveEnabled.value = savedAutoSave === 'true';
        const savedScreenshotFolder = localStorage.getItem('autoSaveScreenshotFolder');
        if (savedScreenshotFolder) autoSaveScreenshotFolder.value = savedScreenshotFolder;
        const savedVideoFolder = localStorage.getItem('autoSaveVideoFolder');
        if (savedVideoFolder) autoSaveVideoFolder.value = savedVideoFolder;
        const savedOcrEngine = localStorage.getItem('ocrEngine');
        if (savedOcrEngine === 'windows_native' || savedOcrEngine === 'ppocr_v5') {
            ocrEngine.value = savedOcrEngine;
        }

        isReady.value = true;
    }

    // Save settings automatically when they change
    watch(locale, (newLocale) => {
        localStorage.setItem('locale', newLocale);
        i18n.global.locale.value = newLocale as any;
    });

    watch(shortcuts, (newShortcuts) => {
        localStorage.setItem('shortcuts', JSON.stringify(newShortcuts));
        applyShortcuts();
    }, { deep: true });

    watch(autoSaveEnabled, (val) => {
        localStorage.setItem('autoSaveEnabled', String(val));
    });

    watch(autoSaveScreenshotFolder, (val) => {
        localStorage.setItem('autoSaveScreenshotFolder', val);
    });

    watch(autoSaveVideoFolder, (val) => {
        localStorage.setItem('autoSaveVideoFolder', val);
    });

    watch(ocrEngine, (val) => {
        localStorage.setItem('ocrEngine', val);
    });

    // Init settings async (e.g. autostart from Tauri)
    async function init() {
        loadSettings();
        try {
            autostart.value = await isEnabled();
        } catch (e) {
            console.error('Failed to check autostart:', e);
        }

        // Let the `watch(shortcuts)` handle applying shortcuts if they changed.
        // If not changed, we can force-apply explicitly:
        const appWindow = getCurrentWindow();
        if (appWindow.label === 'main') {
            await applyShortcuts();
        }
    }

    // Autostart toggler
    async function toggleAutostart() {
        try {
            if (autostart.value) {
                await disable();
                autostart.value = false;
            } else {
                await enable();
                autostart.value = true;
            }
        } catch (e) {
            console.error('Failed to toggle autostart:', e);
            // Revert state on error
            autostart.value = !autostart.value;
        }
    }

    let isApplyingShortcuts = false;

    // Global Shortcuts Management
    async function applyShortcuts() {
        const appWindow = getCurrentWindow();
        if (appWindow.label !== 'main') {
            return; // Only the main window should register system globals
        }

        if (isApplyingShortcuts) return;
        isApplyingShortcuts = true;

        try {
            await info('Unregistering all previous shortcuts...');
            await unregisterAll();
            await info('Unregistered all previous shortcuts.');

            const handlers: [string, () => Promise<void>][] = [
                [shortcuts.value.showApp, async () => {
                    if (isRecording.value) return;
                    await info(`Global shortcut triggered: ${shortcuts.value.showApp}`);
                    const appWindow = getCurrentWindow();
                    await appWindow.show();
                    await appWindow.setFocus();
                }],
                [shortcuts.value.fullscreen, async () => {
                    if (isRecording.value) return;
                    await info(`Global shortcut triggered: ${shortcuts.value.fullscreen}`);
                    await emit('shortcut-fullscreen');
                }],
                [shortcuts.value.region, async () => {
                    if (isRecording.value) return;
                    await info(`Global shortcut triggered: ${shortcuts.value.region}`);
                    await emit('shortcut-region');
                }],
                [shortcuts.value.window, async () => {
                    if (isRecording.value) return;
                    await info(`Global shortcut triggered: ${shortcuts.value.window}`);
                    const appWindow = getCurrentWindow();
                    await appWindow.show();
                    await appWindow.setFocus();
                    await emit('shortcut-window');
                }],
                [shortcuts.value.recordFullscreen, async () => {
                    if (isRecording.value) return;
                    await info(`Global shortcut triggered: ${shortcuts.value.recordFullscreen}`);
                    await emit('shortcut-record-fullscreen');
                }],
                [shortcuts.value.recordRegion, async () => {
                    if (isRecording.value) return;
                    await info(`Global shortcut triggered: ${shortcuts.value.recordRegion}`);
                    await emit('shortcut-record-region');
                }],
                [shortcuts.value.recordWindow, async () => {
                    if (isRecording.value) return;
                    await info(`Global shortcut triggered: ${shortcuts.value.recordWindow}`);
                    await emit('shortcut-record-window');
                }],
                [shortcuts.value.pauseRecording, async () => {
                    if (isRecording.value) return;
                    await info(`Global shortcut triggered: ${shortcuts.value.pauseRecording}`);
                    await emit('shortcut-pause-recording');
                }],
                [shortcuts.value.stopRecording, async () => {
                    if (isRecording.value) return;
                    await info(`Global shortcut triggered: ${shortcuts.value.stopRecording}`);
                    await emit('shortcut-stop-recording');
                }],
                [shortcuts.value.captureToolbar, async () => {
                    if (isRecording.value) return;
                    await info(`Global shortcut triggered: ${shortcuts.value.captureToolbar}`);
                    const toolbar = await WebviewWindow.getByLabel('capture_toolbar');
                    if (toolbar) {
                        const visible = await toolbar.isVisible();
                        if (visible) {
                            await toolbar.hide();
                        } else {
                            await emit('request-show-capture-bar');
                        }
                    }
                }],
            ];

            for (const [shortcut, handler] of handlers) {
                if (!shortcut) continue;
                try {
                    const registered = await isRegistered(shortcut);
                    if (!registered) {
                        await register(shortcut, async (eventPayload) => {
                            await info(`Shortcut callback FIRED for ${shortcut}! Payload: ${JSON.stringify(eventPayload)}`);
                            // Handle both possible structures of eventPayload in v2
                            const payload = eventPayload as any;
                            const isPressed = payload?.state === 'Pressed' || payload === 'Pressed' || !payload?.state;

                            if (isPressed) {
                                await info(`Executing handler for ${shortcut}`);
                                handler();
                            }
                        });
                        await info(`Successfully registered shortcut: ${shortcut}`);
                    } else {
                        await info(`Shortcut already registered: ${shortcut}`);
                    }
                } catch (e) {
                    const errMsg = `Failed to register shortcut ${shortcut}: ${e}`;
                    console.error(errMsg);
                    await error(errMsg);
                }
            }
        } catch (e) {
            const errMsg = `Failed to apply shortcuts: ${e}`;
            console.error(errMsg);
            await error(errMsg);
        } finally {
            isApplyingShortcuts = false;
        }
    }

    async function testAndSaveShortcut(key: keyof ShortcutsConfig, shortcutStr: string): Promise<boolean> {
        try {
            // Check if the OS considers it already registered
            const registered = await isRegistered(shortcutStr);
            if (registered) {
                // If it's already registered, it could be registered by us!
                // To be safe, we must test if it's one of OUR current shortcuts.
                const isOurs = Object.values(shortcuts.value).includes(shortcutStr);
                if (!isOurs) {
                    return false; // Taken by another app
                }
            }

            // Attempt to register it temporarily to see if the OS rejects it (e.g. F12)
            try {
                await register(shortcutStr, () => { });
                await unregisterAll(); // Need to wipe because we just polluted the registry
                await applyShortcuts(); // Restore ours
            } catch (e) {
                return false; // OS rejected it lock-out
            }

            // Test passed, save it
            shortcuts.value[key] = shortcutStr;
            return true;
        } catch (e) {
            console.error('Shortcut test failed:', e);
            return false;
        }
    }

    return {
        isReady,
        isRecording,
        locale,
        autostart,
        shortcuts,
        autoSaveEnabled,
        autoSaveScreenshotFolder,
        autoSaveVideoFolder,
        ocrEngine,
        loadSettings,
        init,
        toggleAutostart,
        applyShortcuts,
        testAndSaveShortcut
    };
});
