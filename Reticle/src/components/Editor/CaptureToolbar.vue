<script setup lang="ts">
import { useVideoStore } from '../../stores/video';
import { useEditorStore } from '../../stores/editor';
import { useNotificationStore } from '../../stores/notification';
import { useSettingsStore } from '../../stores/settings';
import { useHistoryStore } from '../../stores/history';
import { storeToRefs } from 'pinia';
import { invoke } from '@tauri-apps/api/core';
import { ref, onMounted } from 'vue';
import { 
  Camera, Crop, AppWindow, Monitor, 
  Circle, Square, Pause, Play
} from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import type { MonitorInfo } from '../../types';
import { saveUrlToHistory } from '../../utils/history';
import { renderEditorImageAsBytes } from '../../utils/editorRender';

const { t } = useI18n();
const store = useEditorStore();
const videoStore = useVideoStore();
const notify = useNotificationStore();
const settingsStore = useSettingsStore();
const historyStore = useHistoryStore();
const { isVideoMode, isRecording, recordingDuration } = storeToRefs(videoStore);

const emit = defineEmits<{
  (e: 'capture-region', monitor?: MonitorInfo): void,
  (e: 'capture-window'): void
}>();

const monitors = ref<MonitorInfo[]>([]);

async function checkMonitors() {
  try {
    monitors.value = await invoke<MonitorInfo[]>('get_monitors');
  } catch (e) {
    console.error('Failed to get monitors:', e);
  }
}

onMounted(async () => {
  await checkMonitors();
});

async function autoSaveOriginal(bytes: Uint8Array) {
  try {
    const targetDir = settingsStore.autoSaveEnabled && settingsStore.autoSaveScreenshotFolder
      ? settingsStore.autoSaveScreenshotFolder
      : undefined;
    await invoke<string>('save_image', { bytes, targetDir });
  } catch (e) {
    console.error('Failed to auto-save original screenshot:', e);
  }
}

function getRenderState() {
  return {
    imageData: store.imageData,
    padding: store.padding,
    borderRadius: store.borderRadius,
    background: store.background,
    backgroundImage: store.backgroundImage,
    backgroundBlur: store.backgroundBlur,
    shaderEnabled: store.shaderEnabled,
    shaderParams: store.shaderParams,
    shadowX: store.shadowX,
    shadowY: store.shadowY,
    shadowBlur: store.shadowBlur,
    shadowSpread: store.shadowSpread,
    shadowColor: store.shadowColor,
    shadowOpacity: store.shadowOpacity,
    shadowInset: store.shadowInset,
    blurs: store.blurs,
    arrows: store.arrows,
    stickers: store.stickers,
  };
}

async function autoCopyRendered() {
  if (!store.imageData) return;
  try {
    const bytes = await renderEditorImageAsBytes(getRenderState());
    await invoke('copy_to_clipboard', { bytes });
  } catch (e) {
    console.error('Failed to auto-copy screenshot:', e);
  }
}

