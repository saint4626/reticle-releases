import { defineStore } from 'pinia';
import { ref, watch, toRaw } from 'vue';
import { get, set } from 'idb-keyval';

export interface HistoryItem {
  id: string;
  data: Blob;
  timestamp: number;
}

export const useHistoryStore = defineStore('history', () => {
  const history = ref<HistoryItem[]>([]);
  const initialized = ref(false);

  // Initialize: Load from IDB
  async function init() {
    try {
      // Clear old localStorage data to fix QuotaExceededError
      if (localStorage.getItem('app_screenshot_history')) {
        localStorage.removeItem('app_screenshot_history');
      }

      const stored = await get<HistoryItem[]>('app_screenshot_history');
      if (stored && Array.isArray(stored)) {
        history.value = stored;
      }
    } catch (e) {
      console.error('Failed to load history from IDB:', e);
    } finally {
      initialized.value = true;
    }
  }

  // Save to IDB whenever history changes
  watch(history, async (newVal) => {
    if (!initialized.value) return;
    
    try {
      // idb-keyval uses Structured Clone, so it supports Blobs directly
      // We must unwrap Vue proxies using toRaw to avoid DataCloneError
      const rawData = toRaw(newVal).map(item => toRaw(item));
      await set('app_screenshot_history', rawData);
    } catch (e) {
      console.error('Failed to save history to IDB:', e);
    }
  }, { deep: true });

  function addToHistory(data: Blob) {
    const newItem: HistoryItem = {
      id: crypto.randomUUID(),
      data,
      timestamp: Date.now(),
    };
    
    history.value.unshift(newItem);
    
    if (history.value.length > 5) {
      history.value = history.value.slice(0, 5);
    }
  }

  function removeFromHistory(id: string) {
    history.value = history.value.filter(item => item.id !== id);
  }

  // Start init
  init();

  return {
    history,
    addToHistory,
    removeFromHistory
  };
});
