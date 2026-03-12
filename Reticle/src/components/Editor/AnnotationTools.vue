<script setup lang="ts">
import { useEditorStore } from '../../stores/editor';
import { useNotificationStore } from '../../stores/notification';
import { storeToRefs } from 'pinia';
import { invoke } from '@tauri-apps/api/core';
import { 
  Clipboard, ArrowRight, Undo2, 
  EyeOff, Trash2
} from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '../../stores/settings';
import EmojiPicker from './EmojiPicker.vue';
import { renderEditorImageAsBytes } from '../../utils/editorRender';

const { t } = useI18n();
const store = useEditorStore();
const notify = useNotificationStore();
const settingsStore = useSettingsStore();
const { activeTool, blurs, arrows, ocrEnabled } = storeToRefs(store);

interface OcrWordBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OcrResponse {
  text: string;
  words: OcrWordBox[];
}

// Fully offscreen canvas export — no domToBlob, no CSS transforms, no flicker.
// Renders background + padding + shadow + image + blurs + arrows + stickers
// all in canvas-space (naturalWidth x naturalHeight), so any image size works.
async function renderImageAsBytes(): Promise<Uint8Array | null> {
  if (!store.imageData) {
    notify.add(t('editor.no_image_to_save'), 'error');
    return null;
  }

  try {
    return await renderEditorImageAsBytes({
      imageData: store.imageData,
      padding: store.padding,
      borderRadius: store.borderRadius,
      background: store.background,
      backgroundImage: store.backgroundImage,
      backgroundBlur: store.backgroundBlur,
      shaderEnabled: store.shaderEnabled,
      shaderParams: store.shaderParams,
      shadowX: store.shadowX,
      shadowY: store.shadowY,
      shadowBlur: store.shadowBlur,
      shadowSpread: store.shadowSpread,
      shadowColor: store.shadowColor,
      shadowOpacity: store.shadowOpacity,
      shadowInset: store.shadowInset,
      blurs: store.blurs,
      arrows: store.arrows,
      stickers: store.stickers,
    });
  } catch (e) {
    console.error('Failed to render:', e);
    notify.add(t('editor.render_error') + e, 'error');
    return null;
  }
}

async function copyToClipboard() {
  const bytes = await renderImageAsBytes();
  if (!bytes) return;

  try {
    await invoke('copy_to_clipboard', { bytes });
    notify.add(t('editor.copy_success'), 'success');
  } catch (e) {
    console.error('Failed to copy:', e);
    notify.add(t('editor.copy_error') + e, 'error');
  }
}

async function getSourceImageBytes(): Promise<Uint8Array | null> {
  if (!store.imageData) {
    notify.add(t('editor.no_image_to_save'), 'error');
    return null;
  }

  try {
    const blob = await fetch(store.imageData).then((r) => r.blob());
    return new Uint8Array(await blob.arrayBuffer());
  } catch (e) {
    notify.add(t('editor.render_error') + e, 'error');
    return null;
  }
}

async function toggleOcr() {
  if (ocrEnabled.value) {
    store.clearOcrBoxes();
    return;
  }

  const bytes = await getSourceImageBytes();
  if (!bytes) return;

  try {
    const result = await invoke<OcrResponse>('ocr_image', {
      bytes,
      engine: settingsStore.ocrEngine,
    });
    const words = result.words
      .filter((word) => word.text.trim().length > 0 && word.width > 2 && word.height > 2)
      .map((word) => ({
        text: word.text,
        x: word.x,
        y: word.y,
        w: word.width,
        h: word.height,
      }));

    if (words.length === 0) {
      store.clearOcrBoxes();
      notify.add(t('editor.tools.ocr_empty'), 'error');
      return;
    }

    store.setOcrBoxes(words);
    notify.add(t('editor.tools.ocr_ready'), 'success');
  } catch (e) {
    store.clearOcrBoxes();
    notify.add(t('editor.tools.ocr_error') + e, 'error');
  }
}
</script>

