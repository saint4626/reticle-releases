<script setup lang="ts">
import { useVideoEditorStore } from '../../stores/videoEditor';
import { useMotionEngine } from '../../composables/useMotionEngine';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { ref, computed, watch, onMounted, onUnmounted, shallowRef } from 'vue';
import { Play, Pause, SkipBack, X, MousePointer, ZoomIn, Wand2, Trash2, Settings, Keyboard, Download, Music, Volume2, VolumeX } from 'lucide-vue-next';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import AudioWaveform from './AudioWaveform.vue';
import ExportDialog from './ExportDialog.vue';

const videoEditor = useVideoEditorStore();
const { t } = useI18n();
const {
  isPlaying, currentTime, duration, thumbnails, trackingEvents,
  isLoadingThumbnails, trimIn, trimOut
} = storeToRefs(videoEditor);

// ---- Motion Engine ----
const motion = useMotionEngine();

// DOM refs
const timelineCanvasRef = shallowRef<HTMLCanvasElement | null>(null);

// Scrubbing state
const isScrubbing = ref(false);
const showZoomSettings = ref(false);
const showExportDialog = ref(false);

// ---- Music track ----

async function pickMusicFile() {
  const selected = await openDialog({
    multiple: false,
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'aac', 'ogg', 'm4a'] }]
  });
  if (selected && typeof selected === 'string') {
    videoEditor.setMusicTrack(selected);
  }
}

// Music offset drag
const musicDragging = ref(false);
const musicDragStartX = ref(0);
const musicDragStartOffset = ref(0);
let musicDragRafId: number | null = null;
let pendingMusicOffset: number | null = null;

// Hover state for track controls
const sysHover = ref(false);
const micHover = ref(false);
const musicHover = ref(false);

function onMusicWaveformMouseDown(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('.music-track-controls')) return;
  musicDragging.value = true;
  musicDragStartX.value = e.clientX;
  musicDragStartOffset.value = videoEditor.musicOffset;
  window.addEventListener('mousemove', onMusicDragMove);
  window.addEventListener('mouseup', onMusicDragEnd);
  e.preventDefault();
}

function onMusicDragMove(e: MouseEvent) {
  if (!musicDragging.value) return;
  const dx = musicDragStartX.value - e.clientX;
  const containerEl = document.querySelector('.music-track-row') as HTMLElement | null;
  const containerWidth = containerEl?.getBoundingClientRect().width ?? 400;
  const musicDur = videoEditor.musicDuration;
  const videoDur = duration.value;
  const secPerPx = musicDur > 0 ? musicDur / containerWidth : videoDur / containerWidth;
  pendingMusicOffset = Math.max(0, musicDragStartOffset.value + dx * secPerPx);

  // Throttle store updates to once per animation frame
  if (musicDragRafId === null) {
    musicDragRafId = requestAnimationFrame(() => {
      if (pendingMusicOffset !== null) {
        videoEditor.setMusicOffset(pendingMusicOffset);
        pendingMusicOffset = null;
      }
      musicDragRafId = null;
    });
  }
}

function onMusicDragEnd() {
  musicDragging.value = false;
  if (musicDragRafId !== null) {
    cancelAnimationFrame(musicDragRafId);
    musicDragRafId = null;
  }
  // Apply final position
  if (pendingMusicOffset !== null) {
    videoEditor.setMusicOffset(pendingMusicOffset);
    pendingMusicOffset = null;
  }
  window.removeEventListener('mousemove', onMusicDragMove);
  window.removeEventListener('mouseup', onMusicDragEnd);
}

// ---- Trim handle drag state ----
type TrimHandle = 'in' | 'out' | null;
const draggingTrimHandle = ref<TrimHandle>(null);

// ---- Keyframe interaction state ----
const draggingKeyframeId = ref<string | null>(null);
const dragStartX = ref(0);
const dragStartTime = ref(0);

interface KfPopover {
  visible: boolean;
  keyframeId: string;
  x: number;
  bottom: number;
}
const kfPopover = ref<KfPopover>({ visible: false, keyframeId: '', x: 0, bottom: 0 });

const selectedKeyframe = computed(() =>
  motion.zoomKeyframes.value.find(k => k.id === kfPopover.value.keyframeId) ?? null
);

// Cached thumbnail images
const thumbImages = ref<HTMLImageElement[]>([]);

// ---- Timeline dimensions ----
const TIMELINE_HEIGHT = 80;
const MARKER_HEIGHT = 12;
const PLAYHEAD_WIDTH = 2;

// ---- Computed ----

const formattedTime = computed(() => formatTime(currentTime.value));
const formattedDuration = computed(() => formatTime(duration.value));

const progress = computed(() => {
  if (duration.value <= 0) return 0;
  return (currentTime.value / duration.value) * 100;
});

// ---- Time formatting ----

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ---- Canvas rendering ----

