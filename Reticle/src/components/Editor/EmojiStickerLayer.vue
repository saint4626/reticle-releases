<script setup lang="ts">
import { ref, watch } from 'vue';
import { useEditorStore } from '../../stores/editor';
import { storeToRefs } from 'pinia';
import type { EmojiSticker } from '../../stores/editor';

/**
 * Coordinate system — normalized [0..1] relative to canvasWidth/canvasHeight.
 *
 * s.x, s.y  — [0..1] fraction of image natural size
 * s.size    — [0..1] fraction of image natural width
 * s.rotation — degrees
 *
 * For UI rendering we need the screen-space rect of the layer element itself.
 * We read it via getBoundingClientRect() at interaction time — this is always
 * correct regardless of viewport zoom level, CSS transforms, or window size.
 *
 * For export: multiply by naturalWidth/naturalHeight directly.
 */

const props = defineProps<{
  canvasWidth: number;
  canvasHeight: number;
  displayWidth: number;
  displayHeight: number;
}>();

const store = useEditorStore();
const { stickers, selectedStickerId } = storeToRefs(store);

const layerRef = ref<HTMLElement | null>(null);

/** Get the current screen-space rect of the sticker layer (= canvas element rect). */
function getLayerRect(): DOMRect | null {
  return layerRef.value?.getBoundingClientRect() ?? null;
}

// Place new sticker at canvas center
watch(stickers, (newVal, oldVal) => {
  if (newVal.length > (oldVal?.length ?? 0)) {
    const last = newVal[newVal.length - 1];
    if (last.x === -1 && last.y === -1) {
      store.updateSticker(last.id, { x: 0.5, y: 0.5 });
    }
  }
}, { flush: 'post' });

// ── Drag ─────────────────────────────────────────────────────────────────────
const dragState = ref<{
  id: string;
  startX: number; startY: number;
  origX: number; origY: number;
  moved: boolean;
  rectW: number; rectH: number;
} | null>(null);

function onStickerPointerDown(e: PointerEvent, sticker: EmojiSticker) {
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  selectedStickerId.value = sticker.id;

  // Capture layer rect NOW — correct for current zoom level
  const rect = getLayerRect();
  dragState.value = {
    id: sticker.id,
    startX: e.clientX, startY: e.clientY,
    origX: sticker.x, origY: sticker.y,
    moved: false,
    rectW: rect?.width ?? 1,
    rectH: rect?.height ?? 1,
  };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragUp, { once: true });
}

function onDragMove(e: PointerEvent) {
  if (!dragState.value) return;
  const dx = e.clientX - dragState.value.startX;
  const dy = e.clientY - dragState.value.startY;
  if (!dragState.value.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
  dragState.value.moved = true;
  // dx/rectW: viewport-px delta / viewport-px layer width = correct normalized delta
  store.updateSticker(dragState.value.id, {
    x: dragState.value.origX + dx / dragState.value.rectW,
    y: dragState.value.origY + dy / dragState.value.rectH,
  });
}

function onDragUp() {
  dragState.value = null;
  window.removeEventListener('pointermove', onDragMove);
}

// ── Resize ────────────────────────────────────────────────────────────────────
const resizeState = ref<{
  id: string;
  startDist: number;
  origSize: number;
  screenCx: number; screenCy: number;
  rectW: number;
} | null>(null);

function onResizePointerDown(e: PointerEvent, sticker: EmojiSticker, _corner: string) {
  e.stopPropagation();
  e.preventDefault();
  const wrapper = (e.currentTarget as HTMLElement).closest('.sticker-wrapper') as HTMLElement;
  const wRect = wrapper?.getBoundingClientRect();
  const screenCx = wRect ? wRect.left + wRect.width / 2 : e.clientX;
  const screenCy = wRect ? wRect.top + wRect.height / 2 : e.clientY;
  const dx = e.clientX - screenCx;
  const dy = e.clientY - screenCy;
  const rect = getLayerRect();
  resizeState.value = {
    id: sticker.id,
    startDist: Math.sqrt(dx * dx + dy * dy) || 1,
    origSize: sticker.size,
    screenCx, screenCy,
    rectW: rect?.width ?? 1,
  };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  window.addEventListener('pointermove', onResizeMove);
  window.addEventListener('pointerup', onResizeUp, { once: true });
}

function onResizeMove(e: PointerEvent) {
  if (!resizeState.value) return;
  const { id, startDist, origSize, screenCx, screenCy } = resizeState.value;
  const dx = e.clientX - screenCx;
  const dy = e.clientY - screenCy;
  const ratio = (Math.sqrt(dx * dx + dy * dy) || 1) / startDist;
  store.updateSticker(id, { size: Math.max(0.01, Math.min(0.5, origSize * ratio)) });
}

function onResizeUp() {
  resizeState.value = null;
  window.removeEventListener('pointermove', onResizeMove);
}

// ── Rotate ────────────────────────────────────────────────────────────────────
const rotateState = ref<{ id: string; cx: number; cy: number } | null>(null);

function onRotatePointerDown(e: PointerEvent, sticker: EmojiSticker) {
  e.stopPropagation();
  e.preventDefault();
  const el = (e.currentTarget as HTMLElement).closest('.sticker-wrapper') as HTMLElement;
  const rect = el?.getBoundingClientRect();
  rotateState.value = {
    id: sticker.id,
    cx: rect ? rect.left + rect.width / 2 : e.clientX,
    cy: rect ? rect.top + rect.height / 2 : e.clientY,
  };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  window.addEventListener('pointermove', onRotateMove);
  window.addEventListener('pointerup', onRotateUp, { once: true });
}

function onRotateMove(e: PointerEvent) {
  if (!rotateState.value) return;
  const { id, cx, cy } = rotateState.value;
  store.updateSticker(id, { rotation: Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI) + 90 });
}