<template>
  <div class="join" @mousedown.stop>
    <!-- Annotation Tools Group -->
    <div class="join">
      <div class="tooltip tooltip-bottom" :data-tip="t('editor.tools.arrow_style')">
        <button 
          class="btn btn-sm join-item btn-ghost border-none hover:bg-white/10 hover:!text-white"
          :class="activeTool === 'arrow' ? 'bg-white/20 !text-white' : 'bg-transparent !text-white'"
          @click="activeTool = activeTool === 'arrow' ? 'cursor' : 'arrow'"
        >
          <ArrowRight class="w-4 h-4" />
        </button>
      </div>
      <div class="tooltip tooltip-bottom" :data-tip="t('editor.tools.undo')">
        <button 
          class="btn btn-sm join-item btn-ghost bg-transparent border-none hover:bg-white/10 hover:!text-white disabled:opacity-30 disabled:hover:bg-transparent" 
          :class="arrows.length > 0 ? '!text-white' : '!text-white/50'"
          :disabled="arrows.length === 0"
          @click="store.undoArrow()"
        >
          <Undo2 class="w-4 h-4" />
        </button>
      </div>
    </div>

    <div class="w-[1px] h-6 bg-white/10 mx-1 self-center pointer-events-none"></div>

    <!-- Blur Tools Group -->
    <div class="join">
      <div class="tooltip tooltip-bottom" :data-tip="t('editor.tools.blur')">
        <button 
          class="btn btn-sm join-item btn-ghost border-none hover:bg-white/10 hover:!text-white"
          :class="activeTool === 'blur' ? 'bg-white/20 !text-white' : 'bg-transparent !text-white'"
          @click="activeTool = activeTool === 'blur' ? 'cursor' : 'blur'"
        >
          <EyeOff class="w-4 h-4" />
        </button>
      </div>
      <div class="tooltip tooltip-bottom" :data-tip="t('editor.tools.undo')">
        <button 
          class="btn btn-sm join-item btn-ghost bg-transparent border-none hover:bg-white/10 hover:!text-white disabled:opacity-30 disabled:hover:bg-transparent" 
          :class="blurs.length > 0 ? '!text-white' : '!text-white/50'"
          :disabled="blurs.length === 0"
          @click="store.undoBlur()"
        >
          <Undo2 class="w-4 h-4" />
        </button>
      </div>
      <div class="tooltip tooltip-bottom" :data-tip="t('editor.tools.clear')">
        <button 
          class="btn btn-sm join-item btn-ghost bg-transparent border-none hover:bg-red-500/20 hover:!text-red-500 text-white/50" 
          @click="store.setImage(null)"
        >
          <Trash2 class="w-4 h-4" />
        </button>
      </div>
    </div>

    <div class="w-[1px] h-6 bg-white/10 mx-1 self-center pointer-events-none"></div>

    <!-- Emoji Stickers -->
    <EmojiPicker />

    <div class="w-[1px] h-6 bg-white/10 mx-1 self-center pointer-events-none"></div>

    <div class="join">
      <div class="tooltip tooltip-bottom" :data-tip="t('editor.tools.ocr_scan')">
        <button
          class="btn btn-sm join-item btn-ghost bg-transparent border-none hover:bg-white/10"
          :class="ocrEnabled ? '!text-cyan-300 bg-cyan-500/10' : '!text-white hover:!text-white'"
          @click="toggleOcr"
        >
          OCR
        </button>
      </div>
    </div>

    <div class="w-[1px] h-6 bg-white/10 mx-1 self-center pointer-events-none"></div>

    <!-- Export Group -->
    <div class="join">
      <div class="tooltip tooltip-bottom" :data-tip="t('editor.tools.copy')">
        <button class="btn btn-sm join-item btn-ghost bg-transparent border-none !text-white hover:bg-white/10 hover:!text-white" @click="copyToClipboard">
          <Clipboard class="w-4 h-4" />
        </button>
      </div>
    </div>
  </div>
</template>
