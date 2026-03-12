<script setup lang="ts">
import { useEditorStore } from '../../stores/editor';
import { useVideoStore } from '../../stores/video';
import { storeToRefs } from 'pinia';
import { PenTool, Palette, Layers, Maximize, Sparkles, ChevronDown, ChevronRight, Shuffle } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { DEFAULT_SHADER_PARAMS, randomizeShaderParams } from '../../utils/shaderBackground';
import { ref, computed } from 'vue';

const { t } = useI18n();
const store = useEditorStore();
const videoStore = useVideoStore();
const { isVideoMode } = storeToRefs(videoStore);
const {
  padding, borderRadius, background, backgroundImage, backgroundBlur,
  shadowBlur, shadowSpread, shadowOpacity, shadowX, shadowY,
  arrowColor, arrowStrokeWidth,
  shaderEnabled, shaderParams
} = storeToRefs(store);

// Which layer accordion is open
const openLayer = ref<string | null>('blob1');

function toggleLayer(name: string) {
  openLayer.value = openLayer.value === name ? null : name;
}

function handleImageUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files?.[0]) {
    const reader = new FileReader();
    reader.onload = (e) => { if (e.target?.result) backgroundImage.value = e.target.result as string; };
    reader.readAsDataURL(input.files[0]);
  }
}

function resetShaderParams() {
  shaderParams.value = JSON.parse(JSON.stringify(DEFAULT_SHADER_PARAMS));
}

function randomizeShader() {
  shaderParams.value = randomizeShaderParams();
  if (!shaderEnabled.value) {
    shaderEnabled.value = true;
    backgroundImage.value = null;
  }
}

function toggleShader() {
  shaderEnabled.value = !shaderEnabled.value;
  if (shaderEnabled.value) backgroundImage.value = null;
}

// Guard: if stored params are stale/corrupt, reset on mount
import { onMounted } from 'vue';
onMounted(() => {
  if (!shaderParams.value?.blob1) {
    shaderParams.value = JSON.parse(JSON.stringify(DEFAULT_SHADER_PARAMS));
  }
});

// Safe accessor — always returns valid params even during hydration
const sp = computed(() => {
  const p = shaderParams.value;
  if (!p?.blob1) return DEFAULT_SHADER_PARAMS;
  return p;
});

// Writable helpers so v-model works through the safe accessor
function ensureParams() {
  if (!shaderParams.value?.blob1) {
    shaderParams.value = JSON.parse(JSON.stringify(DEFAULT_SHADER_PARAMS));
  }
  return shaderParams.value;
}
</script>

