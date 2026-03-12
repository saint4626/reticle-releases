<script setup lang="ts">
import { useNotificationStore } from '../../stores/notification';
import { storeToRefs } from 'pinia';
import { CheckCircle, XCircle, Info, X, Download } from 'lucide-vue-next';

const store = useNotificationStore();
const { notifications } = storeToRefs(store);

function getIcon(type: string) {
  switch (type) {
    case 'success': return CheckCircle;
    case 'error': return XCircle;
    case 'update': return Download;
    default: return Info;
  }
}

function getColorClass(type: string) {
  switch (type) {
    case 'success': return 'text-green-400';
    case 'error': return 'text-red-400';
    case 'update': return 'text-green-400'; // Make update icon green
    default: return 'text-blue-400';
  }
}
</script>

<template>
  <div class="toast toast-end toast-bottom z-[9999] p-4 gap-2 pointer-events-none">
    <TransitionGroup 
      name="toast" 
      tag="div" 
      class="flex flex-col gap-2 items-end"
    >
      <div 
        v-for="notification in notifications" 
        :key="notification.id"
        class="pointer-events-auto flex items-center gap-3 min-w-[300px] max-w-[400px] p-4 rounded-xl bg-neutral-950/90 backdrop-blur-md border border-white/10 shadow-2xl shadow-black/50 select-none"
      >
        <!-- Icon -->
        <component 
          :is="getIcon(notification.type)" 
          class="w-5 h-5 flex-shrink-0"
          :class="getColorClass(notification.type)"
        />

        <!-- Content Container -->
        <div class="flex-1 flex flex-col gap-1 min-w-0">
          <!-- Title -->
          <div v-if="notification.title" class="text-sm font-bold text-white">
            {{ notification.title }}
          </div>
          
          <!-- Message -->
          <div class="text-sm font-medium text-white/80 break-words line-clamp-2">
            {{ notification.message }}
          </div>

          <!-- Actions -->
          <div v-if="notification.actions && notification.actions.length > 0" class="flex gap-2 mt-2">
            <button 
              v-for="(action, idx) in notification.actions" 
              :key="idx"
              @click="action.onClick"
              class="btn btn-xs"
              :class="action.primary ? 'bg-white hover:bg-neutral-200 text-black border-none' : 'btn-ghost text-white/70 hover:text-white'"
            >
              {{ action.label }}
            </button>
          </div>
        </div>

        <!-- Close Button -->
        <button 
          @click="store.remove(notification.id)"
          class="btn btn-ghost btn-xs btn-square text-white/50 hover:text-white hover:bg-white/10"
        >
          <X class="w-3 h-3" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(20px) scale(0.95);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(20px) scale(0.95);
}
</style>
