import { defineStore } from 'pinia';
import { useStorage } from '@vueuse/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs';
import { ref, shallowRef, watch } from 'vue';
import { useViewportStore } from './viewport';
import { DEFAULT_SHADER_PARAMS, type ShaderParams } from '../utils/shaderBackground';

export interface BlurObject {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ArrowObject {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

export interface EmojiSticker {
  id: string;
  emoji: string;
  x: number;
  y: number;
  size: number;
  rotation: number;
}

export interface OcrWordBox {
  id: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type EditorTool = 'cursor' | 'blur' | 'arrow' | 'sticker';

function mimeToExtension(mime: string) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid data URL');
  return { mime: match[1], base64: match[2] };
}

function base64ToUint8Array(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export const useEditorStore = defineStore('editor', () => {
  const imageData = shallowRef<string | null>(null);
  const imageBlob = shallowRef<Blob | null>(null);

  // Editor State
  const activeTool = ref<EditorTool>('cursor');

  const blurs = shallowRef<BlurObject[]>([]);
  const arrows = shallowRef<ArrowObject[]>([]);
  const stickers = shallowRef<EmojiSticker[]>([]);
  const ocrBoxes = shallowRef<OcrWordBox[]>([]);
  const ocrEnabled = ref(false);
  const selectedStickerId = ref<string | null>(null);
  const history = shallowRef<('blur' | 'arrow' | 'sticker')[]>([]);

  const displayWidth = ref(0);
  const displayHeight = ref(0);

  const padding = useStorage('reticle-padding', 64);
  const borderRadius = useStorage('reticle-border-radius', 12);

  // Shadow settings
  const shadowColor = useStorage('reticle-shadow-color', '#000000');
  const shadowBlur = useStorage('reticle-shadow-blur', 20);
  const shadowSpread = useStorage('reticle-shadow-spread', 0);
  const shadowOpacity = useStorage('reticle-shadow-opacity', 0.4);
  const shadowX = useStorage('reticle-shadow-x', 0);
  const shadowY = useStorage('reticle-shadow-y', 10);
  const shadowInset = useStorage('reticle-shadow-inset', false);

  const background = useStorage('reticle-background', 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)');
  const backgroundImage = ref<string | null>(null);
  const backgroundImagePath = useStorage<string | null>('reticle-background-image-path', null);
  const backgroundImageMime = useStorage('reticle-background-image-mime', 'image/png');
  const backgroundBlur = useStorage('reticle-background-blur', 0);

  const shaderEnabled = useStorage('reticle-shader-enabled', false);
  const shaderParams = useStorage<ShaderParams>('reticle-shader-params', JSON.parse(JSON.stringify(DEFAULT_SHADER_PARAMS)));
  if (shaderParams.value && (
    'color1' in (shaderParams.value as any) ||
    'chromaticAberration' in (shaderParams.value as any) ||
    'bands' in (shaderParams.value as any) ||
    'filmGrain' in (shaderParams.value as any) ||
    !shaderParams.value.blob1
  )) {
    shaderParams.value = JSON.parse(JSON.stringify(DEFAULT_SHADER_PARAMS));
  }

  const arrowColor = useStorage('reticle-arrow-color', '#ff0000');
  const arrowStrokeWidth = useStorage('reticle-arrow-width', 5);
  const isRestoringBackground = ref(false);

  async function restoreBackgroundImage() {
    if (!backgroundImagePath.value) return;
    try {
      const fileExists = await exists(backgroundImagePath.value);
      if (!fileExists) {
        backgroundImagePath.value = null;
        backgroundImage.value = null;
        return;
      }
      isRestoringBackground.value = true;
      const bytes = await readFile(backgroundImagePath.value);
      const mime = backgroundImageMime.value || 'image/png';
      const base64 = uint8ArrayToBase64(bytes);
      backgroundImage.value = `data:${mime};base64,${base64}`;
    } catch {
      backgroundImagePath.value = null;
      backgroundImage.value = null;
    } finally {
      isRestoringBackground.value = false;
    }
  }

  watch(backgroundImage, async (value) => {
    if (isRestoringBackground.value) return;
    if (!value) {
      backgroundImagePath.value = null;
      return;
    }
    if (!value.startsWith('data:')) return;
    try {
      const { mime, base64 } = parseDataUrl(value);
      const bytes = base64ToUint8Array(base64);
      const appDataPath = await appDataDir();
      const backgroundsDir = await join(appDataPath, 'backgrounds');
      await mkdir(backgroundsDir, { recursive: true });
      const filePath = await join(backgroundsDir, `reticle-custom-background.${mimeToExtension(mime)}`);
      await writeFile(filePath, bytes);
      backgroundImagePath.value = filePath;
      backgroundImageMime.value = mime;
    } catch {
      backgroundImagePath.value = null;
    }
  });

  void restoreBackgroundImage();

  function setImage(data: string | null, blob?: Blob | null) {
    imageData.value = data;
    imageBlob.value = blob ?? null;
    blurs.value = [];
    arrows.value = [];
    stickers.value = [];
    ocrBoxes.value = [];
    ocrEnabled.value = false;
    selectedStickerId.value = null;
    history.value = [];

    // Reset viewport
    const viewport = useViewportStore();
    viewport.reset();
  }

  function refreshImageUrl(url: string) {
    imageData.value = url;
  }

  function addBlur(blur: BlurObject) {
    blurs.value = [...blurs.value, blur];
    history.value = [...history.value, 'blur'];
  }

  function addArrow(arrow: ArrowObject) {
    arrows.value = [...arrows.value, arrow];
    history.value = [...history.value, 'arrow'];
  }

  function addSticker(sticker: Omit<EmojiSticker, 'id'>) {
    const newSticker: EmojiSticker = { ...sticker, id: crypto.randomUUID() };
    stickers.value = [...stickers.value, newSticker];
    history.value = [...history.value, 'sticker'];
    selectedStickerId.value = newSticker.id;
    return newSticker.id;
  }

  function updateSticker(id: string, patch: Partial<Omit<EmojiSticker, 'id'>>) {
    stickers.value = stickers.value.map(s => s.id === id ? { ...s, ...patch } : s);
  }

  function removeSticker(id: string) {
    stickers.value = stickers.value.filter(s => s.id !== id);
    if (selectedStickerId.value === id) selectedStickerId.value = null;
    const idx = history.value.lastIndexOf('sticker');
    if (idx !== -1) {
      const h = [...history.value];
      h.splice(idx, 1);
      history.value = h;
    }
  }

  function undo() {
    if (history.value.length === 0) return;

    const newHistory = [...history.value];
    const lastAction = newHistory.pop();
    history.value = newHistory; // Триггерит реактивность history

    if (lastAction === 'blur') {
      blurs.value = blurs.value.slice(0, -1);
    } else if (lastAction === 'arrow') {
      arrows.value = arrows.value.slice(0, -1);
    } else if (lastAction === 'sticker') {
      const last = stickers.value[stickers.value.length - 1];
      if (last) removeSticker(last.id);
    }
  }

  function removeFromHistory(type: 'blur' | 'arrow' | 'sticker') {
    const index = history.value.lastIndexOf(type);
    if (index !== -1) {
      const newHistory = [...history.value];
      newHistory.splice(index, 1);
      history.value = newHistory;
    }
  }

  function undoBlur() {
    if (blurs.value.length > 0) {
      blurs.value = blurs.value.slice(0, -1);
      removeFromHistory('blur');
    }
  }

  function undoArrow() {
    if (arrows.value.length > 0) {
      arrows.value = arrows.value.slice(0, -1);
      removeFromHistory('arrow');
    }
  }

  function setOcrBoxes(boxes: Omit<OcrWordBox, 'id'>[]) {
    ocrBoxes.value = boxes.map((box, index) => ({
      ...box,
      id: `${index}-${box.x}-${box.y}-${box.w}-${box.h}-${box.text}`,
    }));
    ocrEnabled.value = ocrBoxes.value.length > 0;
  }

  function clearOcrBoxes() {
    ocrBoxes.value = [];
    ocrEnabled.value = false;
  }

  return {
    imageData,
    activeTool,
    blurs,
    arrows,
    stickers,
    ocrBoxes,
    ocrEnabled,
    selectedStickerId,
    displayWidth,
    displayHeight,
    padding,
    borderRadius,
    // Shadow
    shadowColor,
    shadowBlur,
    shadowSpread,
    shadowOpacity,
    shadowX,
    shadowY,
    shadowInset,
    // BG
    background,
    backgroundImage,
    backgroundBlur,
    // Shader BG
    shaderEnabled,
    shaderParams,
    // Annotations
    arrowColor,
    arrowStrokeWidth,
    setImage,
    imageBlob,
    refreshImageUrl,
    addBlur,
    addArrow,
    addSticker,
    updateSticker,
    removeSticker,
    setOcrBoxes,
    clearOcrBoxes,
    undo,
    undoBlur,
    undoArrow
  };
});
