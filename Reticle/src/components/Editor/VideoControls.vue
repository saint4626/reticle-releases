<script setup lang="ts">
import { useVideoStore } from '../../stores/video';
import { storeToRefs } from 'pinia';
import { 
  Film, Mic, MicOff, Volume2, VolumeX, 
  MousePointer2, Webcam
} from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const videoStore = useVideoStore();
const { isRecording, micLevel } = storeToRefs(videoStore);
</script>

<template>
  <div class="join" @mousedown.stop>
    <!-- FPS Selector -->
    <div class="dropdown dropdown-bottom dropdown-end">
      <div tabindex="0" role="button" 
           class="btn btn-sm join-item btn-ghost bg-transparent border-none hover:bg-white/10 hover:!text-white tooltip tooltip-bottom" 
           :class="{ 'opacity-50 cursor-not-allowed pointer-events-none': isRecording }"
           :data-tip="t('editor.video.frame_rate')">
        <Film class="w-4 h-4" />
        <span class="text-xs font-mono">{{ videoStore.selectedFps }}</span>
      </div>
      <ul v-if="!isRecording" tabindex="0" class="dropdown-content z-[9999] menu p-2 shadow-xl bg-neutral-950 text-white rounded-box w-32 border border-white/10 mt-2">
        <li v-for="fps in [30, 60, 120]" :key="fps">
          <a @click="videoStore.selectedFps = fps as any" class="flex justify-between items-center hover:bg-white/10" :class="{ 'bg-white/20': videoStore.selectedFps === fps }">
            <span>{{ fps }} FPS</span>
            <div v-if="videoStore.selectedFps === fps" class="w-1.5 h-1.5 rounded-full bg-red-500"></div>
          </a>
        </li>
      </ul>
    </div>

    <!-- Codec Selector (CPU/GPU) -->
    <div class="dropdown dropdown-bottom dropdown-end">
      <div tabindex="0" role="button" 
           class="btn btn-sm join-item btn-ghost bg-transparent border-none hover:bg-white/10 hover:!text-white tooltip tooltip-bottom" 
           :class="{ 'opacity-50 cursor-not-allowed pointer-events-none': isRecording }"
           :data-tip="t('editor.video.encoder') + ': ' + (videoStore.availableCodecs.find(c => c.id === videoStore.selectedCodec)?.name || t('editor.video.unknown'))">
        <span class="text-xs font-mono font-bold uppercase">{{ videoStore.selectedCodec.includes('nvenc') ? 'NVENC' : videoStore.selectedCodec.includes('amf') ? 'AMF' : videoStore.selectedCodec.includes('qsv') ? 'QSV' : 'CPU' }}</span>
      </div>
      <ul v-if="!isRecording" tabindex="0" class="dropdown-content z-[9999] menu p-2 shadow-xl bg-neutral-950 text-white rounded-box w-48 border border-white/10 mt-2">
        <li class="menu-title text-white/50 text-xs uppercase font-bold mt-2">{{ t('editor.video.video_encoder') }}</li>
        <li v-for="codec in videoStore.availableCodecs" :key="codec.id">
          <a @click="videoStore.selectedCodec = codec.id" class="flex justify-between items-center hover:bg-white/10" :class="{ 'bg-white/20': videoStore.selectedCodec === codec.id }">
            <span class="text-xs">{{ codec.name }}</span>
            <div v-if="videoStore.selectedCodec === codec.id" class="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
          </a>
        </li>
      </ul>
    </div>

    <!-- Microphone Selector -->
    <div class="dropdown dropdown-bottom dropdown-end">
      <div tabindex="0" role="button" 
           class="btn btn-sm join-item btn-ghost bg-transparent border-none hover:bg-white/10 hover:!text-white tooltip tooltip-bottom flex items-center gap-1"
           :class="videoStore.enableMic ? '!text-white' : '!text-gray-500'"
           :data-tip="videoStore.selectedMic || t('editor.video.microphone')">
        <div class="relative">
            <Mic v-if="videoStore.enableMic" class="w-4 h-4" />
            <MicOff v-else class="w-4 h-4" />
        </div>
        <!-- Mini Bar Meter -->
        <div v-if="videoStore.enableMic" class="w-1 h-3 bg-white/10 rounded-full overflow-hidden flex flex-col-reverse">
            <div class="w-full bg-green-500 transition-all duration-75" :style="{ height: Math.min(micLevel * 100 * 3, 100) + '%' }"></div>
        </div>
      </div>
      <ul tabindex="0" class="dropdown-content z-[9999] menu p-2 shadow-xl bg-neutral-950 text-white rounded-box w-64 border border-white/10 mt-2">
        <li>
            <a @click.stop="videoStore.toggleMic(!videoStore.enableMic)" class="flex justify-between items-center hover:bg-white/10">
                <span>{{ t('editor.video.enable_mic') }}</span>
                <input type="checkbox" class="toggle toggle-xs toggle-success" :checked="videoStore.enableMic" @click.stop="videoStore.toggleMic(!videoStore.enableMic)" />
            </a>
        </li>
        <li class="menu-title text-white/50 text-xs uppercase font-bold mt-2">{{ t('editor.video.select_device') }}</li>
        <li v-for="device in videoStore.audioDevices" :key="device.name">
          <a @click="videoStore.setMicDevice(device.name)" class="flex justify-between items-center hover:bg-white/10" :class="{ 'bg-white/20': videoStore.selectedMic === device.name }">
            <span class="truncate max-w-[180px]" :title="device.name">{{ device.name }}</span>
            <div v-if="videoStore.selectedMic === device.name" class="w-1.5 h-1.5 rounded-full bg-green-500"></div>
          </a>
        </li>
         <li v-if="videoStore.audioDevices.length === 0" class="disabled">
            <a class="text-white/30 italic">{{ t('editor.video.no_mics') }}</a>
        </li>
      </ul>
    </div>

    <!-- Webcam Selector -->
    <div class="tooltip tooltip-bottom" :data-tip="t('editor.tools.coming_soon')">
      <div role="button" 
           class="btn btn-sm join-item btn-ghost bg-transparent border-none text-white/30 cursor-not-allowed"
      >
        <Webcam class="w-4 h-4" />
      </div>
    </div>

    <!-- System Audio Toggle -->
    <div class="tooltip tooltip-bottom" :data-tip="videoStore.enableSys ? t('editor.video.system_audio_on') : t('editor.video.system_audio_off')">
      <button 
        class="btn btn-sm join-item btn-ghost bg-transparent border-none hover:bg-white/10 hover:!text-white"
        :class="videoStore.enableSys ? '!text-white' : '!text-gray-500'"
        @click="videoStore.toggleSys(!videoStore.enableSys)"
      >
        <Volume2 v-if="videoStore.enableSys" class="w-4 h-4" />
        <VolumeX v-else class="w-4 h-4" />
      </button>
    </div>

    <!-- Cursor Toggle -->
    <div class="tooltip tooltip-bottom" :data-tip="videoStore.captureCursor ? t('editor.video.cursor_visible') : t('editor.video.cursor_hidden')">
      <button 
        class="btn btn-sm join-item btn-ghost bg-transparent border-none hover:bg-white/10 hover:!text-white"
        :class="videoStore.captureCursor ? '!text-white' : '!text-gray-500'"
        @click="videoStore.captureCursor = !videoStore.captureCursor"
      >
        <MousePointer2 class="w-4 h-4" />
        <div v-if="!videoStore.captureCursor" class="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div class="w-full h-[1px] bg-red-500 rotate-45 transform scale-75"></div>
        </div>
      </button>
    </div>
  </div>
</template>
