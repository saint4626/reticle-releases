/**
 * ZoomCalculator — shared pure-function module for zoom calculations.
 * No Vue, Pinia, or DOM dependencies.
 *
 * Used by:
 * - useMotionEngine.ts (preview): calculateZoomAtTime + spring
 * - useVideoExport.ts (export): calculateZoomAtTime (no spring — per-frame render)
 */

import type { ZoomKeyframe } from '../stores/videoEditor';

// ---- Types ----

/** Zoom state result — scale + normalized focus offsets */
export interface ZoomState {
  scale: number;
  offsetX: number; // 0-1
  offsetY: number; // 0-1
}

/** Dead zone configuration for camera follow */
export interface DeadZoneConfig {
  radius: number;  // 0-1 — dead zone radius (0.15 = 15% from center)
  falloff: number; // 0-1 — smooth transition width (0.1)
}

/** Spring easing configuration for zoom transitions */
export interface ZoomSpringConfig {
  stiffness: number; // spring stiffness (180)
  damping: number;   // damping coefficient (12 — slightly underdamped for overshoot)
  mass: number;      // mass (1.0)
}

/** Internal spring state for zoom animation */
export interface ZoomSpringState {
  scale: number;
  offsetX: number;
  offsetY: number;
  vScale: number;   // scale velocity
  vOffsetX: number; // offsetX velocity
  vOffsetY: number; // offsetY velocity
}

/** Cursor follow configuration */
export interface CursorFollowConfig {
  enabled: boolean;
  strength: number;  // 0-1 — follow strength (0.6)
  smoothing: number; // 0-1 — camera smoothing (0.3)
}

// ---- Defaults ----

export const DEFAULT_DEAD_ZONE: DeadZoneConfig = { radius: 0.15, falloff: 0.1 };
export const DEFAULT_SPRING_CONFIG: ZoomSpringConfig = { stiffness: 170, damping: 24, mass: 1.0 };
export const DEFAULT_CURSOR_FOLLOW: CursorFollowConfig = { enabled: true, strength: 0.6, smoothing: 0.3 };

// ---- Helpers ----

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * easeInOutQuart — smooth cinematic easing (no overshoot).
 * Used for easeIn/easeOut phases as the base interpolation curve.
 */
function easeInOutQuart(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t < 0.5
    ? 8 * t * t * t * t
    : 1 - Math.pow(-2 * t + 2, 4) / 2;
}

// ---- Dead Zone ----

/**
 * Applies dead zone to a displacement vector.
 *
 * - |displacement| <= radius → {0, 0} (no camera movement)
 * - |displacement| >= radius + falloff → full displacement (minus dead zone radius)
 * - In between → smoothstep interpolation for jerk-free transition
 *
 * @param displacement - cursor offset from focus center
 * @param config - dead zone settings
 */
export function applyDeadZone(
  displacement: { x: number; y: number },
  config: DeadZoneConfig,
): { x: number; y: number } {
  const dist = Math.sqrt(displacement.x ** 2 + displacement.y ** 2);

  if (dist <= config.radius) {
    return { x: 0, y: 0 };
  }

  if (dist >= config.radius + config.falloff) {
    const factor = (dist - config.radius) / dist;
    return { x: displacement.x * factor, y: displacement.y * factor };
  }

  // Transition zone — smoothstep interpolation
  const t = (dist - config.radius) / config.falloff;
  const smooth = t * t * (3 - 2 * t); // smoothstep
  const factor = smooth * (dist - config.radius) / dist;
  return { x: displacement.x * factor, y: displacement.y * factor };
}

// ---- Cursor Follow ----

/**
 * Computes camera offset that follows the cursor with dead zone and strength.
 *
 * - Calculates displacement from baseOffset to cursorPos
 * - Applies dead zone suppression
 * - Blends with followStrength
 * - Clamps result to [0, 1]
 *
 * @param baseOffset - keyframe focus point (0-1)
 * @param cursorPos - current cursor position (0-1)
 * @param followStrength - 0-1 blend factor
 * @param deadZone - dead zone config
 */
