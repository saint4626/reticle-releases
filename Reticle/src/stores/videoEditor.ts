import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import { info, error as logError } from '@tauri-apps/plugin-log';
import { readFile } from '@tauri-apps/plugin-fs';

// ---- Types ----

export interface ZoomKeyframe {
    id: string;
    time: number;       // seconds
    x: number;          // 0-1 normalized focus point
    y: number;          // 0-1 normalized focus point
    scale: number;      // zoom level (1 = no zoom, 2 = 2x, etc)
    duration: number;   // seconds to hold zoom
    easeIn: number;     // seconds for zoom-in transition
    easeOut: number;    // seconds for zoom-out transition
}

export interface ZoomSettings {
    enabled: boolean;
    scale: number;      // 2.0 - zoom magnification (1.5 - 4.0)
    easeIn: number;     // 0.3 - seconds to zoom in (0.1 - 1.0)
    easeOut: number;    // 0.35 - seconds to zoom out (0.1 - 1.0)
    holdBuffer: number; // 0.4 - extra hold after last click (0.0 - 2.0)
    cursorFollow: number;   // 0.6 - cursor follow strength during hold (0 - 1)
    deadZoneRadius: number; // 0.15 - dead zone radius for camera follow (0 - 0.5)
    keyframes: ZoomKeyframe[];
}

export interface VideoSession {
    videoPath: string;
    audioSystemPath: string;
    audioMicPath: string;
    trackingPath: string;
    fps: number;
    captureOffsetX?: number;
    captureOffsetY?: number;
    captureWidth?: number;
    captureHeight?: number;
    // Zoom settings (per-session, cleared when loading new video)
    zoomSettings?: ZoomSettings;
}

export interface VideoInfo {
    duration: number;
    width: number;
    height: number;
    fps: number;
}

export interface Thumbnail {
    time: number;
    data: string; // base64 JPEG
}

export interface TrackingEvent {
    timestamp: number;
    type: 'move' | 'click' | 'scroll' | 'key';
    x?: number;
    y?: number;
    button?: string;
    pressed?: boolean;
    dx?: number;
    dy?: number;
    key?: string;
    /** Active modifiers at the time of key event (Control, Shift, Alt, Meta) */
    modifiers?: string[];
    cursorStyle?: string;
}

export interface CaptureContext {
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
}

export interface TrackingData {
    captureContext?: CaptureContext;
    events: TrackingEvent[];
}

// ---- Constants ----

const THUMBNAIL_COUNT = 20;
const THUMBNAIL_WIDTH = 160;

// ---- Store ----

