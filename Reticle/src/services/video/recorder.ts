import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { info, error as logError } from '@tauri-apps/plugin-log';

export type RecordingTarget = 'screen' | 'window' | 'area';

export interface AudioDevice {
  name: string;
  is_default: boolean;
}

export interface WebcamDevice {
  name: string;
  index: number;
}

export interface CodecInfo {
  id: string;
  name: string;
}

export interface VideoStatus {
  status: 'recording' | 'stopped' | 'idle';
  duration_sec: number;
}

export interface VideoError {
  error: string;
}

export interface MicLevelEvent {
  level: number;
}

class VideoRecorderService {
  private static instance: VideoRecorderService;
  private unlistenStatus: UnlistenFn | null = null;
  private unlistenError: UnlistenFn | null = null;
  private unlistenMic: UnlistenFn | null = null;

  // Event callbacks
  private statusListeners: Set<(status: VideoStatus) => void> = new Set();
  private errorListeners: Set<(error: VideoError) => void> = new Set();
  private micLevelListeners: Set<(level: number) => void> = new Set();

  private constructor() {
    this.initListeners();
  }

  public static getInstance(): VideoRecorderService {
    if (!VideoRecorderService.instance) {
      VideoRecorderService.instance = new VideoRecorderService();
    }
    return VideoRecorderService.instance;
  }

  private async initListeners() {
    // Cleanup previous listeners if any (singleton, so unlikely, but good practice)
    if (this.unlistenStatus) {
      // unlisten is a function returning void or promise?
      // Tauri v2 listen returns a promise resolving to unlisten function
      // But here we await it.
      const unlisten = this.unlistenStatus as unknown as () => void;
      unlisten();
    }

    if (this.unlistenError) {
      const unlisten = this.unlistenError as unknown as () => void;
      unlisten();
    }

    if (this.unlistenMic) {
      const unlisten = this.unlistenMic as unknown as () => void;
      unlisten();
    }

    // Note: Tauri v2 listen returns Promise<UnlistenFn>
    this.unlistenStatus = await listen<VideoStatus>('video-status', (event) => {
      this.statusListeners.forEach(cb => cb(event.payload));
    });

    this.unlistenError = await listen<VideoError>('video-error', (event) => {
      logError(`[VideoRecorder] Error: ${event.payload.error}`);
      this.errorListeners.forEach(cb => cb(event.payload));
    });

    this.unlistenMic = await listen<MicLevelEvent>('mic-level', (event) => {
      this.micLevelListeners.forEach(cb => cb(event.payload.level));
    });
  }

  public onStatusChange(callback: (status: VideoStatus) => void) {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  public onError(callback: (error: VideoError) => void) {
    this.errorListeners.add(callback);
    return () => this.errorListeners.delete(callback);
  }

  public onMicLevel(callback: (level: number) => void) {
    this.micLevelListeners.add(callback);
    return () => this.micLevelListeners.delete(callback);
  }

  public async start(
    target: RecordingTarget,
    id?: string,
    fps: number = 30,
    warmup: boolean = false,
    micDevice?: string,
    enableMic: boolean = true,
    enableSys: boolean = true,
    captureCursor: boolean = true,
    webcamDevice?: string,
    enableWebcam: boolean = false,
    videoCodec?: string,
    videoOutputDir?: string
  ): Promise<void> {
    info(`[VideoRecorder] Starting: target=${target} id=${id} fps=${fps}`);
    await invoke('start_recording', {
      target,
      id,
      fps,
      warmup,
      micDevice,
      enableMic,
      enableSys,
      captureCursor,
      webcamDevice,
      enableWebcam,
      videoCodec,
      videoOutputDir
    });
  }

  public async getAudioDevices(): Promise<AudioDevice[]> {
    return await invoke('get_audio_devices');
  }

  public async getWebcams(): Promise<WebcamDevice[]> {
    return await invoke('get_webcams');
  }

  public async getAvailableCodecs(): Promise<CodecInfo[]> {
    return await invoke('get_available_codecs');
  }

  public async confirm(): Promise<void> {
    info('[VideoRecorder] Confirming recording start');
    await invoke('confirm_recording');
  }

  public async pause(): Promise<void> {
    info('[VideoRecorder] Pausing');
    await invoke('pause_recording');
  }

  public async resume(): Promise<void> {
    info('[VideoRecorder] Resuming');
    await invoke('resume_recording');
  }

  public async setMicMuted(muted: boolean): Promise<void> {
    info(`[VideoRecorder] Set mic muted: ${muted}`);
    await invoke('set_mic_muted', { muted });
  }

  public async setSysMuted(muted: boolean): Promise<void> {
    info(`[VideoRecorder] Set sys muted: ${muted}`);
    await invoke('set_sys_muted', { muted });
  }

  public async stop(): Promise<void> {
    info('[VideoRecorder] Stopping');
    await invoke('stop_recording');
  }

  public async startAudioPreview(deviceName?: string): Promise<void> {
    return invoke('start_audio_preview', { deviceName });
  }

  public async stopAudioPreview(): Promise<void> {
    return invoke('stop_audio_preview');
  }
}

export const videoRecorder = VideoRecorderService.getInstance();