function drawTimeline() {
  const canvas = timelineCanvasRef.value;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = TIMELINE_HEIGHT;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, 0, w, h);

  // Draw thumbnails as filmstrip
  if (thumbImages.value.length > 0) {
    const thumbW = w / thumbImages.value.length;
    thumbImages.value.forEach((img, i) => {
      if (img.complete && img.naturalWidth) {
        // Preserve aspect ratio — crop to fill the slot
        const imgAspect = img.naturalWidth / img.naturalHeight;
        const slotAspect = thumbW / h;
        let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
        if (imgAspect > slotAspect) {
          // Image wider than slot — crop sides
          sw = img.naturalHeight * slotAspect;
          sx = (img.naturalWidth - sw) / 2;
        } else {
          // Image taller than slot — crop top/bottom
          sh = img.naturalWidth / slotAspect;
          sy = (img.naturalHeight - sh) / 2;
        }
        ctx.drawImage(img, sx, sy, sw, sh, i * thumbW, 0, thumbW, h);
      }
    });

    // Darken non-played region
    const playX = (currentTime.value / duration.value) * w;
    if (playX < w) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fillRect(playX, 0, w - playX, h);
    }
  }

  // Draw click markers from tracking data
  if (trackingEvents.value.length > 0 && duration.value > 0) {
    const durationMs = duration.value * 1000;
    // More transparent markers
    ctx.fillStyle = 'rgba(255, 200, 50, 0.6)';
    
    for (const evt of trackingEvents.value) {
      if (evt.type === 'click' && evt.pressed) {
        const x = (evt.timestamp / durationMs) * w;
        ctx.beginPath();
        ctx.arc(x, h - MARKER_HEIGHT, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (evt.type === 'key' && evt.pressed) {
        const x = (evt.timestamp / durationMs) * w;
        ctx.fillStyle = '#00ccff';
        ctx.fillRect(x - 2, h - MARKER_HEIGHT - 2, 4, 4);
        ctx.fillStyle = '#ffcc00'; // Restore click color
      }
    }
  }

  // Draw playhead
  const playheadX = duration.value > 0 ? (currentTime.value / duration.value) * w : 0;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(playheadX - PLAYHEAD_WIDTH / 2, 0, PLAYHEAD_WIDTH, h);

  // Playhead circle
  ctx.beginPath();
  ctx.arc(playheadX, h / 2, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Draw Ruler (Time Scale)
  drawRuler(ctx, w, duration.value);

  // Draw trim handles
  drawTrimHandles(ctx, w, h);

  // Draw zoom keyframe diamonds
  drawKeyframeDiamonds(ctx, w);
}

function drawRuler(ctx: CanvasRenderingContext2D, w: number, duration: number) {
  if (duration <= 0) return;

  const pixelsPerSec = w / duration;
  const minTickSpacing = 50; // Minimum pixels between major ticks
  
  // Find nice step (1s, 2s, 5s, 10s, 30s, 60s...)
  const steps = [1, 2, 5, 10, 15, 30, 60];
  let step = steps[0];
  for (const s of steps) {
    if (s * pixelsPerSec >= minTickSpacing) {
      step = s;
      break;
    }
  }

  // Draw ticks
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.textAlign = 'left';
  ctx.font = '10px Roboto Mono, monospace';
  
  // Offset for UX
  const tickY = 2; 
  const tickHeightMajor = 6;
  const tickHeightMinor = 3;

  for (let t = 0; t <= duration; t += 1) { // Iterate seconds
     const x = (t / duration) * w;
     
     // Major tick (label)
     if (t % step === 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillRect(x, tickY, 1, tickHeightMajor);
        
        // Label
        const label = formatTimeShort(t);
        ctx.fillText(label, x + 3, tickY + tickHeightMajor + 4); // Adjusted for tickY
     } 
     // Minor tick (every second if step > 1)
     else if (pixelsPerSec > 10) { // Show minor ticks only if space allows
         ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
         ctx.fillRect(x, tickY, 1, tickHeightMinor);
     }
  }
}

function formatTimeShort(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    if (m > 0) return `${m}:${s.toString().padStart(2, '0')}`;
    return `${s}s`;
}

// ---- Trim handle drawing ----

function drawTrimHandles(ctx: CanvasRenderingContext2D, w: number, h: number) {
  if (duration.value <= 0) return;

  const inX = (trimIn.value / duration.value) * w;
  const outX = (trimOut.value / duration.value) * w;

  // Darken regions outside trim zone
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  if (inX > 0) ctx.fillRect(0, 0, inX, h);
  if (outX < w) ctx.fillRect(outX, 0, w - outX, h);

  // Trim In handle (left, green)
  ctx.fillStyle = '#4ade80';
  ctx.fillRect(inX - 2, 0, 4, h);
  // Arrow cap pointing right
  ctx.beginPath();
  ctx.moveTo(inX + 2, h / 2 - 8);
  ctx.lineTo(inX + 10, h / 2);
  ctx.lineTo(inX + 2, h / 2 + 8);
  ctx.closePath();
  ctx.fill();

  // Trim Out handle (right, orange)
  ctx.fillStyle = '#fb923c';
  ctx.fillRect(outX - 2, 0, 4, h);
  // Arrow cap pointing left
  ctx.beginPath();
  ctx.moveTo(outX - 2, h / 2 - 8);
  ctx.lineTo(outX - 10, h / 2);
  ctx.lineTo(outX - 2, h / 2 + 8);
  ctx.closePath();
  ctx.fill();
}

// ---- Trim handle hit test ----

function hitTestTrimHandle(e: MouseEvent): TrimHandle {
  const canvas = timelineCanvasRef.value;
  if (!canvas || duration.value <= 0) return null;
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const w = rect.width;
  const HIT = 12;

  const inX = (trimIn.value / duration.value) * w;
  const outX = (trimOut.value / duration.value) * w;

  if (Math.abs(mouseX - inX) < HIT) return 'in';
  if (Math.abs(mouseX - outX) < HIT) return 'out';
  return null;
}

// ---- Keyframe diamond drawing ----

function drawKeyframeDiamonds(ctx: CanvasRenderingContext2D, w: number) {
  if (!motion.zoomEnabled.value || motion.zoomKeyframes.value.length === 0 || duration.value <= 0) return;

  const diamondSize = 8;
  const y = TIMELINE_HEIGHT - 6;

  for (const kf of motion.zoomKeyframes.value) {
    const isSelected = kf.id === kfPopover.value.keyframeId;
    const x = (kf.time / duration.value) * w;

    // Draw zoom range bar
    const rangeStart = (kf.time - kf.easeIn) / duration.value * w;
    const rangeEnd = (kf.time + kf.duration + kf.easeOut) / duration.value * w;
    ctx.fillStyle = isSelected ? 'rgba(255, 255, 255, 0.2)' : 'rgba(120, 200, 120, 0.12)';
    ctx.fillRect(rangeStart, TIMELINE_HEIGHT - 12, rangeEnd - rangeStart, 12);

    // Diamond shape
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);

    if (isSelected) {
      ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
    } else {
      ctx.fillStyle = 'rgba(120, 200, 120, 0.9)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 1;
    }

    ctx.fillRect(-diamondSize / 2, -diamondSize / 2, diamondSize, diamondSize);
    ctx.strokeRect(-diamondSize / 2, -diamondSize / 2, diamondSize, diamondSize);
    ctx.restore();
  }
}

// ---- Tooltip state ----
const tooltip = ref<{ visible: boolean; x: number; y: number; text: string }>({
  visible: false, x: 0, y: 0, text: ''
});

// ---- Button tooltip (edge-aware) ----
const btnTooltip = ref<{ visible: boolean; x: number; y: number; text: string }>({
  visible: false, x: 0, y: 0, text: ''
});
let btnTipTimer: ReturnType<typeof setTimeout> | null = null;

function showBtnTip(e: MouseEvent, text: string) {
  if (btnTipTimer) clearTimeout(btnTipTimer);
  btnTipTimer = setTimeout(() => {
    const el = (e.currentTarget as HTMLElement);
    if (!el) return; // Guard against null element
    const rect = el.getBoundingClientRect();
    const PADDING = 8;
    // Center above button
    let x = rect.left + rect.width / 2;
    const y = rect.top - 6;
    // Clamp to viewport edges
    // Estimate tooltip width (~8px per char + 20px padding)
    const estWidth = text.length * 7 + 20;
    const halfW = estWidth / 2;
    if (x - halfW < PADDING) x = PADDING + halfW;
    if (x + halfW > window.innerWidth - PADDING) x = window.innerWidth - PADDING - halfW;
    btnTooltip.value = { visible: true, x, y, text };
  }, 400);
}

function hideBtnTip() {
  if (btnTipTimer) { clearTimeout(btnTipTimer); btnTipTimer = null; }
  btnTooltip.value.visible = false;
}

// ---- Scrubbing & Hover ----

function getTimeFromMouseEvent(e: MouseEvent): number {
  const canvas = timelineCanvasRef.value;
  if (!canvas || duration.value <= 0) return 0;
  const rect = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  return (x / rect.width) * duration.value;
}

function onTimelineMouseMove(e: MouseEvent) {
   const canvas = timelineCanvasRef.value;
   if (!canvas || duration.value <= 0) return;
   
   const rect = canvas.getBoundingClientRect();
   const mouseX = e.clientX - rect.left;
   const mouseY = e.clientY - rect.top;
   const w = rect.width;
   const durationMs = duration.value * 1000;

   // Trim handle drag
   if (draggingTrimHandle.value) {
     const time = (Math.max(0, Math.min(mouseX, w)) / w) * duration.value;
     if (draggingTrimHandle.value === 'in') videoEditor.setTrimIn(time);
     else videoEditor.setTrimOut(time);
     return;
   }

   // Change cursor when hovering over trim handles or keyframe
   const trimHit = hitTestTrimHandle(e);
   const hitKf = !trimHit ? hitTestKeyframe(e) : null;
   if (trimHit) canvas.style.cursor = 'ew-resize';
   else if (hitKf) canvas.style.cursor = 'grab';
   else canvas.style.cursor = 'pointer';
   if (draggingKeyframeId.value) canvas.style.cursor = 'grabbing';
   
   // Check collision with markers (tolerance 5px)
   let foundEvt = null;
   const searchRadius = 6;
   
   // Only check closest
   for (const evt of trackingEvents.value) {
      if (evt.type === 'click' && evt.pressed) {
         const x = (evt.timestamp / durationMs) * w;
         const y = rect.height - MARKER_HEIGHT;
         
         if (Math.abs(mouseX - x) < searchRadius && Math.abs(mouseY - y) < searchRadius + 5) {
             foundEvt = evt;
             break;
         }
      } else if (evt.type === 'key' && evt.pressed) {
         const x = (evt.timestamp / durationMs) * w;
         const y = rect.height - MARKER_HEIGHT;
         
         if (Math.abs(mouseX - x) < searchRadius && Math.abs(mouseY - y) < searchRadius + 5) {
             foundEvt = evt;
             break;
         }
      }
   }

   if (foundEvt) {
       const x = (foundEvt.timestamp / durationMs) * w;
       const screenX = rect.left + x;
       const screenY = rect.top; 
       tooltip.value = {
           visible: true,
           x: screenX,
           y: screenY - 5,
           text: formatEventTooltip(foundEvt)
       };
   } else {
       tooltip.value.visible = false;
   }

   if (isScrubbing.value) {
      const time = getTimeFromMouseEvent(e);
      videoEditor.seek(time);
   }
}

function formatEventTooltip(evt: any): string {
    if (evt.type === 'click') return `Click (${evt.button || 'Left'})`;
    if (evt.type === 'key') {
        let text = evt.key || '';
        if (text === ' ') text = 'Space';
        if (evt.modifiers && evt.modifiers.length > 0) {
            const mods = evt.modifiers.map((m: string) => {
                if (m === 'Control') return 'Ctrl';
                if (m === 'Meta') return 'Win';
                return m;
            }).join('+');
            return `Key: ${mods}+${text.toUpperCase()}`;
        }
        return `Key: ${text.toUpperCase()}`;
    }
    return evt.type;
}

function onTimelineMouseDown(e: MouseEvent) {
  // Check trim handles first (highest priority)
  const trimHit = hitTestTrimHandle(e);
  if (trimHit) {
    draggingTrimHandle.value = trimHit;
    window.addEventListener('mousemove', onTrimDragMove);
    window.addEventListener('mouseup', onTrimDragEnd);
    return;
  }

  // Check if clicking on a keyframe diamond first
  const hitKf = hitTestKeyframe(e);
  
  if (hitKf) {
    if (e.button === 2) {
      // Right click → delete keyframe
      e.preventDefault();
      motion.removeKeyframe(hitKf.id);
      kfPopover.value.visible = false;
      return;
    }
    // Left click → start drag, show popover on mouseup if no drag
    draggingKeyframeId.value = hitKf.id;
    dragStartX.value = e.clientX;
    dragStartTime.value = hitKf.time;
    window.addEventListener('mousemove', onKfDragMove);
    window.addEventListener('mouseup', onKfDragEnd);
    return;
  }

  // Close popover if clicking elsewhere
  kfPopover.value.visible = false;

  isScrubbing.value = true;
  const time = getTimeFromMouseEvent(e);
  videoEditor.seek(time);

  window.addEventListener('mousemove', onScrubMoveGlobal);
  window.addEventListener('mouseup', onScrubEnd);
}

function hitTestKeyframe(e: MouseEvent) {
  const canvas = timelineCanvasRef.value;
  if (!canvas || duration.value <= 0) return null;
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const w = rect.width;
  const HIT_RADIUS = 14;
  const y = TIMELINE_HEIGHT - 6;

  for (const kf of motion.zoomKeyframes.value) {
    const x = (kf.time / duration.value) * w;
    if (Math.abs(mouseX - x) < HIT_RADIUS && Math.abs(mouseY - y) < HIT_RADIUS) {
      return kf;
    }
  }
  return null;
}

function onKfDragMove(e: MouseEvent) {
  if (!draggingKeyframeId.value) return;
  const canvas = timelineCanvasRef.value;
  if (!canvas || duration.value <= 0) return;

  const dx = e.clientX - dragStartX.value;
  const rect = canvas.getBoundingClientRect();
  const dtPerPx = duration.value / rect.width;
  const newTime = Math.max(0, Math.min(duration.value, dragStartTime.value + dx * dtPerPx));

  motion.moveKeyframe(draggingKeyframeId.value, newTime);
}

function onKfDragEnd(e: MouseEvent) {
  window.removeEventListener('mousemove', onKfDragMove);
  window.removeEventListener('mouseup', onKfDragEnd);

  const wasDrag = Math.abs(e.clientX - dragStartX.value) > 4;

  if (!wasDrag && draggingKeyframeId.value) {
    // It was a click, not a drag → show popover
    const canvas = timelineCanvasRef.value;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const kf = motion.zoomKeyframes.value.find(k => k.id === draggingKeyframeId.value);
      if (kf) {
        const POPOVER_WIDTH = 320;
        const POPOVER_HEIGHT = 220; // approximate
        const MARGIN = 8;

        // X: center on keyframe, clamp to viewport
        let x = (kf.time / duration.value) * rect.width + rect.left - POPOVER_WIDTH / 2;
        x = Math.max(MARGIN, Math.min(window.innerWidth - POPOVER_WIDTH - MARGIN, x));

        // Position above the timeline; if not enough space, position below
        const aboveY = rect.top - MARGIN;
        const belowY = rect.bottom + MARGIN + POPOVER_HEIGHT;
        const anchorY = aboveY - POPOVER_HEIGHT < MARGIN ? belowY : aboveY;
        const bottom = window.innerHeight - anchorY;

        kfPopover.value = {
          visible: true,
          keyframeId: kf.id,
          x,
          bottom,
        };
      }
    }
  }

  draggingKeyframeId.value = null;
}
// Renamed from onScrubMove to distinguish local vs global behavior
function onScrubMoveGlobal(e: MouseEvent) {
    if (!isScrubbing.value) return;
    // For global drag, we need relative pos within canvas
    const canvas = timelineCanvasRef.value;
    if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const time = (x / rect.width) * duration.value;
        videoEditor.seek(time);
    }
}

