<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { AppWindow, X } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

interface WindowInfo {
  id: string;
  title: string;
  app_name: string;
  thumbnail?: string; // base64
}

// Helper to convert binary to Blob URL
function binaryToBlobUrl(bytes: Uint8Array | number[], type = 'image/jpeg'): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const blob = new Blob([data as unknown as BlobPart], { type });
  return URL.createObjectURL(blob);
}

const emit = defineEmits<{
  (e: 'confirm', win: WindowInfo): void;
  (e: 'cancel'): void;
}>();

const windows = ref<WindowInfo[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

// Track Blob URLs for cleanup
const blobUrls: string[] = [];

function registerBlobUrl(url: string) {
  blobUrls.push(url);
  return url;
}

async function loadWindows() {
  loading.value = true;
  error.value = null;
  try {
    const list = await invoke<WindowInfo[]>('get_open_windows');
    windows.value = list;
    
    // Load thumbnails in parallel but without blocking the UI
    // We update the reactive array items as they load
    loadThumbnails(list);
  } catch (e) {
    console.error(e);
    error.value = t('window_selector.load_error') + e;
  } finally {
    loading.value = false;
  }
}

async function loadThumbnails(list: WindowInfo[]) {
  // Batch processing
  const BATCH_SIZE = 6;
  
  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE);
    const ids = batch.map(w => w.id);
    
    try {
      const thumbnails = await invoke<Record<string, Uint8Array>>('get_window_thumbnails', { ids });
      
      // Update UI
      for (const [id, bytes] of Object.entries(thumbnails)) {
        const index = windows.value.findIndex(w => w.id === id);
        if (index !== -1) {
          const url = registerBlobUrl(binaryToBlobUrl(bytes));
          windows.value[index].thumbnail = url;
        }
      }
    } catch (e) {
      console.warn('Failed to load batch thumbnails:', e);
    }
  }
}

function selectWindow(win: WindowInfo) {
  emit('confirm', win);
}

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('cancel');
  }
}

onMounted(() => {
  loadWindows();
  window.addEventListener('keydown', onEsc);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onEsc);
  // Cleanup Blob URLs
  blobUrls.forEach(url => URL.revokeObjectURL(url));
  blobUrls.length = 0;
});
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md" @click.self="$emit('cancel')"><!-- Content -->
      <div class="bg-neutral-950 w-full max-w-2xl max-h-[80vh] rounded-xl shadow-2xl flex flex-col overflow-hidden animate-slide-up border border-white/10">
        <!-- Header -->    <div class="p-4 border-b border-white/10 flex justify-between items-center bg-black/50">
        <h3 class="text-lg font-bold flex items-center gap-2 text-white">
          <AppWindow class="w-5 h-5" />
          {{ t('window_selector.title') }}
        </h3>
        <button class="btn btn-sm btn-ghost btn-square bg-transparent border-none !text-white hover:bg-white/10 hover:!text-white" @click="$emit('cancel')">
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-4 bg-neutral-950">
        <div v-if="loading" class="flex flex-col items-center justify-center h-40 gap-4">
          <span class="loading loading-spinner loading-lg text-white/50"></span>
          <p class="text-white/50">{{ t('window_selector.searching') }}</p>
        </div>

        <div v-else-if="error" class="alert bg-red-900/20 border-red-500/20 text-red-200">
          <span>{{ error }}</span>
          <button class="btn btn-sm btn-ghost border-red-500/20 hover:bg-red-500/10 text-red-200" @click="loadWindows">{{ t('window_selector.retry') }}</button>
        </div>

        <div v-else-if="windows.length === 0" class="flex flex-col items-center justify-center h-40 text-white/30">
          <p>{{ t('window_selector.no_windows') }}</p>
        </div>

        <div v-else class="grid grid-cols-2 md:grid-cols-3 gap-4">
          <button
            v-for="win in windows"
            :key="win.id"
            class="card bg-black hover:bg-neutral-900 transition-all cursor-pointer border border-white/10 hover:border-white/40 group p-0 overflow-hidden text-left h-full"
            @click="selectWindow(win)"
          >
            <!-- Thumbnail Area -->
            <div class="aspect-video bg-neutral-900 w-full relative flex items-center justify-center overflow-hidden border-b border-white/5">
              <img 
                v-if="win.thumbnail" 
                :src="win.thumbnail" 
                class="w-full h-full object-contain" 
                alt="Window preview"
              />
              <div v-else class="loading loading-spinner text-white/10"></div>
              
              <!-- App Icon Badge (Placeholder) -->
              <div class="absolute bottom-2 left-2 badge badge-ghost bg-black/50 border-white/10 text-xs shadow-md backdrop-blur-sm text-white">
                {{ win.app_name }}
              </div>
            </div>

            <!-- Content -->
            <div class="p-3 w-full">
               <h4 class="font-medium text-xs truncate w-full opacity-70 group-hover:opacity-100 text-white" :title="win.title">
                 {{ win.title || t('window_selector.untitled_window') }}
               </h4>
            </div>
          </button>
        </div>
      </div>
      
      <!-- Footer -->
      <div class="p-3 bg-black/50 text-center text-xs text-white/30 border-t border-white/5">
        {{ t('window_selector.cancel_instruction') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes slide-up {
  from { transform: translateY(20px); }
  to { transform: translateY(0); }
}
.animate-slide-up {
  animation: slide-up 0.2s ease-out;
}
</style>
