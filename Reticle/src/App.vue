<script setup lang="ts">
import EditorCanvas from './components/Editor/EditorCanvas.vue';
import VideoEditorCanvas from './components/Editor/VideoEditorCanvas.vue';
import VideoTimeline from './components/Editor/VideoTimeline.vue';
import EditorNavbar from './components/Editor/EditorNavbar.vue';
import SettingsPanel from './components/Settings/SettingsPanel.vue';
import WindowSelector from './components/Overlay/WindowSelector.vue';
import MonitorSelector from './components/Overlay/MonitorSelector.vue';
import CountdownOverlay from './components/Overlay/CountdownOverlay.vue';
import ScreenshotHistory from './components/History/ScreenshotHistory.vue';
import ToastContainer from './components/UI/ToastContainer.vue';
import WelcomeScreen from './components/WelcomeScreen.vue';
import RecordOverlay from './windows/RecordOverlay.vue';
import RegionOverlay from './windows/RegionOverlay.vue';
import CaptureBar from './windows/CaptureBar.vue';

import { useCapture } from './composables/useCapture';
import { useShortcuts } from './composables/useShortcuts';
import { UPDATE_CHECK_DELAY_MS } from './utils/constants';

import { ref, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { info, error } from '@tauri-apps/plugin-log';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-shell';
import { useNotificationStore } from './stores/notification';
import { useVideoEditorStore } from './stores/videoEditor';
import { useSettingsStore } from './stores/settings';

const notificationStore = useNotificationStore();
const videoEditorStore = useVideoEditorStore();
const settingsStore = useSettingsStore();
const windowLabel = ref('');
const currentView = ref<'editor' | 'settings'>('editor');

const capture = useCapture();
const shortcuts = useShortcuts(capture);

function preventContextMenu(e: Event) {
  e.preventDefault();
}

function preventReload(e: KeyboardEvent) {
  if (e.key === 'F5' || (e.ctrlKey && e.key === 'r') || (e.metaKey && e.key === 'r')) {
    e.preventDefault();
  }
}

async function checkUpdates() {
  try {
    const currentVer = await getVersion();
    const response = await fetch('https://raw.githubusercontent.com/saint4626/reticle-releases/main/version.json', { cache: "no-store" });
    
    if (!response.ok) return;

    const data = await response.json();
    
    if (data.version !== currentVer) {
      notificationStore.add(
        `Version ${data.version} is available. ${data.notes}`,
        'update',
        15000,
        {
          title: 'Update Available',
          actions: [
            {
              label: 'Download',
              onClick: () => {
                if (data.download_url) open(data.download_url);
              },
              primary: true
            }
          ]
        }
      );
    }
  } catch (e) {
    console.error('Update check error:', e);
  }
}

onMounted(async () => {
  const currentWindow = getCurrentWindow();
  windowLabel.value = currentWindow.label;

  // Overlay windows are self-contained — early return
  if (windowLabel.value === 'record_overlay' || windowLabel.value === 'region_overlay' || windowLabel.value === 'capture_toolbar') {
    // Basic settings load without global plugin hooks
    settingsStore.loadSettings();
    return;
  }

  // Main window initialization
  try {
    const hwid = await invoke<string>('get_hwid');
    await info(`App Started. HWID: ${hwid}`);
    await info(`App Started. HWID loaded`);
  } catch (e) {
    await error(`Failed to generate HWID: ${e}`);
  }

  document.addEventListener('contextmenu', preventContextMenu);
  document.addEventListener('keydown', preventReload);

  setTimeout(checkUpdates, UPDATE_CHECK_DELAY_MS);

  await capture.fetchMonitors();
  if (capture.monitors.value.length > 1) {
    capture.refreshMonitorPreviews();
  }

  await shortcuts.setup();
  await settingsStore.init();
  await videoEditorStore.init();
});

onUnmounted(() => {
  document.removeEventListener('contextmenu', preventContextMenu);
  document.removeEventListener('keydown', preventReload);
  capture.cleanup();
  videoEditorStore.destroy();
});
</script>

<template>
  <!-- Record Overlay Window -->
  <RecordOverlay v-if="windowLabel === 'record_overlay'" />

  <!-- Region Overlay Window -->
  <RegionOverlay v-else-if="windowLabel === 'region_overlay'" />

  <!-- Capture Toolbar Window -->
  <CaptureBar v-else-if="windowLabel === 'capture_toolbar'" />

  <!-- Main Application Window -->
  <template v-else>
  <div class="h-screen w-screen overflow-hidden relative bg-black text-white select-none">
    <!-- Main Content Transition -->
    <Transition name="fade" mode="out-in">
      <div v-if="currentView === 'editor'" class="absolute inset-0 flex flex-col">
        <div class="z-50 shadow-sm">
          <EditorNavbar 
            @capture-region="capture.startRegionCapture"
            @capture-window="capture.isWindowMode.value = true"
            @open-settings="currentView = 'settings'" 
          />
        </div>
        <div class="flex-1 w-full overflow-hidden relative bg-black flex flex-col">
          <div class="flex-1 overflow-hidden relative">
            <template v-if="videoEditorStore.session">
              <VideoEditorCanvas />
            </template>
            <template v-else>
              <ScreenshotHistory />
              <EditorCanvas />
            </template>
          </div>
          <VideoTimeline v-if="videoEditorStore.session" />
        </div>
      </div>
      <div v-else-if="currentView === 'settings'" class="absolute inset-0 z-20">
        <SettingsPanel @back="currentView = 'editor'" />
      </div>
    </Transition>
  </div>

  <!-- Overlays -->
  <Transition name="fade">
    <WindowSelector 
      v-if="capture.isWindowMode.value"
      @confirm="capture.onWindowCapture"
      @cancel="capture.isWindowMode.value = false"
    />
  </Transition>

  <Transition name="fade">
    <MonitorSelector 
      v-if="capture.isMonitorSelectorMode.value"
      :monitors="capture.monitors.value"
      :previews="capture.monitorPreviews.value"
      @select="capture.onMonitorSelect"
      @cancel="capture.isMonitorSelectorMode.value = false"
    />
  </Transition>

  <CountdownOverlay />
  <ToastContainer />
  <WelcomeScreen />
  </template>
</template>

<style>
/* Transition Styles */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