export const useVideoEditorStore = defineStore('videoEditor', () => {
    // Session
    const session = ref<VideoSession | null>(null);
    const videoInfo = ref<VideoInfo | null>(null);
    const videoSrc = ref<string | null>(null);

    // Playback
    const isPlaying = ref(false);
    const currentTime = ref(0);
    const duration = computed(() => videoInfo.value?.duration ?? 0);
    const isLoading = ref(false);

    // Timeline data
    const thumbnails = ref<Thumbnail[]>([]);
    const trackingEvents = ref<TrackingEvent[]>([]);
    const isLoadingThumbnails = ref(false);
    const isLoadingTracking = ref(false);

    // Trim
    const trimIn = ref(0);
    const trimOut = ref(0); // 0 means "use full duration" — set to duration on load

    // Music track
    const musicTrackPath = ref<string | null>(null);
    const musicVolume = ref(1.0);
    const musicMuted = ref(false);
    const musicOffset = ref(0.0);
    const musicDuration = ref(0.0);

    // System & Mic audio mix
    const sysVolume = ref(1.0);
    const sysMuted = ref(false);
    const micVolume = ref(1.0);
    const micMuted = ref(false);

    // Settings
    const captureCursor = ref(true);
    const captureKeys = ref(true);
    const enableSys = ref(true); // System audio
    const enableMic = ref(true); // Microphone

    // Key Overlay Settings
    const keyOverlayColor = ref('light'); // 'light', 'dark', 'accent'
    const keyOverlaySize = ref('medium'); // 'small', 'medium', 'large'
    const keyOverlayPosition = ref('bottom-center'); // 'bottom-center', 'bottom-left', 'bottom-right', 'top-left', 'top-right'

    // Video element reference (set by VideoEditorCanvas)
    const videoElement = ref<HTMLVideoElement | null>(null);

    // Event listener
    let unlistenSession: UnlistenFn | null = null;

    function setVideoSrc(src: string) {
        info(`[VideoEditor] Manually set src: ${src}`);
        // Clean up old if blob
        if (videoSrc.value && videoSrc.value.startsWith('blob:')) {
            URL.revokeObjectURL(videoSrc.value);
        }
        videoSrc.value = src;
    }

    /** Initialize listener for video-session-ready events from Rust */
    async function init() {
        if (unlistenSession) return;
        unlistenSession = await listen<VideoSession>('video-session-ready', (event) => {
            info(`Video session ready: ${event.payload.videoPath}`);
            loadSession(event.payload);
        });
    }

    /** Load a video session from recorded files */
    async function loadSession(sessionData: VideoSession) {
        // Set session with default zoom settings
        session.value = {
            ...sessionData,
            zoomSettings: {
                enabled: true,
                scale: 2.0,
                easeIn: 0.3,
                easeOut: 0.35,
                holdBuffer: 0.4,
                cursorFollow: 0.6,
                deadZoneRadius: 0.15,
                keyframes: []
            }
        };
        isLoading.value = true;

        try {
            // Revert to fixed delay: "Smart" check for > 0 bytes is not enough,
            // as the file might be non-empty but still invalid (half-written).
            // 1.5s delay was proven to work.
            info('[VideoEditor] Waiting 1.5s for file flush...');
            await new Promise(resolve => setTimeout(resolve, 1500));

            const fileData = await readFile(sessionData.videoPath);
            info(`[VideoEditor] Read file: ${fileData.length} bytes`);

            if (fileData.length === 0) {
                throw new Error("File is empty (0 bytes) after wait");
            }

            const blob = new Blob([fileData], { type: 'video/mp4' });
            const url = URL.createObjectURL(blob);

            // Clean up old URL if exists
            if (videoSrc.value && videoSrc.value.startsWith('blob:')) {
                URL.revokeObjectURL(videoSrc.value);
            }

            videoSrc.value = url;

        } catch (e) {
            logError(`Failed to read video file: ${e}`);
            // Fallback (unlikely to work if server is dead)
            const normalizedPath = sessionData.videoPath.replace(/\\/g, '/');
            videoSrc.value = convertFileSrc(normalizedPath);
        } finally {
            isLoading.value = false; // Reset loading state
        }

        isPlaying.value = false;
        currentTime.value = 0;
        trimIn.value = 0;
        trimOut.value = 0; // Will be set after videoInfo loads
        musicTrackPath.value = null;
        musicVolume.value = 1.0;
        musicMuted.value = false;
        musicOffset.value = 0.0;
        musicDuration.value = 0.0;
        sysVolume.value = 1.0;
        sysMuted.value = false;
        micVolume.value = 1.0;
        micMuted.value = false;
        // Now that protocol-asset feature is enabled and permissions are set, this should work.
        // It is better than Blob because it supports streaming and range requests.
        // const normalizedPath = sessionData.videoPath.replace(/\\/g, '/');
        // const src = convertFileSrc(normalizedPath);

        // info(`[VideoEditor] Loading video via Asset Protocol: ${src}`);
        // videoSrc.value = src;

        // isPlaying.value = false;
        // currentTime.value = 0;

        // Fetch video metadata from Rust (ffmpeg)
        try {
            const meta = await invoke<VideoInfo>('get_video_info', { path: sessionData.videoPath });
            videoInfo.value = meta;
            info(`Video info: ${meta.width}x${meta.height}, ${meta.duration}s, ${meta.fps}fps`);
            // Initialize trimOut to full duration
            trimOut.value = meta.duration;
        } catch (e) {
            logError(`Failed to get video info: ${e}`);
            // Fallback
            videoInfo.value = { duration: 0, width: 1920, height: 1080, fps: sessionData.fps };
        }

        // Load thumbnails and tracking data in parallel (Rust does heavy I/O)
        loadThumbnails(sessionData.videoPath);
        loadTrackingData(sessionData.trackingPath);
    }

    /** Load thumbnail strip from Rust (ffmpeg frame extraction) */
    async function loadThumbnails(videoPath: string) {
        isLoadingThumbnails.value = true;
        try {
            const thumbs = await invoke<Thumbnail[]>('get_video_thumbnails', {
                path: videoPath,
                count: THUMBNAIL_COUNT,
                thumbWidth: THUMBNAIL_WIDTH,
            });
            thumbnails.value = thumbs;
        } catch (e) {
            logError(`Failed to load thumbnails: ${e}`);
            thumbnails.value = [];
        }
        isLoadingThumbnails.value = false;
    }

    /** Load tracking data from Rust (JSON parse on Rust side) */
    async function loadTrackingData(trackingPath: string) {
        isLoadingTracking.value = true;
        try {
            const data = await invoke<TrackingEvent[] | TrackingData>('read_tracking_data', { path: trackingPath });
            
            // Handle both old format (array) and new format (object with captureContext)
            if (Array.isArray(data)) {
                // Old format: just an array of events
                trackingEvents.value = data;
                info(`Loaded ${data.length} tracking events (legacy format)`);
            } else {
                // New format: object with captureContext and events
                trackingEvents.value = data.events;
                
                // Store capture context in session if available
                if (data.captureContext && session.value) {
                    session.value.captureOffsetX = data.captureContext.offsetX;
                    session.value.captureOffsetY = data.captureContext.offsetY;
                    session.value.captureWidth = data.captureContext.width;
                    session.value.captureHeight = data.captureContext.height;
                    info(`Loaded ${data.events.length} tracking events with capture context: offset=(${data.captureContext.offsetX}, ${data.captureContext.offsetY}), size=${data.captureContext.width}x${data.captureContext.height}`);
                } else {
                    info(`Loaded ${data.events.length} tracking events (no capture context)`);
                }
            }
        } catch (e) {
            logError(`Failed to load tracking data: ${e}`);
            trackingEvents.value = [];
        }
        isLoadingTracking.value = false;
    }

    // ---- Playback controls ----

    function play() {
        if (!videoElement.value) {
            logError('[VideoEditorStore] play() called but videoElement is null');
            return;
        }
        info('[VideoEditorStore] Calling video.play()');
        videoElement.value.play().catch(e => {
            logError(`[VideoEditorStore] Play failed: ${e}`);
        });
        isPlaying.value = true;
    }

    function pause() {
        if (!videoElement.value) return;
        videoElement.value.pause();
        isPlaying.value = false;
    }

    function togglePlay() {
        if (isPlaying.value) pause();
        else play();
    }

    function seek(time: number) {
        if (!videoElement.value) {
            logError('[VideoEditorStore] seek() called but videoElement is null');
            return;
        }
        videoElement.value.currentTime = time;
        currentTime.value = time;
    }

    /** Called by VideoEditorCanvas on timeupdate */
    function onTimeUpdate(time: number) {
        currentTime.value = time;
    }

    /** Register the video element for playback control */
    function setVideoElement(el: HTMLVideoElement | null) {
        info(`[VideoEditorStore] setVideoElement: ${el ? 'HTMLVideoElement' : 'null'}`);
        videoElement.value = el;
    }

    /** Close the video editor session */
    function closeSession() {
        if (session.value && videoSrc.value && videoSrc.value.startsWith('blob:')) {
            URL.revokeObjectURL(videoSrc.value);
        }
        session.value = null;
        videoInfo.value = null;
        videoSrc.value = null;
        isPlaying.value = false;
        currentTime.value = 0;
        trimIn.value = 0;
        trimOut.value = 0;
        thumbnails.value = [];
        trackingEvents.value = [];
        videoElement.value = null;
        musicTrackPath.value = null;
        musicVolume.value = 1.0;
        musicMuted.value = false;
        musicOffset.value = 0.0;
        musicDuration.value = 0.0;
        sysVolume.value = 1.0;
        sysMuted.value = false;
        micVolume.value = 1.0;
        micMuted.value = false;
    }

    // ---- Zoom management ----

    function updateZoomSettings(settings: Partial<ZoomSettings>) {
        if (!session.value) return;
        if (!session.value.zoomSettings) {
            session.value.zoomSettings = {
                enabled: true,
                scale: 2.0,
                easeIn: 0.3,
                easeOut: 0.35,
                holdBuffer: 0.4,
                cursorFollow: 0.6,
                deadZoneRadius: 0.15,
                keyframes: []
            };
        }
        session.value.zoomSettings = {
            ...session.value.zoomSettings,
            ...settings
        };
    }

    function setZoomKeyframes(keyframes: ZoomKeyframe[]) {
        if (!session.value?.zoomSettings) return;
        session.value.zoomSettings.keyframes = keyframes;
    }

    function addZoomKeyframe(keyframe: ZoomKeyframe) {
        if (!session.value?.zoomSettings) return;
        session.value.zoomSettings.keyframes.push(keyframe);
        // Sort by time
        session.value.zoomSettings.keyframes.sort((a, b) => a.time - b.time);
    }

    function removeZoomKeyframe(id: string) {
        if (!session.value?.zoomSettings) return;
        session.value.zoomSettings.keyframes = session.value.zoomSettings.keyframes.filter(k => k.id !== id);
    }

    function clearZoomKeyframes() {
        if (!session.value?.zoomSettings) return;
        session.value.zoomSettings.keyframes = [];
    }

    function setTrimIn(t: number) {
        const max = trimOut.value > 0 ? trimOut.value : duration.value;
        trimIn.value = Math.max(0, Math.min(t, max - 0.1));
    }

    function setTrimOut(t: number) {
        trimOut.value = Math.max(trimIn.value + 0.1, Math.min(t, duration.value));
    }

    function setMusicTrack(path: string | null) {
        musicTrackPath.value = path;
        musicOffset.value = 0.0;
        musicDuration.value = 0.0;
    }

    function setMusicVolume(v: number) {
        musicVolume.value = Math.max(0, Math.min(2, v));
    }

    function setMusicMuted(v: boolean) {
        musicMuted.value = v;
    }

    function setSysVolume(v: number) { sysVolume.value = Math.max(0, Math.min(2, v)); }
    function setSysMuted(v: boolean) { sysMuted.value = v; }
    function setMicVolume(v: number) { micVolume.value = Math.max(0, Math.min(2, v)); }
    function setMicMuted(v: boolean) { micMuted.value = v; }

    function setMusicDuration(v: number) {
        musicDuration.value = v;
    }

    function setMusicOffset(v: number) {
        // Clamp: can't go past (musicDuration - videoDuration), can't go below 0
        const maxOffset = musicDuration.value > 0
            ? Math.max(0, musicDuration.value - duration.value)
            : v;
        musicOffset.value = Math.max(0, Math.min(v, maxOffset));
    }

    /** Cleanup listener */
    function destroy() {
        if (unlistenSession) {
            unlistenSession();
            unlistenSession = null;
        }
        closeSession();
    }

    return {
        // State
        session,
        videoInfo,
        videoSrc,
        isPlaying,
        currentTime,
        duration,
        trimIn,
        trimOut,
        thumbnails,
        trackingEvents,
        isLoadingThumbnails,
        isLoadingTracking,
        isLoading, // Export isLoading
        videoElement,
        captureCursor,
        captureKeys,
        enableSys,
        enableMic,
        // Key Overlay
        keyOverlayColor,
        keyOverlaySize,
        keyOverlayPosition,
        // Actions
        init,
        loadSession,
        play,
        pause,
        togglePlay,
        seek,
        onTimeUpdate,
        setVideoElement,
        setVideoSrc,
        closeSession,
        destroy,
        // Trim
        setTrimIn,
        setTrimOut,
        // Music
        musicTrackPath,
        musicVolume,
        musicMuted,
        musicOffset,
        musicDuration,
        setMusicTrack,
        setMusicVolume,
        setMusicMuted,
        setMusicOffset,
        setMusicDuration,
        // Sys/Mic mix
        sysVolume,
        sysMuted,
        micVolume,
        micMuted,
        setSysVolume,
        setSysMuted,
        setMicVolume,
        setMicMuted,
        // Zoom
        updateZoomSettings,
        setZoomKeyframes,
        addZoomKeyframe,
        removeZoomKeyframe,
        clearZoomKeyframes,
    };
});
