import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useStorage } from '@vueuse/core';
import { videoRecorder, type VideoStatus, type VideoError, type AudioDevice, type WebcamDevice, type CodecInfo } from '../services/video/recorder';
import { useNotificationStore } from '../stores/notification';
import i18n from '../i18n';
import { useRecordingTimer } from '../composables/useRecordingTimer';
import { AUDIO_PREVIEW_RESTART_DELAY_MS } from '../utils/constants';

export const useVideoStore = defineStore('video', () => {
  const isVideoMode = ref(false);
  const isRecording = ref(false);
  const isPaused = ref(false);
  const lastError = ref<string | null>(null);

  // Countdown & timer logic delegated to composable
  const {
    isCountingDown,
    countdownValue,
    recordingDuration,
    runCountdown,
    cancelCountdown,
    finishCountdown,
    startTimer,
    stopTimer
  } = useRecordingTimer();

  // Settings
  const selectedFps = useStorage<30 | 60 | 120>('reticle-video-fps', 30);

  // Audio Settings
  const audioDevices = ref<AudioDevice[]>([]);
  const selectedMic = useStorage<string | undefined>('reticle-video-mic', undefined);
  const enableMic = useStorage('reticle-video-enable-mic', true);
  const enableSys = useStorage('reticle-video-enable-sys', true);
  const captureCursor = useStorage('reticle-video-cursor', true);
  const micLevel = ref(0.0);

  // Webcam Settings
  const webcamDevices = ref<WebcamDevice[]>([]);
  const selectedWebcam = useStorage<string | undefined>('reticle-video-webcam', undefined);
  const enableWebcam = useStorage('reticle-video-enable-webcam', false);

  // Encoding Settings
  const selectedCodec = useStorage('reticle-video-codec', 'libx264');
  const availableCodecs = ref<CodecInfo[]>([
    { name: 'CPU (libx264)', id: 'libx264' }
  ]);

  // Track recording area for overlay visualization
  const recordingArea = ref<{ x: number, y: number, w: number, h: number } | null>(null);

  // Initialize listeners
  videoRecorder.onStatusChange((status: VideoStatus) => {
    if (status.status === 'recording') {
      isRecording.value = true;
      // Backend sends 0 on start. We track locally for UI feedback.
    } else if (status.status === 'stopped') {
      isRecording.value = false;
      isPaused.value = false;
      recordingArea.value = null;
      stopTimer();
    }
  });

  videoRecorder.onError((err: VideoError) => {
    lastError.value = err.error;
    isRecording.value = false;
    isPaused.value = false;
    isCountingDown.value = false;
    recordingArea.value = null;
    stopTimer();
    const notify = useNotificationStore();
    const t = i18n.global.t;
    notify.add(t('editor.video_errors.recording_error') + err.error, 'error');
  });

  // Listen for VU Meter
  videoRecorder.onMicLevel((level: number) => {
    // Smooth decay or instant attack?
    // Let's just set it raw for now, Vue handles updates
    micLevel.value = level;
  });

  function toggleMode() {
    isVideoMode.value = !isVideoMode.value;
    if (isVideoMode.value) {
      // Start preview when entering video mode
      // Wait a bit to ensure UI is ready or just fire it
      // Also check if we have a selected mic
      if (enableMic.value) {
        videoRecorder.startAudioPreview(selectedMic.value).catch(console.error);
      }
    } else {
      // Stop preview when leaving video mode
      videoRecorder.stopAudioPreview().catch(console.error);
    }
  }

  async function loadAudioDevices() {
    try {
      const devices = await videoRecorder.getAudioDevices();
      audioDevices.value = devices;
      // If saved mic no longer exists, fall back to default
      const savedMicExists = selectedMic.value && devices.some(d => d.name === selectedMic.value);
      if (!savedMicExists) {
        const defaultDevice = devices.find(d => d.is_default);
        if (defaultDevice) {
          selectedMic.value = defaultDevice.name;
        } else if (devices.length > 0) {
          selectedMic.value = devices[0].name;
        }
      }

      // If we are in video mode and not recording, start preview with the default device
      if (isVideoMode.value && !isRecording.value && enableMic.value) {
        videoRecorder.startAudioPreview(selectedMic.value).catch(console.error);
      }
    } catch (e) {
      console.error('Failed to load audio devices:', e);
    }
  }

  async function loadWebcams() {
    try {
      const devices = await videoRecorder.getWebcams();
      webcamDevices.value = devices;
      const savedWebcamExists = selectedWebcam.value && devices.some(d => d.name === selectedWebcam.value);
      if (!savedWebcamExists && devices.length > 0) {
        selectedWebcam.value = devices[0].name;
      }
    } catch (e) {
      console.error('Failed to load webcams:', e);
    }
  }

  async function loadCodecs() {
    try {
      const codecs = await videoRecorder.getAvailableCodecs();
      availableCodecs.value = codecs;

      // Only auto-select if saved codec is no longer available
      const savedCodecExists = codecs.some(c => c.id === selectedCodec.value);
      if (!savedCodecExists) {
        // Auto-select GPU if available, else CPU
        selectedCodec.value = codecs.length > 1 ? codecs[1].id : codecs[0].id;
      }
    } catch (e) {
      console.error('Failed to load codecs:', e);
    }
  }

  // Watch for mic changes to restart preview
  // We need to import watch from vue
  // But we are inside defineStore callback...

  async function startRecording(target: 'screen' | 'window' | 'area', id?: string) {
    try {
      // Stop preview before starting actual recording (to free up device lock if needed, though WASAPI is shared)
      // Ideally we should switch seamlessly, but stop/start is safer.
      await videoRecorder.stopAudioPreview();

      lastError.value = null;
      recordingArea.value = null;

      // Parse Area if needed
      if (target === 'area' && id) {
        // Format: "monitorIdx:x,y,w,h"
        const parts = id.split(':');
        if (parts.length === 2) {
          const rectParts = parts[1].split(',');
          if (rectParts.length === 4) {
            const dpr = window.devicePixelRatio || 1;
            // We store logical pixels for CSS positioning
            // The id contains physical pixels (already scaled by DPR in App.vue)
            // So we divide by DPR to get logical pixels back for UI
            recordingArea.value = {
              x: parseInt(rectParts[0]) / dpr,
              y: parseInt(rectParts[1]) / dpr,
              w: parseInt(rectParts[2]) / dpr,
              h: parseInt(rectParts[3]) / dpr
            };
          }
        }
      }

      // Start Countdown Flow — warmup backend while counting down
      // Get video output dir from settings if autosave is enabled
      const { useSettingsStore } = await import('./settings');
      const settingsStore = useSettingsStore();
      const videoOutputDir = settingsStore.autoSaveEnabled && settingsStore.autoSaveVideoFolder
        ? settingsStore.autoSaveVideoFolder
        : undefined;

      await videoRecorder.start(
        target,
        id,
        selectedFps.value,
        true,
        selectedMic.value,
        enableMic.value,
        enableSys.value,
        captureCursor.value,
        selectedWebcam.value,
        enableWebcam.value,
        selectedCodec.value,
        videoOutputDir
      );

      await runCountdown();

      // Check if we are still in countdown mode (user didn't cancel/error didn't happen)
      if (isCountingDown.value) {
        // Confirm recording start (unpause engine)
        await videoRecorder.confirm();

        finishCountdown();
        // isRecording will be set via event listener, but set locally to be responsive
        isRecording.value = true;
        recordingDuration.value = 0;
        startTimer();
      }

    } catch (error) {
      console.error('Failed to start recording:', error);
      lastError.value = String(error);
      cancelCountdown();
      const notify = useNotificationStore();
      const t = i18n.global.t;
      notify.add(t('editor.video_errors.start_failed') + error, 'error');
    }
  }

  async function stopRecording() {
    try {
      if (isCountingDown.value) {
        // Cancel countdown
        cancelCountdown();
        // We also need to stop the backend if it was warming up
        await videoRecorder.stop();
      } else {
        await videoRecorder.stop();
      }

      // Restart preview if we are still in video mode
      if (isVideoMode.value && enableMic.value) {
        // Add a small delay to ensure backend has fully released resources
        setTimeout(() => {
          videoRecorder.startAudioPreview(selectedMic.value).catch(console.error);
        }, AUDIO_PREVIEW_RESTART_DELAY_MS);
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
      const notify = useNotificationStore();
      const t = i18n.global.t;
      notify.add(t('editor.video_errors.stop_failed') + error, 'error');
    }
  }

  async function togglePause() {
    try {
      if (isPaused.value) {
        await videoRecorder.resume();
        isPaused.value = false;
        // Resume timer
        startTimer(recordingDuration.value);
      } else {
        await videoRecorder.pause();
        isPaused.value = true;
        // Pause timer
        stopTimer();
      }
    } catch (e) {
      console.error('Failed to toggle pause:', e);
      const notify = useNotificationStore();
      const t = i18n.global.t;
      notify.add(t('editor.video_errors.pause_failed') + e, 'error');
    }
  }

  // Watch for audio toggle changes during recording
  async function toggleMic(enabled: boolean) {
    enableMic.value = enabled;
    if (isRecording.value) {
      await videoRecorder.setMicMuted(!enabled);
    } else if (isVideoMode.value) {
      // Toggle preview
      if (enabled) {
        videoRecorder.startAudioPreview(selectedMic.value).catch(console.error);
      } else {
        videoRecorder.stopAudioPreview().catch(console.error);
      }
    }
  }

  async function setMicDevice(deviceName: string) {
    selectedMic.value = deviceName;
    // If previewing, restart with new device
    if (isVideoMode.value && !isRecording.value && enableMic.value) {
      await videoRecorder.stopAudioPreview();
      await videoRecorder.startAudioPreview(deviceName);
    }
  }

  async function toggleSys(enabled: boolean) {
    enableSys.value = enabled;
    if (isRecording.value) {
      await videoRecorder.setSysMuted(!enabled);
    }
  }



  return {
    isVideoMode,
    isRecording,
    isCountingDown,
    countdownValue,
    recordingDuration,
    lastError,
    recordingArea,
    selectedFps,
    toggleMode,
    startRecording,
    stopRecording,
    confirmRecording: videoRecorder.confirm,
    audioDevices,
    selectedMic,
    enableMic,
    enableSys,
    loadAudioDevices,
    stopTimer,
    togglePause,
    isPaused,
    toggleMic,
    toggleSys,
    setMicDevice,
    captureCursor,
    micLevel,
    loadWebcams,
    loadCodecs,
    webcamDevices,
    selectedWebcam,
    enableWebcam,
    selectedCodec,
    availableCodecs
  };
});