function onRotateUp() {
  rotateState.value = null;
  window.removeEventListener('pointermove', onRotateMove);
}

// ── Styles ────────────────────────────────────────────────────────────────────
// displayWidth/displayHeight = CSS size of canvas without viewport zoom.
// s.x * displayWidth = CSS px position inside the (pre-zoom) container.
// This is correct because the container itself is scaled by viewport zoom,
// so CSS px inside it map correctly to screen px.
function stickerStyle(s: EmojiSticker) {
  return {
    position: 'absolute' as const,
    left: `${s.x * props.displayWidth}px`,
    top: `${s.y * props.displayHeight}px`,
    transform: `translate(-50%, -50%) rotate(${s.rotation}deg)`,
    fontSize: `${s.size * props.displayWidth}px`,
    lineHeight: '1',
    userSelect: 'none' as const,
    touchAction: 'none',
    cursor: selectedStickerId.value === s.id ? 'grab' : 'pointer',
  };
}
</script>

<template>
  <div
    ref="layerRef"
    class="stickers-layer"
    style="position: absolute; inset: 0; z-index: 30; pointer-events: none;"
  >
    <div
      v-for="sticker in stickers"
      :key="sticker.id"
      class="sticker-wrapper"
      :style="stickerStyle(sticker)"
      style="pointer-events: all;"
      @pointerdown="onStickerPointerDown($event, sticker)"
    >
      <span style="display: block; pointer-events: none; line-height: 1;">{{ sticker.emoji }}</span>

      <template v-if="selectedStickerId === sticker.id">
        <div style="position:absolute;inset:-6px;border:2px dashed rgba(255,255,255,0.9);border-radius:6px;pointer-events:none;box-shadow:0 0 0 1px rgba(0,0,0,0.4);"></div>

        <div
          class="rotate-handle"
          style="position:absolute;top:-30px;left:50%;transform:translateX(-50%);width:14px;height:14px;background:white;border:2px solid #555;border-radius:50%;cursor:crosshair;pointer-events:all;box-shadow:0 1px 4px rgba(0,0,0,0.4);"
          @pointerdown="onRotatePointerDown($event, sticker)"
        ></div>

        <div
          v-for="corner in ['top-left','top-right','bottom-left','bottom-right']"
          :key="corner"
          :style="{
            position:'absolute', width:'12px', height:'12px',
            background:'white', border:'2px solid #555', borderRadius:'3px',
            cursor: corner==='top-left'||corner==='bottom-right' ? 'nwse-resize':'nesw-resize',
            pointerEvents:'all', boxShadow:'0 1px 4px rgba(0,0,0,0.4)',
            top: corner.includes('top') ? '-12px':'auto',
            bottom: corner.includes('bottom') ? '-12px':'auto',
            left: corner.includes('left') ? '-12px':'auto',
            right: corner.includes('right') ? '-12px':'auto',
          }"
          @pointerdown="onResizePointerDown($event, sticker, corner)"
        ></div>

        <button
          style="position:absolute;top:-32px;right:-32px;width:22px;height:22px;background:#ef4444;border:none;border-radius:50%;color:white;font-size:16px;line-height:22px;text-align:center;padding:0;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.4);pointer-events:all;"
          @pointerdown.stop
          @click.stop="store.removeSticker(sticker.id)"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="pointer-events:none">
            <line x1="1" y1="1" x2="9" y2="9" stroke="white" stroke-width="2" stroke-linecap="round"/>
            <line x1="9" y1="1" x2="1" y2="9" stroke="white" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </template>
    </div>
  </div>
</template>
