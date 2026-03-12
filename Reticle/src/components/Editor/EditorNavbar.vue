<script setup lang="ts">
import { useVideoStore } from '../../stores/video';
import { storeToRefs } from 'pinia';
import { onMounted } from 'vue';
import { Camera, Video } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import logoUrl from '../../assets/logo.svg';
import type { MonitorInfo } from '../../types';

import CaptureToolbar from './CaptureToolbar.vue';
import VideoControls from './VideoControls.vue';
import AnnotationTools from './AnnotationTools.vue';
import EditorProperties from './EditorProperties.vue';
import WindowControls from './WindowControls.vue';

const { t } = useI18n();
const videoStore = useVideoStore();
const { isVideoMode, isRecording } = storeToRefs(videoStore);

const emit = defineEmits<{
  (e: 'capture-region', monitor?: MonitorInfo): void,
  (e: 'capture-window'): void,
  (e: 'open-settings'): void
}>();

onMounted(async () => {
  await videoStore.loadAudioDevices();
  await videoStore.loadWebcams();
  await videoStore.loadCodecs();
});
</script>

<template>
  <!-- Root container with drag region -->
  <div class="relative w-full h-[50px] bg-black border-b border-white/5 z-50 flex items-center justify-between px-2 gap-2 text-white" data-tauri-drag-region>
    
    <!-- Left: Title -->
    <div class="flex-none flex items-center gap-2">
      <div class="text-lg font-bold flex items-center gap-2 select-none px-2" data-tauri-drag-region>
        <div class="relative">
            <div class="absolute -inset-2 bg-primary/20 rounded-full blur-md"></div>
            <img :src="logoUrl" class="w-6 h-6 relative z-10" alt="Reticle" />
        </div>
        Reticle
      </div>

      <div class="w-[1px] h-6 bg-white/10 mx-1 pointer-events-none"></div>

      <!-- Mode Toggle -->
      <div class="tooltip tooltip-bottom" :data-tip="isRecording ? t('editor.video.recording') : (isVideoMode ? t('editor.video.switch_to_screenshot') : t('editor.video.switch_to_video'))">
        <div class="relative w-8 h-8 flex items-center justify-center">
           <!-- Screenshot Icon -->
           <button 
              class="absolute inset-0 btn btn-sm border-none bg-transparent hover:bg-white/10 transition-all duration-300 transform flex items-center justify-center p-0 rounded"
              :class="[
                isVideoMode ? 'opacity-0 scale-50 -translate-x-4 pointer-events-none' : 'opacity-100 scale-100 translate-x-0 text-white',
                isRecording ? 'cursor-not-allowed opacity-50' : ''
              ]"
              :disabled="isRecording"
              @click="videoStore.toggleMode()"
           >
              <Camera class="w-4 h-4" />
           </button>

           <!-- Video Icon -->
           <button 
              class="absolute inset-0 btn btn-sm border-none hover:bg-white/10 transition-all duration-300 transform flex items-center justify-center p-0 rounded"
              :class="[
                isVideoMode ? 'opacity-100 scale-100 translate-x-0 bg-red-500/20 text-red-400 hover:text-red-300' : 'opacity-0 scale-50 translate-x-4 pointer-events-none bg-transparent',
                isRecording ? 'cursor-not-allowed opacity-50' : ''
              ]"
              :disabled="isRecording"
              @click="videoStore.toggleMode()"
           >
              <Video class="w-4 h-4" />
           </button>
        </div>
      </div>
    </div>

    <!-- Center: Tools -->
    <div class="flex-1 flex justify-center gap-2" data-tauri-drag-region>
      <CaptureToolbar 
        @capture-region="(monitor?: MonitorInfo) => emit('capture-region', monitor)" 
        @capture-window="emit('capture-window')" 
      />

      <div class="w-[1px] h-6 bg-white/10 mx-1 self-center pointer-events-none"></div>

      <!-- Video Settings / Annotation Tools -->
      <transition name="tool">
        <VideoControls v-if="isVideoMode" />
        <AnnotationTools v-else />
      </transition>
    </div>

    <!-- Right: Properties -->
    <div class="relative flex-none flex items-center gap-2 justify-end" data-tauri-drag-region>
      <EditorProperties />

      <WindowControls @open-settings="emit('open-settings')" />
    </div>
  </div>
</template>

<style scoped>
/* Tool Transitions */
.tool-enter-active,
.tool-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.tool-enter-from,
.tool-leave-to {
  opacity: 0;
  transform: translateX(-10px);
  max-width: 0;
  margin-left: -0.5rem;
  margin-right: -0.5rem;
  padding: 0;
}

.tool-enter-to,
.tool-leave-from {
  opacity: 1;
  transform: translateX(0);
  max-width: 800px;
}
</style>
