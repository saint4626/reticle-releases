import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEditorStore } from '../stores/editor';
import { useHistoryStore } from '../stores/history';
import { useVideoStore } from '../stores/video';
import { useNotificationStore } from '../stores/notification';
import { useSettingsStore } from '../stores/settings';
import { binaryToBlobUrl, BlobUrlManager } from '../utils/blob';
import { cropImage } from '../utils/image';
import { saveUrlToHistory } from '../utils/history';
import { renderEditorImageAsBytes } from '../utils/editorRender';
import { useOverlay } from './useOverlay';
import type { MonitorInfo } from '../types';
import { CAPTURE_HIDE_DELAY_MS, REGION_PREPARE_DELAY_MS } from '../utils/constants';

/**
 * Composable for all capture-related logic: fullscreen, region, window, monitor selection.
 */
export function useCapture() {
    const store = useEditorStore();
    const historyStore = useHistoryStore();
    const videoStore = useVideoStore();
    const notificationStore = useNotificationStore();
    const settingsStore = useSettingsStore();
    const { openRegionOverlay, exitRegionMode } = useOverlay();
    const blobManager = new BlobUrlManager();

    const isWindowMode = ref(false);
    const isMonitorSelectorMode = ref(false);
    const pendingAction = ref<'fullscreen' | 'region' | 'record_fullscreen' | null>(null);
    const monitors = ref<MonitorInfo[]>([]);
    const monitorPreviews = ref<Record<number, string>>({});
    const selectedMonitorId = ref<number | undefined>(undefined);
    const fullscreenScreenshot = ref<string | null>(null);

    async function autoSaveOriginal(bytes: Uint8Array) {
        try {
            const targetDir = settingsStore.autoSaveEnabled && settingsStore.autoSaveScreenshotFolder
                ? settingsStore.autoSaveScreenshotFolder
                : undefined;
            await invoke<string>('save_image', { bytes, targetDir });
        } catch (e) {
            console.error('Failed to auto-save original screenshot:', e);
        }
    }

    function getRenderState() {
        return {
            imageData: store.imageData,
            padding: store.padding,
            borderRadius: store.borderRadius,
            background: store.background,
            backgroundImage: store.backgroundImage,
            backgroundBlur: store.backgroundBlur,
            shaderEnabled: store.shaderEnabled,
            shaderParams: store.shaderParams,
            shadowX: store.shadowX,
            shadowY: store.shadowY,
            shadowBlur: store.shadowBlur,
            shadowSpread: store.shadowSpread,
            shadowColor: store.shadowColor,
            shadowOpacity: store.shadowOpacity,
            shadowInset: store.shadowInset,
            blurs: store.blurs,
            arrows: store.arrows,
            stickers: store.stickers,
        };
    }

    async function autoCopyRendered() {
        if (!store.imageData) return;
        try {
            const bytes = await renderEditorImageAsBytes(getRenderState());
            await invoke('copy_to_clipboard', { bytes });
        } catch (e) {
            console.error('Failed to auto-copy screenshot:', e);
        }
    }

    async function refreshMonitorPreviews() {
        try {
            const previews = await invoke<Record<number, Uint8Array>>('get_monitor_previews');
            const urlPreviews: Record<number, string> = {};
            for (const [id, bytes] of Object.entries(previews)) {
                urlPreviews[Number(id)] = blobManager.register(binaryToBlobUrl(bytes, 'image/jpeg'));
            }
            monitorPreviews.value = urlPreviews;
        } catch (e) {
            console.error('Failed to get monitor previews:', e);
        }
    }

    async function fetchMonitors() {
        try {
            monitors.value = await invoke<MonitorInfo[]>('get_monitors');
        } catch (e) {
            console.error('Failed to get monitors:', e);
        }
    }

    async function captureFullscreen(monitorId?: number) {
        const appWindow = getCurrentWindow();

        if (await appWindow.isVisible()) {
            await appWindow.hide();
            await new Promise(r => setTimeout(r, CAPTURE_HIDE_DELAY_MS));
        }

        try {
            const result = await invoke<Uint8Array>('capture_fullscreen', { monitorId });
            const data = result instanceof Uint8Array ? result : new Uint8Array(result);
            const blob = new Blob([data as unknown as BlobPart], { type: 'image/png' });
            const url = blobManager.register(URL.createObjectURL(blob));
            store.setImage(url, blob);
            saveUrlToHistory(url, historyStore);
            void autoSaveOriginal(data);
            void autoCopyRendered();
            await appWindow.show();
            await appWindow.setFocus();
        } catch (e) {
            console.error('Fullscreen capture error:', e);
            await appWindow.show();
        }
    }

    async function startRegionCapture(monitor?: MonitorInfo) {
        const appWindow = getCurrentWindow();
        selectedMonitorId.value = monitor?.id;

        await appWindow.hide();
        await new Promise(r => setTimeout(r, REGION_PREPARE_DELAY_MS));

        try {
            const result = await invoke<Uint8Array>('capture_fullscreen', { monitorId: monitor?.id });
            const url = blobManager.register(binaryToBlobUrl(result));
            fullscreenScreenshot.value = url;
            await openRegionOverlay(monitor, result);
        } catch (e) {
            console.error(e);
            await appWindow.show();
        }
    }

    async function onMonitorSelect(monitor: MonitorInfo) {
        isMonitorSelectorMode.value = false;

        if (pendingAction.value === 'fullscreen') {
            await captureFullscreen(monitor.id);
        } else if (pendingAction.value === 'region') {
            await startRegionCapture(monitor);
        } else if (pendingAction.value === 'record_fullscreen') {
            const index = monitors.value.findIndex(m => m.id === monitor.id);
            videoStore.startRecording('screen', index !== -1 ? index.toString() : '0');
        }

        pendingAction.value = null;
    }

    async function onWindowCapture(win: { id: string, title: string }) {
        if (videoStore.isVideoMode) {
            videoStore.startRecording('window', win.title);
            isWindowMode.value = false;
            return;
        }

        try {
            const result = await invoke<Uint8Array>('capture_window', { id: win.id });
            const data = result instanceof Uint8Array ? result : new Uint8Array(result);
            const blob = new Blob([data as unknown as BlobPart], { type: 'image/png' });
            const url = blobManager.register(URL.createObjectURL(blob));
            store.setImage(url, blob);
            saveUrlToHistory(url, historyStore);
            void autoSaveOriginal(data);
            void autoCopyRendered();
            isWindowMode.value = false;
        } catch (e) {
            console.error('Window capture failed:', e);
            notificationStore.add('Failed to capture window: ' + e, 'error');
        }
    }

    async function onRegionConfirm(rect: { x: number, y: number, width: number, height: number, dpr?: number }) {
        // Use DPR from the overlay window (correct for multi-monitor setups with different scaling)
        const dpr = rect.dpr ?? window.devicePixelRatio ?? 1;

        if (videoStore.isVideoMode) {
            const x = Math.round(rect.x * dpr);
            const y = Math.round(rect.y * dpr);
            const w = Math.round(rect.width * dpr);
            const h = Math.round(rect.height * dpr);

            let monitorIndex = 0;
            if (selectedMonitorId.value !== undefined) {
                const idx = monitors.value.findIndex(m => m.id === selectedMonitorId.value);
                if (idx !== -1) monitorIndex = idx;
            }

            const idParam = `${monitorIndex}:${x},${y},${w},${h}`;
            await exitRegionMode();
            videoStore.startRecording('area', idParam);
            return;
        }

        if (fullscreenScreenshot.value) {
            try {
                const physicalRect = {
                    x: Math.round(rect.x * dpr),
                    y: Math.round(rect.y * dpr),
                    width: Math.round(rect.width * dpr),
                    height: Math.round(rect.height * dpr),
                };
                const croppedUrl = await cropImage(fullscreenScreenshot.value, physicalRect);
                const url = blobManager.register(croppedUrl);
                // Fetch the blob so we can recreate the URL after navigation
                const blob = await fetch(url).then(r => r.blob());
                store.setImage(url, blob);
                saveUrlToHistory(url, historyStore);
                const originalBytes = new Uint8Array(await blob.arrayBuffer());
                void autoSaveOriginal(originalBytes);
                void autoCopyRendered();
            } catch (e) {
                console.error('[RegionConfirm] crop failed:', e);
                notificationStore.add('Failed to crop region: ' + e, 'error');
            }
        }

        await exitRegionMode();
    }

    async function onRegionCancel() {
        await exitRegionMode();
    }

    function cleanup() {
        blobManager.cleanup();
    }

    return {
        isWindowMode,
        isMonitorSelectorMode,
        pendingAction,
        monitors,
        monitorPreviews,
        selectedMonitorId,
        fullscreenScreenshot,
        fetchMonitors,
        refreshMonitorPreviews,
        captureFullscreen,
        startRegionCapture,
        onMonitorSelect,
        onWindowCapture,
        onRegionConfirm,
        onRegionCancel,
        cleanup
    };
}
