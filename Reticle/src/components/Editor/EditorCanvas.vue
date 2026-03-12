<script setup lang="ts">
import { useEditorStore } from '../../stores/editor';
import { useViewportStore } from '../../stores/viewport';
import { storeToRefs } from 'pinia';
import { computed, ref, shallowRef, watch, onMounted, onUnmounted } from 'vue';
import { pixelate } from '../../utils/canvasEffects';
import { zoomToPoint } from '../../utils/zoomCalculator';
import { useI18n } from 'vue-i18n';
import { invoke } from '@tauri-apps/api/core';
import EmojiStickerLayer from './EmojiStickerLayer.vue';
import ShaderBackgroundLayer from './ShaderBackgroundLayer.vue';
import { useNotificationStore } from '../../stores/notification';

const { t } = useI18n();
const store = useEditorStore();
const viewport = useViewportStore();
const notify = useNotificationStore();

const { 
  imageData, padding, borderRadius, background, backgroundImage, backgroundBlur,
  shadowColor, shadowBlur, shadowSpread, shadowOpacity, shadowX, shadowY, shadowInset,
  activeTool, blurs, arrows, arrowColor, arrowStrokeWidth,
  shaderEnabled, shaderParams, imageBlob, ocrBoxes, ocrEnabled
} = storeToRefs(store);
const { scale, translate } = storeToRefs(viewport);

// ОПТИМИЗАЦИЯ 1: shallowRef вместо глубокого ref для DOM и тяжелых объектов
const mainCanvasRef = shallowRef<HTMLCanvasElement | null>(null);
const uiCanvasRef = shallowRef<HTMLCanvasElement | null>(null);
const containerRef = shallowRef<HTMLElement | null>(null);
const imageObj = shallowRef<HTMLImageElement | null>(null);
const displaySize = ref({ width: 0, height: 0 });
const hostWindow = ref<Window | null>(null);

// Pan State
const isPanning = ref(false);
const panStart = ref({ x: 0, y: 0 });
const initialTranslate = ref({ x: 0, y: 0 });

// Переменные для управления requestAnimationFrame и кэшем
let drawUIRafId: number | null = null;
let panRafId: number | null = null;
let cachedCanvasRect: DOMRect | null = null;
let resizeObserver: ResizeObserver | null = null;

const containerWrapperStyle = computed(() => ({
  padding: `${padding.value}px`,
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  overflow: 'hidden',
  position: 'relative' as const,
  transform: `scale(${scale.value}) translate(${translate.value.x}px, ${translate.value.y}px)`,
  transformOrigin: 'center center',
  cursor: (activeTool.value === 'blur' || activeTool.value === 'arrow') ? 'crosshair' : (isPanning.value ? 'grabbing' : 'default'),
}));

const backgroundLayerStyle = computed(() => {
  const style: any = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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

function getDisplayedBorderRadius() {
  const iw = imageObj.value?.naturalWidth ?? 0;
  const ih = imageObj.value?.naturalHeight ?? 0;
  const dw = displaySize.value.width || iw;
  const dh = displaySize.value.height || ih;
  if (!iw || !ih || !dw || !dh) return borderRadius.value;
  const sx = dw / iw;
  const sy = dh / ih;
  const scaleFactor = Math.min(sx, sy);
  const scaledRadius = borderRadius.value * scaleFactor;
  return Math.min(scaledRadius, dw / 2, dh / 2);
}

// Стили для основного (нижнего) канваса
const mainCanvasStyle = computed(() => {
  const clampedRadius = getDisplayedBorderRadius();
  return {
    borderRadius: `${clampedRadius}px`,
    maxWidth: '100%',
    maxHeight: '100%',
    display: 'block',
    zIndex: 10,
  };
});

// Shadow applied to the canvas wrapper div (not the transparent canvas element).
// box-shadow on a transparent <canvas> creates a rectangular halo artifact.
// Applying it to the opaque wrapper gives correct visual that matches canvas export.
const canvasWrapperShadowStyle = computed(() => {
  const clampedRadius = getDisplayedBorderRadius();

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
  };
});

// Стили для верхнего канваса (UI-слоя), который перехватывает мышь
const uiCanvasStyle = computed(() => {
  const clampedRadius = getDisplayedBorderRadius();

  return {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    zIndex: 20,
    borderRadius: `${clampedRadius}px`,
    cursor: (activeTool.value === 'blur' || activeTool.value === 'arrow') ? 'crosshair' : 'default',
  };
});

const ocrOverlayBoxes = computed(() => {
  const iw = imageObj.value?.naturalWidth ?? 0;
  const ih = imageObj.value?.naturalHeight ?? 0;
  if (!iw || !ih) return [];
  return ocrBoxes.value.map((box) => ({
    ...box,
    left: `${(box.x / iw) * 100}%`,
    top: `${(box.y / ih) * 100}%`,
    width: `${(box.w / iw) * 100}%`,
    height: `${(box.h / ih) * 100}%`,
  }));
});

// Common Canvas Logic
function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width: number) {
  const headLength = 20 + width;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx);
  
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  const lineEndOffset = headLength * 0.7;
  const lineEndX = x2 - lineEndOffset * Math.cos(angle);
  const lineEndY = y2 - lineEndOffset * Math.sin(angle);

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(lineEndX, lineEndY);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLength * Math.cos(angle - Math.PI / 6), y2 - headLength * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - headLength * Math.cos(angle + Math.PI / 6), y2 - headLength * Math.sin(angle + Math.PI / 6));
  ctx.lineTo(x2, y2);
  ctx.fill();
  
  ctx.restore();
}

