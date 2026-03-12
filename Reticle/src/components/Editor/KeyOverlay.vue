<script setup lang="ts">
import { computed } from 'vue';
import { useVideoEditorStore } from '../../stores/videoEditor';
import type { TrackingEvent } from '../../stores/videoEditor';

const props = defineProps<{
  activeKeys: TrackingEvent[];
  visible: boolean;
}>();

const videoEditor = useVideoEditorStore();

const SHIFT_MAP: Record<string, string> = {
  '1': '!', '2': '@', '3': '#', '4': '$', '5': '%',
  '6': '^', '7': '&', '8': '*', '9': '(', '0': ')',
  '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|',
  ';': ':', "'": '"', ',': '<', '.': '>', '/': '?', '`': '~'
};

  // Group keys that are pressed together or in quick succession
const uniqueKeys = computed(() => {
  if (props.activeKeys.length === 0) return [];

  // Sort events by timestamp ascending (oldest first = natural typing order)
  const sorted = [...props.activeKeys].sort((a, b) => a.timestamp - b.timestamp);
  
  const newestTime = sorted[sorted.length - 1].timestamp;
  const windowMs = 300;
  
  // Filter to events within time window
  const recentEvents = sorted.filter(k => newestTime - k.timestamp < windowMs);
  
  // Collect modifiers and keys in chronological order
  const modifiers = new Set<string>();
  // Use Map to preserve insertion order (chronological)
  const keysOrdered = new Map<string, number>(); // key -> timestamp
  
  recentEvents.forEach(event => {
    if (event.modifiers) {
      event.modifiers.forEach(m => {
        if (m === 'Control') modifiers.add('Ctrl');
        else if (m === 'Shift') modifiers.add('Shift');
        else if (m === 'Alt') modifiers.add('Alt');
        else if (m === 'Meta') modifiers.add('Win');
        else modifiers.add(m);
      });
    }
    
    if (event.key) {
      let keyName = event.key;
      if (keyName === 'Control' || keyName === 'Ctrl') modifiers.add('Ctrl');
      else if (keyName === 'Shift') modifiers.add('Shift');
      else if (keyName === 'Alt') modifiers.add('Alt');
      else if (keyName === 'Meta' || keyName === 'Win') modifiers.add('Win');
      else {
        if (keyName.length === 1) keyName = keyName.toUpperCase();
        // Only add if not already present (keep first occurrence = chronological order)
        if (!keysOrdered.has(keyName)) {
          keysOrdered.set(keyName, event.timestamp);
        }
      }
    }
  });
  
  // Construct display list: modifiers first (fixed order), then keys in typing order
  const result: string[] = [];
  
  if (modifiers.has('Ctrl')) result.push('Ctrl');
  if (modifiers.has('Alt')) result.push('Alt');
  if (modifiers.has('Shift')) result.push('Shift');
  if (modifiers.has('Win')) result.push('Win');
  
  // Keys in chronological order (Map preserves insertion order)
  for (const [k] of keysOrdered) {
    if (modifiers.has('Shift') && SHIFT_MAP[k]) {
      result.push(SHIFT_MAP[k]);
    } else {
      result.push(k);
    }
  }
  
  return result;
});

const show = computed(() => props.visible && uniqueKeys.value.length > 0);

// ---- Styling Logic ----

const containerStyle = computed(() => {
  const pos = videoEditor.keyOverlayPosition;
  const size = videoEditor.keyOverlaySize;
  
  const style: Record<string, string> = {};

  // Position
  switch (pos) {
    case 'top-left':
      style.top = '10%';
      style.left = '5%';
      break;
    case 'top-right':
      style.top = '10%';
      style.right = '5%';
      break;
    case 'bottom-left':
      style.bottom = '10%';
      style.left = '5%';
      break;
    case 'bottom-right':
      style.bottom = '10%';
      style.right = '5%';
      break;
    case 'bottom-center':
    default:
      style.bottom = '10%';
      style.left = '50%';
      style.transform = 'translateX(-50%)'; // Will be merged with scale
      break;
  }

  // Size (Scale)
  let scale = 1;
  if (size === 'small') scale = 0.8;
  if (size === 'large') scale = 1.2;

  if (style.transform) {
    style.transform += ` scale(${scale})`;
  } else {
    style.transform = `scale(${scale})`;
  }
  
  // Color Theme Background
  const theme = videoEditor.keyOverlayColor;
  if (theme === 'light') {
    style.background = 'rgba(0, 0, 0, 0.6)';
    style.borderColor = 'rgba(255, 255, 255, 0.1)';
    style.color = '#fff';
  } else if (theme === 'dark') {
    style.background = 'rgba(255, 255, 255, 0.8)';
    style.borderColor = 'rgba(0, 0, 0, 0.1)';
    style.color = '#000';
  } else if (theme === 'accent') {
    style.background = 'rgba(0, 0, 0, 0.8)';
    style.borderColor = 'rgba(0, 150, 255, 0.3)';
    style.color = '#fff';
  }

  return style;
});

const kbdClass = computed(() => {
  return `kbd-${videoEditor.keyOverlayColor}`;
});

</script>

<template>
  <Transition name="fade-slide">
    <div v-if="show" class="key-overlay" :style="containerStyle">
      <div v-for="(k, i) in uniqueKeys" :key="k" class="key-item">
        <span v-if="i > 0" class="plus">+</span>
        <kbd class="kbd" :class="kbdClass">{{ k }}</kbd>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.key-overlay {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  backdrop-filter: blur(8px);
  border-radius: 12px;
  border: 1px solid transparent; /* Set in JS */
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 200;
  pointer-events: none;
  transform-origin: center center;
}

.key-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.plus {
  font-weight: 600;
  font-size: 14px;
  opacity: 0.6;
}

.kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  font-family: 'Roboto Mono', monospace;
  font-weight: 700;
  font-size: 14px;
  text-transform: uppercase;
}

/* Themes for Keys */

/* Light Theme: White keys on dark bg */
.kbd-light {
  background: linear-gradient(180deg, #ffffff 0%, #e0e0e0 100%);
  color: #333;
  box-shadow: 0 2px 0 #bbb, 0 3px 4px rgba(0,0,0,0.2);
}

/* Dark Theme: Dark keys on light bg */
.kbd-dark {
  background: linear-gradient(180deg, #444 0%, #222 100%);
  color: #eee;
  box-shadow: 0 2px 0 #000, 0 3px 4px rgba(0,0,0,0.2);
}

/* Accent Theme: Blue keys on dark bg */
.kbd-accent {
  background: linear-gradient(180deg, #4facfe 0%, #00f2fe 100%);
  color: #003;
  box-shadow: 0 2px 0 #0077aa, 0 3px 4px rgba(0,0,0,0.2);
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.95); /* simplified transform for transition */
}
</style>
