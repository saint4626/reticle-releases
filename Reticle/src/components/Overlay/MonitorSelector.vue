<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { Monitor } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

interface MonitorInfo {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  is_primary: boolean;
}

const props = defineProps<{
  monitors: MonitorInfo[];
  previews?: Record<number, string>;
}>();

const emit = defineEmits<{
  (e: 'select', monitor: MonitorInfo): void;
  (e: 'cancel'): void;
}>();

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('cancel');
    return;
  }

  const key = parseInt(e.key);
  if (!isNaN(key) && key >= 1 && key <= props.monitors.length) {
    emit('select', props.monitors[key - 1]);
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
    <div class="bg-neutral-900 border border-white/10 rounded-2xl p-8 shadow-2xl max-w-4xl w-full mx-4">
      <h2 class="text-2xl font-bold text-white mb-8 text-center flex items-center justify-center gap-3">
        <Monitor class="w-8 h-8" />
        {{ t('monitor_selector.title') }}
      </h2>
      
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <button
          v-for="(monitor, index) in monitors"
          :key="monitor.id"
          class="group relative flex flex-col items-center p-6 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/30 hover:scale-105 transition-all duration-200"
          @click="$emit('select', monitor)"
        >
          <!-- Monitor Visual Representation -->
          <div class="w-full aspect-video bg-black rounded-lg mb-4 border border-white/10 group-hover:border-white/50 flex items-center justify-center relative overflow-hidden">
            <img 
              v-if="previews && previews[monitor.id]" 
              :src="previews[monitor.id]" 
              class="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" 
            />
            <div v-else class="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent"></div>
            
            <span class="text-4xl font-bold text-white/20 group-hover:text-white/40 transition-colors z-10 drop-shadow-lg">
              {{ index + 1 }}
            </span>
          </div>

          <!-- Info -->
          <div class="text-center">
            <h3 class="font-medium text-white text-lg mb-1">{{ monitor.name }}</h3>
            <p class="text-white/50 text-sm font-mono">{{ monitor.width }} x {{ monitor.height }}</p>
            <span v-if="monitor.is_primary" class="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-bold bg-primary/20 text-primary border border-primary/20">
              MAIN
            </span>
          </div>
        </button>
      </div>

      <div class="mt-8 text-center text-white/30 text-sm">
        {{ t('monitor_selector.instruction_key') }} <span class="font-mono bg-white/10 px-1 rounded">1-{{ monitors.length }}</span> {{ t('monitor_selector.instruction_mouse') }}
      </div>
    </div>
  </div>
</template>
