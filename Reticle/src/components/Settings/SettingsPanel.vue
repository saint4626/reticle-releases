<script setup lang="ts">
import { ArrowLeft, Keyboard, Info, Power, Settings as SettingsIcon, Monitor, User, Info as InfoIcon, FileText, Globe, Github, FolderOpen, HardDriveDownload } from 'lucide-vue-next';
import boostyIcon from '../../assets/socialicons/arcticons--boosty.svg';
import xIcon from '../../assets/socialicons/codicon--twitter.svg';
import { ref, onMounted, computed, onUnmounted } from 'vue';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import logoUrl from '../../assets/logo.svg';
import { useI18n } from 'vue-i18n';
import { useSettingsStore, type OcrEngine, type ShortcutsConfig } from '../../stores/settings';
import { useNotificationStore } from '../../stores/notification';
import { open } from '@tauri-apps/plugin-dialog';

const { t, locale } = useI18n();
const settingsStore = useSettingsStore();
const notify = useNotificationStore();

defineEmits<{
  (e: 'back'): void
}>();

const autostartEnabled = ref(false);
const activeTab = ref('general');
const appVersion = ref('1.1.6');

// Hotkey Recording
const recordingKey = ref<keyof ShortcutsConfig | null>(null);
const errorKey = ref<keyof ShortcutsConfig | null>(null);

