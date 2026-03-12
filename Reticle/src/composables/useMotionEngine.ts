import { ref, computed, watch } from 'vue';
import { useVideoEditorStore, type ZoomKeyframe } from '../stores/videoEditor';
import { storeToRefs } from 'pinia';
import type { TrackingEvent, CaptureContext } from '../stores/videoEditor';
import {
    calculateZoomAtTime as calcZoom,
    springEase,
    DEFAULT_SPRING_CONFIG,
    type ZoomSpringState,
    type ZoomState as ZoomCalcState,
} from '../utils/zoomCalculator';

// ---- Types ----

export interface ZoomState {
    scale: number;
    offsetX: number;    // 0-1 normalized
    offsetY: number;    // 0-1 normalized
}

interface SpringState {
    x: number;
    y: number;
    vx: number;
    vy: number;
}

// ---- Helpers ----

function generateId(): string {
    return Math.random().toString(36).substring(2, 9);
}


function clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
}

/**
 * Validates a capture context object to ensure all fields are present and valid.
 * 
 * Checks:
 * - All fields (offsetX, offsetY, width, height) are defined
 * - All values are finite numbers (not NaN or Infinity)
 * - Dimensions (width, height) are positive
 * 
 * @param ctx - Partial capture context to validate
 * @returns true if valid, false otherwise
 */
function validateCaptureContext(ctx: Partial<CaptureContext>): boolean {
    // Check all fields are present
    if (ctx.offsetX === undefined || ctx.offsetY === undefined ||
        ctx.width === undefined || ctx.height === undefined) {
        return false;
    }
    
    // Check for valid numbers
    if (!Number.isFinite(ctx.offsetX) || !Number.isFinite(ctx.offsetY) ||
        !Number.isFinite(ctx.width) || !Number.isFinite(ctx.height)) {
        return false;
    }
    
    // Check dimensions are positive
    if (ctx.width <= 0 || ctx.height <= 0) {
        return false;
    }
    
    return true;
}

/**
 * Transforms global screen coordinates to video-relative normalized coordinates [0, 1].
 * 
 * Uses capture context from the video session to account for:
 * - Multi-monitor setups (monitors can have negative offsets)
 * - Region recordings (subset of screen)
 * - Window recordings (window position on screen)
 * 
 * Formula: videoCoord = (globalCoord - captureOffset) / captureDimension
 * 
 * Backward Compatibility:
 * - If capture context is missing (legacy recordings), defaults to:
 *   - offsetX = 0, offsetY = 0 (assumes primary monitor at origin)
 *   - captureWidth/Height = video dimensions (assumes full-screen recording)
 * - This ensures old recordings continue to work correctly on primary monitor
 * 
 * @param globalX - Global screen X coordinate (pixels)
 * @param globalY - Global screen Y coordinate (pixels)
 * @returns Normalized coordinates {x, y} in [0, 1] range, clamped to valid bounds
 */
function transformCoordinates(globalX: number, globalY: number): { x: number; y: number } {
    const videoEditor = useVideoEditorStore();
    const session = videoEditor.session;
    const videoInfo = videoEditor.videoInfo;
    
    // Backward compatibility: Default values when capture context is missing
    // offsetX=0, offsetY=0 assumes recording was on primary monitor at origin
    // captureWidth/Height defaults to video dimensions (full-screen recording)
    const offsetX = session?.captureOffsetX ?? 0;
    const offsetY = session?.captureOffsetY ?? 0;
    const captureWidth = session?.captureWidth ?? videoInfo?.width ?? 1920;
    const captureHeight = session?.captureHeight ?? videoInfo?.height ?? 1080;
    
    // Validate capture context and log warnings
    const ctx = { offsetX, offsetY, width: captureWidth, height: captureHeight };
    if (!validateCaptureContext(ctx)) {
        console.warn('[transformCoordinates] Invalid capture context:', ctx, '- using default (0.5, 0.5)');
        return { x: 0.5, y: 0.5 };
    }
    
    // Apply transformation formula
    const videoX = (globalX - offsetX) / captureWidth;
    const videoY = (globalY - offsetY) / captureHeight;
    
    // Clamp to [0, 1] range
    return {
        x: clamp(videoX, 0, 1),
        y: clamp(videoY, 0, 1)
    };
}

// ---- Professional easing for zoom (Screen Studio style) ----
//
// easeInOutQuart: Smooth, cinematic, no overshoot
// Perfect for professional screen recordings
// Used by Screen Studio, Loom, and other premium tools

