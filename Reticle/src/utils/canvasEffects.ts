export interface BlurObject {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Shared offscreen canvas to avoid garbage collection pressure
let sharedOffscreenCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let sharedOffscreenCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
let smoothingDisabled = false;

// Buffer management constants
const INITIAL_BUFFER_SIZE = 64;
const GROWTH_FACTOR = 1.5;
const MAX_BUFFER_OVERHEAD = 3.0; // Shrink if buffer is 3x larger than needed

function getSharedContext(width: number, height: number) {
  if (!sharedOffscreenCanvas) {
    const startW = Math.max(INITIAL_BUFFER_SIZE, width);
    const startH = Math.max(INITIAL_BUFFER_SIZE, height);
    
    if (typeof OffscreenCanvas !== 'undefined') {
      sharedOffscreenCanvas = new OffscreenCanvas(startW, startH);
    } else {
      sharedOffscreenCanvas = document.createElement('canvas');
      sharedOffscreenCanvas.width = startW;
      sharedOffscreenCanvas.height = startH;
    }
    sharedOffscreenCtx = sharedOffscreenCanvas.getContext('2d', {
      alpha: true,
      willReadFrequently: false
    }) as CanvasRenderingContext2D;
  }
  
  // OPTIMIZATION: Grow buffer only when needed
  if (width > sharedOffscreenCanvas.width || height > sharedOffscreenCanvas.height) {
    sharedOffscreenCanvas.width = Math.ceil(Math.max(width * GROWTH_FACTOR, sharedOffscreenCanvas.width));
    sharedOffscreenCanvas.height = Math.ceil(Math.max(height * GROWTH_FACTOR, sharedOffscreenCanvas.height));
    smoothingDisabled = false; // Canvas resize resets context properties
  } 
  // OPTIMIZATION: Shrink buffer if it's excessively large (prevents memory waste)
  else if (
    sharedOffscreenCanvas.width > width * MAX_BUFFER_OVERHEAD &&
    sharedOffscreenCanvas.height > height * MAX_BUFFER_OVERHEAD
  ) {
    sharedOffscreenCanvas.width = Math.ceil(width * GROWTH_FACTOR);
    sharedOffscreenCanvas.height = Math.ceil(height * GROWTH_FACTOR);
    smoothingDisabled = false;
  }
  
  // Set smoothing only once after resize (avoids redundant property sets)
  if (!smoothingDisabled && sharedOffscreenCtx) {
    sharedOffscreenCtx.imageSmoothingEnabled = false;
    smoothingDisabled = true;
  }
  
  return sharedOffscreenCtx;
}

/**
 * Applies a pixelation effect to a specific region of the canvas.
 * Works by downscaling the region and then upscaling it back with nearest-neighbor interpolation.
 * 
 * Optimizations:
 * - Reuses offscreen canvas instance to avoid GC pressure
 * - Smart buffer growing/shrinking strategy
 * - Avoids unnecessary clearRect (drawImage overwrites pixels)
 * - Caches imageSmoothingEnabled state
 * 
 * @param ctx The 2D rendering context of the canvas
 * @param x The x-coordinate of the region
 * @param y The y-coordinate of the region
 * @param w The width of the region
 * @param h The height of the region
 * @param blockSize The size of the "pixels" (default: 10)
 */
export function pixelate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  blockSize: number = 10
) {
  if (w <= 0 || h <= 0 || blockSize <= 0) return;

  // Save current context state
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Calculate the scaled dimensions
  const scaledW = Math.floor(w / blockSize) || 1;
  const scaledH = Math.floor(h / blockSize) || 1;

  // Use shared offscreen canvas with smart buffering
  const offCtx = getSharedContext(scaledW, scaledH);
  
  if (!offCtx || !sharedOffscreenCanvas) {
    ctx.restore();
    return;
  }

  // 1. Draw the source region onto the small offscreen canvas (downscale)
  // Note: No clearRect needed - drawImage overwrites pixels completely
  offCtx.drawImage(
    ctx.canvas,
    x, y, w, h,            // Source region
    0, 0, scaledW, scaledH // Destination (scaled down)
  );

  // 2. Draw the small offscreen canvas back onto the main canvas (upscale)
  ctx.drawImage(
    sharedOffscreenCanvas as CanvasImageSource,
    0, 0, scaledW, scaledH, // Source (only the working area, not entire buffer)
    x, y, w, h              // Destination (original region)
  );

  // Restore context state
  ctx.restore();
}

/**
 * Optional: Call this to free the shared canvas memory when pixelation is no longer needed
 * Useful for cleaning up resources when switching contexts or unmounting components
 */
export function releasePixelateResources() {
  sharedOffscreenCanvas = null;
  sharedOffscreenCtx = null;
  smoothingDisabled = false;
}