function onScrubEnd() {
  isScrubbing.value = false;
  window.removeEventListener('mousemove', onScrubMoveGlobal);
  window.removeEventListener('mouseup', onScrubEnd);
}

// ---- Trim drag handlers ----

function onTrimDragMove(e: MouseEvent) {
  if (!draggingTrimHandle.value) return;
  const canvas = timelineCanvasRef.value;
  if (!canvas || duration.value <= 0) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  const time = (x / rect.width) * duration.value;
  if (draggingTrimHandle.value === 'in') videoEditor.setTrimIn(time);
  else videoEditor.setTrimOut(time);
}

function onTrimDragEnd() {
  draggingTrimHandle.value = null;
  window.removeEventListener('mousemove', onTrimDragMove);
  window.removeEventListener('mouseup', onTrimDragEnd);
}
//...

// ---- Thumbnail loading ----

watch(thumbnails, (newThumbs) => {
  thumbImages.value = newThumbs.map(t => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${t.data}`;
    img.onload = () => drawTimeline();
    return img;
  });
}, { immediate: true });

// ---- Redraw on state changes ----

// ---- Redraw logic (Active Loop vs Passive Watch) ----

let rafId: number | null = null;

function drawFrame() {
  drawTimeline();
  if (isPlaying.value) {
    rafId = requestAnimationFrame(drawFrame);
  }
}

// Watch play state to start/stop render loop
watch(isPlaying, (playing) => {
  if (playing) {
    drawFrame();
  } else {
    if (rafId) cancelAnimationFrame(rafId);
    drawTimeline(); // Draw final state
  }
});

// Watch updates when NOT playing (manual seek, scrub)
watch(currentTime, () => {
  if (!isPlaying.value) {
    scheduleRedraw();
  }
});

watch(trackingEvents, scheduleRedraw);

// Redraw when trim changes
watch([trimIn, trimOut], scheduleRedraw);

// Redraw when keyframes change
watch(() => motion.zoomKeyframes.value, scheduleRedraw, { deep: true });

// Redraw when keyframe selection changes
watch(() => kfPopover.value, scheduleRedraw, { deep: true });

function scheduleRedraw() {
  if (isPlaying.value) return; // Do not interrupt the drawFrame loop
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(drawTimeline);
}

// ---- Keyboard shortcuts ----

function onKeyDown(e: KeyboardEvent) {
  if (e.code === 'Space') {
    e.preventDefault();
    videoEditor.togglePlay();
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault();
    videoEditor.seek(Math.max(0, currentTime.value - 5));
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    videoEditor.seek(Math.min(duration.value, currentTime.value + 5));
  } else if (e.code === 'Home') {
    e.preventDefault();
    videoEditor.seek(0);
  }
}

// ---- Lifecycle ----

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    drawTimeline();
  });
  
  if (timelineCanvasRef.value) {
    resizeObserver.observe(timelineCanvasRef.value);
  }

  drawTimeline();
  
  window.addEventListener('keydown', onKeyDown);
  // Close popover on outside click
  window.addEventListener('mousedown', (e) => {
    const popover = document.querySelector('.kf-popover');
    if (popover && !popover.contains(e.target as Node)) {
      kfPopover.value.visible = false;
    }
  });
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
  }
  
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('mousemove', onScrubMoveGlobal);
  window.removeEventListener('mouseup', onScrubEnd);
  window.removeEventListener('mousemove', onTrimDragMove);
  window.removeEventListener('mouseup', onTrimDragEnd);
  window.removeEventListener('mousemove', onMusicDragMove);
  window.removeEventListener('mouseup', onMusicDragEnd);
  
  if (rafId) {
    cancelAnimationFrame(rafId);
  }
});
</script>

<template>
  <div class="video-timeline" ref="timelineContainerRef">
    <!-- Controls row -->
    <div class="controls-row">
      <div class="controls-left">
        <button class="ctrl-btn" @click="videoEditor.seek(0)" @mouseenter="showBtnTip($event, t('video_editor.restart'))" @mouseleave="hideBtnTip">
          <SkipBack :size="16" />
        </button>
        <button class="ctrl-btn play-btn" @click="videoEditor.togglePlay()" @mouseenter="showBtnTip($event, isPlaying ? t('video_editor.pause') : t('video_editor.play'))" @mouseleave="hideBtnTip">
          <Pause v-if="isPlaying" :size="18" />
          <Play v-else :size="18" />
        </button>
      </div>

      <div class="time-display">
        <span class="time-current">{{ formattedTime }}</span>
        <span class="time-separator">/</span>
        <span class="time-total">{{ formattedDuration }}</span>
      </div>

      <div class="controls-right">
        <!-- Motion controls -->
        <button 
          class="ctrl-btn" 
          :class="{ active: motion.cursorEnabled.value }" 
          @click="motion.cursorEnabled.value = !motion.cursorEnabled.value"
          @mouseenter="showBtnTip($event, t('video_editor.toggle_cursor'))"
          @mouseleave="hideBtnTip"
        >
          <MousePointer :size="14" />
        </button>

        <button 
          class="ctrl-btn" 
          :class="{ active: motion.keysEnabled.value }" 
          @click="motion.keysEnabled.value = !motion.keysEnabled.value"
          @mouseenter="showBtnTip($event, 'Toggle Keys')"
          @mouseleave="hideBtnTip"
        >
          <Keyboard :size="14" />
        </button>

        <button 
          class="ctrl-btn" 
          :class="{ active: motion.zoomEnabled.value }" 
          @click="motion.zoomEnabled.value = !motion.zoomEnabled.value"
          @mouseenter="showBtnTip($event, t('video_editor.toggle_zoom'))"
          @mouseleave="hideBtnTip"
        >
          <ZoomIn :size="14" />
        </button>

        <button 
          class="ctrl-btn" 
          @click="motion.generateAutoZoom()"
          @mouseenter="showBtnTip($event, t('video_editor.auto_zoom'))"
          @mouseleave="hideBtnTip"
        >
          <Wand2 :size="14" />
        </button>

        <button 
          v-if="motion.zoomKeyframes.value.length > 0"
          class="ctrl-btn" 
          @click="motion.clearKeyframes()"
          @mouseenter="showBtnTip($event, t('video_editor.clear_keyframes'))"
          @mouseleave="hideBtnTip"
        >
          <Trash2 :size="14" />
        </button>

        <button
          class="ctrl-btn"
          :class="{ active: showZoomSettings }"
          @click="showZoomSettings = !showZoomSettings"
          @mouseenter="showBtnTip($event, 'Editor Settings')"
          @mouseleave="hideBtnTip"
        >
          <Settings :size="14" />
        </button>

        <!-- Settings Popover -->
        <div v-if="showZoomSettings" class="zoom-settings-popover">
          <div class="zs-header">
            <span>Editor Settings</span>
            <button class="zs-close" @click="showZoomSettings = false">&times;</button>
          </div>

          <!-- Key Overlay Section -->
          <div class="zs-section-title">Key Overlay</div>
          <div class="zs-row">
            <label>Theme</label>
            <select :value="videoEditor.keyOverlayColor" @change="(e) => videoEditor.keyOverlayColor = (e.target as HTMLSelectElement).value">
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="accent">Accent</option>
            </select>
          </div>
          <div class="zs-row">
            <label>Size</label>
            <select :value="videoEditor.keyOverlaySize" @change="(e) => videoEditor.keyOverlaySize = (e.target as HTMLSelectElement).value">
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
          <div class="zs-row">
            <label>Position</label>
            <select :value="videoEditor.keyOverlayPosition" @change="(e) => videoEditor.keyOverlayPosition = (e.target as HTMLSelectElement).value">
              <option value="bottom-center">Bottom Center</option>
              <option value="bottom-left">Bottom Left</option>
              <option value="bottom-right">Bottom Right</option>
              <option value="top-left">Top Left</option>
              <option value="top-right">Top Right</option>
            </select>
          </div>

          <!-- Zoom Camera Section -->
          <div class="zs-section-title">Zoom Camera</div>
          <div class="zs-row">
            <label>Cursor Follow</label>
            <input type="range" min="0" max="1" step="0.05"
              :value="motion.cursorFollowStrength.value"
              @input="(e) => motion.cursorFollowStrength.value = parseFloat((e.target as HTMLInputElement).value)"
            />
            <span class="zs-val">{{ (motion.cursorFollowStrength.value * 100).toFixed(0) }}%</span>
          </div>
          <div class="zs-row">
            <label>Dead Zone</label>
            <input type="range" min="0" max="0.4" step="0.01"
              :value="motion.deadZoneRadius.value"
              @input="(e) => motion.deadZoneRadius.value = parseFloat((e.target as HTMLInputElement).value)"
            />
            <span class="zs-val">{{ (motion.deadZoneRadius.value * 100).toFixed(0) }}%</span>
          </div>

        </div>

        <div class="controls-divider" />

        <!-- Export Button -->
        <button
          class="ctrl-btn export-btn"
          @click="showExportDialog = true"
          @mouseenter="showBtnTip($event, t('video_editor.export_video'))"
          @mouseleave="hideBtnTip"
        >
          <Download :size="14" />
        </button>

        <div class="controls-divider" />

        <button class="ctrl-btn close-btn" @click="videoEditor.closeSession()" @mouseenter="showBtnTip($event, t('video_editor.close_editor'))" @mouseleave="hideBtnTip">
          <X :size="16" />
        </button>
      </div>
    </div>

    <!-- Timeline canvas -->
    <div class="timeline-track" @mousedown="onTimelineMouseDown" @mousemove="onTimelineMouseMove" @mouseleave="tooltip.visible = false" @contextmenu.prevent>
      <canvas ref="timelineCanvasRef" class="timeline-canvas" />

      <!-- Loading indicator -->
      <div v-if="isLoadingThumbnails" class="timeline-loading">
        <div class="loading-pulse" />
      </div>
      
      <!-- Event Tooltip -->
      <div v-if="tooltip.visible" class="timeline-tooltip" :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }">
          {{ tooltip.text }}
      </div>
    </div>

    <!-- Progress bar (simple CSS fallback) -->
    <div class="progress-bar">
      <div class="progress-fill" :style="{ width: `${progress}%` }" />
    </div>
  </div>

  <!-- Audio Tracks -->
  <div class="audio-tracks" v-if="videoEditor.session">
    <AudioWaveform 
      v-if="videoEditor.session.audioSystemPath"
      :src="videoEditor.session.audioSystemPath"
      :height="36"
      waveColor="rgba(100, 200, 255, 0.8)" 
      progressColor="#60a5fa"
      label="System Audio"
      :muted="videoEditor.sysMuted"
      :volume="videoEditor.sysVolume"
      :playable="true"
      class="music-track-row"
      @mouseenter="sysHover = true"
      @mouseleave="sysHover = false"
    >
      <div class="music-track-controls" :class="{ visible: sysHover }">
        <button class="music-ctrl-btn" :class="{ muted: videoEditor.sysMuted }" @click.stop="videoEditor.setSysMuted(!videoEditor.sysMuted)">
          <VolumeX v-if="videoEditor.sysMuted" :size="14" />
          <Volume2 v-else :size="14" />
        </button>
        <input
          type="range" min="0" max="2" step="0.01"
          :value="videoEditor.sysVolume"
          @input="(e) => videoEditor.setSysVolume(parseFloat((e.target as HTMLInputElement).value))"
          class="music-volume-slider"
          @mousedown.stop
        />
        <span class="music-vol-pct">{{ Math.round(videoEditor.sysVolume * 100) }}%</span>
      </div>
    </AudioWaveform>
    
    <AudioWaveform 
      v-if="videoEditor.session.audioMicPath"
      :src="videoEditor.session.audioMicPath"
      :height="36"
      waveColor="rgba(255, 100, 150, 0.8)"
      progressColor="#f472b6"
      label="Microphone"
      :muted="videoEditor.micMuted"
      :volume="videoEditor.micVolume"
      :playable="true"
      class="music-track-row"
      @mouseenter="micHover = true"
      @mouseleave="micHover = false"
    >
      <div class="music-track-controls" :class="{ visible: micHover }">
        <button class="music-ctrl-btn" :class="{ muted: videoEditor.micMuted }" @click.stop="videoEditor.setMicMuted(!videoEditor.micMuted)">
          <VolumeX v-if="videoEditor.micMuted" :size="14" />
          <Volume2 v-else :size="14" />
        </button>
        <input
          type="range" min="0" max="2" step="0.01"
          :value="videoEditor.micVolume"
          @input="(e) => videoEditor.setMicVolume(parseFloat((e.target as HTMLInputElement).value))"
          class="music-volume-slider"
          @mousedown.stop
        />
        <span class="music-vol-pct">{{ Math.round(videoEditor.micVolume * 100) }}%</span>
      </div>
    </AudioWaveform>

    <!-- Music Track -->
    <AudioWaveform
      v-if="videoEditor.musicTrackPath"
      :src="videoEditor.musicTrackPath"
      :height="36"
      waveColor="rgba(180, 130, 255, 0.8)"
      progressColor="#a78bfa"
      label="Music"
      :playable="true"
      :offset="videoEditor.musicOffset"
      :muted="videoEditor.musicMuted"
      class="music-track-row"
      @mousedown="onMusicWaveformMouseDown"
      @audio-duration="videoEditor.setMusicDuration"
      @mouseenter="musicHover = true"
      @mouseleave="musicHover = false"
      :style="{ cursor: musicDragging ? 'grabbing' : 'grab' }"
    >
      <div class="music-track-controls" :class="{ visible: musicHover || musicDragging }">
        <button class="music-ctrl-btn" :class="{ muted: videoEditor.musicMuted }" @click.stop="videoEditor.setMusicMuted(!videoEditor.musicMuted)">
          <VolumeX v-if="videoEditor.musicMuted" :size="14" />
          <Volume2 v-else :size="14" />
        </button>
        <input
          type="range" min="0" max="2" step="0.01"
          :value="videoEditor.musicVolume"
          @input="(e) => videoEditor.setMusicVolume(parseFloat((e.target as HTMLInputElement).value))"
          class="music-volume-slider"
          @mousedown.stop
        />
        <span class="music-vol-pct">{{ Math.round(videoEditor.musicVolume * 100) }}%</span>
        <button class="music-ctrl-btn music-remove" @click.stop="videoEditor.setMusicTrack(null)">
          <X :size="14" />
        </button>
      </div>
    </AudioWaveform>
    <div v-else class="add-music-btn" @click="pickMusicFile" role="button" tabindex="0" @keydown.enter="pickMusicFile">
      <Music :size="12" />
      <span>{{ t('video_editor.add_music') }}</span>
    </div>
  </div>

  <!-- Button tooltip (edge-aware, fixed position) -->
  <div v-if="btnTooltip.visible" class="btn-tooltip" :style="{ left: btnTooltip.x + 'px', top: btnTooltip.y + 'px' }">
    {{ btnTooltip.text }}
  </div>

  <!-- Export Dialog -->
  <ExportDialog v-if="showExportDialog" @close="showExportDialog = false" />

  <!-- Keyframe Popover -->
  <Teleport to="body">
    <div
      v-if="kfPopover.visible && selectedKeyframe"
      class="kf-popover"
      :style="{ left: kfPopover.x + 'px', bottom: kfPopover.bottom + 'px' }"
      @mousedown.stop
    >
      <div class="kf-popover-header">
        <span>Keyframe · {{ selectedKeyframe.time.toFixed(2) }}s</span>
        <button class="kf-popover-close" @click="kfPopover.visible = false">×</button>
      </div>

      <div class="kf-row">
        <label>Scale</label>
        <input type="range" min="1.2" max="4" step="0.1"
          :value="selectedKeyframe.scale"
          @input="(e) => motion.updateKeyframe(selectedKeyframe!.id, { scale: parseFloat((e.target as HTMLInputElement).value) })"
        />
        <span class="kf-val">{{ selectedKeyframe.scale.toFixed(1) }}x</span>
      </div>

      <div class="kf-row">
        <label>Hold</label>
        <input type="range" min="0.1" max="5" step="0.1"
          :value="selectedKeyframe.duration"
          @input="(e) => motion.updateKeyframe(selectedKeyframe!.id, { duration: parseFloat((e.target as HTMLInputElement).value) })"
        />
        <span class="kf-val">{{ selectedKeyframe.duration.toFixed(1) }}s</span>
      </div>

      <div class="kf-row">
        <label>Ease In</label>
        <input type="range" min="0.05" max="1.5" step="0.05"
          :value="selectedKeyframe.easeIn"
          @input="(e) => motion.updateKeyframe(selectedKeyframe!.id, { easeIn: parseFloat((e.target as HTMLInputElement).value) })"
        />
        <span class="kf-val">{{ selectedKeyframe.easeIn.toFixed(2) }}s</span>
      </div>

      <div class="kf-row">
        <label>Ease Out</label>
        <input type="range" min="0.05" max="1.5" step="0.05"
          :value="selectedKeyframe.easeOut"
          @input="(e) => motion.updateKeyframe(selectedKeyframe!.id, { easeOut: parseFloat((e.target as HTMLInputElement).value) })"
        />
        <span class="kf-val">{{ selectedKeyframe.easeOut.toFixed(2) }}s</span>
      </div>

      <div class="kf-row">
        <label>Focus X</label>
        <input type="range" min="0" max="1" step="0.01"
          :value="selectedKeyframe.x"
          @input="(e) => motion.updateKeyframe(selectedKeyframe!.id, { x: parseFloat((e.target as HTMLInputElement).value) })"
        />
        <span class="kf-val">{{ (selectedKeyframe.x * 100).toFixed(0) }}%</span>
      </div>

      <div class="kf-row">
        <label>Focus Y</label>
        <input type="range" min="0" max="1" step="0.01"
          :value="selectedKeyframe.y"
          @input="(e) => motion.updateKeyframe(selectedKeyframe!.id, { y: parseFloat((e.target as HTMLInputElement).value) })"
        />
        <span class="kf-val">{{ (selectedKeyframe.y * 100).toFixed(0) }}%</span>
      </div>

      <button class="kf-delete-btn" @click="motion.removeKeyframe(selectedKeyframe.id); kfPopover.visible = false">
        Delete Keyframe
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.timeline-tooltip {
    position: fixed; /* Fixed to viewport to avoid clipping */
    transform: translate(-50%, -100%);
    background: rgba(0, 0, 0, 0.9);
    color: white;
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-family: 'Roboto Mono', monospace;
    pointer-events: none;
    white-space: nowrap;
    z-index: 9999; /* High index to sit on top of everything */
    border: 1px solid rgba(255, 255, 255, 0.15);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}
/* ... rest of styles ... */
.video-timeline {
  background: var(--color-black);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  /* User requested styles */
  display: flex;
  padding: 8px 16px 12px;
  gap: 20px;
  flex-direction: column;
  user-select: none;
}

.timeline-track {
  position: relative;
  height: 80px;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-sizing: border-box;
}

.audio-tracks {
  display: flex;
  flex-direction: column;
  padding: 0 16px 16px 16px;
  gap: 8px;
  margin-top: 8px;
}

.controls-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.controls-left {
  display: flex;
  align-items: center;
  gap: 4px;
}

.controls-right {
  display: flex;
  align-items: center;
  gap: 2px;
  position: relative;
}

.ctrl-btn.active {
  background: rgba(120, 200, 120, 0.15);
  color: rgba(120, 200, 120, 0.95);
}

.ctrl-btn.active:hover {
  background: rgba(120, 200, 120, 0.25);
}

.controls-divider {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.12);
  margin: 0 4px;
}

.ctrl-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: all 0.15s ease;
  outline: none;
}

.zs-regenerate:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.zs-section-title {
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.3);
  text-transform: uppercase;
  margin-top: 12px;
  margin-bottom: 6px;
  padding-left: 2px;
  letter-spacing: 0.05em;
}

.zs-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
  margin: 12px 0;
}

.zs-row select {
  flex: 1;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.8);
  padding: 4px 24px 4px 8px; /* Right padding for arrow */
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
  outline: none;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23FFFFFF%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  background-size: 8px;
  transition: all 0.2s ease;
}

.zs-row select:hover {
  background-color: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
}

.zs-row select:focus {
  border-color: rgba(100, 200, 255, 0.5);
  background-color: rgba(255, 255, 255, 0.12);
}

.zs-row select option {
  background: #1a1a1c;
  color: #fff;
}

.ctrl-btn:focus,
.ctrl-btn:focus-visible {
  outline: none;
  box-shadow: none;
}

.ctrl-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.play-btn {
  width: 36px;
  height: 36px;
  background: rgba(255, 255, 255, 0.08);
}

.play-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.close-btn:hover {
  background: rgba(255, 80, 80, 0.2);
  color: #ff5050;
}

.time-display {
  font-family: 'Roboto Mono', 'Consolas', monospace;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
}

.time-current {
  color: #fff;
  font-weight: 500;
}

.time-separator {
  margin: 0 4px;
  color: rgba(255, 255, 255, 0.3);
}

.timeline-canvas {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 6px;
}

.timeline-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 6px;
}

.loading-pulse {
  width: 40px;
  height: 4px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 2px;
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.3; transform: scaleX(0.6); }
  50% { opacity: 1; transform: scaleX(1); }
}

.progress-bar {
  height: 3px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea, #764ba2);
  border-radius: 2px;
  /* transition: width 0.1s linear; REMOVED to fix lag */
}

/* ---- Zoom Settings Popover ---- */

.zoom-settings-popover {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  width: 290px;
  background: rgba(12, 12, 14, 0.96);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 12px 14px;
  z-index: 100;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.03);
  font-family: 'Geist Mono', monospace;
}

.zs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.zs-header span {
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.zs-close {
  background: none;
  border: none;
  outline: none;
  color: rgba(255, 255, 255, 0.3);
  font-size: 16px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.zs-close:hover {
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.06);
}

.zs-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.zs-row label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  min-width: 62px;
  flex-shrink: 0;
}

.zs-row input[type="range"] {
  flex: 1;
  height: 3px;
  appearance: none;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.zs-row input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.7);
  border: none;
  cursor: pointer;
  transition: background 0.15s ease;
}

.zs-row input[type="range"]::-webkit-slider-thumb:hover {
  background: #fff;
}

.zs-row input[type="range"]:focus {
  outline: none;
}

.zs-val {
  font-size: 10px;
  font-family: 'Geist Mono', monospace;
  color: rgba(255, 255, 255, 0.5);
  min-width: 36px;
  text-align: right;
  flex-shrink: 0;
}

.zs-regenerate {
  width: 100%;
  margin-top: 10px;
  padding: 6px 0;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.7);
  font-size: 10px;
  font-weight: 500;
  font-family: 'Geist Mono', monospace;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.15s ease;
  outline: none;
}

.zs-regenerate:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.zs-regenerate:focus {
  outline: none;
}

.zs-section-title {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
  margin-top: 12px;
  margin-bottom: 8px;
  padding-left: 2px;
}

.zs-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
  margin: 12px 0;
}

.zs-row select {
  flex: 1;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.8);
  font-family: inherit;
  font-size: 11px;
  padding: 2px 4px;
  outline: none;
  cursor: pointer;
}

.zs-row select:hover {
  background: rgba(255, 255, 255, 0.1);
}

/* ---- Button Tooltip (edge-aware) ---- */

.btn-tooltip {
  position: fixed;
  transform: translate(-50%, -100%);
  background: rgba(0, 0, 0, 0.92);
  color: rgba(255, 255, 255, 0.9);
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-family: 'Geist Mono', monospace;
  pointer-events: none;
  white-space: nowrap;
  z-index: 9999;
  letter-spacing: 0.02em;
}

.export-btn {
  background: rgba(102, 126, 234, 0.15);
  color: rgba(102, 126, 234, 0.95);
}

.export-btn:hover {
  background: rgba(102, 126, 234, 0.25);
  color: #667eea;
}

/* ---- Keyframe Popover ---- */

.kf-popover {
  position: fixed;
  width: 300px;
  background: rgba(12, 12, 14, 0.97);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 12px 14px;
  z-index: 9999;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.85);
  font-family: 'Geist Mono', monospace;
}

.kf-popover-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.kf-popover-header span {
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kf-popover-close {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.3);
  font-size: 18px;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.15s;
  outline: none;
}

.kf-popover-close:hover {
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.06);
}

.kf-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 7px;
}

.kf-row label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  width: 56px;
  flex-shrink: 0;
  white-space: nowrap;
}

.kf-row input[type="range"] {
  flex: 1;
  min-width: 0;
  height: 4px;
  appearance: none;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.kf-row input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: rgba(120, 200, 120, 0.95);
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
  box-shadow: 0 0 4px rgba(120, 200, 120, 0.35);
}

.kf-row input[type="range"]::-webkit-slider-thumb:hover {
  background: rgb(150, 225, 150);
  transform: scale(1.2);
}

.kf-val {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  width: 40px;
  flex-shrink: 0;
  text-align: right;
  white-space: nowrap;
}

.kf-delete-btn {
  width: 100%;
  margin-top: 12px;
  padding: 9px 0;
  border: 1px solid rgba(255, 80, 80, 0.2);
  border-radius: 6px;
  background: rgba(255, 80, 80, 0.08);
  color: rgba(255, 100, 100, 0.85);
  font-size: 12px;
  font-family: 'Geist Mono', monospace;
  cursor: pointer;
  transition: all 0.15s;
  outline: none;
  letter-spacing: 0.03em;
}

.kf-delete-btn:hover {
  background: rgba(255, 80, 80, 0.18);
  border-color: rgba(255, 80, 80, 0.4);
  color: rgba(255, 130, 130, 1);
}

.music-track-row:hover :deep(.music-track-controls),
.music-track-row:hover .music-track-controls {
  opacity: 1;
  pointer-events: auto;
}

.music-track-controls.visible {
  opacity: 1;
  pointer-events: auto;
}

.music-track-controls {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  width: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  opacity: 0;
  transition: opacity 0.15s ease;
  background: linear-gradient(to right, transparent, rgba(0, 0, 0, 0.7) 30%);
  backdrop-filter: blur(6px);
  border-radius: 0 6px 6px 0;
  pointer-events: none;
  z-index: 10;
}

.music-ctrl-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: all 0.15s;
  outline: none;
  flex-shrink: 0;
}

.music-ctrl-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

.music-ctrl-btn.muted {
  color: rgba(167, 139, 250, 0.8);
}

.music-remove:hover {
  background: rgba(255, 80, 80, 0.2);
  color: #ff5050;
}

.music-volume-slider {
  width: 80px;
  height: 3px;
  appearance: none;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  flex-shrink: 0;
}

.music-volume-slider::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #a78bfa;
  cursor: pointer;
}

.music-vol-pct {
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  min-width: 32px;
  text-align: right;
}

.music-offset-label {
  font-family: 'Geist Mono', monospace;
  font-size: 10px;
  color: rgba(167, 139, 250, 0.8);
  margin-right: 4px;
  white-space: nowrap;
}

.add-music-btn {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px dashed rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.3);
  font-family: 'Geist Mono', 'Roboto Mono', monospace;
  font-size: 11px;
  font-weight: 400;
  line-height: 1;
  padding: 6px 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  width: 100%;
}

.add-music-btn:hover {
  background: rgba(167, 139, 250, 0.06);
  border-color: rgba(167, 139, 250, 0.3);
  color: rgba(167, 139, 250, 0.8);
}

</style>