// ---- Catmull-Rom spline interpolation ----
//
// Takes 4 control points and parameter t (0-1, between P1 and P2).
// Produces smooth curved path through P1→P2, influenced by P0 and P3.
// alpha=0.5 → centripetal Catmull-Rom (no cusps, no self-intersections)

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (
        (2 * p1) +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    );
}


// ---- Binary search for tracking events ----

function findNearestMoveEvents(
    events: TrackingEvent[],
    timeMs: number
): { before: TrackingEvent | null; after: TrackingEvent | null } {
    let lo = 0;
    let hi = events.length - 1;
    let bestBefore: TrackingEvent | null = null;
    let bestAfter: TrackingEvent | null = null;

    // Binary search for the insertion point
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const evt = events[mid];

        if (evt.timestamp <= timeMs) {
            if (evt.type === 'move' && evt.x !== undefined && evt.y !== undefined) {
                bestBefore = evt;
            }
            lo = mid + 1;
        } else {
            if (evt.type === 'move' && evt.x !== undefined && evt.y !== undefined) {
                bestAfter = evt;
            }
            hi = mid - 1;
        }
    }

    // If binary search missed exact neighbors, scan nearby
    if (!bestBefore || !bestAfter) {
        for (let i = lo - 1; i >= Math.max(0, lo - 50); i--) {
            const evt = events[i];
            if (evt.type === 'move' && evt.x !== undefined && evt.y !== undefined && evt.timestamp <= timeMs) {
                bestBefore = evt;
                break;
            }
        }
        for (let i = lo; i < Math.min(events.length, lo + 50); i++) {
            const evt = events[i];
            if (evt.type === 'move' && evt.x !== undefined && evt.y !== undefined && evt.timestamp > timeMs) {
                bestAfter = evt;
                break;
            }
        }
    }

    return { before: bestBefore, after: bestAfter };
}

// ---- Find 4 surrounding move events for Catmull-Rom ----
//
// Returns [P0, P1, P2, P3] where P1.timestamp <= timeMs < P2.timestamp
// P0 is one step before P1, P3 is one step after P2.
// If edge points are missing, they are mirrored from P1/P2.

