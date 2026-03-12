<script setup lang="ts">
import { useOverlay } from '../composables/useOverlay';

const { overlayStyle, initRecordOverlayStyle } = useOverlay();

initRecordOverlayStyle();
</script>

<template>
  <div class="absolute bg-transparent pointer-events-none z-[9999]" :style="{ ...overlayStyle, outline: '2px dashed red' }">
    <!-- Recording label -->
    <div class="absolute bottom-full left-[-2px] mb-[2px] bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-t flex items-center gap-1">
      <div class="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></div>
      REC
    </div>
  </div>
</template>
