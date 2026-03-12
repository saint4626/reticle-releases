<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { ShaderRenderer, type ShaderParams } from '../../utils/shaderBackground';

const props = defineProps<{
  params: ShaderParams;
  active: boolean;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
let renderer: ShaderRenderer | null = null;

function initRenderer() {
  if (!canvasRef.value) return;
  renderer?.destroy();
  renderer = new ShaderRenderer(canvasRef.value, props.params);
  if (props.active) renderer.start();
}

onMounted(() => {
  initRenderer();
});

onUnmounted(() => {
  renderer?.destroy();
  renderer = null;
});

// Sync params reactively
watch(() => props.params, (p) => {
  if (renderer) Object.assign(renderer.params, p);
}, { deep: true });

watch(() => props.active, (v) => {
  if (!renderer) return;
  v ? renderer.start() : renderer.stop();
});

// ResizeObserver to keep canvas pixel size in sync with CSS size
let ro: ResizeObserver | null = null;
onMounted(() => {
  if (!canvasRef.value) return;
  ro = new ResizeObserver((entries) => {
    const e = entries[0];
    if (!e || !canvasRef.value) return;
    const { width, height } = e.contentRect;
    canvasRef.value.width = Math.round(width);
    canvasRef.value.height = Math.round(height);
  });
  ro.observe(canvasRef.value);
});
onUnmounted(() => ro?.disconnect());
</script>

<template>
  <canvas
    ref="canvasRef"
    class="shader-bg-canvas"
  />
</template>

<style scoped>
.shader-bg-canvas {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  display: block;
}
</style>