const availableLocales = [
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
  { code: 'es', name: 'Español' },
  { code: 'it', name: 'Italiano' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt-BR', name: 'Português (BR)' }
];

const availableOcrEngines: { value: OcrEngine, label: string }[] = [
  { value: 'windows_native', label: 'Windows OCR' },
  { value: 'ppocr_v5', label: 'PP-OCRv5 (MNN)' },
];

function changeLocale(code: string) {
  locale.value = code;
  localStorage.setItem('locale', code);
}

async function checkAutostart() {
  try {
    autostartEnabled.value = await isEnabled();
  } catch (e) {
    console.error('Failed to check autostart status:', e);
  }
}

async function toggleAutostart() {
  try {
    if (autostartEnabled.value) {
      await disable();
      autostartEnabled.value = false;
    } else {
      await enable();
      autostartEnabled.value = true;
    }
  } catch (e) {
    console.error('Failed to toggle autostart:', e);
    // Revert state on error
    autostartEnabled.value = !autostartEnabled.value;
  }
}

async function openLogsFolder() {
  try {
    await invoke('open_log_folder');
  } catch (e) {
    console.error('Failed to open logs folder:', e);
  }
}

async function pickScreenshotFolder() {
  const selected = await open({ directory: true, multiple: false, title: 'Select Screenshot Folder' });
  if (selected && typeof selected === 'string') {
    settingsStore.autoSaveScreenshotFolder = selected;
  }
}

async function pickVideoFolder() {
  const selected = await open({ directory: true, multiple: false, title: 'Select Video Folder' });
  if (selected && typeof selected === 'string') {
    settingsStore.autoSaveVideoFolder = selected;
  }
}

onMounted(() => {
  checkAutostart();
});

const shortcutsList = computed(() => [
  { id: 'showApp' as keyof ShortcutsConfig, description: 'settings.hotkeys.actions.show_app' },
  { id: 'fullscreen' as keyof ShortcutsConfig, description: 'settings.hotkeys.actions.fullscreen' },
  { id: 'region' as keyof ShortcutsConfig, description: 'settings.hotkeys.actions.region' },
  { id: 'window' as keyof ShortcutsConfig, description: 'settings.hotkeys.actions.window' },
  { id: 'recordFullscreen' as keyof ShortcutsConfig, description: 'settings.hotkeys.actions.record_fullscreen' },
  { id: 'recordRegion' as keyof ShortcutsConfig, description: 'settings.hotkeys.actions.record_region' },
  { id: 'recordWindow' as keyof ShortcutsConfig, description: 'settings.hotkeys.actions.record_window' },
  { id: 'pauseRecording' as keyof ShortcutsConfig, description: 'settings.hotkeys.actions.pause_recording' },
  { id: 'stopRecording' as keyof ShortcutsConfig, description: 'settings.hotkeys.actions.stop_recording' },
  { id: 'captureToolbar' as keyof ShortcutsConfig, description: 'settings.hotkeys.actions.capture_toolbar' },
]);

function formatShortcut(shortcutStr: string): string[] {
  if (!shortcutStr) return [];
  return shortcutStr.split('+');
}

function startRecording(id: keyof ShortcutsConfig) {
  recordingKey.value = id;
  settingsStore.isRecording = true;
}

function processShortcutKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    recordingKey.value = null;
    settingsStore.isRecording = false;
    return;
  }
  
  const keys = [];
  
  // Tauri global shortcut expects modifiers in specific formats:
  if (e.ctrlKey || e.metaKey) keys.push('CommandOrControl');
  if (e.altKey) keys.push('Alt');
  if (e.shiftKey) keys.push('Shift');
  
  // Ignore raw modifier keys being pressed alone (Wait for the final key)
  const invalidCodes = ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'];
  if (invalidCodes.includes(e.code) || ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return;
  
  // Normalize key name for Tauri's shortcut parser
  let mainKey = e.key;

  // Use physical hardware code (e.code) to bypass keyboard layout issues (e.g. Russian 'Е' instead of 'T')
  if (e.code.startsWith('Key') && e.code.length === 4) {
    mainKey = e.code.replace('Key', '');
  } else if (e.code.startsWith('Digit') && e.code.length === 6) {
    mainKey = e.code.replace('Digit', '');
  }

  // Handle special keys mapping from KeyboardEvent to Tauri GlobalShortcut strings
  if (mainKey.toUpperCase() === 'PRINTSCREEN' || e.code === 'PrintScreen') mainKey = 'PrintScreen';
  else if (mainKey.toUpperCase() === 'SPACE' || mainKey === ' ' || e.code === 'Space') mainKey = 'Space';
  else if (mainKey.toUpperCase() === 'ENTER' || e.code === 'Enter') mainKey = 'Enter';
  else if (mainKey.length === 1) mainKey = mainKey.toUpperCase(); 

  keys.push(mainKey);
  
  if (recordingKey.value) {
    const keyToSave = recordingKey.value;
    const shortcutStr = keys.join('+');
    
    // Test the shortcut asynchronously before saving
    recordingKey.value = null; // Exit recording state immediately
    settingsStore.isRecording = false;
    
    settingsStore.testAndSaveShortcut(keyToSave, shortcutStr).then(success => {
      if (!success) {
        // Show error animation
        errorKey.value = keyToSave;
        
        // Show toast notification
        notify.add(
          t('settings.hotkeys.register_error', { shortcut: shortcutStr }) || `Failed to register ${shortcutStr}. It may be in use by the system.`,
          'error'
        );
        
        // Remove error state after animation finishes (0.5s)
        setTimeout(() => {
          if (errorKey.value === keyToSave) {
            errorKey.value = null;
          }
        }, 500);
      }
    });
  }
}

function onGlobalKeyDown(e: KeyboardEvent) {
  if (!recordingKey.value) return;
  e.preventDefault();
  
  // PrintScreen usually only fires `keyup` on Windows in Webview2
  if (e.key === 'PrintScreen') return;
  
  processShortcutKey(e);
}

function onGlobalKeyUp(e: KeyboardEvent) {
  if (!recordingKey.value) return;
  e.preventDefault();
  
  if (e.key === 'PrintScreen') {
    processShortcutKey(e);
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onGlobalKeyDown);
  window.addEventListener('keyup', onGlobalKeyUp);
  checkAutostart();
  try {
    appVersion.value = await getVersion();
  } catch (e) {
    console.error('Cant fetch version', e);
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeyDown);
  window.removeEventListener('keyup', onGlobalKeyUp);
});
</script>

