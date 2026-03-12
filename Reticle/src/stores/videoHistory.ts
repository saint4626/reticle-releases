import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { get, set } from 'idb-keyval';
import { invoke } from '@tauri-apps/api/core';
import { exists } from '@tauri-apps/plugin-fs';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Thumbnail, VideoSession } from './videoEditor';
import { useVideoEditorStore } from './videoEditor';
import { useNotificationStore } from './notification';
import i18n from '../i18n';

// ---- Types ----

export interface VideoHistoryItem {
  id: string;                    // UUID
  videoPath: string;             // Абсолютный путь к видеофайлу
  audioSystemPath: string;       // Путь к системному аудио
  audioMicPath: string;          // Путь к микрофонному аудио
  trackingPath: string;          // Путь к файлу отслеживания
  thumbnail: Blob;               // Превью (120x90px JPEG)
  timestamp: number;             // Unix timestamp
  fps: number;                   // FPS видео
  duration: number;              // Длительность в секундах
  width: number;                 // Ширина видео
  height: number;                // Высота видео
}

// Serializable version for IDB storage (Blob → ArrayBuffer)
interface VideoHistoryItemSerialized {
  id: string;
  videoPath: string;
  audioSystemPath: string;
  audioMicPath: string;
  trackingPath: string;
  thumbnailData: ArrayBuffer;    // Serialized thumbnail
  thumbnailType: string;         // MIME type
  timestamp: number;
  fps: number;
  duration: number;
  width: number;
  height: number;
}

interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
}

// ---- Store ----

