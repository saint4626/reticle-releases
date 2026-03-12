<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import WaveSurfer from 'wavesurfer.js';
import { readFile } from '@tauri-apps/plugin-fs';
import { useVideoEditorStore } from '../../stores/videoEditor';
import { storeToRefs } from 'pinia';

const props = defineProps<{
  src: string;
  height?: number;
  waveColor?: string;
  progressColor?: string;
  label?: string;
  playable?: boolean;
  offset?: number; // seconds into audio file
  muted?: boolean;
  volume?: number; // 0-2, for live preview
}>();

const emit = defineEmits<{
  audioDuration: [duration: number];
}>();

const containerRef = ref<HTMLElement | null>(null);
const wavesurfer = ref<WaveSurfer | null>(null);
const isReady = ref(false);
const audioDuration = ref(0); // actual music file duration in seconds
let blobUrl: string | null = null;

const videoEditor = useVideoEditorStore();
const { currentTime, duration, isPlaying, musicVolume, musicMuted } = storeToRefs(videoEditor);

// ---- Stretch + translate for offset visualization ----
// When playable (music track): stretch waveform to full audio length,
// then translateX so the visible window starts at `offset` seconds.
const waveStyle = computed(() => {
  if (!props.playable || audioDuration.value <= 0 || duration.value <= 0) {
    return {};
  }
  const videoDur = duration.value;
  const musicDur = audioDuration.value;
  // Scale: how many times wider than the container
  const scale = musicDur / videoDur;
  const offsetFraction = (props.offset ?? 0) / musicDur;
  // translateX in % of the stretched width to show the right window
  const translatePct = -(offsetFraction * 100);
  return {
    width: `${scale * 100}%`,
    transform: `translateX(${translatePct}%)`,
  };
});

async function loadAudio() {
  if (!props.src) return;
  isReady.value = false;
  audioDuration.value = 0;

  try {
    const data = await readFile(props.src);
    const ext = props.src.split('.').pop()?.toLowerCase() ?? 'wav';
    const mimeMap: Record<string, string> = { mp3: 'audio/mpeg', aac: 'audio/aac', ogg: 'audio/ogg', wav: 'audio/wav' };
    const mime = mimeMap[ext] ?? 'audio/wav';

    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(new Blob([data], { type: mime }));

    if (wavesurfer.value) {
      wavesurfer.value.load(blobUrl);
    }
  } catch (e) {
    console.error('Failed to load audio for waveform:', e);
  }
}

onMounted(() => {
  if (!containerRef.value) return;

  try {
    wavesurfer.value = WaveSurfer.create({
      container: containerRef.value,
      waveColor: props.waveColor || 'rgba(255, 255, 255, 0.6)',
      progressColor: props.progressColor || '#667eea',
      url: '',
      height: props.height || 48,
      barWidth: 3,
      barGap: 3,
      barRadius: 3,
      cursorWidth: 0,
      interact: false,
      normalize: true,
      minPxPerSec: 1,
      fillParent: true,
    });

    wavesurfer.value.on('ready', () => {
      isReady.value = true;
      audioDuration.value = wavesurfer.value?.getDuration() ?? 0;
      emit('audioDuration', audioDuration.value);
      // Apply initial volume
      const hasPropVolume = props.volume !== undefined;
      const vol = props.muted
        ? 0
        : hasPropVolume
          ? props.volume!
          : (props.playable ? (musicMuted.value ? 0 : musicVolume.value) : 1);
      wavesurfer.value?.setVolume(Math.min(vol, 1));
      seekToCurrentTime();
      if (props.playable && isPlaying.value) {
        wavesurfer.value?.play();
      }
    });

    wavesurfer.value.on('error', (e) => {
      if (!e.message?.includes('PTS is not defined')) {
        console.error('WaveSurfer error:', e);
      }
    });

    loadAudio();
  } catch (err) {
    console.error('Error initializing wavesurfer:', err);
  }

  resizeObserver.observe(containerRef.value!);
});

watch(() => props.src, () => loadAudio());

onUnmounted(() => {
  resizeObserver.disconnect();
  wavesurfer.value?.destroy();
  wavesurfer.value = null;
  if (blobUrl) URL.revokeObjectURL(blobUrl);
});