export function applyCursorFollow(
  baseOffset: { x: number; y: number },
  cursorPos: { x: number; y: number },
  followStrength: number,
  deadZone: DeadZoneConfig,
): { x: number; y: number } {
  const dx = cursorPos.x - baseOffset.x;
  const dy = cursorPos.y - baseOffset.y;

  const adjusted = applyDeadZone({ x: dx, y: dy }, deadZone);

  return {
    x: clamp(baseOffset.x + adjusted.x * followStrength, 0, 1),
    y: clamp(baseOffset.y + adjusted.y * followStrength, 0, 1),
  };
}

// ---- Spring Physics ----

/**
 * Semi-implicit Euler spring integration.
 *
 * F_spring  = -stiffness * (current - target)
 * F_damping = -damping * velocity
 * acceleration = (F_spring + F_damping) / mass
 *
 * With default config (stiffness=180, damping=12, mass=1):
 * - Critical damping ≈ 2*sqrt(180) ≈ 26.8
 * - damping=12 < 26.8 → underdamped → slight overshoot (desired)
 *
 * @param current - current value
 * @param target - target value
 * @param velocity - current velocity
 * @param config - spring parameters
 * @param dt - delta time in seconds (should be <= 0.05)
 */
export function springEase(
  current: number,
  target: number,
  velocity: number,
  config: ZoomSpringConfig,
  dt: number,
): { value: number; velocity: number } {
  const { stiffness, damping, mass } = config;

  const displacement = current - target;
  const springForce = -stiffness * displacement;
  const dampingForce = -damping * velocity;
  const acceleration = (springForce + dampingForce) / mass;

  // Semi-implicit Euler: update velocity first, then position
  const newVelocity = velocity + acceleration * dt;
  const newValue = current + newVelocity * dt;

  return { value: newValue, velocity: newVelocity };
}

// ---- Zoom Calculation ----

/**
 * Calculates zoom state at a given time, with cursor-follow during hold phase.
 *
 * Phase detection per keyframe:
 * - easeIn:  [time - easeIn, time)       → interpolate neutral → target (easeInOutQuart)
 * - hold:    [time, time + duration]      → cursor-follow around keyframe focus
 * - overlap: (holdEnd, next.time)         → smooth pan to next keyframe (easeInOutQuart)
 * - easeOut: (holdEnd, holdEnd + easeOut) → interpolate target → neutral (easeInOutQuart)
 *
 * Returns neutral state {scale:1, offsetX:0.5, offsetY:0.5} when outside all keyframes
 * or when keyframes array is empty.
 *
 * @param time - current playback time in seconds
 * @param keyframes - sorted by time ascending
 * @param cursorX - current cursor X (0-1)
 * @param cursorY - current cursor Y (0-1)
 * @param deadZone - dead zone config for cursor follow
 * @param followStrength - cursor follow strength during hold (0-1), defaults to 0.6
 */
export function calculateZoomAtTime(
  time: number,
  keyframes: ZoomKeyframe[],
  cursorX: number,
  cursorY: number,
  deadZone: DeadZoneConfig,
  followStrength: number = DEFAULT_CURSOR_FOLLOW.strength,
): ZoomState {
  if (keyframes.length === 0) {
    return { scale: 1, offsetX: 0.5, offsetY: 0.5 };
  }

  for (let i = 0; i < keyframes.length; i++) {
    const kf = keyframes[i];
    const easeInStart = kf.time - kf.easeIn;
    const holdEnd = kf.time + kf.duration;
    const easeOutEnd = holdEnd + kf.easeOut;

    const next = keyframes[i + 1] ?? null;
    const nextEaseInStart = next ? (next.time - next.easeIn) : Infinity;
    const overlapsNext = next !== null && easeOutEnd > nextEaseInStart;

    if (time < easeInStart) continue;

    // ── EASE IN: from neutral (scale=1, offset=0.5) to keyframe target ──
    if (time < kf.time) {
      const t = clamp((time - easeInStart) / kf.easeIn, 0, 1);
      const e = easeInOutQuart(t);
      return {
        scale: 1 + (kf.scale - 1) * e,
        offsetX: 0.5 + (kf.x - 0.5) * e,
        offsetY: 0.5 + (kf.y - 0.5) * e,
      };
    }

    // ── HOLD: camera follows cursor ──
    if (time <= holdEnd) {
      const followed = applyCursorFollow(
        { x: kf.x, y: kf.y },
        { x: cursorX, y: cursorY },
        followStrength,
        deadZone,
      );
      return { scale: kf.scale, offsetX: followed.x, offsetY: followed.y };
    }

    // ── SMOOTH PAN TO NEXT (overlap) ──
    if (overlapsNext && next) {
      if (time < next.time) {
        const panDuration = next.time - holdEnd;
        const t = panDuration > 0 ? clamp((time - holdEnd) / panDuration, 0, 1) : 1;
        const e = easeInOutQuart(t);
        return {
          scale: kf.scale + (next.scale - kf.scale) * e,
          offsetX: kf.x + (next.x - kf.x) * e,
          offsetY: kf.y + (next.y - kf.y) * e,
        };
      }
      continue;
    }

    // ── EASE OUT: from keyframe target back to neutral ──
    if (time < easeOutEnd) {
      const t = clamp((time - holdEnd) / kf.easeOut, 0, 1);
      const e = 1 - easeInOutQuart(t);
      return {
        scale: 1 + (kf.scale - 1) * e,
        offsetX: kf.x + (0.5 - kf.x) * (1 - e),
        offsetY: kf.y + (0.5 - kf.y) * (1 - e),
      };
    }
  }

  return { scale: 1, offsetX: 0.5, offsetY: 0.5 };
}