export const useVideoHistoryStore = defineStore('videoHistory', () => {
  // State
  const videoHistory = ref<VideoHistoryItem[]>([]);
  const initialized = ref(false);
  const blobUrls = ref<Record<string, string>>({});  // id -> Blob URL для thumbnails
  let unlistenSession: UnlistenFn | null = null;

  // Initialize: Load from IDB
  async function init() {
    try {
      const stored = await get<VideoHistoryItemSerialized[]>('app_video_history');
      if (stored && Array.isArray(stored)) {
        // Deserialize: Convert ArrayBuffer back to Blob
        videoHistory.value = stored.map(item => ({
          ...item,
          thumbnail: new Blob([item.thumbnailData], { type: item.thumbnailType })
        }));
        
        // Create Blob URLs for thumbnails
        videoHistory.value.forEach(item => {
          if (item.thumbnail instanceof Blob) {
            blobUrls.value[item.id] = URL.createObjectURL(item.thumbnail);
          }
        });
      } else {
      }
    } catch (e) {
      console.error('Failed to load video history from IDB:', e);
    } finally {
      initialized.value = true;
    }

    // Initialize listener for video-session-ready events
    if (!unlistenSession) {
      unlistenSession = await listen<VideoSession>('video-session-ready', async (event) => {
        try {
          await addToHistory(event.payload);
        } catch (e) {
          console.error('Failed to add video to history from event:', e);
          const notify = useNotificationStore();
          const t = i18n.global.t;
          notify.add(t('video_history.save_failed'), 'error');
        }
      });
    }
  }

  // Watch for history changes to manage Blob URLs
  watch(
    () => videoHistory.value,
    (newHistory, oldHistory) => {
      // Skip if this is the initial load (handled by init)
      if (!initialized.value) return;
      
      // Get IDs from old and new history
      const oldIds = new Set(oldHistory?.map(item => item.id) || []);
      const newIds = new Set(newHistory.map(item => item.id));
      
      // Revoke URLs for items that are no longer in history
      oldIds.forEach(id => {
        if (!newIds.has(id) && blobUrls.value[id]) {
          URL.revokeObjectURL(blobUrls.value[id]);
          delete blobUrls.value[id];
        }
      });
      
      // Create URLs for new items
      newHistory.forEach(item => {
        if (!blobUrls.value[item.id] && item.thumbnail instanceof Blob) {
          blobUrls.value[item.id] = URL.createObjectURL(item.thumbnail);
        }
      });
    },
    { deep: true }
  );

  // Generate thumbnail from video file
  async function generateThumbnail(videoPath: string): Promise<Blob> {
    try {
      // Call Tauri command to get video thumbnails (count=1 for first frame)
      const thumbnails = await invoke<Thumbnail[]>('get_video_thumbnails', {
        path: videoPath,
        count: 1,
        thumbWidth: 120
      });
      
      if (!thumbnails || thumbnails.length === 0) {
        throw new Error('No thumbnails generated');
      }
      
      // Convert base64 to Blob
      const base64Data = thumbnails[0].data;
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      return new Blob([byteArray], { type: 'image/jpeg' });
      
    } catch (e) {
      console.warn(`Failed to generate thumbnail for ${videoPath}:`, e);
      // Fallback: create placeholder thumbnail (SVG play icon)
      return createPlaceholderThumbnail();
    }
  }

  // Create placeholder thumbnail (SVG play icon as Blob)
  function createPlaceholderThumbnail(): Blob {
    const svg = `
      <svg width="120" height="90" xmlns="http://www.w3.org/2000/svg">
        <rect width="120" height="90" fill="#1a1a1a"/>
        <circle cx="60" cy="45" r="20" fill="#ffffff" opacity="0.8"/>
        <polygon points="55,35 55,55 70,45" fill="#1a1a1a"/>
      </svg>
    `;
    return new Blob([svg], { type: 'image/svg+xml' });
  }

  // Add video to history
  async function addToHistory(session: VideoSession): Promise<void> {
    const notify = useNotificationStore();
    const t = i18n.global.t;
    
    try {
      // Generate unique ID
      const id = crypto.randomUUID();
      
      // Wait a bit for the video file to be fully written
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Generate thumbnail (handles errors internally with fallback)
      const thumbnail = await generateThumbnail(session.videoPath);
      
      // Get video metadata
      let videoInfo: VideoInfo;
      try {
        videoInfo = await invoke<VideoInfo>('get_video_info', {
          path: session.videoPath
        });
      } catch (e) {
        console.error(`Failed to get video info for ${session.videoPath}:`, e);
        notify.add(t('video_history.save_failed'), 'error');
        throw e;
      }
      // Create history item
      const historyItem: VideoHistoryItem = {
        id,
        videoPath: session.videoPath,
        audioSystemPath: session.audioSystemPath,
        audioMicPath: session.audioMicPath,
        trackingPath: session.trackingPath,
        thumbnail,
        timestamp: Date.now(),
        fps: session.fps,
        duration: videoInfo.duration,
        width: videoInfo.width,
        height: videoInfo.height,
      };
      
      // Add to history array (prepend to keep newest first)
      videoHistory.value.unshift(historyItem);
      
      // Trim history to 5 elements
      if (videoHistory.value.length > 5) {
        // Remove oldest items (from the end)
        // The watch will automatically clean up Blob URLs for removed items
        videoHistory.value.splice(5);
      }
      
      // Save to IDB
      try {
        // Serialize: Convert Blob to ArrayBuffer for IDB storage
        const serializedHistory: VideoHistoryItemSerialized[] = await Promise.all(
          videoHistory.value.map(async (item) => ({
            id: item.id,
            videoPath: item.videoPath,
            audioSystemPath: item.audioSystemPath,
            audioMicPath: item.audioMicPath,
            trackingPath: item.trackingPath,
            thumbnailData: await item.thumbnail.arrayBuffer(),
            thumbnailType: item.thumbnail.type,
            timestamp: item.timestamp,
            fps: item.fps,
            duration: item.duration,
            width: item.width,
            height: item.height,
          }))
        );
        
        await set('app_video_history', serializedHistory);
      } catch (e) {
        console.error(`Failed to save video history to IDB for ${session.videoPath}:`, e);
        // Remove the item we just added since we couldn't persist it
        videoHistory.value.shift();
        notify.add(t('video_history.save_failed'), 'error');
        throw e;
      }
      
    } catch (e) {
      console.error(`Failed to add video to history for ${session.videoPath}:`, e);
      throw e;
    }
  }

  // Cleanup all Blob URLs (call on component unmount)
  function cleanupBlobUrls(): void {
    Object.values(blobUrls.value).forEach(url => {
      URL.revokeObjectURL(url);
    });
    blobUrls.value = {};
  }

  // Cleanup event listener
  function cleanup(): void {
    if (unlistenSession) {
      unlistenSession();
      unlistenSession = null;
    }
    cleanupBlobUrls();
  }

  // Load video into editor
  async function loadIntoEditor(id: string): Promise<void> {
    const notify = useNotificationStore();
    const t = i18n.global.t;
    
    // Find the item by ID
    const item = videoHistory.value.find(i => i.id === id);
    if (!item) {
      console.error(`Video history item not found for ID: ${id}`);
      notify.add(t('video_history.load_failed'), 'error');
      return;
    }
    
    try {
      // Check if video file exists
      const fileExists = await exists(item.videoPath);
      
      if (!fileExists) {
        throw new Error('Video file not found');
      }
      
      // Create VideoSession object
      const session: VideoSession = {
        videoPath: item.videoPath,
        audioSystemPath: item.audioSystemPath,
        audioMicPath: item.audioMicPath,
        trackingPath: item.trackingPath,
        fps: item.fps,
      };
      
      // Load session into video editor
      const videoEditorStore = useVideoEditorStore();
      await videoEditorStore.loadSession(session);
      
    } catch (e) {
      console.error(`Failed to load video into editor (ID: ${id}):`, e);
      notify.add(t('video_history.file_not_found'), 'error');
      
      // Remove from history since file doesn't exist
      await removeFromHistory(id);
    }
  }

  // Remove video from history
  async function removeFromHistory(id: string): Promise<void> {
    const notify = useNotificationStore();
    const t = i18n.global.t;
    
    const item = videoHistory.value.find(i => i.id === id);
    if (!item) {
      console.warn(`Video history item not found for removal (ID: ${id})`);
      return;
    }
    
    try {
      // Call Tauri command to delete video files from disk
      await invoke('delete_video_files', {
        videoPath: item.videoPath,
        audioSystemPath: item.audioSystemPath,
        audioMicPath: item.audioMicPath,
        trackingPath: item.trackingPath,
      });
      
      // Remove from array
      const index = videoHistory.value.findIndex(i => i.id === id);
      if (index !== -1) {
        videoHistory.value.splice(index, 1);
      }
      
      // Save to IDB
      const serializedHistory: VideoHistoryItemSerialized[] = await Promise.all(
        videoHistory.value.map(async (item) => ({
          id: item.id,
          videoPath: item.videoPath,
          audioSystemPath: item.audioSystemPath,
          audioMicPath: item.audioMicPath,
          trackingPath: item.trackingPath,
          thumbnailData: await item.thumbnail.arrayBuffer(),
          thumbnailType: item.thumbnail.type,
          timestamp: item.timestamp,
          fps: item.fps,
          duration: item.duration,
          width: item.width,
          height: item.height,
        }))
      );
      await set('app_video_history', serializedHistory);
      
      // Revoke Blob URL
      if (blobUrls.value[id]) {
        URL.revokeObjectURL(blobUrls.value[id]);
        delete blobUrls.value[id];
      }
      
      // Display success notification
      notify.add(t('video_history.delete_success'), 'success');
      
    } catch (e) {
      console.error(`Failed to delete video files from disk (ID: ${id}):`, e);
      
      // Even if file deletion fails, remove metadata from IDB
      const index = videoHistory.value.findIndex(i => i.id === id);
      if (index !== -1) {
        videoHistory.value.splice(index, 1);
      }
      const serializedHistory: VideoHistoryItemSerialized[] = await Promise.all(
        videoHistory.value.map(async (item) => ({
          id: item.id,
          videoPath: item.videoPath,
          audioSystemPath: item.audioSystemPath,
          audioMicPath: item.audioMicPath,
          trackingPath: item.trackingPath,
          thumbnailData: await item.thumbnail.arrayBuffer(),
          thumbnailType: item.thumbnail.type,
          timestamp: item.timestamp,
          fps: item.fps,
          duration: item.duration,
          width: item.width,
          height: item.height,
        }))
      );
      await set('app_video_history', serializedHistory);
      
      // Revoke Blob URL
      if (blobUrls.value[id]) {
        URL.revokeObjectURL(blobUrls.value[id]);
        delete blobUrls.value[id];
      }
      
      // Display warning notification
      notify.add(t('video_history.delete_files_failed'), 'error');
    }
  }

  return {
    // State
    videoHistory,
    initialized,
    blobUrls,
    
    // Actions
    init,
    generateThumbnail,
    addToHistory,
    cleanupBlobUrls,
    cleanup,
    loadIntoEditor,
    removeFromHistory,
  };
});
