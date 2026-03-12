/**
 * Timing constants used across the application.
 * Centralised here to avoid magic numbers and make tuning easier.
 */

/** Delay before fullscreen capture to allow the window to fully hide (ms) */
export const CAPTURE_HIDE_DELAY_MS = 200;

/** Delay before region capture to allow the overlay to prepare (ms) */
export const REGION_PREPARE_DELAY_MS = 300;

/** Delay after stopping recording before restarting audio preview (ms) */
export const AUDIO_PREVIEW_RESTART_DELAY_MS = 500;

/** Delay before checking for app updates after startup (ms) */
export const UPDATE_CHECK_DELAY_MS = 3000;

/** Recording countdown duration in seconds */
export const COUNTDOWN_SECONDS = 3;

/** Countdown tick interval (ms) */
export const COUNTDOWN_TICK_MS = 1000;

/** Recording timer tick interval (ms) */
export const TIMER_TICK_MS = 1000;