// ---- Playback sync ----
function seekToCurrentTime() {
  if (!wavesurfer.value || !isReady.value || audioDuration.value <= 0) return;
  const targetTime = currentTime.value + (props.offset ?? 0);
  const progress = Math.max(0, Math.min(1, targetTime / audioDuration.value));
  wavesurfer.value.seekTo(progress);
}

watch(currentTime, () => {
  if (props.playable) {
    if (!isPlaying.value) {
      seekToCurrentTime();
    } else {
      // Detect manual seek: if WaveSurfer drifts more than 0.5s from expected, resync
      if (wavesurfer.value && isReady.value && audioDuration.value > 0) {
        const expected = currentTime.value + (props.offset ?? 0);
        const actual = wavesurfer.value.getCurrentTime();
        if (Math.abs(expected - actual) > 0.5) {
          seekToCurrentTime();
        }
      }
    }
  } else {
    if (duration.value <= 0 || !wavesurfer.value || !isReady.value) return;
    wavesurfer.value.seekTo(Math.max(0, Math.min(1, currentTime.value / duration.value)));
  }
});

watch(isPlaying, (playing) => {
  if (!props.playable || !isReady.value || !wavesurfer.value) return;
  if (playing) {
    const targetTime = currentTime.value + (props.offset ?? 0);
    if (targetTime >= audioDuration.value) return;
    seekToCurrentTime();
    // Small delay to let seekTo settle before playing
    requestAnimationFrame(() => {
      if (isPlaying.value && wavesurfer.value && isReady.value) {
        wavesurfer.value.play();
      }
    });
  } else {
    wavesurfer.value.pause();
    seekToCurrentTime();
  }
});

// offset change — re-seek only when paused (waveStyle computed handles visual shift)
watch(() => props.offset, () => {
  if (props.playable && !isPlaying.value) seekToCurrentTime();
});

// Volume & mute — apply to WaveSurfer for live preview
// Props take priority; for music track (playable without explicit volume prop) fall back to store
watch([musicVolume, musicMuted, () => props.volume, () => props.muted, isReady], () => {
  if (!wavesurfer.value || !isReady.value) return;
  const hasPropVolume = props.volume !== undefined;
  const vol = props.muted
    ? 0
    : hasPropVolume
      ? props.volume!
      : (props.playable ? (musicMuted.value ? 0 : musicVolume.value) : 1);
  wavesurfer.value.setVolume(Math.min(vol, 1));
});

const resizeObserver = new ResizeObserver(() => {
  requestAnimationFrame(() => {});
});
</script>

<template>
  <div class="audio-waveform-track" :class="{ 'is-muted': muted }" :style="{ height: (height || 48) + 'px' }">
    <!-- Wrapper that clips the stretched waveform -->
    <div class="waveform-clip">
      <div class="waveform-stretch" :style="waveStyle">
        <div ref="containerRef" class="waveform-container" />
      </div>
    </div>

    <div v-if="label" class="track-label">
      <span class="label-icon">♪</span> {{ label }}
      <span v-if="offset && offset > 0" class="offset-badge">+{{ offset.toFixed(1) }}s</span>
    </div>

    <slot />
  </div>
</template>

<style scoped>
.audio-waveform-track {
  width: 100%;
  position: relative;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-sizing: border-box;
}

.audio-waveform-track.is-muted .waveform-clip {
  filter: grayscale(1);
  opacity: 0.35;
  transition: filter 0.2s ease, opacity 0.2s ease;
}

.waveform-clip {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}

.waveform-stretch {
  height: 100%;
  /* width and transform set dynamically via waveStyle */
}

.waveform-container {
  width: 100%;
  height: 100%;
}

.track-label {
  position: absolute;
  top: 4px;
  left: 6px;
  font-family: 'Roboto', sans-serif;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.75);
  pointer-events: none;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(0, 0, 0, 0.5);
  padding: 2px 4px;
  border-radius: 3px;
}

.label-icon {
  font-size: 9px;
  opacity: 0.7;
}

.offset-badge {
  color: rgba(167, 139, 250, 0.9);
  font-size: 9px;
  margin-left: 2px;
}
</style>