// ОПТИМИЗАЦИЯ: Разделяем отрисовку на тяжелую (Main) и легкую (UI)

// drawMain: Рисует саму картинку и все СОХРАНЕННЫЕ блюры/стрелки
function drawMain() {
  const canvas = mainCanvasRef.value;
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx || !imageObj.value) return;

  const width = imageObj.value.naturalWidth;
  const height = imageObj.value.naturalHeight;

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    // Синхронизируем размер верхнего слоя
    if (uiCanvasRef.value) {
      uiCanvasRef.value.width = width;
      uiCanvasRef.value.height = height;
    }
  }

  // 1. Draw original image
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(imageObj.value, 0, 0);

  // 2. Apply blurs
  blurs.value.forEach(blur => {
    pixelate(ctx, blur.x, blur.y, blur.w, blur.h);
  });
  
  // 3. Draw Arrows
  arrows.value.forEach(arrow => {
    const w = (arrow as any).width || 5;
    drawArrow(ctx, arrow.x1, arrow.y1, arrow.x2, arrow.y2, arrow.color, w);
  });
}

function updateDisplaySize() {
  const canvas = mainCanvasRef.value;
  if (!canvas) return;
  // offsetWidth/offsetHeight give CSS layout size unaffected by CSS transforms (scale).
  // getBoundingClientRect() would return the visually-scaled size, which is wrong here.
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  if (w === 0 || h === 0) return;
  displaySize.value = { width: w, height: h };
  store.displayWidth = w;
  store.displayHeight = h;
}

// drawUI: Вызывается 60 раз в секунду при движении мыши. Рисует только процесс выделения!
function drawUI() {
  const canvas = uiCanvasRef.value;
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;

  // Очищаем прозрачный слой
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (isDragging.value && currentSelection.value) {
    if (activeTool.value === 'blur') {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        currentSelection.value.x,
        currentSelection.value.y,
        currentSelection.value.w,
        currentSelection.value.h
      );
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.fillRect(
        currentSelection.value.x,
        currentSelection.value.y,
        currentSelection.value.w,
        currentSelection.value.h
      );
      ctx.restore();
    } else if (activeTool.value === 'arrow') {
       const x1 = startPos.value.x;
       const y1 = startPos.value.y;
       const x2 = startPos.value.x + currentSelection.value.w;
       const y2 = startPos.value.y + currentSelection.value.h;
       drawArrow(ctx, x1, y1, x2, y2, arrowColor.value, arrowStrokeWidth.value);
    }
  }
}

function scheduleUIUpdate() {
  if (drawUIRafId) cancelAnimationFrame(drawUIRafId);
  drawUIRafId = requestAnimationFrame(() => drawUI());
}

// Watchers
watch(imageData, (newData) => {
  if (newData) {
    const img = new Image();
    img.onload = () => {
      imageObj.value = img;
      drawMain();
      updateDisplaySize();
    };
    img.src = newData;
  } else {
    imageObj.value = null;
    const canvas = mainCanvasRef.value;
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    if (uiCanvasRef.value) uiCanvasRef.value.getContext('2d')?.clearRect(0, 0, uiCanvasRef.value.width, uiCanvasRef.value.height);
  }
}, { immediate: true });

