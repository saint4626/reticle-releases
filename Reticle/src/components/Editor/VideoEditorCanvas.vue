<script setup lang="ts">
import { useEditorStore } from '../../stores/editor';
import { useViewportStore } from '../../stores/viewport';
import { useVideoEditorStore } from '../../stores/videoEditor';
import { useMotionEngine } from '../../composables/useMotionEngine';
import { zoomToPoint, getMotionBlurStyle } from '../../utils/zoomCalculator';
import FakeCursor from './FakeCursor.vue';
import KeyOverlay from './KeyOverlay.vue';
import ShaderBackgroundLayer from './ShaderBackgroundLayer.vue';
import { info, error as logError } from '@tauri-apps/plugin-log';
import { storeToRefs } from 'pinia';
import { computed, ref, shallowRef, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const editor = useEditorStore();
const viewport = useViewportStore();
const videoEditor = useVideoEditorStore();

const {
  padding, borderRadius, background, backgroundImage, backgroundBlur,
  shadowColor, shadowBlur, shadowSpread, shadowOpacity, shadowX, shadowY, shadowInset,
  shaderEnabled, shaderParams
} = storeToRefs(editor);

const { scale, translate } = storeToRefs(viewport);
const { videoSrc } = storeToRefs(videoEditor);

// ---- Motion Engine (Fake Cursor + Zoom) ----
const motion = useMotionEngine();

// Zoom transform for the video container
const zoomTransformStyle = computed(() => {
  const zoom = motion.currentZoom.value;
  if (zoom.scale <= 1.001) return {};

  // Use transform-origin to zoom into the exact focus point.
  // offsetX/offsetY are 0-1 normalized coordinates of the click area.
  return {
    transform: `scale(${zoom.scale})`,
    transformOrigin: `${zoom.offsetX * 100}% ${zoom.offsetY * 100}%`,
    // No CSS transition — easing is handled by calculateZoomAtTime() in JS
  };
});

// Motion blur during zoom transitions (preview only)
let prevZoomScale = 1;
let prevFrameTime = 0;
const motionBlurFilterStyle = ref<Record<string, string>>({});

// Update motion blur on each animation frame via watch on currentZoom
watch(() => motion.currentZoom.value, (zoom) => {
  const now = performance.now();
  const dt = prevFrameTime ? Math.max((now - prevFrameTime) / 1000, 1 / 120) : 1 / 60;
  prevFrameTime = now;
  motionBlurFilterStyle.value = getMotionBlurStyle(zoom.scale, prevZoomScale, dt) as Record<string, string>;
  prevZoomScale = zoom.scale;
});

// DOM refs
const videoRef = shallowRef<HTMLVideoElement | null>(null);
const containerRef = shallowRef<HTMLElement | null>(null);

// Pan state
const isPanning = ref(false);
const panStart = ref({ x: 0, y: 0 });
const initialTranslate = ref({ x: 0, y: 0 });
let panRafId: number | null = null;

// ---- Computed styles (same as EditorCanvas for visual consistency) ----

const containerWrapperStyle = computed(() => ({
  padding: `${padding.value}px`,
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  overflow: 'hidden',
  position: 'relative' as const,
  transform: `scale(${scale.value}) translate(${translate.value.x}px, ${translate.value.y}px)`,
  transformOrigin: 'center center',
  cursor: isPanning.value ? 'grabbing' : 'default',
}));

const backgroundLayerStyle = computed(() => {
  const style: any = {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 0,
  };

  if (backgroundImage.value) {
    style.backgroundImage = `url(${backgroundImage.value})`;
    style.backgroundSize = 'cover';
    style.backgroundPosition = 'center';
  } else {
    style.background = background.value;
  }

  if (backgroundBlur.value > 0) {
    style.filter = `blur(${backgroundBlur.value}px)`;
    style.transform = 'scale(1.1)';
  }

  return style;
});

const videoStyle = computed(() => {
  const vw = videoEditor.videoInfo?.width ?? Infinity;
  const vh = videoEditor.videoInfo?.height ?? Infinity;
  const clampedRadius = Math.min(borderRadius.value, vw / 2, vh / 2);
  return {
    borderRadius: `${clampedRadius}px`,
    maxWidth: '100%',
    maxHeight: '100%',
    display: 'block',
    zIndex: 10,
    objectFit: 'contain' as const,
  };
});

// Shadow wrapper style: sits OUTSIDE the zoom container so box-shadow
// is not clipped by overflow:hidden. Matches video's border-radius.
const videoShadowStyle = computed(() => {
  const vw = videoEditor.videoInfo?.width ?? Infinity;
  const vh = videoEditor.videoInfo?.height ?? Infinity;
  const clampedRadius = Math.min(borderRadius.value, vw / 2, vh / 2);

  let r = 0, g = 0, b = 0;
  if (shadowColor.value.startsWith('#')) {
    const hex = shadowColor.value.slice(1);
    r = parseInt(hex.substring(0, 2), 16);
    g = parseInt(hex.substring(2, 4), 16);
    b = parseInt(hex.substring(4, 6), 16);
  }
  const rgba = `rgba(${r}, ${g}, ${b}, ${shadowOpacity.value})`;
  const inset = shadowInset.value ? 'inset ' : '';

  return {
    borderRadius: `${clampedRadius}px`,
    boxShadow: `${inset}${shadowX.value}px ${shadowY.value}px ${shadowBlur.value}px ${shadowSpread.value}px ${rgba}`,
    position: 'relative' as const,
    zIndex: 10,
  };
});

// ---- Video event handlers ----

function onTimeUpdate() {
  if (videoRef.value) {
    const t = videoRef.value.currentTime;
    videoEditor.onTimeUpdate(t);
    // Stop at trimOut
    const trimOut = videoEditor.trimOut;
    if (trimOut > 0 && t >= trimOut) {
      videoRef.value.pause();
      videoEditor.pause();
    }
  }
}

function onEnded() {
  videoEditor.pause();
}

function onLoadedMetadata() {
  // Video element ready — register it with store
  if (videoRef.value) {
    videoEditor.setVideoElement(videoRef.value);
  }
}

function onVideoError(e: Event) {
  const target = e.target as HTMLVideoElement;
  const err = target.error;
  if (err) {
    const msg = `Video Playback Error: Code ${err.code}, Message: ${err.message}`;
    logError(`[VideoEditorCanvas] ${msg}`);
  }
}

// ---- Pan controls (middle mouse button only, same as EditorCanvas) ----

function onWrapperMouseDown(e: MouseEvent) {
  if (e.button !== 1) return; // middle button only
  e.preventDefault(); // prevent browser auto-scroll

  isPanning.value = true;
  panStart.value = { x: e.clientX, y: e.clientY };
  initialTranslate.value = { ...translate.value };

  window.addEventListener('mousemove', onGlobalMouseMove);
  window.addEventListener('mouseup', onGlobalMouseUp);
}

function onGlobalMouseMove(e: MouseEvent) {
  if (!isPanning.value) return;
  e.preventDefault();

  const dx = e.clientX - panStart.value.x;
  const dy = e.clientY - panStart.value.y;

  // Update store directly — Vue computed style will apply the transform
  // No manual DOM writes that conflict with reactivity
  if (panRafId) cancelAnimationFrame(panRafId);
  panRafId = requestAnimationFrame(() => {
    viewport.setTranslate(initialTranslate.value.x + dx, initialTranslate.value.y + dy);
  });
}

function onGlobalMouseUp(e: MouseEvent) {
  if (!isPanning.value) return;
  isPanning.value = false;

  const dx = e.clientX - panStart.value.x;
  const dy = e.clientY - panStart.value.y;
  viewport.setTranslate(initialTranslate.value.x + dx, initialTranslate.value.y + dy);

  window.removeEventListener('mousemove', onGlobalMouseMove);
  window.removeEventListener('mouseup', onGlobalMouseUp);
}

function onDoubleClick(e: MouseEvent) {
  e.preventDefault();
  viewport.reset();
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  const container = containerRef.value;
  if (!container) {
    const delta = -Math.sign(e.deltaY) * 0.1;
    viewport.setScale(scale.value + delta);
    return;
  }

  const rect = container.getBoundingClientRect();
  const delta = -Math.sign(e.deltaY);
  const { newScale, newTranslate } = zoomToPoint(
    e.clientX, e.clientY, delta,
    rect, scale.value, translate.value,
  );
  viewport.setScale(newScale);
  viewport.setTranslate(newTranslate.x, newTranslate.y);
}

// ---- Keyboard controls ----
function handleKeydown(e: KeyboardEvent) {
  if (e.code === 'Space') {
    e.preventDefault(); // Prevent scrolling
    videoEditor.togglePlay();
  }
}

// ---- Lifecycle ----

onMounted(() => {
  if (videoRef.value) {
    info('[VideoEditorCanvas] Mounted, setting video element');
    videoEditor.setVideoElement(videoRef.value);
  } else {
    logError('[VideoEditorCanvas] Mounted but videoRef is null');
  }

  // Initialize store if needed (it might be already init from App.vue)
  // videoEditor.init(); // App.vue handles this

  // Add key listener
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  info('[VideoEditorCanvas] Unmounting');
  videoEditor.setVideoElement(null);
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('mousemove', onGlobalMouseMove);
  window.removeEventListener('mouseup', onGlobalMouseUp);
  if (panRafId) cancelAnimationFrame(panRafId);
});

// Watch for src changes
watch(() => videoEditor.videoSrc, async (newSrc) => {
  info(`[VideoEditorCanvas] videoSrc changed to: ${newSrc}`);
  // videoSrc change triggers v-if, so wait for DOM update
  await nextTick();
  if (videoRef.value) {
    info('[VideoEditorCanvas] Video element rendered, updating store');
    videoEditor.setVideoElement(videoRef.value);
  }
});

// Watch for playback state to start/stop RAF loop
let playbackRaf: number | null = null;

watch(() => videoEditor.isPlaying, (playing) => {
  if (playing) {
    startPlaybackLoop();
  } else {
    stopPlaybackLoop();
  }
});

function startPlaybackLoop() {
  if (playbackRaf) cancelAnimationFrame(playbackRaf);
  
  function loop() {
    if (videoRef.value && !videoRef.value.paused) {
      // Direct update for smoothness
      videoEditor.onTimeUpdate(videoRef.value.currentTime);
      playbackRaf = requestAnimationFrame(loop);
    } else {
       stopPlaybackLoop();
    }
  }
  
  playbackRaf = requestAnimationFrame(loop);
}

function stopPlaybackLoop() {
  if (playbackRaf) {
    cancelAnimationFrame(playbackRaf);
    playbackRaf = null;
  }
  // Sync one last time to be sure
  if (videoRef.value) {
     videoEditor.onTimeUpdate(videoRef.value.currentTime);
  }
}

// Watch for src change to reset viewport
watch(videoSrc, () => {
  viewport.reset();
});
</script>

<template>
  <div 
    class="canvas-wrapper w-full h-full flex justify-center items-center bg-black p-8 overflow-hidden"
    @wheel="onWheel"
    @mousedown="onWrapperMouseDown"
    @auxclick.prevent
    @dblclick="onDoubleClick"
  >
    <div v-if="videoSrc" id="video-target" ref="containerRef" :style="containerWrapperStyle" class="origin-center">
      <!-- Static background -->
      <div v-if="!shaderEnabled" :style="backgroundLayerStyle"></div>
      <!-- Animated shader background -->
      <ShaderBackgroundLayer v-else :params="shaderParams" :active="true" />

      <div :style="videoShadowStyle">
        <div class="video-zoom-container" :style="[zoomTransformStyle, motionBlurFilterStyle]">
          <div class="relative" style="display: flex; font-size: 0; max-width: 100%; max-height: 100%; position: relative;">
            <video
              ref="videoRef"
              :src="videoSrc"
              :style="videoStyle"
              preload="auto"
              muted
              @timeupdate="onTimeUpdate"
              @ended="onEnded"
              @loadedmetadata="onLoadedMetadata"
              @error="onVideoError"
              @click="videoEditor.togglePlay()"
            />

            <!-- Fake Cursor Overlay -->
            <FakeCursor
              :x="motion.cursorX.value"
              :y="motion.cursorY.value"
              :visible="motion.cursorEnabled.value && motion.cursorVisible.value"
              :clicking="motion.cursorClicking.value"
              :container-width="videoEditor.videoInfo?.width ?? 1920"
              :container-height="videoEditor.videoInfo?.height ?? 1080"
              :cursor-style="motion.cursorStyle.value"
            />
          </div>
        </div>

        <!-- Key Overlay (outside zoom container to stay visible) -->
        <KeyOverlay
          :active-keys="motion.activeKeys.value"
          :visible="motion.keysEnabled.value"
        />
      </div>
    </div>

    <div v-if="scale !== 1" class="absolute bottom-4 right-4 bg-black/80 border border-white/10 text-white px-3 py-1.5 rounded-lg text-sm font-mono pointer-events-none select-none">
      {{ Math.round(scale * 100) }}%
    </div>

    <div v-else-if="!videoSrc" class="text-white/50 text-xl font-mono select-none pointer-events-none">
      {{ t('editor.empty_state') }}
    </div>

    <!-- Loading Spinner -->
    <div v-if="videoEditor.isLoading" class="absolute inset-0 flex items-center justify-center z-50 bg-black/20 pointer-events-none fade-enter-active">
        <div class="loading-spinner"></div>
    </div>
  </div>
</template>

<style scoped>
.video-zoom-container {
  overflow: hidden;
  will-change: transform;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(255, 255, 255, 0.1);
  border-left-color: #ffffff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>

<style scoped>
.canvas-wrapper {
  background-image: radial-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 20px 20px;
}

video {
  /* Prevent browser default controls */
  outline: none;
  cursor: pointer;
}
</style>
