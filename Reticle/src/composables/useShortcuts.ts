import { onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import type { MonitorInfo } from '../types';

import { useVideoStore } from '../stores/video';

interface ShortcutHandlers {
    monitors: { value: MonitorInfo[] };
    pendingAction: { value: 'fullscreen' | 'region' | 'record_fullscreen' | null };
    isMonitorSelectorMode: { value: boolean };
    isWindowMode: { value: boolean };
    captureFullscreen: (monitorId?: number) => Promise<void>;
    startRegionCapture: (monitor?: MonitorInfo) => Promise<void>;
    refreshMonitorPreviews: () => Promise<void>;
    onRegionConfirm: (rect: { x: number; y: number; width: number; height: number; dpr?: number }) => Promise<void>;
    onRegionCancel: () => Promise<void>;
    onWindowCapture: (win: { id: string; title: string }) => Promise<void>;
}

/**
 * Sets up global shortcut listeners for capture actions.
 * Automatically cleans up on component unmount.
 */
export function useShortcuts(handlers: ShortcutHandlers) {
    const unlisteners: UnlistenFn[] = [];

    async function setup() {
        // Fullscreen shortcut
        const unlistenFullscreen = await listen('shortcut-fullscreen', async () => {
            const appWindow = getCurrentWindow();

            try {
                handlers.monitors.value = await invoke<MonitorInfo[]>('get_monitors');
            } catch (e) { console.error(e); }

            if (handlers.monitors.value.length > 1) {
                handlers.pendingAction.value = 'fullscreen';
                handlers.isMonitorSelectorMode.value = true;
                await handlers.refreshMonitorPreviews();
                await appWindow.show();
                await appWindow.setFocus();
                return;
            }

            await handlers.captureFullscreen();
        });
        unlisteners.push(unlistenFullscreen);

        // Region shortcut
        const unlistenRegion = await listen('shortcut-region', async () => {
            try {
                handlers.monitors.value = await invoke<MonitorInfo[]>('get_monitors');
            } catch (e) { console.error(e); }

            if (handlers.monitors.value.length > 1) {
                handlers.pendingAction.value = 'region';
                handlers.isMonitorSelectorMode.value = true;
                await handlers.refreshMonitorPreviews();
                const appWindow = getCurrentWindow();
                await appWindow.show();
                await appWindow.setFocus();
                return;
            }

            await handlers.startRegionCapture();
        });
        unlisteners.push(unlistenRegion);

        // Window shortcut
        const unlistenWindow = await listen('shortcut-window', async () => {
            const videoStore = useVideoStore();
            videoStore.isVideoMode = false;
            handlers.isWindowMode.value = true;
        });
        unlisteners.push(unlistenWindow);

        // --- Capture Bar Direct Actions ---
        const unlistenDirectFullscreen = await listen('capture-bar-fullscreen', async (event: any) => {
            await handlers.captureFullscreen(event.payload?.monitorId);
        });
        unlisteners.push(unlistenDirectFullscreen);

        const unlistenDirectRegion = await listen('capture-bar-region', async (event: any) => {
            await handlers.startRegionCapture(event.payload?.monitor);
        });
        unlisteners.push(unlistenDirectRegion);

        const unlistenDirectWindow = await listen('capture-bar-window', async (event: any) => {
            const videoStore = useVideoStore();
            videoStore.isVideoMode = false;
            if (event.payload?.window?.id) {
                await handlers.onWindowCapture(event.payload.window);
                return;
            }
            handlers.isWindowMode.value = true;
        });
        unlisteners.push(unlistenDirectWindow);

        // --- Video Shortcuts ---

        const unlistenRecordFullscreen = await listen('shortcut-record-fullscreen', async () => {
            const videoStore = useVideoStore();
            const appWindow = getCurrentWindow();
            videoStore.isVideoMode = true;

            try {
                handlers.monitors.value = await invoke<MonitorInfo[]>('get_monitors');
            } catch (e) { console.error(e); }

            if (handlers.monitors.value.length > 1) {
                handlers.pendingAction.value = 'record_fullscreen';
                handlers.isMonitorSelectorMode.value = true;
                await handlers.refreshMonitorPreviews();
                await appWindow.show();
                await appWindow.setFocus();
                return;
            }

            await videoStore.startRecording('screen');
        });
        unlisteners.push(unlistenRecordFullscreen);

        const unlistenRecordRegion = await listen('shortcut-record-region', async () => {
            const videoStore = useVideoStore();
            videoStore.isVideoMode = true;

            try {
                handlers.monitors.value = await invoke<MonitorInfo[]>('get_monitors');
            } catch (e) { console.error(e); }

            if (handlers.monitors.value.length > 1) {
                // For region, we still just use 'region' pendingAction, 
                // because onRegionConfirm checks videoStore.isVideoMode anyway!
                handlers.pendingAction.value = 'region';
                handlers.isMonitorSelectorMode.value = true;
                await handlers.refreshMonitorPreviews();
                const appWindow = getCurrentWindow();
                await appWindow.show();
                await appWindow.setFocus();
                return;
            }

            await handlers.startRegionCapture();
        });
        unlisteners.push(unlistenRecordRegion);

        const unlistenRecordWindow = await listen('shortcut-record-window', async () => {
            const videoStore = useVideoStore();
            videoStore.isVideoMode = true;
            handlers.isWindowMode.value = true;
        });
        unlisteners.push(unlistenRecordWindow);

        const unlistenPauseRecording = await listen('shortcut-pause-recording', async () => {
            const videoStore = useVideoStore();
            if (videoStore.isRecording) {
                await videoStore.togglePause();
            }
        });
        unlisteners.push(unlistenPauseRecording);

        const unlistenStopRecording = await listen('shortcut-stop-recording', async () => {
            const videoStore = useVideoStore();
            // We only want to trigger stop if it actually is recording
            if (videoStore.isRecording || videoStore.isCountingDown) {
                await videoStore.stopRecording();
            }
        });
        unlisteners.push(unlistenStopRecording);

        // Region overlay events
        const unlistenConfirm = await listen('region-overlay-confirm', async (event) => {
            await handlers.onRegionConfirm(event.payload as { x: number, y: number, width: number, height: number, dpr?: number });
        });
        unlisteners.push(unlistenConfirm);

        const unlistenCancel = await listen('region-overlay-cancel', async () => {
            await handlers.onRegionCancel();
        });
        unlisteners.push(unlistenCancel);
    }

    function cleanup() {
        unlisteners.forEach(fn => fn());
        unlisteners.length = 0;
    }

    onUnmounted(cleanup);

    return { setup, cleanup };
}
