<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { Smile } from 'lucide-vue-next';
import { useEditorStore } from '../../stores/editor';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const store = useEditorStore();

const EMOJI_CATEGORIES: Record<string, string[]> = {
  '😀': ['😀','😂','🥹','😍','🤩','😎','🥳','😭','😤','🤯','🥺','😏','🤔','😴','🤗','😬','🫡','🤫','😇','🤠'],
  '👍': ['👍','👎','👏','🙌','🤝','✌️','🤞','🫶','❤️','🔥','💯','✅','❌','⚠️','💡','🎉','🎊','🏆','⭐','💎'],
  '🐶': ['🐶','🐱','🐭','🐸','🦊','🐻','🐼','🐨','🦁','🐯','🦄','🐙','🦋','🌸','🌈','☀️','🌙','⚡','❄️','🌊'],
  '🍕': ['🍕','🍔','🍟','🌮','🍜','🍣','🍩','🍪','🎂','☕','🧃','🍺','🥂','🍾','🎮','💻','📱','🎵','🎸','🚀'],
};

const activeCategory = ref(Object.keys(EMOJI_CATEGORIES)[0]);
const isOpen = ref(false);
const wrapperRef = ref<HTMLElement | null>(null);

function toggle(e: MouseEvent) {
  e.stopPropagation();
  isOpen.value = !isOpen.value;
}

function placeSticker(emoji: string) {
  store.addSticker({ emoji, x: -1, y: -1, size: 0.08, rotation: 0 });
  isOpen.value = false;
}

function onDocClick(e: MouseEvent) {
  if (wrapperRef.value && !wrapperRef.value.contains(e.target as Node)) {
    isOpen.value = false;
  }
}

onMounted(() => document.addEventListener('click', onDocClick, true));
onUnmounted(() => document.removeEventListener('click', onDocClick, true));
</script>

<template>
  <div ref="wrapperRef" style="position: relative;" @mousedown.stop>
    <div
      class="tooltip tooltip-bottom"
      :data-tip="t('editor.tools.sticker')"
    >
      <button
        class="btn btn-sm btn-ghost btn-square border-none !text-white hover:bg-white/10 hover:!text-white"
        :class="isOpen ? 'bg-white/20' : 'bg-transparent'"
        @click="toggle"
      >
        <Smile class="w-4 h-4" />
      </button>
    </div>

    <div
      v-if="isOpen"
      style="position: absolute; top: calc(100% + 8px); right: 0; width: 224px; z-index: 9999;"
      class="p-3 shadow-xl bg-neutral-950 rounded-box border border-white/10"
      @click.stop
      @mousedown.stop
    >
      <!-- Category tabs -->
      <div class="flex gap-1 mb-2 flex-wrap">
        <button
          v-for="cat in Object.keys(EMOJI_CATEGORIES)"
          :key="cat"
          class="btn btn-xs btn-ghost border-none"
          :class="activeCategory === cat ? 'bg-white/20 !text-white' : 'bg-transparent !text-white/50'"
          @click.stop="activeCategory = cat"
        >{{ cat }}</button>
      </div>

      <!-- Emoji grid -->
      <div class="grid grid-cols-5 gap-1">
        <button
          v-for="emoji in EMOJI_CATEGORIES[activeCategory]"
          :key="emoji"
          class="btn btn-xs btn-ghost border-none bg-transparent hover:bg-white/10 text-lg p-0 h-9 w-9"
          @click.stop="placeSticker(emoji)"
        >{{ emoji }}</button>
      </div>
    </div>
  </div>
</template>