// ---- Zoom-to-Point (viewport wheel zoom) ----

/**
 * Computes new scale and translate so the content point under the mouse
 * stays visually fixed after zooming.
 *
 * Invariant: mouseClient = center + (pointInContent + translate) * scale
 * This holds both before and after the zoom.
 *
 * @param mouseClientX - WheelEvent clientX
 * @param mouseClientY - WheelEvent clientY
 * @param delta - zoom direction (+1 zoom in, -1 zoom out)
 * @param containerRect - container's getBoundingClientRect()
 * @param currentScale - current viewport scale
 * @param currentTranslate - current viewport translate {x, y}
 * @returns new scale and translate preserving the point under cursor
 */
export function zoomToPoint(
  mouseClientX: number,
  mouseClientY: number,
  delta: number,
  containerRect: { left: number; top: number; width: number; height: number },
  currentScale: number,
  currentTranslate: { x: number; y: number },
): { newScale: number; newTranslate: { x: number; y: number } } {
  const step = 0.1;
  const newScale = clamp(currentScale + delta * step, 0.1, 5);

  if (newScale === currentScale) {
    return { newScale: currentScale, newTranslate: currentTranslate };
  }

  // Mouse position relative to container center
  const centerX = containerRect.left + containerRect.width / 2;
  const centerY = containerRect.top + containerRect.height / 2;

  // Point in content space (before zoom)
  const mouseRelX = (mouseClientX - centerX) / currentScale - currentTranslate.x;
  const mouseRelY = (mouseClientY - centerY) / currentScale - currentTranslate.y;

  // Compensate translate so the same content point stays under cursor
  const newTranslateX = (mouseClientX - centerX) / newScale - mouseRelX;
  const newTranslateY = (mouseClientY - centerY) / newScale - mouseRelY;

  return {
    newScale,
    newTranslate: { x: newTranslateX, y: newTranslateY },
  };
}

// ---- Motion Blur ----

/**
 * Computes CSS motion blur style based on scale change velocity.
 *
 * - scaleVelocity < 0.5 → no blur (empty object)
 * - scaleVelocity >= 0.5 → blur ∈ [0, 2] px
 *
 * Applied via CSS filter to .video-zoom-container in preview mode only.
 *
 * @param currentScale - current frame scale
 * @param previousScale - previous frame scale
 * @param dt - delta time in seconds (> 0)
 */
export function getMotionBlurStyle(
  currentScale: number,
  previousScale: number,
  dt: number,
): { filter: string } | Record<string, never> {
  const scaleVelocity = Math.abs(currentScale - previousScale) / dt;

  if (scaleVelocity < 0.5) return {};

  const blurAmount = clamp(scaleVelocity * 0.3, 0, 2);

  return {
    filter: `blur(${blurAmount.toFixed(1)}px)`,
  };
}


