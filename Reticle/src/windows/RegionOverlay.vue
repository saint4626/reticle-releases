<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event';
import { binaryToBlobUrl, BlobUrlManager } from '../utils/blob';
import RegionSelector from '../components/Overlay/RegionSelector.vue';

const fullscreenScreenshot = ref<string | null>(null);
const regionOverlayKey = ref(0);
const blobManager = new BlobUrlManager();
const unlisteners = ref<UnlistenFn[]>([]);
const overlayDpr = ref(window.devicePixelRatio ?? 1);

async function onConfirm(rect: { x: number, y: number, width: number, height: number }) {
  await emit('region-overlay-confirm', { ...rect, dpr: overlayDpr.value });
  await getCurrentWindow().hide();
}

async function onCancel() {
  await emit('region-overlay-cancel', null);
  await getCurrentWindow().hide();
}

onMounted(async () => {
  document.body.style.backgroundColor = 'transparent';
  document.documentElement.style.backgroundColor = 'transparent';
  document.documentElement.style.margin = '0';
  document.documentElement.style.padding = '0';

  document.body.style.margin = '0';
  document.body.style.padding = '0';
  document.body.style.overflow = 'hidden';
      
  const appEl = document.getElementById('app');
  if (appEl) {
    appEl.style.margin = '0';
    appEl.style.padding = '0';
    appEl.style.position = 'absolute';
    appEl.style.inset = '0';
  }

  const unlistenImage = await listen('region-overlay-image', (event) => {
    const payload = event.payload as number[] | Uint8Array;
    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    fullscreenScreenshot.value = blobManager.register(binaryToBlobUrl(bytes));
  });

  const unlistenReset = await listen('region-overlay-reset', () => {
    regionOverlayKey.value += 1;
  });

  unlisteners.value = [unlistenImage, unlistenReset];

  await emit('region-overlay-ready', null);
});

onUnmounted(() => {
  unlisteners.value.forEach(fn => fn());
  blobManager.cleanup();
});
</script>

<template>
  <RegionSelector 
    :key="regionOverlayKey"
    v-if="fullscreenScreenshot"
    :image="fullscreenScreenshot"
    @confirm="onConfirm"
    @cancel="onCancel"
  />
</template>