function findFourMoveEvents(
    moveEvts: TrackingEvent[],
    timeMs: number
): { p0: TrackingEvent; p1: TrackingEvent; p2: TrackingEvent; p3: TrackingEvent; t: number } | null {
    if (moveEvts.length < 2) return null;

    // Binary search for P1 (last event <= timeMs)
    let lo = 0, hi = moveEvts.length - 1;
    let p1Idx = 0;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (moveEvts[mid].timestamp <= timeMs) {
            p1Idx = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    const p2Idx = Math.min(p1Idx + 1, moveEvts.length - 1);
    if (p1Idx === p2Idx) return null; // at the very end

    const p0Idx = Math.max(p1Idx - 1, 0);
    const p3Idx = Math.min(p2Idx + 1, moveEvts.length - 1);

    const p1 = moveEvts[p1Idx];
    const p2 = moveEvts[p2Idx];
    const dt = p2.timestamp - p1.timestamp;
    const t = dt > 0 ? clamp((timeMs - p1.timestamp) / dt, 0, 1) : 0;

    return {
        p0: moveEvts[p0Idx],
        p1,
        p2,
        p3: moveEvts[p3Idx],
        t,
    };
}

// ---- Composable (Singleton) ----

let instance: ReturnType<typeof createMotionEngine> | null = null;

function createMotionEngine() {
    const videoEditor = useVideoEditorStore();
    const { currentTime, duration, trackingEvents } = storeToRefs(videoEditor);

    // ---- Settings ----
    const cursorEnabled = computed({
        get: () => videoEditor.captureCursor,
        set: (v) => videoEditor.captureCursor = v
    });
    const keysEnabled = computed({
        get: () => videoEditor.captureKeys,
        set: (v) => videoEditor.captureKeys = v
    });
    
    const cursorSmoothing = ref(0.35);  // 0 = instant, 1 = very smooth (0.35 = snappy default)
    
    // Zoom enabled toggle - stored per-session
    const zoomEnabled = computed({
        get: () => videoEditor.session?.zoomSettings?.enabled ?? true,
        set: (v) => videoEditor.updateZoomSettings({ enabled: v })
    });

    // Cursor follow strength - how much camera follows cursor during hold (0-1)
    const cursorFollowStrength = computed({
        get: () => videoEditor.session?.zoomSettings?.cursorFollow ?? 0.6,
        set: (v) => videoEditor.updateZoomSettings({ cursorFollow: v })
    });

    // Dead zone radius - suppresses small cursor movements (0-0.5)
    const deadZoneRadius = computed({
        get: () => videoEditor.session?.zoomSettings?.deadZoneRadius ?? 0.15,
        set: (v) => videoEditor.updateZoomSettings({ deadZoneRadius: v })
    });

    // ---- Cursor state ----
    const rawCursorX = ref(0.5);
    const rawCursorY = ref(0.5);
    const cursorX = ref(0.5);       // spring-smoothed, 0-1 normalized
    const cursorY = ref(0.5);       // spring-smoothed, 0-1 normalized
    const cursorVisible = ref(false);
    const cursorClicking = ref(false);
    const cursorStyle = ref('default');
    const activeKeys = ref<TrackingEvent[]>([]);

    // Spring state (internal)
    const spring: SpringState = { x: 0.5, y: 0.5, vx: 0, vy: 0 };

    // ---- Zoom spring state (internal) ----
    const zoomSpring: ZoomSpringState = {
        scale: 1,
        offsetX: 0.5,
        offsetY: 0.5,
        vScale: 0,
        vOffsetX: 0,
        vOffsetY: 0,
    };

    // ---- Zoom state ----
    // Keyframes are stored in videoEditor store, we provide computed access
    const zoomKeyframes = computed({
        get: () => videoEditor.session?.zoomSettings?.keyframes ?? [],
        set: (v) => videoEditor.setZoomKeyframes(v)
    });

    const currentZoom = ref<ZoomState>({ scale: 1, offsetX: 0, offsetY: 0 });

    // ---- Precomputed move-only events for faster lookup ----
    const moveEvents = computed(() => {
        return trackingEvents.value.filter(
            e => e.type === 'move' && e.x !== undefined && e.y !== undefined
        );
    });

    // ---- Cursor interpolation (Catmull-Rom spline) ----
    //
    // Instead of linear lerp between two points (which creates angular,
    // robotic paths), we use Catmull-Rom splines through 4 surrounding
    // move events. This produces organic, arc-like cursor trajectories
    // that mimic how humans actually move a mouse.

    function updateCursorPosition() {
        const timeMs = currentTime.value * 1000;

        // OPTIMIZATION: Use pre-computed key timeline instead of O(n) backward scan
        if (keysEnabled.value) {
            buildKeyTimeline(trackingEvents.value);
            activeKeys.value = getActiveKeysAtTime(timeMs);
        } else {
            activeKeys.value = [];
        }

        if (!cursorEnabled.value || moveEvents.value.length === 0) {
            cursorVisible.value = false;
            return;
        }

        // timeMs is already defined above
        const mEvts = moveEvents.value;

        let targetX: number;
        let targetY: number;

        // Try Catmull-Rom with 4 surrounding points
        const fourPts = findFourMoveEvents(mEvts, timeMs);
        if (fourPts) {
            const { p0, p1, p2, p3, t } = fourPts;
            
            // Transform all four points before interpolation
            const t0 = transformCoordinates(p0.x ?? 0, p0.y ?? 0);
            const t1 = transformCoordinates(p1.x ?? 0, p1.y ?? 0);
            const t2 = transformCoordinates(p2.x ?? 0, p2.y ?? 0);
            const t3 = transformCoordinates(p3.x ?? 0, p3.y ?? 0);
            
            targetX = catmullRom(t0.x, t1.x, t2.x, t3.x, t);
            targetY = catmullRom(t0.y, t1.y, t2.y, t3.y, t);
            
            // Update style from p1 (current segment start)
            cursorStyle.value = p1.cursorStyle || 'default';
            
            cursorVisible.value = true;
        } else {
            // Fallback: find nearest single event
            const { before } = findNearestMoveEvents(trackingEvents.value, timeMs);
            if (!before) {
                cursorVisible.value = false;
                return;
            }
            cursorVisible.value = true;
            
            const transformed = transformCoordinates(before.x ?? 0, before.y ?? 0);
            targetX = transformed.x;
            targetY = transformed.y;
            
            cursorStyle.value = before.cursorStyle || 'default';
        }

        rawCursorX.value = clamp(targetX, 0, 1);
        rawCursorY.value = clamp(targetY, 0, 1);

        // OPTIMIZATION: Binary search for click events instead of .some() O(n)
        const clickWindow = 150;
        const events = trackingEvents.value;
        let lo2 = 0, hi2 = events.length - 1, hasClick = false;
        while (lo2 <= hi2) {
            const mid = (lo2 + hi2) >> 1;
            if (events[mid].timestamp < timeMs - clickWindow) lo2 = mid + 1;
            else if (events[mid].timestamp > timeMs + clickWindow) hi2 = mid - 1;
            else {
                if (events[mid].type === 'click' && events[mid].pressed) { hasClick = true; break; }
                // scan both directions from mid
                for (let i = mid - 1; i >= lo2; i--) {
                    if (events[i].timestamp < timeMs - clickWindow) break;
                    if (events[i].type === 'click' && events[i].pressed) { hasClick = true; break; }
                }
                if (!hasClick) {
                    for (let i = mid + 1; i <= hi2; i++) {
                        if (events[i].timestamp > timeMs + clickWindow) break;
                        if (events[i].type === 'click' && events[i].pressed) { hasClick = true; break; }
                    }
                }
                break;
            }
        }
        cursorClicking.value = hasClick;
    }

    // ---- Pre-computed key state timeline ----
    //
    // OPTIMIZATION: Instead of scanning up to 5000ms of events backward on every RAF frame
    // (O(n) per frame), we pre-compute a sparse timeline of key state changes.
    // The timeline maps timestamp → active key list, built once when trackingEvents changes.
    // During playback we binary-search the timeline for O(log n) lookup.
    //
    // Structure: sorted array of { timeMs, keys: TrackingEvent[] }
    // Built lazily when trackingEvents changes (watch below).

    interface KeyTimelineEntry {
        timeMs: number;
        keys: TrackingEvent[];
    }

    let keyTimeline: KeyTimelineEntry[] = [];
    let keyTimelineSource: TrackingEvent[] | null = null;

    function buildKeyTimeline(events: TrackingEvent[]): void {
        if (events === keyTimelineSource) return; // already built for this array
        keyTimelineSource = events;

        const keyEvents = events.filter(e => e.type === 'key' && e.key);
        if (keyEvents.length === 0) { keyTimeline = []; return; }

        // Collect all unique timestamps where key state changes
        const changePoints = new Set<number>();
        for (const e of keyEvents) changePoints.add(e.timestamp);

        const sortedPoints = [...changePoints].sort((a, b) => a - b);
        const RELEASE_WINDOW = 500;
        const SCAN_LIMIT = 5000;

        keyTimeline = sortedPoints.map(timeMs => {
            const active: TrackingEvent[] = [];
            const processedKeys = new Set<string>();

            // Find the index of the last event <= timeMs
            let lo = 0, hi = keyEvents.length - 1, idx = -1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (keyEvents[mid].timestamp <= timeMs) { idx = mid; lo = mid + 1; }
                else hi = mid - 1;
            }

            if (idx !== -1) {
                for (let i = idx; i >= 0; i--) {
                    const e = keyEvents[i];
                    if (timeMs - e.timestamp > SCAN_LIMIT) break;
                    if (!e.key || processedKeys.has(e.key)) continue;
                    if (e.pressed) {
                        active.push({ ...e, timestamp: timeMs });
                    } else if (timeMs - e.timestamp < RELEASE_WINDOW) {
                        active.push(e);
                    }
                    processedKeys.add(e.key);
                }
            }
            return { timeMs, keys: active };
        });
    }

    function getActiveKeysAtTime(timeMs: number): TrackingEvent[] {
        if (keyTimeline.length === 0) return [];

        // Binary search for the last entry <= timeMs
        let lo = 0, hi = keyTimeline.length - 1, idx = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (keyTimeline[mid].timeMs <= timeMs) { idx = mid; lo = mid + 1; }
            else hi = mid - 1;
        }

        if (idx === -1) return [];

        // The entry gives us the key state at the nearest change point before timeMs.
        // Filter out keys whose release window has expired relative to actual timeMs.
        const RELEASE_WINDOW = 500;
        return keyTimeline[idx].keys.filter(k => {
            // Held keys have timestamp updated to timeMs of the change point — always show
            // Released keys: check if still within release window from actual event time
            const originalEvent = trackingEvents.value.find(
                e => e.type === 'key' && e.key === k.key && !e.pressed &&
                     e.timestamp >= keyTimeline[idx].timeMs - RELEASE_WINDOW &&
                     e.timestamp <= keyTimeline[idx].timeMs
            );
            if (originalEvent) return timeMs - originalEvent.timestamp < RELEASE_WINDOW;
            return true; // held key
        });
    }

    /**
     * Imperative cursor position update for export pipeline.
     * Does NOT trigger Vue reactivity (no store.seek(), no currentTime mutation).
     * Called once per frame by useVideoExport instead of videoEditor.seek().
     */
    function updateCursorPositionAtTime(timeSec: number): void {
        const timeMs = timeSec * 1000;

        if (keysEnabled.value) {
            buildKeyTimeline(trackingEvents.value);
            activeKeys.value = getActiveKeysAtTime(timeMs);
        } else {
            activeKeys.value = [];
        }

        if (!cursorEnabled.value || moveEvents.value.length === 0) {
            cursorVisible.value = false;
            // Still update spring to current position
            spring.x = rawCursorX.value;
            spring.y = rawCursorY.value;
            cursorX.value = spring.x;
            cursorY.value = spring.y;
            return;
        }

        const mEvts = moveEvents.value;
        let targetX: number, targetY: number;

        const fourPts = findFourMoveEvents(mEvts, timeMs);
        if (fourPts) {
            const { p0, p1, p2, p3, t } = fourPts;
            const t0 = transformCoordinates(p0.x ?? 0, p0.y ?? 0);
            const t1 = transformCoordinates(p1.x ?? 0, p1.y ?? 0);
            const t2 = transformCoordinates(p2.x ?? 0, p2.y ?? 0);
            const t3 = transformCoordinates(p3.x ?? 0, p3.y ?? 0);
            targetX = catmullRom(t0.x, t1.x, t2.x, t3.x, t);
            targetY = catmullRom(t0.y, t1.y, t2.y, t3.y, t);
            cursorStyle.value = p1.cursorStyle || 'default';
            cursorVisible.value = true;
        } else {
            const { before } = findNearestMoveEvents(trackingEvents.value, timeMs);
            if (!before) { cursorVisible.value = false; return; }
            const transformed = transformCoordinates(before.x ?? 0, before.y ?? 0);
            targetX = transformed.x;
            targetY = transformed.y;
            cursorStyle.value = before.cursorStyle || 'default';
            cursorVisible.value = true;
        }

        rawCursorX.value = clamp(targetX, 0, 1);
        rawCursorY.value = clamp(targetY, 0, 1);

        // For export: no spring smoothing — use direct position for frame-accurate output
        spring.x = rawCursorX.value;
        spring.y = rawCursorY.value;
        cursorX.value = spring.x;
        cursorY.value = spring.y;

        // Click detection
        const clickWindow = 150;
        const hasClick = trackingEvents.value.some(
            e => e.type === 'click' && e.pressed && Math.abs(e.timestamp - timeMs) < clickWindow
        );
        cursorClicking.value = hasClick;
    }

    // Invalidate key timeline when tracking events change
    watch(trackingEvents, () => {
        keyTimelineSource = null;
        keyTimeline = [];
    });

    // ---- Spring physics ----
    //
    // Design: high stiffness for responsiveness, near-critical damping to avoid oscillation.
    // At smoothing=0.35:  stiffness ≈ 295, damping ≈ 30 → snappy, minimal lag
    // At smoothing=0:     instant (no spring)
    // At smoothing=1:     stiffness = 100, damping ≈ 20 → visibly smooth

    function updateSpring(dt: number) {
        if (cursorSmoothing.value <= 0.01) {
            // No smoothing, direct assignment
            spring.x = rawCursorX.value;
            spring.y = rawCursorY.value;
            spring.vx = 0;
            spring.vy = 0;
        } else {
            const s = cursorSmoothing.value;
            // Stiffness: 400 (instant) → 100 (smooth)
            const stiffness = 400 - s * 300;
            // Near-critical damping: 2 * sqrt(k) for critical, stay slightly under
            const damping = 2 * Math.sqrt(stiffness) * (0.85 + s * 0.15);

            // Spring force toward target
            const dx = rawCursorX.value - spring.x;
            const dy = rawCursorY.value - spring.y;

            // Acceleration = (spring force - damping) / mass(1)
            const ax = stiffness * dx - damping * spring.vx;
            const ay = stiffness * dy - damping * spring.vy;

            // Semi-implicit Euler integration
            spring.vx += ax * dt;
            spring.vy += ay * dt;
            spring.x += spring.vx * dt;
            spring.y += spring.vy * dt;
        }

        cursorX.value = clamp(spring.x, 0, 1);
        cursorY.value = clamp(spring.y, 0, 1);
    }

    // ---- Zoom spring smoothing ----
    //
    // Applies spring physics to zoom state (scale, offsetX, offsetY).
    // Uses the shared springEase() from zoomCalculator.ts.
    // dt is capped at 0.05s for integration stability.
    // scale is clamped >= 1.0, offsets clamped to [0, 1].

    function updateZoomSpring(target: ZoomCalcState, dt: number): ZoomCalcState {
        const cappedDt = Math.min(dt, 0.05);

        const s = springEase(zoomSpring.scale, target.scale, zoomSpring.vScale, DEFAULT_SPRING_CONFIG, cappedDt);
        const ox = springEase(zoomSpring.offsetX, target.offsetX, zoomSpring.vOffsetX, DEFAULT_SPRING_CONFIG, cappedDt);
        const oy = springEase(zoomSpring.offsetY, target.offsetY, zoomSpring.vOffsetY, DEFAULT_SPRING_CONFIG, cappedDt);

        zoomSpring.scale = s.value;
        zoomSpring.vScale = s.velocity;
        zoomSpring.offsetX = ox.value;
        zoomSpring.vOffsetX = ox.velocity;
        zoomSpring.offsetY = oy.value;
        zoomSpring.vOffsetY = oy.velocity;

        return {
            scale: Math.max(1, zoomSpring.scale),
            offsetX: clamp(zoomSpring.offsetX, 0, 1),
            offsetY: clamp(zoomSpring.offsetY, 0, 1),
        };
    }

    // ---- Zoom calculation (overlap-aware + spring) ----
    //
    // Features:
    // 1. Overlap detection: smooth pan instead of jarring zoom-out/zoom-in
    // 2. Spring ease: subtle overshoot for organic, physical feel

    // Cached sorted keyframes — avoids [...kfs].sort() on every RAF frame
    let _sortedKfs: typeof zoomKeyframes.value = [];
    let _sortedKfsVersion = 0;
    watch(zoomKeyframes, () => { _sortedKfsVersion++; });

    function getSortedKfs() {
        const kfs = zoomKeyframes.value;
        if (_sortedKfs.length !== kfs.length || _sortedKfsVersion > 0) {
            _sortedKfs = [...kfs].sort((a, b) => a.time - b.time);
            _sortedKfsVersion = 0;
        }
        return _sortedKfs;
    }

    // ---- Keyframe management ----

    function addKeyframe(
        time: number, x: number, y: number,
        scale: number = 2.0, dur = 0.8, eIn = 0.2, eOut = 0.25
    ) {
        const keyframe: ZoomKeyframe = {
            id: generateId(),
            time,
            x: clamp(x, 0, 1),
            y: clamp(y, 0, 1),
            scale: clamp(scale, 1.2, 5),
            duration: dur,
            easeIn: eIn,
            easeOut: eOut,
        };
        videoEditor.addZoomKeyframe(keyframe);
    }

    function removeKeyframe(id: string) {
        videoEditor.removeZoomKeyframe(id);
    }

    function moveKeyframe(id: string, newTime: number) {
        const kf = zoomKeyframes.value.find(k => k.id === id);
        if (kf) {
            videoEditor.removeZoomKeyframe(id);
            videoEditor.addZoomKeyframe({ ...kf, time: clamp(newTime, 0, duration.value) });
        }
    }

    function updateKeyframe(id: string, patch: Partial<{ x: number; y: number; scale: number; duration: number; easeIn: number; easeOut: number }>) {
        const kf = zoomKeyframes.value.find(k => k.id === id);
        if (!kf) return;
        videoEditor.removeZoomKeyframe(id);
        videoEditor.addZoomKeyframe({ ...kf, ...patch });
    }

    function clearKeyframes() {
        videoEditor.clearZoomKeyframes();
    }

    // ---- Auto-zoom generation (v2: precise click-centric) ----
    //
    // 1. For each click, resolve cursor position from nearest Move event
    // 2. Group clicks by proximity in BOTH time (<1.5s) AND space (<15% screen)
    //    → same button clicked 3 times = one sustained zoom, not three
    // 3. Timing per zoom:
    //    - easeIn:  0.2s  (snap in quickly right before the action)
    //    - hold:    first_click → last_click + 0.3s buffer
    //    - easeOut: 0.25s (quick release back to 1x)

    function generateAutoZoom() {
        const events = trackingEvents.value;

        // Click events don't carry x,y — look up from nearest Move event
        const clicks = events.filter(e => e.type === 'click' && e.pressed);
        if (clicks.length === 0) return;

        // Resolve positions
        interface ClickPoint { timeS: number; nx: number; ny: number }
        const points: ClickPoint[] = [];

        for (const click of clicks) {
            const { before } = findNearestMoveEvents(events, click.timestamp);
            if (before && before.x !== undefined && before.y !== undefined) {
                const transformed = transformCoordinates(before.x, before.y);
                points.push({
                    timeS: click.timestamp / 1000,
                    nx: transformed.x,
                    ny: transformed.y,
                });
            }
        }

        if (points.length === 0) return;

        // ── Step 1: Group clicks by proximity in BOTH time AND space ──
        const TIME_GAP = 1.5;    // seconds - same area clicks
        const SPACE_GAP = 0.15;  // 15% of screen

        const rawGroups: ClickPoint[][] = [];
        let group: ClickPoint[] = [points[0]];

        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            const dt = curr.timeS - prev.timeS;
            const dist = Math.sqrt((curr.nx - prev.nx) ** 2 + (curr.ny - prev.ny) ** 2);

            if (dt < TIME_GAP && dist < SPACE_GAP) {
                group.push(curr);
            } else {
                rawGroups.push(group);
                group = [curr];
            }
        }
        rawGroups.push(group);

        // ── Step 2: Approach #3 - Merge groups that are too close in time ──
        // If gap between end of group A and start of group B < MIN_MERGE_GAP,
        // don't return to 1.0 between them - they'll be connected via smooth pan
        // This is handled at the keyframe level by setting easeOut to bridge the gap
        const EASE_IN = 0.3;
        const EASE_OUT = 0.35;
        const BUFFER = 0.4;
        const BASE_SCALE = 2.0;

        // Build keyframe descriptors first (before adding to store)
        interface KFDesc {
            time: number; x: number; y: number;
            scale: number; duration: number;
            easeIn: number; easeOut: number;
        }
        const kfDescs: KFDesc[] = [];

        for (const g of rawGroups) {
            const lastPoint = g[g.length - 1];
            const cx = lastPoint.nx;
            const cy = lastPoint.ny;

            const firstT = g[0].timeS;
            const lastT = g[g.length - 1].timeS;
            const holdDuration = Math.max(0.5, lastT - firstT + BUFFER);

            // ── Adaptive scale ──
            let minX = g[0].nx, maxX = g[0].nx;
            let minY = g[0].ny, maxY = g[0].ny;
            for (const p of g) {
                minX = Math.min(minX, p.nx);
                maxX = Math.max(maxX, p.nx);
                minY = Math.min(minY, p.ny);
                maxY = Math.max(maxY, p.ny);
            }
            const area = Math.max(0.01, (maxX - minX) * (maxY - minY));
            const density = g.length / area;
            const normalizedDensity = Math.log10(Math.max(1, density)) / 2;
            const adaptiveScale = 1.5 + 1.0 * Math.min(1, normalizedDensity); // 1.5x - 2.5x
            const finalScale = clamp(adaptiveScale * (BASE_SCALE / 2.0), 1.3, 3.5);

            kfDescs.push({ time: firstT, x: cx, y: cy, scale: finalScale, duration: holdDuration, easeIn: EASE_IN, easeOut: EASE_OUT });
        }

        // ── Step 3: Approach #1 - Smart easeOut bridging ──
        // If gap between kf[i] easeOut end and kf[i+1] easeIn start < MIN_GAP,
        // extend easeOut of kf[i] to reach exactly kf[i+1] easeIn start
        // This eliminates the "return to 1.0" flash between nearby zooms
        const MIN_GAP = 1.2; // seconds - if gap is less than this, bridge it

        for (let i = 0; i < kfDescs.length - 1; i++) {
            const curr = kfDescs[i];
            const next = kfDescs[i + 1];

            const currEaseOutEnd = curr.time + curr.duration + curr.easeOut;
            const nextEaseInStart = next.time - next.easeIn;
            const gap = nextEaseInStart - currEaseOutEnd;

            if (gap < MIN_GAP && gap > 0) {
                // Extend easeOut to bridge the gap - camera pans directly to next zoom
                // instead of returning to 1.0 and then zooming in again
                curr.easeOut = curr.easeOut + gap;
            } else if (gap <= 0) {
                // Already overlapping - overlap detection in calculateZoomAtTime handles this
            }
        }

        // ── Step 4: Commit keyframes ──
        clearKeyframes();
        for (const kf of kfDescs) {
            addKeyframe(kf.time, kf.x, kf.y, kf.scale, kf.duration, kf.easeIn, kf.easeOut);
        }

        // ── Typing Auto-Zoom ──
        const keys = events.filter(e => e.type === 'key' && e.pressed);
        if (keys.length > 0) {
            const KEY_TIME_GAP = 1.0;
            const keyGroups: TrackingEvent[][] = [];
            let kGroup: TrackingEvent[] = [keys[0]];

            for (let i = 1; i < keys.length; i++) {
                const prev = keys[i - 1];
                const curr = keys[i];
                const dt = (curr.timestamp - prev.timestamp) / 1000;
                if (dt < KEY_TIME_GAP) {
                    kGroup.push(curr);
                } else {
                    keyGroups.push(kGroup);
                    kGroup = [curr];
                }
            }
            keyGroups.push(kGroup);

            for (const kg of keyGroups) {
                if (kg.length < 3) continue;

                const firstK = kg[0];
                const lastK = kg[kg.length - 1];

                const { before } = findNearestMoveEvents(events, firstK.timestamp);
                if (before && before.x !== undefined && before.y !== undefined) {
                    const transformed = transformCoordinates(before.x, before.y);
                    const firstT = firstK.timestamp / 1000;
                    const lastT = lastK.timestamp / 1000;
                    const holdDuration = Math.max(0.5, lastT - firstT + BUFFER);
                    addKeyframe(firstT, transformed.x, transformed.y, BASE_SCALE, holdDuration, EASE_IN, EASE_OUT);
                }
            }
        }
    }

    /**
     * Get zoom state at specific time (for export/rendering)
     * This is the imperative API for getting zoom without relying on reactive currentTime
     */
    function getZoomAtTime(time: number): ZoomState {
        if (!zoomEnabled.value || zoomKeyframes.value.length === 0) {
            return { scale: 1, offsetX: 0.5, offsetY: 0.5 };
        }
        return calcZoom(time, getSortedKfs(), cursorX.value, cursorY.value,
            { radius: deadZoneRadius.value, falloff: 0.1 },
            cursorFollowStrength.value,
        );
    }

    // ---- Animation loop ----

    let lastFrameTime = 0;
    let animationRafId: number | null = null;

    function animationLoop(timestamp: number) {
        const dt = lastFrameTime ? Math.min((timestamp - lastFrameTime) / 1000, 0.05) : 1 / 60;
        lastFrameTime = timestamp;

        updateCursorPosition();
        updateSpring(dt);

        // Calculate zoom target via shared module (with cursor-follow + dead zone)
        if (zoomEnabled.value && zoomKeyframes.value.length > 0) {
            const zoomTarget = calcZoom(
                currentTime.value,
                getSortedKfs(),
                cursorX.value,
                cursorY.value,
                { radius: deadZoneRadius.value, falloff: 0.1 },
                cursorFollowStrength.value,
            );
            // Apply spring smoothing to zoom
            const smoothed = updateZoomSpring(zoomTarget, dt);
            currentZoom.value = smoothed;
        } else {
            currentZoom.value = { scale: 1, offsetX: 0, offsetY: 0 };
        }

        animationRafId = requestAnimationFrame(animationLoop);
    }

    function startAnimation() {
        if (animationRafId !== null) return;
        lastFrameTime = 0;
        animationRafId = requestAnimationFrame(animationLoop);
    }

    function stopAnimation() {
        if (animationRafId !== null) {
            cancelAnimationFrame(animationRafId);
            animationRafId = null;
        }
    }

    // Start/stop animation based on session
    watch(() => videoEditor.session, (session) => {
        if (session) {
            startAnimation();
        } else {
            stopAnimation();
            // Keyframes are now managed by store, no need to clear here
        }
    }, { immediate: true });

    // Reset spring when seeking (large time jump)
    let lastTime = 0;
    watch(currentTime, (newTime) => {
        const jump = Math.abs(newTime - lastTime);
        if (jump > 0.5) {
            // Teleport cursor spring to raw position
            updateCursorPosition();
            spring.x = rawCursorX.value;
            spring.y = rawCursorY.value;
            spring.vx = 0;
            spring.vy = 0;
            cursorX.value = spring.x;
            cursorY.value = spring.y;

            // Teleport zoom spring to target position (no smoothing on seek)
            if (zoomEnabled.value && zoomKeyframes.value.length > 0) {
                const target = calcZoom(newTime, getSortedKfs(), cursorX.value, cursorY.value,
                    { radius: deadZoneRadius.value, falloff: 0.1 },
                    cursorFollowStrength.value,
                );
                zoomSpring.scale = target.scale;
                zoomSpring.offsetX = target.offsetX;
                zoomSpring.offsetY = target.offsetY;
                zoomSpring.vScale = 0;
                zoomSpring.vOffsetX = 0;
                zoomSpring.vOffsetY = 0;
                currentZoom.value = {
                    scale: Math.max(1, target.scale),
                    offsetX: clamp(target.offsetX, 0, 1),
                    offsetY: clamp(target.offsetY, 0, 1),
                };
            }
        }
        lastTime = newTime;
    });

    return {
        // Cursor
        cursorX,
        cursorY,
        cursorVisible,
        cursorClicking,
        cursorStyle,
        activeKeys,

        // Zoom
        zoomKeyframes,
        currentZoom,
        getZoomAtTime,
        addKeyframe,
        removeKeyframe,
        updateKeyframe,
        moveKeyframe,
        clearKeyframes,
        generateAutoZoom,

        // Settings
        cursorEnabled,
        keysEnabled,
        cursorSmoothing,
        zoomEnabled,
        cursorFollowStrength,
        deadZoneRadius,

        // Lifecycle
        stopAnimation,

        // Export API — imperative update without Vue reactivity overhead
        updateCursorPositionAtTime,
    };
}

export function useMotionEngine() {
    if (!instance) {
        instance = createMotionEngine();
    }
    return instance;
}