// Когда добавляем новый блюр или стрелку, перерисовываем только Main слой
watch([blurs, arrows], () => {
  drawMain();
}, { deep: true });

watch(scale, () => {
  updateDisplaySize();
});

onMounted(() => {
  hostWindow.value = mainCanvasRef.value?.ownerDocument.defaultView ?? null;
  updateDisplaySize();
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => updateDisplaySize())
    if (mainCanvasRef.value) resizeObserver.observe(mainCanvasRef.value);
  } else if (hostWindow.value) {
    hostWindow.value.addEventListener('resize', updateDisplaySize);
  }
  // On remount (returning from settings), the blob URL in imageData may have been
  // revoked by ScreenshotHistory thumbnail cleanup. Recreate it from the stored Blob.
  if (imageBlob.value && !imageObj.value) {
    const freshUrl = URL.createObjectURL(imageBlob.value);
    store.refreshImageUrl(freshUrl);
    const img = new Image();
    img.onload = () => {
      imageObj.value = img;
      drawMain();
      updateDisplaySize();
    };
    img.src = freshUrl;
  } else if (imageObj.value) {
    drawMain();
    updateDisplaySize();
  }
});

// Управление панорамированием — только средняя кнопка мыши (button === 1)
function onWrapperMouseDown(e: MouseEvent) {
  if (e.button !== 1) return; // только средняя кнопка
  e.preventDefault(); // предотвращаем авто-скролл браузера
  
  isPanning.value = true;
  panStart.value = { x: e.clientX, y: e.clientY };
  initialTranslate.value = { ...translate.value };
  
  window.addEventListener('mousemove', onGlobalMouseMove);
  window.addEventListener('mouseup', onGlobalMouseUp);
}

