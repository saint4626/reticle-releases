<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Settings, X, Minus, Square } from 'lucide-vue-next';

const appWindow = getCurrentWindow();

defineEmits<{
  (e: 'open-settings'): void
}>();

async function minimize() {
  try {
    await appWindow.minimize();
  } catch (e) {
    console.error('Failed to minimize:', e);
  }
}

async function toggleMaximize() {
  try {
    const isMaximized = await appWindow.isMaximized();
    if (isMaximized) {
      await appWindow.unmaximize();
    } else {
      await appWindow.maximize();
    }
  } catch (e) {
    console.error('Failed to toggle maximize:', e);
  }
}

async function closeApp() {
  try {
    await appWindow.close();
  } catch (e) {
    console.error('Failed to close:', e);
  }
}
</script>

<template>
  <div class="ml-auto flex items-center gap-2" @mousedown.stop>
    <button class="btn btn-sm btn-ghost btn-square bg-transparent border-none !text-white hover:bg-white/10 hover:!text-white" @click="$emit('open-settings')">
      <Settings class="w-5 h-5" />
    </button>

    <div class="w-[1px] h-6 bg-white/10 mx-1 pointer-events-none"></div>

    <div class="flex items-center gap-1">
      <button class="btn btn-xs btn-ghost btn-square bg-transparent border-none !text-white hover:bg-white/10 hover:!text-white" @click="minimize">
        <Minus class="w-4 h-4" />
      </button>
      <button class="btn btn-xs btn-ghost btn-square bg-transparent border-none !text-white hover:bg-white/10 hover:!text-white" @click="toggleMaximize">
        <Square class="w-3 h-3" />
      </button>
      <button class="btn btn-xs btn-ghost btn-square bg-transparent border-none text-error hover:bg-error/20" @click="closeApp">
        <X class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>