async function capture(monitorId?: number) {
  try {
    const result = await invoke<Uint8Array>('capture_fullscreen', { monitorId });
    const data = result instanceof Uint8Array ? result : new Uint8Array(result);
    const blob = new Blob([data as unknown as BlobPart], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    store.setImage(url, blob);
    saveUrlToHistory(url, historyStore);
    void autoSaveOriginal(data);
    void autoCopyRendered();
  } catch (e) {
    console.error('Failed to capture:', e);
    notify.add(t('editor.capture_error') + e, 'error');
  }
}

function captureRegion(monitor?: MonitorInfo) {
  emit('capture-region', monitor);
}
</script>

<template>
  <div class="join" @mousedown.stop>
    
    <!-- Recording Status -->
    <div v-if="isRecording" class="flex items-center gap-2 px-3 text-red-400">
      <div class="flex items-center gap-2" :class="{ 'animate-pulse': !videoStore.isPaused }">
         <Circle class="w-3 h-3 fill-current" :class="{ 'text-yellow-400 fill-yellow-400': videoStore.isPaused }" />
         <span class="font-mono text-xs">{{ new Date(recordingDuration * 1000).toISOString().substr(14, 5) }}</span>
      </div>
      
      <!-- Pause/Resume Button -->
      <button 
        class="btn btn-xs btn-ghost btn-square text-white ml-2 hover:bg-white/10 border border-white/10 rounded transition-all duration-200" 
        :class="videoStore.isPaused ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30' : 'bg-transparent hover:text-white'"
        @click="videoStore.togglePause()" 
        :title="videoStore.isPaused ? t('editor.video.resume_recording') : t('editor.video.pause_recording')"
      >
         <Play v-if="videoStore.isPaused" class="w-3 h-3 fill-current" />
         <Pause v-else class="w-3 h-3 fill-current" />
      </button>

      <!-- Stop Button -->
      <button 
        class="btn btn-xs btn-ghost btn-square text-red-400 ml-1 hover:bg-red-500/20 hover:text-red-300 border border-white/10 rounded transition-all duration-200" 
        @click="videoStore.stopRecording()" 
        :title="t('editor.video.stop_recording')"
      >
         <Square class="w-3 h-3 fill-current" />
      </button>
    </div>

    <div v-else class="contents">
    
    <!-- Fullscreen Capture (Single Monitor) -->
    <div v-if="monitors.length <= 1" class="tooltip tooltip-bottom" :data-tip="isVideoMode ? t('editor.video.record_screen') : t('editor.tools.fullscreen')">
      <button 
        class="btn btn-sm join-item btn-ghost bg-transparent border-none hover:bg-white/10 transition-colors duration-300" 
        :class="isVideoMode ? 'text-red-400 hover:text-red-300' : 'text-white hover:text-white'"
        @click="isVideoMode ? videoStore.startRecording('screen') : capture()"
      >
        <Camera class="w-4 h-4" />
      </button>
    </div>

    <!-- Fullscreen Capture (Multi Monitor) -->
    <div v-else class="dropdown dropdown-bottom dropdown-end">
       <div tabindex="0" role="button" class="btn btn-sm join-item btn-ghost bg-transparent border-none hover:bg-white/10 tooltip tooltip-bottom transition-colors duration-300" 
         :class="isVideoMode ? 'text-red-400 hover:text-red-300' : 'text-white hover:text-white'"
         :data-tip="isVideoMode ? t('editor.video.record_screen') : t('editor.tools.fullscreen')">
         <Monitor class="w-4 h-4" />
       </div>
       <ul tabindex="0" class="dropdown-content z-[9999] menu p-2 shadow-xl bg-neutral-950 text-white rounded-box w-52 border border-white/10 mt-2">
         <li v-for="(monitor, index) in monitors" :key="monitor.id">
           <a @click="isVideoMode ? videoStore.startRecording('screen', index.toString()) : capture(monitor.id)" class="flex items-center gap-2 hover:bg-white/10">
             <Monitor class="w-4 h-4" />
             <span class="text-xs truncate">
               {{ monitor.name }} 
               <span v-if="monitor.is_primary" class="opacity-50">(Main)</span>
             </span>
           </a>
         </li>
       </ul>
    </div>

    <!-- Region Capture (Multi Monitor) -->
    <div v-if="monitors.length > 1" class="dropdown dropdown-bottom dropdown-end">
       <div tabindex="0" role="button" class="btn btn-sm join-item btn-ghost bg-transparent border-none hover:bg-white/10 tooltip tooltip-bottom transition-colors duration-300" 
         :class="isVideoMode ? 'text-red-400 hover:text-red-300' : 'text-white hover:text-white'"
         :data-tip="isVideoMode ? t('editor.video.record_area') : t('editor.tools.region')">
         <Crop class="w-4 h-4" />
       </div>
       <ul tabindex="0" class="dropdown-content z-[9999] menu p-2 shadow-xl bg-neutral-950 text-white rounded-box w-52 border border-white/10 mt-2">
         <li v-for="monitor in monitors" :key="monitor.id">
           <a @click="captureRegion(monitor)" class="flex items-center gap-2 hover:bg-white/10">
             <Monitor class="w-4 h-4" />
             <span class="text-xs truncate">
               {{ monitor.name }} 
               <span v-if="monitor.is_primary" class="opacity-50">(Main)</span>
             </span>
           </a>
         </li>
       </ul>
    </div>
    
    <div v-else class="tooltip tooltip-bottom" :data-tip="isVideoMode ? t('editor.video.record_area') : t('editor.tools.region')">
      <button class="btn btn-sm join-item btn-ghost bg-transparent border-none hover:bg-white/10 transition-colors duration-300" 
        :class="isVideoMode ? 'text-red-400 hover:text-red-300' : 'text-white hover:text-white'"
        @click="captureRegion()">
        <Crop class="w-4 h-4" />
      </button>
    </div>

    <div class="tooltip tooltip-bottom" :data-tip="isVideoMode ? t('editor.video.record_window') : t('editor.tools.window')">
       <button class="btn btn-sm join-item btn-ghost bg-transparent border-none hover:bg-white/10 transition-colors duration-300" 
         :class="isVideoMode ? 'text-red-400 hover:text-red-300' : 'text-white hover:text-white'"
         @click="$emit('capture-window')">
         <AppWindow class="w-4 h-4" />
       </button>
     </div>
     </div> <!-- End of v-else contents -->
  </div>
</template>
