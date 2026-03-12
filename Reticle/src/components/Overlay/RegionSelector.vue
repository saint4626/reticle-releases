<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useMouseInElement } from '@vueuse/core';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

defineProps<{
  image: string;
}>();

const emit = defineEmits<{
  (e: 'confirm', region: { x: number, y: number, width: number, height: number }): void;
  (e: 'cancel'): void;
}>();

const container = ref<HTMLElement | null>(null);
const { elementX, elementY } = useMouseInElement(container);

const isSelecting = ref(false);
const startX = ref(0);
const startY = ref(0);
const currentX = ref(0);
const currentY = ref(0);

const selection = computed(() => {
  const width = Math.abs(currentX.value - startX.value);
  const height = Math.abs(currentY.value - startY.value);
  const left = Math.min(startX.value, currentX.value);
  const top = Math.min(startY.value, currentY.value);
  return { width, height, left, top };
});

function onMouseDown() {
  isSelecting.value = true;
  startX.value = elementX.value;
  startY.value = elementY.value;
  currentX.value = elementX.value;
  currentY.value = elementY.value;
}

function onMouseMove() {
  if (!isSelecting.value) return;
  currentX.value = elementX.value;
  currentY.value = elementY.value;
}

function onMouseUp() {
  if (!isSelecting.value) return;
  isSelecting.value = false;
  
  // Calculate final rect
  const x = Math.min(startX.value, currentX.value);
  const y = Math.min(startY.value, currentY.value);
  const width = Math.abs(currentX.value - startX.value);
  const height = Math.abs(currentY.value - startY.value);

  if (width > 10 && height > 10) {
    emit('confirm', { x, y, width, height });
  } else {
    // If selection is too small, just cancel or ignore
    isSelecting.value = false;
  }
}

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('cancel');
  }
}

onMounted(() => window.addEventListener('keydown', onEsc));
onUnmounted(() => window.removeEventListener('keydown', onEsc));
</script>

<template>
  <div 
    ref="container"
    class="fixed inset-0 z-50 cursor-crosshair select-none overflow-hidden"
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
  >
    <!-- Background Image -->
    <img :src="image" class="w-full h-full object-cover pointer-events-none" />
    
    <!-- Dim Overlay -->
    <div class="absolute inset-0 bg-black/50 pointer-events-none"></div>

    <!-- Selection Highlight (Clip Path trick or separate div) -->
    <!-- Simple div implementation -->
    <div 
      v-if="isSelecting || (startX !== 0 && selection.width > 0)"
      class="absolute border-2 border-white bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
      :style="{
        left: selection.left + 'px',
        top: selection.top + 'px',
        width: selection.width + 'px',
        height: selection.height + 'px',
      }"
    ></div>
    
    <div class="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-full text-sm font-medium pointer-events-none">
      {{ t('region_selector.instruction') }}
    </div>
  </div>
</template>
