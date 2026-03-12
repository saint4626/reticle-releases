<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { Camera, Crop, AppWindow, X } from 'lucide-vue-next';
import { getCurrentWindow, LogicalPosition, LogicalSize, primaryMonitor } from '@tauri-apps/api/window';
import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from 'vue-i18n';
import logoUrl from '../assets/logo.svg';
import type { MonitorInfo } from '../types';

interface WindowInfo {
  id: string;
  title: string;
  app_name: string;
}

const monitors = ref<MonitorInfo[]>([]);
const openWindows = ref<WindowInfo[]>([]);
const isWindowDropdownOpen = ref(false);
const { t } = useI18n();

const DEFAULT_WIDTH = 800; // Even wider safe zone to prevent invisible OS window clipping
const DEFAULT_HEIGHT = 80; // enough to fit bar + shadow
const EXPANDED_HEIGHT = 600; // enough to fit dropdown without max-height clipping

async function checkMonitors() {
  try {
    monitors.value = await invoke<MonitorInfo[]>('get_monitors');
  } catch (e) {
    console.error('Failed to get monitors:', e);
  }
}

async function fetchOpenWindows() {
  try {
    openWindows.value = await invoke<WindowInfo[]>('get_open_windows');
  } catch (e) {
    console.error('Failed to get open windows:', e);
  }
}

async function triggerAction(action: 'fullscreen' | 'region' | 'window', target?: any) {
  if (action === 'fullscreen') {
    await emit('capture-bar-fullscreen', { monitorId: typeof target === 'number' ? target : undefined });
  } else if (action === 'region') {
    await emit('capture-bar-region', { monitor: target });
  } else if (action === 'window') {
    if (target) {
      await emit('capture-bar-window', { window: target });
    } else {
      await emit('capture-bar-window-mode');
    }
  }
  
  close(); // close bar
}

async function toggleDropdown() {
  isWindowDropdownOpen.value = !isWindowDropdownOpen.value;
  const win = getCurrentWindow();
  if (isWindowDropdownOpen.value) {
    await win.setSize(new LogicalSize(DEFAULT_WIDTH, EXPANDED_HEIGHT));
  } else {
    await win.setSize(new LogicalSize(DEFAULT_WIDTH, DEFAULT_HEIGHT));
  }
}

async function close() {
  isWindowDropdownOpen.value = false;
  const win = getCurrentWindow();
  await win.setSize(new LogicalSize(DEFAULT_WIDTH, DEFAULT_HEIGHT));
  await win.hide();
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (isWindowDropdownOpen.value) {
      toggleDropdown();
    } else {
      close();
    }
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeyDown);
  
  // Make window transparent completely and prevent scrolling
  document.body.style.backgroundColor = 'transparent';
  document.body.style.overflow = 'hidden'; // Hide scrollbars
  document.documentElement.style.backgroundColor = 'transparent';
  document.documentElement.style.overflow = 'hidden'; 
  const appEl = document.getElementById('app');
  if (appEl) {
    appEl.style.backgroundColor = 'transparent';
    appEl.style.overflow = 'hidden';
  }

  // Listen to explicit show request
  await listen('request-show-capture-bar', async () => {
    isWindowDropdownOpen.value = false;
    await checkMonitors();
    await fetchOpenWindows();
    
    const win = getCurrentWindow();
    const primary = await primaryMonitor();
    
    if (primary) {
      const scale = primary.scaleFactor || 1;
      await win.setSize(new LogicalSize(DEFAULT_WIDTH, DEFAULT_HEIGHT));
      const logicalWidth = DEFAULT_WIDTH;
      // Calculate taking monitor position into account
      const logicalX = (primary.position.x / scale) + (primary.size.width / scale - logicalWidth) / 2;
      const logicalY = (primary.position.y / scale) + 12;
      await win.setPosition(new LogicalPosition(logicalX, logicalY));
    }
    
    await win.show();
    await win.setFocus();
  });
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
});
</script>

