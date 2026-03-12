<template>
  <div v-if="videoStore.isCountingDown" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm select-none pointer-events-none">
    <div class="relative flex items-center justify-center">
      <div 
        :key="videoStore.countdownValue"
        class="text-[12rem] font-black text-white drop-shadow-[0_0_15px_rgba(0,0,0,0.5)] animate-countdown"
      >
        {{ videoStore.countdownValue }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useVideoStore } from '../../stores/video';

const videoStore = useVideoStore();
</script>

<style scoped>
@keyframes countdown-pop {
  0% {
    transform: scale(0.5);
    opacity: 0;
  }
  50% {
    transform: scale(1.2);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.animate-countdown {
  animation: countdown-pop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
}
</style>