function onGlobalMouseMove(e: MouseEvent) {
  if (!isPanning.value || !containerRef.value) return;
  e.preventDefault();
  
  const dx = e.clientX - panStart.value.x;
  const dy = e.clientY - panStart.value.y;
  const newX = initialTranslate.value.x + dx;
  const newY = initialTranslate.value.y + dy;
  
  // ОПТИМИЗАЦИЯ: Throttling для панорамирования (zero-latency rAF)
  if (panRafId) cancelAnimationFrame(panRafId);
  panRafId = requestAnimationFrame(() => {
    if (containerRef.value) {
      containerRef.value.style.transform = `scale(${scale.value}) translate(${newX}px, ${newY}px)`;
    }
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
// Canvas Interaction (Tools)
const isDragging = ref(false);
const startPos = ref({ x: 0, y: 0 });
const currentSelection = ref<{x: number, y: number, w: number, h: number} | null>(null);

function getCanvasCoords(e: MouseEvent) {
  const canvas = uiCanvasRef.value; // Берем UI канвас
  if (!canvas) return { x: 0, y: 0 };
  
  // ОПТИМИЗАЦИЯ: Используем закэшированный rect (защита от Layout Thrashing)
  const rect = cachedCanvasRect || canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function onMouseDown(e: MouseEvent) {
  if (activeTool.value === 'cursor') return;

  // Кэшируем позицию DOM один раз при клике
  if (uiCanvasRef.value) {
    cachedCanvasRect = uiCanvasRef.value.getBoundingClientRect();
  }

  const coords = getCanvasCoords(e);
  isDragging.value = true;
  startPos.value = coords;
  currentSelection.value = { x: coords.x, y: coords.y, w: 0, h: 0 };
  
  scheduleUIUpdate();
}
function onMouseMove(e: MouseEvent) {
  if (!isDragging.value || activeTool.value === 'cursor') return;
  
  const coords = getCanvasCoords(e);
  currentSelection.value = {
    x: startPos.value.x,
    y: startPos.value.y,
    w: coords.x - startPos.value.x,
    h: coords.y - startPos.value.y
  };
  
  // ОПТИМИЗАЦИЯ: Перерисовываем только легкий UI-слой через rAF
  scheduleUIUpdate();
}

function onMouseUp() {
  if (!isDragging.value) return;
  
  isDragging.value = false;
  cachedCanvasRect = null; // Очищаем кэш геометрии DOM
  
  if (currentSelection.value) {
    let { x, y, w, h } = currentSelection.value;
    
    if (activeTool.value === 'blur') {
      if (w < 5 && h < 5) {
         currentSelection.value = null;
         drawUI(); // Очищаем UI слой
         return; 
      }
      
      if (w < 0) { x += w; w = Math.abs(w); }
      if (h < 0) { y += h; h = Math.abs(h); }
      
      if (w > 5 && h > 5) store.addBlur({ x, y, w, h });
      
    } else if (activeTool.value === 'arrow') {
      const x1 = startPos.value.x;
      const y1 = startPos.value.y;
      const x2 = x1 + w;
      const y2 = y1 + h;
      
      if (Math.abs(w) > 5 || Math.abs(h) > 5) {
        store.addArrow({ x1, y1, x2, y2, color: arrowColor.value, width: arrowStrokeWidth.value });
      }
    }
  }
  
  currentSelection.value = null;
  drawUI(); // Очищаем рамку с прозрачного слоя
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

async function onOcrBoxClick(text: string) {
  if (!text.trim()) return;
  try {
    await invoke('copy_text_to_clipboard', { text });
    notify.add(t('editor.copy_success'), 'success');
  } catch (e) {
    notify.add(t('editor.copy_error') + e, 'error');
  }
}

// Очистка при уничтожении компонента для предотвращения утечек памяти
onUnmounted(() => {
  window.removeEventListener('mousemove', onGlobalMouseMove);
  window.removeEventListener('mouseup', onGlobalMouseUp);
  if (resizeObserver && mainCanvasRef.value) {
    resizeObserver.unobserve(mainCanvasRef.value);
    resizeObserver.disconnect();
  } else if (hostWindow.value) {
    hostWindow.value.removeEventListener('resize', updateDisplaySize);
  }
  if (drawUIRafId) cancelAnimationFrame(drawUIRafId);
  if (panRafId) cancelAnimationFrame(panRafId);
});
</script>

<template>
  <div 
    class="canvas-wrapper w-full h-full flex justify-center items-center bg-black p-8 overflow-hidden"
    @wheel.prevent="onWheel"
    @mousedown="onWrapperMouseDown"
    @auxclick.prevent
    @dblclick="onDoubleClick"
  >
    <div v-if="imageData" id="capture-target" ref="containerRef" :style="containerWrapperStyle" class="origin-center">
      <!-- Static gradient/solid/image background -->
      <div v-if="!shaderEnabled" :style="backgroundLayerStyle"></div>
      <!-- Animated shader background -->
      <ShaderBackgroundLayer v-else :params="shaderParams" :active="true" />
      
      <div class="relative" style="display: flex; font-size: 0; max-width: 100%; max-height: 100%;" :style="canvasWrapperShadowStyle">
        <canvas 
          ref="mainCanvasRef"
          :style="mainCanvasStyle"
        ></canvas>

        <canvas 
          ref="uiCanvasRef"
          :style="uiCanvasStyle"
          @mousedown="onMouseDown"
          @mousemove="onMouseMove"
          @mouseup="onMouseUp"
          @mouseleave="onMouseUp"
          @pointerdown="store.selectedStickerId = null"
        ></canvas>

        <div
          v-if="ocrEnabled && ocrOverlayBoxes.length > 0"
          class="absolute inset-0 z-30"
          :style="{ pointerEvents: activeTool === 'cursor' ? 'auto' : 'none' }"
        >
          <button
            v-for="box in ocrOverlayBoxes"
            :key="box.id"
            class="absolute border border-cyan-300/80 bg-cyan-400/10 hover:bg-cyan-400/20 transition-colors"
            :style="{ left: box.left, top: box.top, width: box.width, height: box.height }"
            :title="box.text"
            @click.stop="onOcrBoxClick(box.text)"
          />
        </div>

        <EmojiStickerLayer
          :canvas-width="imageObj?.naturalWidth ?? 0"
          :canvas-height="imageObj?.naturalHeight ?? 0"
          :display-width="displaySize.width"
          :display-height="displaySize.height"
        />
      </div>

    </div>
    
    <div v-if="scale !== 1" class="absolute bottom-4 right-4 bg-black/80 border border-white/10 text-white px-3 py-1.5 rounded-lg text-sm font-mono pointer-events-none select-none animate-in fade-in zoom-in duration-200">
      {{ Math.round(scale * 100) }}%
    </div>

    <div v-else-if="!imageData" class="text-white/50 text-xl font-mono select-none pointer-events-none">
      {{ t('editor.empty_state') }}
    </div>
  </div>
</template>

<style scoped>
.canvas-wrapper {
  background-image: radial-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 20px 20px;
}
</style>
