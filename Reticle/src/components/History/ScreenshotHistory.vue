<script setup lang="ts">
import { ref, computed } from 'vue';
import { History, Trash2, Edit2, ChevronLeft, Play } from 'lucide-vue-next';
import { useHistoryStore } from '../../stores/history';
import { useVideoHistoryStore, type VideoHistoryItem } from '../../stores/videoHistory';
import { useEditorStore } from '../../stores/editor';
import { useNotificationStore } from '../../stores/notification';
import { useI18n } from 'vue-i18n';

// ---- Types ----

type HistoryItemType = 'screenshot' | 'video';

interface UnifiedHistoryItem {
  id: string;
  type: HistoryItemType;
  timestamp: number;
  thumbnail: string;  // Blob URL
  data?: Blob;        // Для скриншотов
  videoData?: VideoHistoryItem;  // Для видео
}

// ---- Setup ----

const { t } = useI18n();
const historyStore = useHistoryStore();
const videoHistoryStore = useVideoHistoryStore();
const editorStore = useEditorStore();
const notify = useNotificationStore();

const isOpen = ref(false);
const blobUrls = ref<Record<string, string>>({});

// Unified history combining screenshots and videos
const unifiedHistory = computed<UnifiedHistoryItem[]>(() => {
  const items: UnifiedHistoryItem[] = [];
  
  // Add screenshots
  historyStore.history.forEach(item => {
    items.push({
      id: item.id,
      type: 'screenshot',
      timestamp: item.timestamp,
      thumbnail: blobUrls.value[item.id] || '',
      data: item.data,
    });
  });
  
  // Add videos
  videoHistoryStore.videoHistory.forEach(item => {
    items.push({
      id: item.id,
      type: 'video',
      timestamp: item.timestamp,
      thumbnail: videoHistoryStore.blobUrls[item.id] || '',
      videoData: item,
    });
  });
  
  // Sort by timestamp (newest first)
  return items.sort((a, b) => b.timestamp - a.timestamp);
});

// Watch history changes to update Blob URLs
import { watch, onUnmounted } from 'vue';

watch(() => historyStore.history, (newHistory) => {
  // Revoke old URLs to prevent memory leaks
  Object.values(blobUrls.value).forEach(url => URL.revokeObjectURL(url));
  blobUrls.value = {};
  
  // Create new URLs
  newHistory.forEach(item => {
    if (item.data instanceof Blob) {
      blobUrls.value[item.id] = URL.createObjectURL(item.data);
    }
  });
}, { immediate: true, deep: true });

onUnmounted(() => {
  Object.values(blobUrls.value).forEach(url => URL.revokeObjectURL(url));
});

function toggle() {
  isOpen.value = !isOpen.value;
}

function load(item: UnifiedHistoryItem) {
  if (item.type === 'screenshot') {
    if (!item.data) return;
    // Create a fresh URL from the Blob — this URL is owned by the editor store
    // and won't be revoked by thumbnail cleanup cycles
    const freshUrl = URL.createObjectURL(item.data);
    editorStore.setImage(freshUrl, item.data);
  } else if (item.type === 'video') {
    videoHistoryStore.loadIntoEditor(item.id);
  }
}

function remove(item: UnifiedHistoryItem) {
  if (item.type === 'screenshot') {
    historyStore.removeFromHistory(item.id);
    notify.add(t('history.delete_success'), 'success');
  } else if (item.type === 'video') {
    videoHistoryStore.removeFromHistory(item.id);
  }
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
</script>

<template>
  <div class="absolute left-0 top-0 bottom-0 z-[40] flex items-center pointer-events-none">
    
    <!-- Sliding Panel -->
    <div 
      class="h-full bg-black shadow-2xl transition-[width] duration-300 ease-in-out pointer-events-auto overflow-hidden flex flex-col"
      :class="[isOpen ? 'w-[160px] border-r border-white/10' : 'w-0 border-none']"
    >
      <!-- Content Container (Fixed Width to prevent squishing) -->
      <div class="w-[160px] h-full flex flex-col">
        
        <!-- List -->
        <div class="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide flex flex-col">
            <div v-if="unifiedHistory.length === 0" class="flex-1 flex items-center justify-center text-white/30 text-xs text-center leading-tight">
            {{ t('history.empty') }}
            </div>

            <div v-else class="space-y-3">
              <div 
              v-for="item in unifiedHistory" 
              :key="item.id"
              class="group relative w-[120px] h-[90px] rounded-lg overflow-hidden border border-white/10 bg-black flex-shrink-0 mx-auto transition-all duration-200 hover:border-white/30"
              >
              <!-- Preview -->
              <img 
                  v-if="item.thumbnail"
                  :src="item.thumbnail" 
                  class="w-full h-full object-cover transition-all duration-200 group-hover:opacity-80 group-hover:scale-105" 
              />
              
              <!-- Video Play Icon Overlay -->
              <div v-if="item.type === 'video'" class="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div class="bg-black/60 rounded-full p-2">
                  <Play class="w-6 h-6 text-white fill-white" />
                </div>
              </div>
              
              <!-- Video Duration Indicator -->
              <div v-if="item.type === 'video' && item.videoData" class="absolute bottom-1 right-1 bg-black/80 text-white text-[10px] px-1.5 py-0.5 rounded pointer-events-none font-mono">
                {{ formatDuration(item.videoData.duration) }}
              </div>
              
              <!-- Actions Overlay -->
              <div class="absolute inset-0 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/40 backdrop-blur-[1px]">
                  <button 
                  class="btn btn-xs btn-square btn-ghost bg-black/50 hover:bg-white text-white hover:text-black border border-white/20 transition-all duration-200 hover:scale-110"
                  @click.stop="load(item)"
                  :title="t('history.load_tooltip')"
                  >
                  <Edit2 class="w-3 h-3" />
                  </button>
                  <button 
                  class="btn btn-xs btn-square btn-ghost bg-black/50 hover:bg-red-500 text-white border border-white/20 hover:border-red-500 transition-all duration-200 hover:scale-110"
                  @click.stop="remove(item)"
                  :title="t('history.delete_tooltip')"
                  >
                  <Trash2 class="w-3 h-3" />
                  </button>
              </div>
              </div>
            </div>
        </div>
      </div>
    </div>

    <!-- Tab Button (Moves with panel) -->
    <div class="pointer-events-auto h-full flex items-center">
      <button 
        class="cursor-pointer bg-black border border-l-0 border-white/10 rounded-r-lg p-3 text-white transition-colors shadow-lg flex items-center justify-center relative -ml-[1px] hover:!bg-neutral-900"
        @click="toggle"
        :title="t('history.title')"
      >
        <ChevronLeft v-if="isOpen" class="w-5 h-5" />
        <History v-else class="w-5 h-5" />
      </button>
    </div>

  </div>
</template>

<style scoped>
/* Hide scrollbar for cleaner look */
.scrollbar-hide::-webkit-scrollbar {
    display: none;
}
.scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
}
</style>
