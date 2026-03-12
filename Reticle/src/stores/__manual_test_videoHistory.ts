/**
 * Manual test file for videoHistory store
 * This file can be used to manually verify the store functionality
 * 
 * To test:
 * 1. Import this in main.ts temporarily
 * 2. Run the app
 * 3. Check console for test results
 */

import { useVideoHistoryStore } from './videoHistory';
import type { VideoSession } from './videoEditor';

export async function testVideoHistoryStore() {
  console.log('=== Testing Video History Store ===');
  
  const store = useVideoHistoryStore();
  
  // Wait for initialization
  await new Promise(resolve => {
    const checkInit = setInterval(() => {
      if (store.initialized) {
        clearInterval(checkInit);
        resolve(true);
      }
    }, 100);
  });
  
  console.log('✓ Store initialized');
  console.log('Initial history length:', store.videoHistory.length);
  
  // Test 1: Check if history is an array
  if (!Array.isArray(store.videoHistory)) {
    console.error('✗ videoHistory is not an array');
    return;
  }
  console.log('✓ videoHistory is an array');
  
  // Test 2: Check if blobUrls is an object
  if (typeof store.blobUrls !== 'object') {
    console.error('✗ blobUrls is not an object');
    return;
  }
  console.log('✓ blobUrls is an object');
  
  // Test 3: Verify all items have required fields
  const requiredFields = [
    'id', 'videoPath', 'audioSystemPath', 'audioMicPath', 
    'trackingPath', 'thumbnail', 'timestamp', 'fps', 
    'duration', 'width', 'height'
  ];
  
  for (const item of store.videoHistory) {
    for (const field of requiredFields) {
      if (!(field in item)) {
        console.error(`✗ Item ${item.id} missing field: ${field}`);
        return;
      }
    }
    
    // Verify thumbnail is a Blob
    if (!(item.thumbnail instanceof Blob)) {
      console.error(`✗ Item ${item.id} thumbnail is not a Blob`);
      return;
    }
    
    // Verify blob URL exists
    if (!store.blobUrls[item.id]) {
      console.error(`✗ Item ${item.id} missing blob URL`);
      return;
    }
    
    // Verify blob URL format
    if (!store.blobUrls[item.id].startsWith('blob:')) {
      console.error(`✗ Item ${item.id} blob URL has invalid format`);
      return;
    }
  }
  console.log('✓ All items have required fields and valid thumbnails');
  
  // Test 4: Verify history is sorted by timestamp (newest first)
  for (let i = 0; i < store.videoHistory.length - 1; i++) {
    if (store.videoHistory[i].timestamp < store.videoHistory[i + 1].timestamp) {
      console.error('✗ History is not sorted correctly (newest first)');
      return;
    }
  }
  console.log('✓ History is sorted correctly (newest first)');
  
  // Test 5: Verify history length is <= 5
  if (store.videoHistory.length > 5) {
    console.error('✗ History length exceeds 5 items');
    return;
  }
  console.log('✓ History length is within limit (<=5)');
  
  console.log('=== All basic tests passed! ===');
  console.log('Store state:', {
    historyLength: store.videoHistory.length,
    blobUrlsCount: Object.keys(store.blobUrls).length,
    initialized: store.initialized
  });
}

/**
 * Test adding a mock video session
 * Note: This requires actual video files to exist, so it's commented out
 */
export async function testAddToHistory() {
  console.log('=== Testing addToHistory ===');
  
  const store = useVideoHistoryStore();
  
  // Mock session - would need real files to work
  const mockSession: VideoSession = {
    videoPath: 'C:/test/video.mp4',
    audioSystemPath: 'C:/test/audio_system.wav',
    audioMicPath: 'C:/test/audio_mic.wav',
    trackingPath: 'C:/test/tracking.json',
    fps: 30,
    captureOffsetX: 0,
    captureOffsetY: 0,
    captureWidth: 1920,
    captureHeight: 1080
  };
  
  try {
    const lengthBefore = store.videoHistory.length;
    await store.addToHistory(mockSession);
    const lengthAfter = store.videoHistory.length;
    
    if (lengthAfter !== lengthBefore + 1) {
      console.error('✗ History length did not increase by 1');
      return;
    }
    console.log('✓ Item added to history');
    
    // Verify the new item is at the beginning (newest first)
    const newItem = store.videoHistory[0];
    if (newItem.videoPath !== mockSession.videoPath) {
      console.error('✗ New item is not at the beginning of history');
      return;
    }
    console.log('✓ New item is at the beginning of history');
    
    console.log('=== addToHistory test passed! ===');
  } catch (e) {
    console.error('✗ addToHistory failed:', e);
  }
}
