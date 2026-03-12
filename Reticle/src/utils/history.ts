import type { useHistoryStore } from '../stores/history';

type HistoryStore = ReturnType<typeof useHistoryStore>;

/**
 * Save a Blob URL to the screenshot history store.
 * Fetches the blob from the URL and adds it to history.
 */
export async function saveUrlToHistory(url: string, historyStore: HistoryStore): Promise<void> {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        await historyStore.addToHistory(blob);
    } catch (e) {
        console.error('Failed to save to history:', e);
    }
}
