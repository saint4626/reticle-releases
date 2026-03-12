<script setup lang="ts">
import { ref, computed } from 'vue';
import { useVideoExport, type ExportOptions } from '../../composables/useVideoExport';
import { useVideoEditorStore } from '../../stores/videoEditor';
import { useI18n } from 'vue-i18n';
import { X, Download } from 'lucide-vue-next';
import { save } from '@tauri-apps/plugin-dialog';

const { t } = useI18n();
const videoEditor = useVideoEditorStore();
const { isExporting, exportProgress, exportVideo } = useVideoExport();

const emit = defineEmits<{
  close: []
}>();

// Export settings
const outputFormat = ref<'mp4' | 'webm' | 'gif'>('mp4');
const videoCodec = ref<'avc' | 'vp9' | 'av1' | 'hevc' | 'vp8'>('avc');
const quality = ref<'QUALITY_VERY_HIGH' | 'QUALITY_HIGH' | 'QUALITY_MEDIUM' | 'QUALITY_LOW'>('QUALITY_HIGH');
const gifFps = ref(15);
const gifWidth = ref(640);

const isGif = computed(() => outputFormat.value === 'gif');

// Audio track settings — driven by editor store (set in timeline)
const includeSystemAudio = computed(() => !videoEditor.sysMuted);
const includeMicAudio = computed(() => !videoEditor.micMuted);

// Available codecs per format
const availableCodecs = computed(() => {
  if (outputFormat.value === 'mp4') {
    return [
      { id: 'avc', name: 'H.264 (AVC)' }
    ];
  } else {
    return [
      { id: 'vp9', name: 'VP9' },
      { id: 'vp8', name: 'VP8' }
    ];
  }
});

// Quality presets
const qualityPresets = [
  { value: 'QUALITY_VERY_HIGH', label: 'Very High', bitrate: '(~10 Mbps)' },
  { value: 'QUALITY_HIGH', label: 'High', bitrate: '(~5 Mbps)' },
  { value: 'QUALITY_MEDIUM', label: 'Medium', bitrate: '(~2.5 Mbps)' },
  { value: 'QUALITY_LOW', label: 'Low', bitrate: '(~1 Mbps)' }
];

// Update codec when format changes
function onFormatChange() {
  if (outputFormat.value === 'mp4') {
    videoCodec.value = 'avc';
  } else if (outputFormat.value === 'webm') {
    videoCodec.value = 'vp9';
  }
  // gif: codec/quality not used
}

async function handleExport() {
  if (!videoEditor.session) return;

  let extension: string;
  let filterName: string;
  if (outputFormat.value === 'gif') {
    extension = 'gif';
    filterName = 'Animated GIF';
  } else if (outputFormat.value === 'mp4') {
    extension = 'mp4';
    filterName = 'MP4 Video';
  } else {
    extension = 'webm';
    filterName = 'WebM Video';
  }

  // Open save dialog
  const outputPath = await save({
    defaultPath: `exported_video.${extension}`,
    filters: [{
      name: filterName,
      extensions: [extension]
    }]
  });

  if (!outputPath) return;

  const options: ExportOptions = {
    outputPath,
    outputFormat: outputFormat.value,
    videoCodec: videoCodec.value,
    quality: quality.value,
    hardwareAcceleration: 'prefer-hardware',
    includeSystemAudio: includeSystemAudio.value,
    includeMicAudio: includeMicAudio.value,
    gifFps: gifFps.value,
    gifWidth: gifWidth.value,
  };

  try {
    await exportVideo(options);
  } catch (error) {
    console.error('Export failed:', error);
  }
}

const progressMessage = computed(() => {
  if (exportProgress.value.phase === 'overlay') {
    return t('video_editor.rendering_overlays');
  } else if (exportProgress.value.phase === 'compositing') {
    return t('video_editor.compositing');
  } else {
    return t('video_editor.export_complete');
  }
});
</script>