<template>
  <div class="w-full h-full bg-black text-white flex flex-col font-sans">
    <!-- Header -->
    <div class="navbar bg-black border-b border-white/10 px-4 h-[50px] min-h-[50px] shrink-0" data-tauri-drag-region>
      <div class="flex-none">
        <button class="btn btn-sm btn-ghost btn-square bg-transparent border-none !text-white hover:bg-white/10 hover:!text-white" @click="$emit('back')" @mousedown.stop>
          <ArrowLeft class="w-5 h-5" />
        </button>
      </div>
      <div class="flex-1 px-2 mx-2" data-tauri-drag-region>
        <span class="text-lg font-bold select-none pointer-events-none">{{ t('settings.title') }}</span>
      </div>
    </div>

    <!-- Content with Tabs -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Tabs Header -->
      <div class="px-6 pt-6">
        <div role="tablist" class="tabs tabs-bordered">
          <a 
            role="tab" 
            class="tab h-10 px-6 transition-colors duration-200" 
            :class="activeTab === 'general' ? 'tab-active !border-white !text-white' : 'text-white/50 hover:text-white/70 border-transparent'"
            @click="activeTab = 'general'"
          >
            <SettingsIcon class="w-4 h-4 mr-2" />
            {{ t('settings.tabs.general') }}
          </a>
          <a 
            role="tab" 
            class="tab h-10 px-6 transition-colors duration-200" 
            :class="activeTab === 'hotkeys' ? 'tab-active !border-white !text-white' : 'text-white/50 hover:text-white/70 border-transparent'"
            @click="activeTab = 'hotkeys'"
          >
            <Keyboard class="w-4 h-4 mr-2" />
            {{ t('settings.tabs.hotkeys') }}
          </a>
          <a 
            role="tab" 
            class="tab h-10 px-6 transition-colors duration-200" 
            :class="activeTab === 'about' ? 'tab-active !border-white !text-white' : 'text-white/50 hover:text-white/70 border-transparent'"
            @click="activeTab = 'about'"
          >
            <InfoIcon class="w-4 h-4 mr-2" />
            {{ t('settings.tabs.about') }}
          </a>
        </div>
      </div>

      <!-- Tabs Content -->
      <div class="flex-1 overflow-y-auto p-6">
        <div class="max-w-3xl mx-auto">
          
          <!-- General Tab -->
          <div v-if="activeTab === 'general'" class="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div class="bg-neutral-950 border border-white/10 rounded-xl overflow-hidden">
              <div class="p-4 border-b border-white/10 bg-neutral-950">
                <h3 class="font-bold flex items-center gap-2 text-white">
                  <Power class="w-4 h-4 text-white" />
                  {{ t('settings.general.system') }}
                </h3>
              </div>
              <div class="p-4 space-y-4">
                <div class="form-control">
                  <label class="label cursor-pointer py-2 hover:bg-white/5 rounded-lg px-2 transition-colors -mx-2 justify-between w-full">
                    <div class="flex flex-col gap-1">
                      <span class="label-text text-white font-medium">{{ t('settings.general.autostart') }}</span>
                      <span class="label-text-alt text-white/50">{{ t('settings.general.autostart_desc') }}</span>
                    </div>
                    <input type="checkbox" class="toggle transition-colors duration-200 border-none bg-white/10 [--tglbg:theme(colors.white)] hover:bg-white/20 checked:bg-white checked:hover:bg-white/90 checked:[--tglbg:theme(colors.black)]" :checked="autostartEnabled" @change="toggleAutostart" />
                  </label>
                </div>

                <div class="form-control">
                   <div class="flex items-center justify-between py-2 hover:bg-white/5 rounded-lg px-2 transition-colors -mx-2">
                    <div class="flex flex-col gap-1">
                      <span class="label-text text-white font-medium flex items-center gap-2">
                        <Globe class="w-4 h-4" />
                        {{ t('settings.general.language') }}
                      </span>
                      <span class="label-text-alt text-white/50">{{ t('settings.general.language_desc') }}</span>
                    </div>
                    <div class="p-1">
                      <select 
                        class="select select-bordered select-sm bg-neutral-900 border-white/10 text-white hover:border-white/30 transition-colors focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary w-full max-w-xs"
                        :value="locale"
                        @change="changeLocale(($event.target as HTMLSelectElement).value)"
                      >
                        <option 
                          v-for="lang in availableLocales" 
                          :key="lang.code" 
                          :value="lang.code"
                        >
                          {{ lang.name }}
                        </option>
                      </select>
                    </div>
                  </div>
                </div>

                <div class="form-control">
                  <div class="flex items-center justify-between py-2 hover:bg-white/5 rounded-lg px-2 transition-colors -mx-2">
                    <div class="flex flex-col gap-1">
                      <span class="label-text text-white font-medium flex items-center gap-2">
                        <Monitor class="w-4 h-4" />
                        {{ t('settings.general.ocr_engine') }}
                      </span>
                      <span class="label-text-alt text-white/50">{{ t('settings.general.ocr_engine_desc') }}</span>
                    </div>
                    <div class="p-1">
                      <select
                        class="select select-bordered select-sm bg-neutral-900 border-white/10 text-white hover:border-white/30 transition-colors focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary w-full max-w-xs"
                        :value="settingsStore.ocrEngine"
                        @change="settingsStore.ocrEngine = ($event.target as HTMLSelectElement).value as OcrEngine"
                      >
                        <option
                          v-for="engine in availableOcrEngines"
                          :key="engine.value"
                          :value="engine.value"
                        >
                          {{ engine.label }}
                        </option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Autosave Section -->
            <div class="bg-neutral-950 border border-white/10 rounded-xl overflow-hidden">
              <div class="p-4 border-b border-white/10 bg-neutral-950">
                <h3 class="font-bold flex items-center gap-2 text-white">
                  <HardDriveDownload class="w-4 h-4 text-white" />
                  {{ t('settings.general.autosave') }}
                </h3>
              </div>
              <div class="p-4 space-y-4">
                <div class="form-control">
                  <label class="label cursor-pointer py-2 hover:bg-white/5 rounded-lg px-2 transition-colors -mx-2 justify-between w-full">
                    <div class="flex flex-col gap-1">
                      <span class="label-text text-white font-medium">{{ t('settings.general.autosave_toggle') }}</span>
                      <span class="label-text-alt text-white/50">{{ t('settings.general.autosave_toggle_desc') }}</span>
                    </div>
                    <input type="checkbox" class="toggle transition-colors duration-200 border-none bg-white/10 [--tglbg:theme(colors.white)] hover:bg-white/20 checked:bg-white checked:hover:bg-white/90 checked:[--tglbg:theme(colors.black)]" :checked="settingsStore.autoSaveEnabled" @change="settingsStore.autoSaveEnabled = !settingsStore.autoSaveEnabled" />
                  </label>
                </div>

                <div class="form-control">
                  <div class="flex items-center justify-between py-2 hover:bg-white/5 rounded-lg px-2 transition-colors -mx-2">
                    <div class="flex flex-col gap-1">
                      <span class="label-text text-white font-medium">{{ t('settings.general.screenshot_folder') }}</span>
                      <span class="label-text-alt text-white/50 truncate max-w-[280px]">{{ settingsStore.autoSaveScreenshotFolder || t('settings.general.default_folder', { folder: 'Pictures/Reticle' }) }}</span>
                    </div>
                    <button class="btn btn-sm btn-ghost border border-white/10 text-white hover:bg-white/10 hover:border-white/20" @click="pickScreenshotFolder">
                      <FolderOpen class="w-4 h-4" />
                      {{ t('settings.general.browse') }}
                    </button>
                  </div>
                </div>

                <div class="form-control">
                  <div class="flex items-center justify-between py-2 hover:bg-white/5 rounded-lg px-2 transition-colors -mx-2">
                    <div class="flex flex-col gap-1">
                      <span class="label-text text-white font-medium">{{ t('settings.general.video_folder') }}</span>
                      <span class="label-text-alt text-white/50 truncate max-w-[280px]">{{ settingsStore.autoSaveVideoFolder || t('settings.general.default_folder', { folder: 'Videos/Reticle' }) }}</span>
                    </div>
                    <button class="btn btn-sm btn-ghost border border-white/10 text-white hover:bg-white/10 hover:border-white/20" @click="pickVideoFolder">
                      <FolderOpen class="w-4 h-4" />
                      {{ t('settings.general.browse') }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Debugging Section -->
            <div class="bg-neutral-950 border border-white/10 rounded-xl overflow-hidden">
              <div class="p-4 border-b border-white/10 bg-neutral-950">
                <h3 class="font-bold flex items-center gap-2 text-white">
                  <FileText class="w-4 h-4 text-white" />
                  {{ t('settings.general.debug') }}
                </h3>
              </div>
              <div class="p-4">
                <div class="form-control">
                   <div class="flex items-center justify-between py-2 hover:bg-white/5 rounded-lg px-2 transition-colors -mx-2">
                    <div class="flex flex-col gap-1">
                      <span class="label-text text-white font-medium">{{ t('settings.general.logs') }}</span>
                      <span class="label-text-alt text-white/50">{{ t('settings.general.logs_desc') }}</span>
                    </div>
                    <button class="btn btn-sm btn-ghost border border-white/10 text-white hover:bg-white/10 hover:border-white/20" @click="openLogsFolder">
                      {{ t('settings.general.open_folder') }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Hotkeys Tab -->
          <div v-if="activeTab === 'hotkeys'" class="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div class="bg-neutral-950 border border-white/10 rounded-xl overflow-hidden">
              <div class="p-4 border-b border-white/10 bg-neutral-950">
                <h3 class="font-bold flex items-center gap-2 text-white">
                  <Keyboard class="w-4 h-4 text-white" />
                  {{ t('settings.hotkeys.title') }}
                </h3>
              </div>
              <div class="overflow-x-auto">
                <table class="table text-white w-full">
                  <thead>
                    <tr class="border-white/10 text-white/50 text-xs uppercase">
                      <th class="bg-transparent font-medium">{{ t('settings.hotkeys.action') }}</th>
                      <th class="bg-transparent font-medium text-right">{{ t('settings.hotkeys.keys') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="shortcut in shortcutsList" :key="shortcut.id" class="border-white/5 hover:bg-white/5 group transition-colors">
                      <td class="font-medium align-middle">{{ t(shortcut.description) }}</td>
                      <td class="text-right">
                        <button 
                          @click="startRecording(shortcut.id)"
                          class="btn btn-sm bg-neutral-900 border-white/10 hover:border-white/30 text-white min-w-[120px] transition-all duration-200 inline-flex"
                          :class="{
                            'border-primary text-primary shadow-[0_0_10px_rgba(var(--color-primary),0.3)]': recordingKey === shortcut.id,
                            'border-red-500 text-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)] animate-shake': errorKey === shortcut.id
                          }"
                        >
                          <span v-if="recordingKey === shortcut.id" class="animate-pulse flex gap-1 justify-center w-full">{{ t('settings.hotkeys.recording') }}...</span>
                          <div v-else class="flex gap-1 justify-end w-full">
                            <kbd v-for="key in formatShortcut(settingsStore.shortcuts[shortcut.id as keyof ShortcutsConfig])" :key="key" class="kbd kbd-sm bg-black/50 border-white/20 text-white min-w-[24px]">{{ key.replace('CommandOrControl', 'Ctrl') }}</kbd>
                          </div>
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            
            <div class="alert bg-white/5 border-white/10 text-white/70 text-sm flex items-start gap-3">
              <Info class="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <h3 class="font-bold text-white">{{ t('settings.hotkeys.info_title') }}</h3>
                <div class="text-xs opacity-80 mt-1">{{ t('settings.hotkeys.info_desc') }}</div>
              </div>
            </div>
          </div>

          <!-- About Tab -->
          <div v-if="activeTab === 'about'" class="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div class="bg-neutral-950 border border-white/10 rounded-xl overflow-hidden">
              <div class="p-8 flex flex-col items-center text-center bg-gradient-to-b from-white/5 to-transparent">
                <div class="mb-6 relative">
                  <div class="absolute -inset-4 bg-primary/20 rounded-full blur-xl"></div>
                  <img :src="logoUrl" alt="Reticle Logo" class="w-24 h-24 relative z-10" />
                </div>
                <h2 class="text-2xl font-bold text-white mb-2">Reticle</h2>
                <p class="text-white/50 max-w-sm">
                  {{ t('settings.about.description') }}
                </p>
              </div>
              
              <div class="divider my-0 h-[1px] bg-white/10"></div>
              
              <div class="p-4 space-y-1">
                <div class="flex justify-between items-center p-3 rounded-lg hover:bg-white/5 transition-colors">
                  <span class="text-white/70 flex items-center gap-2">
                    <User class="w-4 h-4" />
                    {{ t('settings.about.author') }}
                  </span>
                  <span class="font-mono text-white bg-white/5 px-2 py-1 rounded text-sm">Reticle inc.</span>
                </div>
                
                <div class="flex justify-between items-center p-3 rounded-lg hover:bg-white/5 transition-colors">
                  <span class="text-white/70 flex items-center gap-2">
                    <Info class="w-4 h-4" />
                    {{ t('settings.about.version') }}
                  </span>
                  <span class="font-mono text-white bg-white/5 px-2 py-1 rounded text-sm">{{ appVersion }}</span>
                </div>

                <div class="flex justify-between items-center p-3 rounded-lg hover:bg-white/5 transition-colors">
                  <span class="text-white/70 flex items-center gap-2">
                    <Monitor class="w-4 h-4" />
                    {{ t('settings.about.stage') }}
                  </span>
                  <span class="badge badge-outline border-white/20 text-white font-mono">{{ t('settings.about.stage_desc') }}</span>
                </div>
              </div>
            </div>

            <!-- Social Links -->
            <div class="bg-neutral-950 border border-white/10 rounded-xl overflow-hidden mt-4">
              <div class="p-3 border-b border-white/10 opacity-70">
                <h3 class="font-bold text-white text-xs uppercase tracking-wider text-center">{{ t('settings.about.links') }}</h3>
              </div>
              <div class="p-4 flex justify-center gap-6">
                <!-- GitHub -->
                <a
                  href="https://github.com/saint4626/reticle-releases"
                  target="_blank"
                  title="GitHub Releases"
                  class="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                >
                  <Github class="w-5 h-5" />
                </a>

                <!-- Telegram -->
                <a
                  href="https://t.me/VadimTexDex"
                  target="_blank"
                  title="Telegram"
                  class="p-2 rounded-full bg-white/5 top hover:bg-white/10 text-white/70 hover:text-[#2CA5E0] transition-colors"
                >
                  <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.17 13.667l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.978.892z"/>
                  </svg>
                </a>

                <!-- X / Twitter -->
                <a
                  href="https://x.com/VRMOMONTH"
                  target="_blank"
                  title="X (Twitter)"
                  class="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center"
                >
                  <img :src="xIcon" class="w-5 h-5 opacity-70 invert hover:opacity-100 transition-opacity" alt="X" />
                </a>

                <!-- Discord -->
                <a
                  href="https://discord.gg/j5Vrs4QNtR"
                  target="_blank"
                  title="Discord Community"
                  class="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-[#5865F2] transition-colors"
                >
                  <svg class="w-5 h-5 object-contain" viewBox="0 0 127.14 96.36" fill="currentColor">
                    <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.31,60,73.31,53s5-12.74,11.43-12.74S96.1,46,96,53,91.08,65.69,84.69,65.69Z"/>
                  </svg>
                </a>

                <!-- Boosty -->
                <a
                  href="https://boosty.to/pikadesigner"
                  target="_blank"
                  title="Boosty"
                  class="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center"
                >
                  <img :src="boostyIcon" class="w-5 h-5 opacity-70 invert hover:opacity-100 transition-opacity" alt="Boosty" />
                </a>
              </div>
            </div>

          </div>

        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-4px); }
  40%, 80% { transform: translateX(4px); }
}

.animate-shake {
  animation: shake 0.4s cubic-bezier(.36,.07,.19,.97) both;
}
</style>