<template>
  <div class="capture-bar">
    <div class="capture-bar-inner slide-down" data-tauri-drag-region>
      <div class="logo-container mx-1" data-tauri-drag-region>
        <div class="logo-glow"></div>
        <img :src="logoUrl" class="logo w-5 h-5 pointer-events-none" alt="Reticle" />
      </div>
      
      <div class="divider-v pointer-events-none"></div>

      <!-- Fullscreen -->
      <div v-if="monitors.length > 1" class="action-group" :title="t('capture_bar.fullscreen')">
         <Camera class="w-4 h-4 text-white/50 bg-black/50 p-[2px] rounded ml-1" />
         <div v-for="(m, i) in monitors" :key="`fs-${m.id}`" class="tooltip tooltip-bottom" :data-tip="m.name || `Monitor ${i + 1}`">
           <button class="monitor-btn" @click="triggerAction('fullscreen', m.id)">{{ i + 1 }}</button>
         </div>
      </div>
      <button v-else class="bar-btn tooltip tooltip-bottom" :data-tip="t('capture_bar.fullscreen')" @click="triggerAction('fullscreen')">
        <Camera class="w-4 h-4" />
      </button>

      <div class="divider-v pointer-events-none"></div>

      <!-- Region -->
      <div v-if="monitors.length > 1" class="action-group" :title="t('capture_bar.region')">
         <Crop class="w-4 h-4 text-white/50 bg-black/50 p-[2px] rounded ml-1" />
         <div v-for="(m, i) in monitors" :key="`reg-${m.id}`" class="tooltip tooltip-bottom" :data-tip="m.name || `Monitor ${i + 1}`">
           <button class="monitor-btn" @click="triggerAction('region', m)">{{ i + 1 }}</button>
         </div>
      </div>
      <button v-else class="bar-btn tooltip tooltip-bottom" :data-tip="t('capture_bar.region')" @click="triggerAction('region')">
        <Crop class="w-4 h-4" />
      </button>

      <div class="divider-v pointer-events-none"></div>

      <!-- Window Capture Dropdown -->
      <div class="relative">
         <div role="button" class="bar-btn tooltip tooltip-bottom" :class="{ 'bg-white/10 text-white': isWindowDropdownOpen }" :data-tip="t('capture_bar.window')" @click.stop="toggleDropdown">
           <AppWindow class="w-4 h-4" />
         </div>
	 <!-- Reverting to absolute positioning to stop UI jump, but fixing the truncation with min-w-0 flex columns -->
         <ul v-if="isWindowDropdownOpen" class="absolute z-[9999] menu p-2 shadow-lg bg-neutral-950 text-white rounded-xl w-[450px] border border-white/15 mt-4 right-0 overflow-y-auto overflow-x-hidden custom-scrollbar focus:outline-none" style="max-height: 400px;">
           <li v-if="openWindows.length === 0"><a class="opacity-50 pointer-events-none">{{ t('capture_bar.no_windows') }}</a></li>
           <li v-for="win in openWindows" :key="win.id" class="min-w-0 max-w-full block">
             <a @click="triggerAction('window', win)" class="flex items-center gap-3 hover:bg-white/10 p-2 rounded-lg w-full min-w-0 max-w-full overflow-hidden block">
               <div class="flex items-center gap-3 w-full min-w-0 overflow-hidden">
                 <AppWindow class="w-5 h-5 opacity-60 flex-shrink-0" />
                 <div class="flex flex-col flex-1 overflow-hidden min-w-0 w-full">
                   <span class="text-xs font-bold text-white truncate block w-full max-w-full">{{ win.title || t('capture_bar.untitled') }}</span>
                   <span class="text-[10px] text-white/50 truncate block w-full max-w-full">{{ win.app_name }}</span>
                 </div>
               </div>
             </a>
           </li>
         </ul>
      </div>

      <div class="divider-v pointer-events-none"></div>

      <!-- Close -->
      <button class="bar-btn bar-btn-close tooltip tooltip-bottom" :data-tip="t('capture_bar.close')" @click="close">
        <X class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.capture-bar {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  background: transparent !important;
  -webkit-app-region: no-drag;
}

.capture-bar-inner {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  background: rgba(25, 25, 25, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  margin-top: 4px; /* Reduced from 10px to avoid bottom clipping with small window */
  color: white;
}

.slide-down {
  animation: slideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-20px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.logo-container {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-glow {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 24px;
  height: 24px;
  background: radial-gradient(circle, rgba(239, 68, 68, 0.4) 0%, transparent 70%);
  border-radius: 50%;
  filter: blur(4px);
}

.action-group {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 2px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.monitor-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.3);
  color: rgba(255, 255, 255, 0.8);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.monitor-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: white;
  border-color: rgba(255, 255, 255, 0.2);
}

.monitor-btn:active {
  transform: scale(0.92);
}

.divider-v {
  width: 1px;
  height: 20px;
  background: rgba(255, 255, 255, 0.1);
  margin: 0 2px;
}

.bar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: all 0.15s ease;
}

.bar-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.bar-btn:active {
  transform: scale(0.92);
}

.bar-btn-close:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}
</style>
