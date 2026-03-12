import { ref } from 'vue';
import { availableMonitors, primaryMonitor, getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen, emit } from '@tauri-apps/api/event';
import type { MonitorInfo } from '../types';

/**
 * Manages overlay window lifecycle (region overlay creation, positioning, image emission).
 */
export function useOverlay() {
    const overlayStyle = ref({ width: '100%', height: '100%', left: '0px', top: '0px' });

    async function resolveOverlayMonitor(target?: MonitorInfo) {
        try {
            const tauriMonitors = await availableMonitors();
            if (!tauriMonitors.length) {
                return await primaryMonitor();
            }

            if (target) {
                const byName = tauriMonitors.find((m) => m.name === target.name);
                if (byName) return byName;

                const byPosAndSize = tauriMonitors.find((m) =>
                    m.position.x === target.x &&
                    m.position.y === target.y &&
                    m.size.width === target.width &&
                    m.size.height === target.height
                );
                if (byPosAndSize) return byPosAndSize;

                const bySize = tauriMonitors.find((m) =>
                    m.size.width === target.width &&
                    m.size.height === target.height
                );
                if (bySize) return bySize;
            }

            return await primaryMonitor() ?? tauriMonitors[0];
        } catch {
            return null;
        }
    }

    async function openRegionOverlay(monitor: MonitorInfo | undefined, imageBytes: Uint8Array) {
        const existing = await WebviewWindow.getByLabel('region_overlay');
        const targetMonitor = await resolveOverlayMonitor(monitor);

        if (existing) {
            if (targetMonitor) {
                await existing.setPosition(new PhysicalPosition(targetMonitor.position.x, targetMonitor.position.y));
                await existing.setSize(new PhysicalSize(targetMonitor.size.width, targetMonitor.size.height));
            } else if (monitor) {
                await existing.setPosition(new PhysicalPosition(monitor.x, monitor.y));
                await existing.setSize(new PhysicalSize(monitor.width, monitor.height));
            }
            await existing.show();
            await existing.setFocus();
            await emit('region-overlay-reset', null);
            await emit('region-overlay-image', Array.from(imageBytes));
            return;
        }

        const unlistenReady = await listen('region-overlay-ready', async () => {
            unlistenReady();
            await emit('region-overlay-reset', null);
            await emit('region-overlay-image', Array.from(imageBytes));
        });

        const overlay = new WebviewWindow('region_overlay', {
            url: 'index.html?region_overlay=true',
            decorations: false,
            transparent: true,
            alwaysOnTop: true,
            skipTaskbar: true,
            resizable: false,
            visible: false,
            shadow: false
        });

        overlay.once('tauri://created', async () => {
            if (targetMonitor) {
                await overlay.setPosition(new PhysicalPosition(targetMonitor.position.x, targetMonitor.position.y));
                await overlay.setSize(new PhysicalSize(targetMonitor.size.width, targetMonitor.size.height));
            } else if (monitor) {
                await overlay.setPosition(new PhysicalPosition(monitor.x, monitor.y));
                await overlay.setSize(new PhysicalSize(monitor.width, monitor.height));
            }

            await overlay.show();
            await overlay.setFocus();
        });

        overlay.once('tauri://error', async () => {
            unlistenReady();
            const appWindow = getCurrentWindow();
            await appWindow.show();
            await appWindow.setFocus();
        });
    }

    async function exitRegionMode() {
        const appWindow = getCurrentWindow();
        const overlay = await WebviewWindow.getByLabel('region_overlay');
        if (overlay) {
            await overlay.hide();
        }
        await appWindow.show();
        await appWindow.setFocus();
    }

    function initRecordOverlayStyle() {
        document.body.style.backgroundColor = 'transparent';
        document.documentElement.style.backgroundColor = 'transparent';
        document.documentElement.style.margin = '0';
        document.documentElement.style.padding = '0';

        const appEl = document.getElementById('app');
        if (appEl) {
            appEl.style.margin = '0';
            appEl.style.padding = '0';
            appEl.style.position = 'absolute';
            appEl.style.inset = '0';
        }

        const params = new URLSearchParams(window.location.search);
        if (params.get('overlay') === 'true') {
            document.body.style.margin = '0';
            document.body.style.padding = '0';
            document.body.style.overflow = 'hidden';

            const w = parseFloat(params.get('w') || '0');
            const h = parseFloat(params.get('h') || '0');
            const x = parseFloat(params.get('x') || '0');
            const y = parseFloat(params.get('y') || '0');
            const scaleParam = parseFloat(params.get('scale') || '0');

            if (w > 0 && h > 0) {
                const dpr = scaleParam > 0 ? scaleParam : (window.devicePixelRatio || 1);
                const wCss = w / dpr;
                const hCss = h / dpr;
                const xCss = x / dpr;
                const yCss = y / dpr;

                overlayStyle.value = {
                    width: `${wCss}px`,
                    height: `${hCss}px`,
                    left: `${xCss}px`,
                    top: `${yCss}px`
                };
            }
        }
    }

    return {
        overlayStyle,
        openRegionOverlay,
        exitRegionMode,
        initRecordOverlayStyle,
        resolveOverlayMonitor
    };
}
