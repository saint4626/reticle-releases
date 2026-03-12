<script setup lang="ts">
import { ref } from 'vue';
import { useStorage } from '@vueuse/core';
import { Check, Info } from 'lucide-vue-next';
import logoUrl from '../assets/logo.svg';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const welcomeShown = useStorage('reticle-welcome-shown', false);
const isVisible = ref(!welcomeShown.value);

function closeWelcome() {
  welcomeShown.value = true;
  isVisible.value = false;
}
</script>

<template>
  <div v-if="isVisible" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" @click.self="closeWelcome">
    <div class="card w-full max-w-lg bg-neutral-950 border border-white/10 shadow-2xl animate-in fade-in zoom-in duration-300">
      <div class="card-body text-center items-center p-8">
        <div class="mb-6 relative">
          <div class="absolute -inset-4 bg-primary/20 rounded-full blur-xl"></div>
          <img :src="logoUrl" alt="Reticle Logo" class="w-20 h-20 relative z-10" />
        </div>
        
        <h2 class="card-title text-3xl font-bold text-white mb-2">{{ t('welcome.title') }}</h2>
        <p class="text-white/60 mb-8 text-lg">
          {{ t('welcome.subtitle') }}
        </p>
        
        <div class="grid grid-cols-2 gap-4 w-full mb-8 text-left">
          <div class="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/5">
            <div class="p-2 bg-white/10 rounded-md text-white">
              <Check class="w-4 h-4" />
            </div>
            <div>
              <h3 class="font-bold text-white text-sm">{{ t('welcome.features.backgrounds.title') }}</h3>
              <p class="text-xs text-white/50">{{ t('welcome.features.backgrounds.desc') }}</p>
            </div>
          </div>
          <div class="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/5">
             <div class="p-2 bg-white/10 rounded-md text-white">
              <Check class="w-4 h-4" />
            </div>
            <div>
              <h3 class="font-bold text-white text-sm">{{ t('welcome.features.annotations.title') }}</h3>
              <p class="text-xs text-white/50">{{ t('welcome.features.annotations.desc') }}</p>
            </div>
          </div>
          <div class="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/5">
             <div class="p-2 bg-white/10 rounded-md text-white">
              <Check class="w-4 h-4" />
            </div>
            <div>
              <h3 class="font-bold text-white text-sm">{{ t('welcome.features.privacy.title') }}</h3>
              <p class="text-xs text-white/50">{{ t('welcome.features.privacy.desc') }}</p>
            </div>
          </div>
          <div class="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/5">
             <div class="p-2 bg-white/10 rounded-md text-white">
              <Check class="w-4 h-4" />
            </div>
            <div>
              <h3 class="font-bold text-white text-sm">{{ t('welcome.features.native.title') }}</h3>
              <p class="text-xs text-white/50">{{ t('welcome.features.native.desc') }}</p>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/5 mb-4">
          <div class="p-2 bg-white/10 rounded-md text-white shrink-0">
            <Info class="w-4 h-4" />
          </div>
          <p class="text-xs text-white/50">{{ t('welcome.tray_hint') }}</p>
        </div>

        <button class="btn btn-ghost border border-white/10 hover:bg-white/10 text-white w-full" @click="closeWelcome">
          {{ t('welcome.start_button') }}
        </button>
      </div>
    </div>
  </div>
</template>