<template>
  <div class="export-dialog-overlay" @click.self="!isExporting && emit('close')">
    <div class="export-dialog">
      <!-- Header -->
      <div class="dialog-header">
        <div class="header-title">
          <Download :size="20" />
          <span>{{ t('video_editor.export_video') }}</span>
        </div>
        <button class="close-btn" @click="emit('close')" :disabled="isExporting">
          <X :size="18" />
        </button>
      </div>

      <!-- Content -->
      <div class="dialog-content">
        <!-- Output Format Selection -->
        <div class="setting-group">
          <label class="setting-label">{{ t('video_editor.output_format') }}</label>
          <select v-model="outputFormat" class="setting-select" :disabled="isExporting" @change="onFormatChange">
            <option value="mp4">MP4</option>
            <option value="webm">WebM</option>
            <option value="gif">GIF</option>
          </select>
          <p class="setting-hint">{{ isGif ? t('video_editor.format_hint_gif') : t('video_editor.format_hint_new') }}</p>
        </div>

        <!-- Video Codec Selection (hidden for GIF) -->
        <div class="setting-group" v-if="!isGif">
          <label class="setting-label">{{ t('video_editor.video_codec') }}</label>
          <select v-model="videoCodec" class="setting-select" :disabled="isExporting">
            <option v-for="c in availableCodecs" :key="c.id" :value="c.id">
              {{ c.name }}
            </option>
          </select>
          <p class="setting-hint">{{ t('video_editor.codec_hint_new') }}</p>
        </div>

        <!-- Quality Preset Selection (hidden for GIF) -->
        <div class="setting-group" v-if="!isGif">
          <label class="setting-label">{{ t('video_editor.quality_preset') }}</label>
          <select v-model="quality" class="setting-select" :disabled="isExporting">
            <option v-for="preset in qualityPresets" :key="preset.value" :value="preset.value">
              {{ preset.label }} {{ preset.bitrate }}
            </option>
          </select>
          <p class="setting-hint">{{ t('video_editor.quality_preset_hint') }}</p>
        </div>

        <!-- GIF Settings -->
        <div v-if="isGif" class="setting-group">
          <label class="setting-label">{{ t('video_editor.gif_fps') }}</label>
          <select v-model="gifFps" class="setting-select" :disabled="isExporting">
            <option :value="10">10 FPS</option>
            <option :value="15">15 FPS</option>
            <option :value="20">20 FPS</option>
            <option :value="24">24 FPS</option>
          </select>
        </div>
        <div v-if="isGif" class="setting-group">
          <label class="setting-label">{{ t('video_editor.gif_width') }}</label>
          <select v-model="gifWidth" class="setting-select" :disabled="isExporting">
            <option :value="320">320px</option>
            <option :value="480">480px</option>
            <option :value="640">640px</option>
            <option :value="800">800px</option>
            <option :value="960">960px</option>
          </select>
          <p class="setting-hint">{{ t('video_editor.gif_width_hint') }}</p>
        </div>

        <!-- Progress -->
        <div v-if="isExporting" class="export-progress">
          <div class="progress-header">
            <span class="progress-phase">{{ progressMessage }}</span>
            <span class="progress-percent">{{ Math.round(exportProgress.progress) }}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: `${exportProgress.progress}%` }"></div>
          </div>
          <p class="progress-hint">{{ t('video_editor.export_hint') }}</p>
        </div>
      </div>

      <!-- Footer -->
      <div class="dialog-footer">
        <button 
          class="btn btn-secondary" 
          @click="emit('close')"
          :disabled="isExporting"
        >
          {{ t('common.cancel') }}
        </button>
        <button 
          class="btn btn-primary" 
          @click="handleExport"
          :disabled="isExporting"
        >
          <Download :size="16" />
          <span>{{ isExporting ? t('video_editor.exporting') : t('video_editor.export') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.export-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.export-dialog {
  background: #000000;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  width: 90%;
  max-width: 500px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
  animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.header-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  font-family: 'Geist Mono', monospace;
}

.close-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.close-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.dialog-content {
  padding: 24px;
  max-height: 60vh;
  overflow-y: auto;
}

.setting-group {
  margin-bottom: 20px;
}

.setting-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 8px;
  font-family: 'Geist Mono', monospace;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.setting-select {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #ffffff;
  padding: 12px 14px;
  font-size: 14px;
  font-family: 'Geist Mono', monospace;
  cursor: pointer;
  transition: all 0.15s ease;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='white' stroke-opacity='0.5' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  padding-right: 40px;
}

.setting-select:hover:not(:disabled) {
  background-color: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
}

.setting-select:focus {
  outline: none;
  border-color: rgba(102, 126, 234, 0.6);
  background-color: rgba(255, 255, 255, 0.08);
}

.setting-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.setting-select option {
  background: #1a1a1a;
  color: #ffffff;
  padding: 10px;
  font-family: 'Geist Mono', monospace;
}

.setting-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  margin-top: 6px;
  line-height: 1.4;
  font-family: 'Geist Mono', monospace;
}

.export-progress {
  margin-top: 24px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.progress-phase {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  font-weight: 500;
  font-family: 'Geist Mono', monospace;
}

.progress-percent {
  font-size: 12px;
  font-family: 'Geist Mono', monospace;
  color: rgba(255, 255, 255, 0.5);
}

.progress-bar {
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea, #764ba2);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 8px;
  text-align: center;
  font-family: 'Geist Mono', monospace;
}

.dialog-footer {
  display: flex;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.btn {
  flex: 1;
  padding: 12px 20px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  outline: none;
  font-family: 'Geist Mono', monospace;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.btn-secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.2);
}

.btn-primary {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.15);
  font-weight: 500;
}

.btn-primary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.25);
}

.btn-primary:active:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
}

.audio-tracks {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
}

.audio-track-item {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  transition: background 0.15s ease;
}

.audio-track-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.audio-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: rgba(102, 126, 234, 0.8);
}

.audio-checkbox:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.audio-track-label {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  font-family: 'Geist Mono', monospace;
  user-select: none;
}

.setting-warning {
  font-size: 11px;
  color: rgba(255, 200, 50, 0.9);
  margin-top: 6px;
  line-height: 1.4;
  font-family: 'Geist Mono', monospace;
  padding: 6px 8px;
  background: rgba(255, 200, 50, 0.1);
  border-radius: 4px;
  border-left: 2px solid rgba(255, 200, 50, 0.5);
}
</style>