<template>
  <div class="flex items-center gap-2">

    <!-- Arrow Settings -->
    <div v-if="!isVideoMode" class="dropdown dropdown-end" @mousedown.stop>
      <div tabindex="0" role="button" class="btn btn-sm btn-ghost btn-square tooltip tooltip-bottom bg-transparent border-none !text-white hover:bg-white/10 hover:!text-white" :data-tip="t('editor.properties.arrow_style')">
        <PenTool class="w-5 h-5" />
      </div>
      <div tabindex="0" class="dropdown-content z-[9999] menu p-4 shadow-xl bg-neutral-950 text-white rounded-box w-72 border border-white/10 mt-2">
        <h3 class="font-bold mb-4 text-sm">{{ t('editor.properties.arrow_style') }}</h3>
        <div class="mb-4">
          <label class="label p-0 pb-2"><span class="label-text-alt text-white/70">{{ t('editor.properties.color') }}</span></label>
          <div class="grid grid-cols-5 gap-2">
            <div v-for="color in ['#ff0000','#00ff00','#0000ff','#ffff00','#ff00ff','#00ffff','#ffffff','#000000']"
                 :key="color" class="w-8 h-8 rounded-full cursor-pointer border-2 transition-all hover:scale-110"
                 :class="arrowColor === color ? 'border-white' : 'border-white/10'"
                 :style="{ backgroundColor: color }" @click="arrowColor = color" />
          </div>
        </div>
        <div class="form-control">
          <label class="label p-0 pb-1"><span class="label-text-alt text-white/70">{{ t('editor.properties.thickness') }}: {{ arrowStrokeWidth }}px</span></label>
          <input type="range" min="1" max="20" v-model.number="arrowStrokeWidth" class="range range-xs" />
        </div>
      </div>
    </div>

    <!-- Background -->
    <div class="dropdown dropdown-end" @mousedown.stop>
      <div tabindex="0" role="button" class="btn btn-sm btn-ghost btn-square tooltip tooltip-bottom bg-transparent border-none !text-white hover:bg-white/10 hover:!text-white" :data-tip="t('editor.properties.background')">
        <Palette class="w-5 h-5" />
      </div>
      <div tabindex="0" class="dropdown-content z-[9999] menu p-4 shadow-xl bg-neutral-950 text-white rounded-box w-80 border border-white/10 mt-2">
        <h3 class="font-bold mb-4 text-sm">{{ t('editor.properties.background') }}</h3>
        <div class="grid grid-cols-4 gap-2 mb-4">
          <div v-for="(bg, i) in [
            { v: '#ffffff', s: 'background-color:#ffffff' },
            { v: 'transparent', s: '' },
            { v: 'linear-gradient(135deg,#4158D0 0%,#C850C0 46%,#FFCC70 100%)', s: 'background:linear-gradient(135deg,#4158D0 0%,#C850C0 46%,#FFCC70 100%)' },
            { v: 'linear-gradient(135deg,#0093E9 0%,#80D0C7 100%)', s: 'background:linear-gradient(135deg,#0093E9 0%,#80D0C7 100%)' },
            { v: 'linear-gradient(135deg,#8EC5FC 0%,#E0C3FC 100%)', s: 'background:linear-gradient(135deg,#8EC5FC 0%,#E0C3FC 100%)' },
            { v: 'linear-gradient(135deg,#667eea 0%,#764ba2 100%)', s: 'background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)' },
            { v: 'linear-gradient(135deg,#85FFBD 0%,#FFFB7D 100%)', s: 'background:linear-gradient(135deg,#85FFBD 0%,#FFFB7D 100%)' },
            { v: 'linear-gradient(135deg,#0f172a 0%,#334155 100%)', s: 'background:linear-gradient(135deg,#0f172a 0%,#334155 100%)' },
          ]" :key="i"
            class="w-10 h-10 rounded-lg cursor-pointer border-2 transition-all hover:scale-105 relative overflow-hidden"
            :class="!shaderEnabled && background === bg.v ? 'border-white shadow-lg shadow-white/20' : 'border-white/10 hover:border-white/40'"
            :style="bg.s"
            @click="shaderEnabled = false; background = bg.v; backgroundImage = null"
          >
            <div v-if="bg.v === 'transparent'" class="absolute inset-0 bg-checkered opacity-50" />
          </div>
        </div>
        <div class="divider my-2 before:bg-white/10 after:bg-white/10" />
        <div class="form-control">
          <label class="label p-0 pb-1"><span class="label-text text-white/70 text-xs">{{ t('editor.properties.background_blur') }}</span></label>
          <input type="range" min="0" max="20" v-model="backgroundBlur" class="range range-xs range-ghost mt-2" />
        </div>
        <div class="divider my-2 before:bg-white/10 after:bg-white/10" />
        <div class="form-control">
          <label class="label p-0 pb-1"><span class="label-text text-white/70 text-xs">{{ t('editor.properties.image') }}</span></label>
          <input type="file" accept="image/*" class="file-input file-input-bordered file-input-xs w-full mt-2 bg-black/50 border-white/10 text-white" @change="handleImageUpload" />
        </div>
      </div>
    </div>

    <!-- Shader Background -->
    <div class="dropdown dropdown-end" @mousedown.stop>
      <div tabindex="0" role="button"
        class="btn btn-sm btn-ghost btn-square tooltip tooltip-bottom border-none hover:bg-white/10"
        :class="shaderEnabled ? '!text-violet-400 bg-violet-500/10' : '!text-white bg-transparent'"
        :data-tip="t('editor.properties.shader_bg')"
      >
        <Sparkles class="w-5 h-5" />
      </div>

      <!-- Shader panel — component-based layers -->
      <div tabindex="0" class="dropdown-content z-[9999] shadow-xl bg-neutral-950 text-white rounded-box w-72 border border-white/10 mt-2 overflow-hidden">

        <!-- Header -->
        <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span class="text-sm font-semibold">{{ t('editor.properties.shader_bg') }}</span>
          <div class="flex items-center gap-3">
            <button class="text-xs text-white/40 hover:text-white/70 transition-colors" @click="resetShaderParams">{{ t('editor.properties.shader_reset') }}</button>
            <button class="text-white/40 hover:text-violet-400 transition-colors" :title="t('editor.properties.shader_randomize')" @click="randomizeShader">
              <Shuffle class="w-3.5 h-3.5" />
            </button>
            <input type="checkbox" class="toggle toggle-xs transition-colors duration-200 border-none bg-white/10 [--tglbg:theme(colors.white)] hover:bg-white/20 checked:bg-white checked:hover:bg-white/90 checked:[--tglbg:theme(colors.black)]" :checked="shaderEnabled" @change="toggleShader" />
          </div>
        </div>

        <!-- Global speed + base color -->
        <div class="px-4 py-3 border-b border-white/5 space-y-3">
          <div>
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs text-white/50">{{ t('editor.properties.shader_speed') }}</span>
              <span class="text-xs text-white/40 font-mono">{{ sp.speed.toFixed(1) }}</span>
            </div>
            <input type="range" min="0.1" max="3" step="0.1" v-model.number="ensureParams().speed" class="range range-xs w-full [--range-bg:rgba(255,255,255,0.15)] [--range-thumb:#ffffff]" />
          </div>
          <div class="flex items-center justify-between">
            <span class="text-xs text-white/50">{{ t('editor.properties.shader_base_color') }}</span>
            <input type="color" v-model="ensureParams().baseColor" class="w-10 h-7 rounded cursor-pointer bg-transparent border border-white/10 p-0.5" />
          </div>
        </div>

        <!-- Layer list -->
        <div class="divide-y divide-white/5">

          <!-- Blob 1 -->
          <div>
            <button class="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors" @click="toggleLayer('blob1')">
              <div class="flex items-center gap-2">
                <input type="checkbox" class="checkbox checkbox-xs border-white/40 checked:bg-white checked:border-white checked:text-black" v-model="ensureParams().blob1.enabled" @click.stop />
                <span class="text-xs font-medium" :class="sp.blob1.enabled ? 'text-white' : 'text-white/40'">Blob 1</span>
              </div>
              <component :is="openLayer === 'blob1' ? ChevronDown : ChevronRight" class="w-3.5 h-3.5 text-white/30" />
            </button>
            <div v-if="openLayer === 'blob1'" class="px-4 pb-3 space-y-3">
              <div class="flex gap-3">
                <div class="flex-1">
                  <div class="text-[10px] text-white/40 mb-1">{{ t('editor.properties.shader_color_a') }}</div>
                  <input type="color" v-model="ensureParams().blob1.colorA" class="w-full h-8 rounded cursor-pointer bg-transparent border border-white/10 p-0.5" />
                </div>
                <div class="flex-1">
                  <div class="text-[10px] text-white/40 mb-1">{{ t('editor.properties.shader_color_b') }}</div>
                  <input type="color" v-model="ensureParams().blob1.colorB" class="w-full h-8 rounded cursor-pointer bg-transparent border border-white/10 p-0.5" />
                </div>
              </div>
              <div>
                <div class="flex justify-between text-[10px] text-white/40 mb-1">
                  <span>{{ t('editor.properties.shader_size') }}</span><span class="font-mono">{{ sp.blob1.size.toFixed(1) }}</span>
                </div>
                <input type="range" min="0.2" max="2" step="0.05" v-model.number="ensureParams().blob1.size" class="range range-xs w-full [--range-bg:rgba(255,255,255,0.15)] [--range-thumb:#ffffff]" />
              </div>
              <div>
                <div class="flex justify-between text-[10px] text-white/40 mb-1">
                  <span>{{ t('editor.properties.shader_deformation') }}</span><span class="font-mono">{{ sp.blob1.deformation.toFixed(1) }}</span>
                </div>
                <input type="range" min="0" max="3" step="0.1" v-model.number="ensureParams().blob1.deformation" class="range range-xs w-full [--range-bg:rgba(255,255,255,0.15)] [--range-thumb:#ffffff]" />
              </div>
            </div>
          </div>

          <!-- Blob 2 -->
          <div>
            <button class="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors" @click="toggleLayer('blob2')">
              <div class="flex items-center gap-2">
                <input type="checkbox" class="checkbox checkbox-xs border-white/40 checked:bg-white checked:border-white checked:text-black" v-model="ensureParams().blob2.enabled" @click.stop />
                <span class="text-xs font-medium" :class="sp.blob2.enabled ? 'text-white' : 'text-white/40'">Blob 2</span>
              </div>
              <component :is="openLayer === 'blob2' ? ChevronDown : ChevronRight" class="w-3.5 h-3.5 text-white/30" />
            </button>
            <div v-if="openLayer === 'blob2'" class="px-4 pb-3 space-y-3">
              <div class="flex gap-3">
                <div class="flex-1">
                  <div class="text-[10px] text-white/40 mb-1">{{ t('editor.properties.shader_color_a') }}</div>
                  <input type="color" v-model="ensureParams().blob2.colorA" class="w-full h-8 rounded cursor-pointer bg-transparent border border-white/10 p-0.5" />
                </div>
                <div class="flex-1">
                  <div class="text-[10px] text-white/40 mb-1">{{ t('editor.properties.shader_color_b') }}</div>
                  <input type="color" v-model="ensureParams().blob2.colorB" class="w-full h-8 rounded cursor-pointer bg-transparent border border-white/10 p-0.5" />
                </div>
              </div>
              <div>
                <div class="flex justify-between text-[10px] text-white/40 mb-1">
                  <span>{{ t('editor.properties.shader_size') }}</span><span class="font-mono">{{ sp.blob2.size.toFixed(1) }}</span>
                </div>
                <input type="range" min="0.2" max="2" step="0.05" v-model.number="ensureParams().blob2.size" class="range range-xs w-full [--range-bg:rgba(255,255,255,0.15)] [--range-thumb:#ffffff]" />
              </div>
              <div>
                <div class="flex justify-between text-[10px] text-white/40 mb-1">
                  <span>{{ t('editor.properties.shader_deformation') }}</span><span class="font-mono">{{ sp.blob2.deformation.toFixed(1) }}</span>
                </div>
                <input type="range" min="0" max="3" step="0.1" v-model.number="ensureParams().blob2.deformation" class="range range-xs w-full [--range-bg:rgba(255,255,255,0.15)] [--range-thumb:#ffffff]" />
              </div>
            </div>
          </div>

          <!-- Swirl -->
          <div>
            <button class="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors" @click="toggleLayer('swirl')">
              <div class="flex items-center gap-2">
                <input type="checkbox" class="checkbox checkbox-xs border-white/40 checked:bg-white checked:border-white checked:text-black" v-model="ensureParams().swirl.enabled" @click.stop />
                <span class="text-xs font-medium" :class="sp.swirl.enabled ? 'text-white' : 'text-white/40'">Swirl</span>
              </div>
              <component :is="openLayer === 'swirl' ? ChevronDown : ChevronRight" class="w-3.5 h-3.5 text-white/30" />
            </button>
            <div v-if="openLayer === 'swirl'" class="px-4 pb-3 space-y-3">
              <div>
                <div class="flex justify-between text-[10px] text-white/40 mb-1">
                  <span>{{ t('editor.properties.shader_strength') }}</span><span class="font-mono">{{ sp.swirl.strength.toFixed(1) }}</span>
                </div>
                <input type="range" min="0" max="3" step="0.1" v-model.number="ensureParams().swirl.strength" class="range range-xs w-full [--range-bg:rgba(255,255,255,0.15)] [--range-thumb:#ffffff]" />
              </div>
              <div>
                <div class="flex justify-between text-[10px] text-white/40 mb-1">
                  <span>{{ t('editor.properties.shader_speed') }}</span><span class="font-mono">{{ sp.swirl.speed.toFixed(1) }}</span>
                </div>
                <input type="range" min="0.1" max="2" step="0.1" v-model.number="ensureParams().swirl.speed" class="range range-xs w-full [--range-bg:rgba(255,255,255,0.15)] [--range-thumb:#ffffff]" />
              </div>
            </div>
          </div>

          <!-- Halftone -->
          <div>
            <button class="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors" @click="toggleLayer('halftone')">
              <div class="flex items-center gap-2">
                <input type="checkbox" class="checkbox checkbox-xs border-white/40 checked:bg-white checked:border-white checked:text-black" v-model="ensureParams().halftone.enabled" @click.stop />
                <span class="text-xs font-medium" :class="sp.halftone.enabled ? 'text-white' : 'text-white/40'">{{ t('editor.properties.shader_halftone') }}</span>
              </div>
              <component :is="openLayer === 'halftone' ? ChevronDown : ChevronRight" class="w-3.5 h-3.5 text-white/30" />
            </button>
            <div v-if="openLayer === 'halftone'" class="px-4 pb-3 space-y-3">
              <div>
                <div class="flex justify-between text-[10px] text-white/40 mb-1">
                  <span>{{ t('editor.properties.shader_strength') }}</span><span class="font-mono">{{ sp.halftone.strength.toFixed(2) }}</span>
                </div>
                <input type="range" min="0" max="1" step="0.01" v-model.number="ensureParams().halftone.strength" class="range range-xs w-full [--range-bg:rgba(255,255,255,0.15)] [--range-thumb:#ffffff]" />
              </div>
              <div>
                <div class="flex justify-between text-[10px] text-white/40 mb-1">
                  <span>{{ t('editor.properties.shader_size') }}</span><span class="font-mono">{{ sp.halftone.size.toFixed(1) }}</span>
                </div>
                <input type="range" min="2" max="20" step="0.5" v-model.number="ensureParams().halftone.size" class="range range-xs w-full [--range-bg:rgba(255,255,255,0.15)] [--range-thumb:#ffffff]" />
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>

    <!-- Shadow -->
    <div class="dropdown dropdown-end" @mousedown.stop>
      <div tabindex="0" role="button" class="btn btn-sm btn-ghost btn-square tooltip tooltip-bottom bg-transparent border-none !text-white hover:bg-white/10 hover:!text-white" :data-tip="t('editor.properties.shadow')">
        <Layers class="w-5 h-5" />
      </div>
      <div tabindex="0" class="dropdown-content z-[9999] menu p-4 shadow-xl bg-neutral-950 text-white rounded-box w-72 border border-white/10 mt-2">
        <h3 class="font-bold mb-2">{{ t('editor.properties.shadow') }}</h3>
        <div class="form-control mb-2">
          <label class="label p-0 pb-1"><span class="label-text-alt text-white/70">{{ t('editor.properties.opacity') }}</span></label>
          <input type="range" min="0" max="1" step="0.05" v-model.number="shadowOpacity" class="range range-xs" />
        </div>
        <div class="form-control mb-2">
          <label class="label p-0 pb-1"><span class="label-text-alt text-white/70">{{ t('editor.properties.blur') }}: {{ shadowBlur }}px</span></label>
          <input type="range" min="0" max="100" v-model.number="shadowBlur" class="range range-xs" />
        </div>
        <div class="form-control mb-2">
          <label class="label p-0 pb-1"><span class="label-text-alt text-white/70">{{ t('editor.properties.spread') }}: {{ shadowSpread }}px</span></label>
          <input type="range" min="-20" max="50" v-model.number="shadowSpread" class="range range-xs" />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div class="form-control">
            <label class="label p-0 pb-1"><span class="label-text-alt text-white/70">{{ t('editor.properties.x') }}: {{ shadowX }}</span></label>
            <input type="range" min="-50" max="50" v-model.number="shadowX" class="range range-xs" />
          </div>
          <div class="form-control">
            <label class="label p-0 pb-1"><span class="label-text-alt text-white/70">{{ t('editor.properties.y') }}: {{ shadowY }}</span></label>
            <input type="range" min="-50" max="50" v-model.number="shadowY" class="range range-xs" />
          </div>
        </div>
      </div>
    </div>

    <!-- Dimensions -->
    <div class="dropdown dropdown-end" @mousedown.stop>
      <div tabindex="0" role="button" class="btn btn-sm btn-ghost btn-square tooltip tooltip-bottom bg-transparent border-none !text-white hover:bg-white/10 hover:!text-white" :data-tip="t('editor.properties.dimensions')">
        <Maximize class="w-5 h-5" />
      </div>
      <div tabindex="0" class="dropdown-content z-[9999] menu p-4 shadow-xl bg-neutral-950 text-white rounded-box w-64 border border-white/10 mt-2">
        <h3 class="font-bold mb-2">{{ t('editor.properties.dimensions') }}</h3>
        <div class="form-control mb-2">
          <label class="label p-0 pb-1"><span class="label-text-alt text-white/70">{{ t('editor.properties.padding') }}: {{ padding }}px</span></label>
          <input type="range" min="0" max="100" v-model.number="padding" class="range range-xs" />
        </div>
        <div class="form-control">
          <label class="label p-0 pb-1"><span class="label-text-alt text-white/70">{{ t('editor.properties.border_radius') }}: {{ borderRadius }}px</span></label>
          <input type="range" min="0" max="50" v-model.number="borderRadius" class="range range-xs" />
        </div>
      </div>
    </div>

    <div class="w-[1px] h-6 bg-white/10 mx-1 pointer-events-none" />
  </div>
</template>

<style scoped>
.bg-checkered {
  background-image:
    linear-gradient(45deg, #ccc 25%, transparent 25%),
    linear-gradient(-45deg, #ccc 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #ccc 75%),
    linear-gradient(-45deg, transparent 75%, #ccc 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
}
</style>
