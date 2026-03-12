import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { useVideoEditorStore } from '../stores/videoEditor';
import { useEditorStore } from '../stores/editor';
import { useNotificationStore } from '../stores/notification';
import { calculateZoomAtTime } from '../utils/zoomCalculator';
import { springEase, DEFAULT_SPRING_CONFIG } from '../utils/zoomCalculator';
import type { ZoomSpringState } from '../utils/zoomCalculator';
import { renderShaderFrame, disposeExportShader } from '../utils/shaderBackground';
import i18n from '../i18n';
import { 
  Input, 
  Output, 
  Conversion,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget, 
  BlobSource,
  ALL_FORMATS,
  QUALITY_VERY_HIGH,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_LOW
} from 'mediabunny';

export interface ExportProgress {
  phase: 'overlay' | 'compositing' | 'done';
  progress: number; // 0-100
  message: string;
}

export interface ExportOptions {
  outputPath: string;
  outputFormat: 'mp4' | 'webm' | 'gif';
  videoCodec: 'avc' | 'vp9' | 'av1' | 'hevc' | 'vp8';
  quality: 'QUALITY_VERY_HIGH' | 'QUALITY_HIGH' | 'QUALITY_MEDIUM' | 'QUALITY_LOW';
  hardwareAcceleration?: 'prefer-hardware' | 'prefer-software' | 'no-preference';
  includeSystemAudio?: boolean;
  includeMicAudio?: boolean;
  // GIF-specific options
  gifFps?: number;
  gifWidth?: number;
}

// Module-level singletons — shared across all useVideoExport() calls
const isExporting = ref(false);
const exportProgress = ref<ExportProgress>({
  phase: 'overlay',
  progress: 0,
  message: ''
});

export function useVideoExport() {
  const videoEditor = useVideoEditorStore();
  const editor = useEditorStore();
  const notification = useNotificationStore();
  const t = i18n.global.t;

  // ---- Pre-sorted keyframes cache ----
  // Avoids [...keyframes].sort() on every frame during export
  let _sortedKfCache: any[] | null = null;
  let _sortedKfSource: any[] | null = null;

  function getSortedKeyframes(keyframes: any[]): any[] {
    if (_sortedKfSource === keyframes) return _sortedKfCache!;
    _sortedKfCache = [...keyframes].sort((a, b) => a.time - b.time);
    _sortedKfSource = keyframes;
    return _sortedKfCache;
  }

  // ---- Cached background canvas ----
  // Background (gradient/solid/image) is static during export — render once to offscreen canvas
  let _bgCanvas: OffscreenCanvas | null = null;
  let _bgCtx: OffscreenCanvasRenderingContext2D | null = null;

  function ensureBgCanvas(w: number, h: number): OffscreenCanvas {
    if (!_bgCanvas || _bgCanvas.width !== w || _bgCanvas.height !== h) {
      _bgCanvas = new OffscreenCanvas(w, h);
      _bgCtx = _bgCanvas.getContext('2d', { alpha: false })!;
    }
    return _bgCanvas;
  }

  function renderBgToCache(
    w: number, h: number,
    parsedBackground: any,
    settings: any,
    backgroundImageEl: HTMLImageElement | null
  ): OffscreenCanvas {
    const canvas = ensureBgCanvas(w, h);
    const ctx = _bgCtx!;

    if (backgroundImageEl) {
      const imgAspect = backgroundImageEl.naturalWidth / backgroundImageEl.naturalHeight;
      const canvasAspect = w / h;
      let sx = 0, sy = 0, sw = backgroundImageEl.naturalWidth, sh = backgroundImageEl.naturalHeight;
      if (imgAspect > canvasAspect) {
        sw = backgroundImageEl.naturalHeight * canvasAspect;
        sx = (backgroundImageEl.naturalWidth - sw) / 2;
      } else {
        sh = backgroundImageEl.naturalWidth / canvasAspect;
        sy = (backgroundImageEl.naturalHeight - sh) / 2;
      }
      if (settings.backgroundBlur > 0) {
        const blurPx = settings.backgroundBlur;
        const overflow = blurPx * 2;
        ctx.save();
        ctx.filter = `blur(${blurPx}px)`;
        ctx.drawImage(backgroundImageEl, sx, sy, sw, sh, -overflow, -overflow, w + overflow * 2, h + overflow * 2);
        ctx.filter = 'none';
        ctx.restore();
      } else {
        ctx.drawImage(backgroundImageEl, sx, sy, sw, sh, 0, 0, w, h);
      }
    } else if (parsedBackground.type === 'gradient') {
      // CSS linear-gradient: 0deg = bottom-to-top, 90deg = left-to-right
      // Canvas: we need to map CSS angle to canvas coordinates
      // CSS angle → canvas: start point is where the gradient begins (opposite of the angle direction)
      const angleRad = (parsedBackground.angle + 90) * Math.PI / 180;
      const x1 = w / 2 - Math.cos(angleRad) * w / 2;
      const y1 = h / 2 - Math.sin(angleRad) * h / 2;
      const x2 = w / 2 + Math.cos(angleRad) * w / 2;
      const y2 = h / 2 + Math.sin(angleRad) * h / 2;
      const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
      parsedBackground.colors.forEach((colorStop: string) => {
        const parts = colorStop.split(/\s+/);
        const color = parts[0];
        const stop = parts[1] ? parseFloat(parts[1]) / 100 : 0;
        gradient.addColorStop(stop, color);
      });
      if (settings.backgroundBlur > 0) ctx.filter = `blur(${settings.backgroundBlur}px)`;
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      if (settings.backgroundBlur > 0) ctx.filter = 'none';
    } else {
      if (settings.backgroundBlur > 0) ctx.filter = `blur(${settings.backgroundBlur}px)`;
      ctx.fillStyle = parsedBackground.color;
      ctx.fillRect(0, 0, w, h);
      if (settings.backgroundBlur > 0) ctx.filter = 'none';
    }

    return canvas;
  }

  // ---- Key rendering ----
  // Key gradients are created per-frame (context-bound), but we avoid sort/filter overhead
  // on activeKeys by using pre-sorted data from motion engine

  function getKeyGrad(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, offsetX: number, keyH: number, bg0: string, bg1: string): CanvasGradient {
    const grad = ctx.createLinearGradient(offsetX, -keyH / 2, offsetX, keyH / 2);
    grad.addColorStop(0, bg0);
    grad.addColorStop(1, bg1);
    return grad;
  }

  /**
   * Main export function using Mediabunny Conversion API
   */
  async function exportVideo(options: ExportOptions, _nested = false): Promise<void> {
    if (!videoEditor.session || !videoEditor.videoInfo) {
      notification.add(t('video_editor.no_video'), 'error');
      return;
    }

    if (!_nested) {
      isExporting.value = true;
    }
    exportProgress.value = { phase: 'overlay', progress: 0, message: t('video_editor.processing_video') };

    // Reset caches for new export
    _bgCanvas = null;
    _bgCtx = null;
    _sortedKfCache = null;
    _sortedKfSource = null;
    disposeExportShader();

    try {
      const { duration, fps } = videoEditor.videoInfo;

      // OPTIMIZATION: Use tauri-plugin-fs readFile — returns Uint8Array directly,
      // no JSON serialization overhead (was: invoke('read_video_file') → Vec<u8> → number[])
      const videoPath = videoEditor.session.videoPath;
      const videoBytes = await readFile(videoPath);
      const blob = new Blob([videoBytes], { type: 'video/mp4' });

      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });

      const qualityMap = {
        'QUALITY_VERY_HIGH': QUALITY_VERY_HIGH,
        'QUALITY_HIGH': QUALITY_HIGH,
        'QUALITY_MEDIUM': QUALITY_MEDIUM,
        'QUALITY_LOW': QUALITY_LOW
      };
      const qualityBitrate = qualityMap[options.quality];

      // GIF export: render to temp MP4 first, then convert via FFmpeg
      if (options.outputFormat === 'gif') {
        const gifFps = options.gifFps ?? 15;
        const gifWidth = options.gifWidth ?? 640;

        // Force MP4/AVC for the intermediate render
        const gifIntermediateOptions = {
          ...options,
          outputFormat: 'mp4' as const,
          videoCodec: 'avc' as const,
          hardwareAcceleration: 'prefer-hardware' as const,
        };

        const tempMp4Path = options.outputPath.replace(/\.gif$/i, '_temp_gif.mp4');

        // Render with overlays to temp MP4
        await exportVideo({ ...gifIntermediateOptions, outputPath: tempMp4Path }, true);

        // Convert temp MP4 → GIF via FFmpeg
        exportProgress.value = { phase: 'compositing', progress: 35, message: t('video_editor.converting_gif') };

        await invoke('export_video_as_gif', {
          videoPath: tempMp4Path,
          outputPath: options.outputPath,
          fps: gifFps,
          width: gifWidth,
          trimStart: videoEditor.trimIn > 0 ? videoEditor.trimIn : null,
          trimEnd: videoEditor.trimOut > 0 ? videoEditor.trimOut : null,
        });

        // Cleanup temp MP4 is handled by Rust after GIF conversion

        exportProgress.value = { phase: 'done', progress: 100, message: t('video_editor.export_complete') };
        notification.add(t('video_editor.export_success'), 'success');
        return;
      }

      const outputFormat = options.outputFormat === 'mp4' ? new Mp4OutputFormat({}) : new WebMOutputFormat({});
      const output = new Output({ format: outputFormat, target: new BufferTarget() });

      // Pre-compute all editor settings once (avoid unwrapping refs every frame)
      const editorSettings = {
        padding: (editor.padding as any)?.value ?? editor.padding,
        borderRadius: (editor.borderRadius as any)?.value ?? editor.borderRadius,
        background: (editor.background as any)?.value ?? editor.background,
        backgroundBlur: (editor.backgroundBlur as any)?.value ?? editor.backgroundBlur ?? 0,
        shadowColor: (editor.shadowColor as any)?.value ?? editor.shadowColor,
        shadowBlur: (editor.shadowBlur as any)?.value ?? editor.shadowBlur,
        shadowOpacity: (editor.shadowOpacity as any)?.value ?? editor.shadowOpacity,
        shadowX: (editor.shadowX as any)?.value ?? editor.shadowX,
        shadowY: (editor.shadowY as any)?.value ?? editor.shadowY,
        shaderEnabled: (editor.shaderEnabled as any)?.value ?? editor.shaderEnabled ?? false,
        shaderParams: (editor.shaderParams as any)?.value ?? editor.shaderParams,
      };

      const parsedBackground = parseBackground(editorSettings.background);

      const backgroundImageSrc = (editor.backgroundImage as any)?.value ?? editor.backgroundImage ?? null;
      let backgroundImageEl: HTMLImageElement | null = null;
      if (backgroundImageSrc) {
        backgroundImageEl = await new Promise<HTMLImageElement | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => { console.warn('[Export] Failed to load background image'); resolve(null); };
          img.src = backgroundImageSrc;
        });
      }

      const { useMotionEngine } = await import('./useMotionEngine');
      const motion = useMotionEngine();

      const zoomEnabledSnapshot = motion.zoomEnabled.value;
      // Pre-sort keyframes ONCE — not on every frame
      const zoomKeyframesSnapshot = getSortedKeyframes(motion.zoomKeyframes.value);

      // Snapshot user zoom settings for export (avoid reading reactive refs per-frame)
      const deadZoneSnapshot = { radius: motion.deadZoneRadius.value, falloff: 0.1 };
      const followStrengthSnapshot = motion.cursorFollowStrength.value;

      // Spring state for export — simulated per-frame to match preview smoothness
      const exportZoomSpring: ZoomSpringState = {
        scale: 1, offsetX: 0.5, offsetY: 0.5,
        vScale: 0, vOffsetX: 0, vOffsetY: 0,
      };
      let lastExportTime = -1;

      // Zoom calculator with spring simulation (matches preview behavior)
      const calculateZoomFromKeyframes = (time: number, kfs: any[]) => {
        const target = calculateZoomAtTime(time, kfs, motion.cursorX.value, motion.cursorY.value, deadZoneSnapshot, followStrengthSnapshot);

        // Compute dt from frame timestamps (sequential export)
        const dt = lastExportTime >= 0 ? Math.min(time - lastExportTime, 0.05) : 1 / 60;
        lastExportTime = time;

        // Skip spring on first frame or time jump (seek)
        if (dt <= 0 || dt > 0.1) {
          exportZoomSpring.scale = target.scale;
          exportZoomSpring.offsetX = target.offsetX;
          exportZoomSpring.offsetY = target.offsetY;
          exportZoomSpring.vScale = 0;
          exportZoomSpring.vOffsetX = 0;
          exportZoomSpring.vOffsetY = 0;
        } else {
          const s = springEase(exportZoomSpring.scale, target.scale, exportZoomSpring.vScale, DEFAULT_SPRING_CONFIG, dt);
          const ox = springEase(exportZoomSpring.offsetX, target.offsetX, exportZoomSpring.vOffsetX, DEFAULT_SPRING_CONFIG, dt);
          const oy = springEase(exportZoomSpring.offsetY, target.offsetY, exportZoomSpring.vOffsetY, DEFAULT_SPRING_CONFIG, dt);

          exportZoomSpring.scale = s.value;
          exportZoomSpring.vScale = s.velocity;
          exportZoomSpring.offsetX = ox.value;
          exportZoomSpring.vOffsetX = ox.velocity;
          exportZoomSpring.offsetY = oy.value;
          exportZoomSpring.vOffsetY = oy.velocity;
        }

        return {
          scale: Math.max(1, exportZoomSpring.scale),
          offsetX: Math.max(0, Math.min(1, exportZoomSpring.offsetX)),
          offsetY: Math.max(0, Math.min(1, exportZoomSpring.offsetY)),
        };
      };


      let ctx: OffscreenCanvasRenderingContext2D | null = null;
      let bgCached = false; // background rendered to offscreen canvas once
      let frameCount = 0;
      const trimInVal = videoEditor.trimIn;
      const trimOutVal = videoEditor.trimOut > 0 ? videoEditor.trimOut : duration;
      const trimmedDuration = trimOutVal - trimInVal;
      const totalFrames = Math.ceil(trimmedDuration * fps);

      let hardwareAccel = options.hardwareAcceleration || 'prefer-hardware';
      let currentCodec = options.videoCodec;

      if (options.outputFormat === 'webm') {
        if (currentCodec !== 'vp9' && currentCodec !== 'vp8') currentCodec = 'vp9';
        hardwareAccel = 'prefer-software';
      } else {
        if (currentCodec !== 'avc') currentCodec = 'avc';
        const { width: vw = 0, height: vh = 0 } = videoEditor.videoInfo ?? {};
        if (vw * vh > 1920 * 1080) hardwareAccel = 'prefer-software';
      }

      // OPTIMIZATION: motion.updateCursorPositionAtTime() is called once per frame
      // instead of videoEditor.seek() which triggers Vue reactivity watchers
      const createProcessFunction = () => (sample: any) => {
        const time = sample.timestamp;
        if (time < trimInVal || time > trimOutVal) return null;

        if (!ctx) {
          const canvas = new OffscreenCanvas(sample.displayWidth, sample.displayHeight);
          ctx = canvas.getContext('2d', { alpha: false, desynchronized: true, willReadFrequently: false })!;
          bgCached = false;
        }

        const cw = ctx.canvas.width;
        const ch = ctx.canvas.height;

        // OPTIMIZATION: Update motion engine directly without triggering Vue store reactivity
        motion.updateCursorPositionAtTime(time);

        const videoTransform = getVideoTransform(cw, ch, editorSettings.padding, time, zoomEnabledSnapshot, zoomKeyframesSnapshot, calculateZoomFromKeyframes);

        renderVideoWithEffects(ctx, sample, editorSettings, parsedBackground, videoTransform, backgroundImageEl, bgCached, time);
        bgCached = !editorSettings.shaderEnabled; // shader is per-frame, static bg is cached

        renderOverlaysAtTime(ctx, cw, ch, motion, videoTransform);

        frameCount++;
        if (frameCount % 30 === 0) {
          exportProgress.value.progress = Math.min((frameCount / totalFrames) * 100, 99);
        }

        return ctx.canvas;
      };

      const runConversion = async (accel: string, inputSrc: any, outputDst: any) => {
        const cfg: any = {
          input: inputSrc,
          output: outputDst,
          video: {
            codec: currentCodec,
            bitrate: qualityBitrate,
            frameRate: fps,
            hardwareAcceleration: accel,
            process: createProcessFunction()
          }
        };
        const conv = await Conversion.init(cfg);
        await conv.execute();
      };

      try {
        await runConversion(hardwareAccel, input, output);
      } catch (encErr: any) {
        const msg = String(encErr);
        const isConfigError = msg.includes('not supported') || msg.includes('encoder configuration') || msg.includes('EncodingError');
        if (isConfigError && hardwareAccel !== 'prefer-software') {
          console.warn('[Export] Falling back to software encoder');
          const outputFormat2 = options.outputFormat === 'mp4' ? new Mp4OutputFormat({}) : new WebMOutputFormat({});
          const output2 = new Output({ format: outputFormat2, target: new BufferTarget() });
          const input2 = new Input({ formats: ALL_FORMATS, source: new BlobSource(new Blob([videoBytes], { type: 'video/mp4' })) });
          frameCount = 0; ctx = null; bgCached = false;
          await runConversion('prefer-software', input2, output2);

          const buffer2 = (output2.target as BufferTarget).buffer;
          if (!buffer2) throw new Error('Failed to get output buffer (software fallback)');
          exportProgress.value = { phase: 'done', progress: 100, message: t('video_editor.export_complete') };

          // OPTIMIZATION: writeFile instead of Array.from(Uint8Array) + invoke
          const tempPath2 = options.outputPath.replace(/\.(mp4|webm)$/, '_temp_video.$1');
          await writeFile(tempPath2, new Uint8Array(buffer2));

          if (videoEditor.session) {
            await invoke('mix_audio_tracks_for_export', {
              videoPath: tempPath2,
              audioSystemPath: videoEditor.session.audioSystemPath,
              audioMicPath: videoEditor.session.audioMicPath,
              includeSystem: !videoEditor.sysMuted,
              includeMic: !videoEditor.micMuted,
              sysVolume: videoEditor.sysVolume,
              micVolume: videoEditor.micVolume,
              trimStart: trimInVal > 0 ? trimInVal : null,
              trimEnd: trimOutVal < duration ? trimOutVal : null,
              musicPath: videoEditor.musicMuted ? null : videoEditor.musicTrackPath,
              musicVolume: videoEditor.musicVolume,
              musicOffset: videoEditor.musicOffset > 0 ? videoEditor.musicOffset : null,
              outputPath: options.outputPath,
              outputFormat: options.outputFormat
            });
          }
          notification.add(t('video_editor.export_success'), 'success');
          return;
        }
        throw encErr;
      }

      exportProgress.value = { phase: 'done', progress: 100, message: t('video_editor.export_complete') };

      const buffer = (output.target as BufferTarget).buffer;
      if (!buffer) throw new Error('Failed to get output buffer');

      if (videoEditor.session) {
        // OPTIMIZATION: writeFile instead of Array.from(Uint8Array) + invoke
        const tempVideoPath = options.outputPath.replace(/\.(mp4|webm)$/, '_temp_video.$1');
        await writeFile(tempVideoPath, new Uint8Array(buffer));

        await invoke('mix_audio_tracks_for_export', {
          videoPath: tempVideoPath,
          audioSystemPath: videoEditor.session.audioSystemPath,
          audioMicPath: videoEditor.session.audioMicPath,
          includeSystem: !videoEditor.sysMuted,
          includeMic: !videoEditor.micMuted,
          sysVolume: videoEditor.sysVolume,
          micVolume: videoEditor.micVolume,
          trimStart: trimInVal > 0 ? trimInVal : null,
          trimEnd: trimOutVal < duration ? trimOutVal : null,
          musicPath: videoEditor.musicMuted ? null : videoEditor.musicTrackPath,
          musicVolume: videoEditor.musicVolume,
          musicOffset: videoEditor.musicOffset > 0 ? videoEditor.musicOffset : null,
          outputPath: options.outputPath,
          outputFormat: options.outputFormat
        });
      } else {
        console.warn('[Export] No session found, saving with pre-mixed audio');
        await writeFile(options.outputPath, new Uint8Array(buffer));
      }

      notification.add(t('video_editor.export_success'), 'success');

    } catch (error) {
      console.error('[Export] Failed:', error);
      notification.add(t('video_editor.export_failed') + ': ' + error, 'error');
      throw error;
    } finally {
      if (!_nested) {
        isExporting.value = false;
      }
      // Release bg cache memory after export
      _bgCanvas = null;
      _bgCtx = null;
    }
  }


  function parseBackground(background: string) {
    if (background.startsWith('linear-gradient')) {
      const match = background.match(/linear-gradient\((\d+)deg,\s*(.+)\)/);
      if (match) {
        const angle = parseInt(match[1]);
        const colors = match[2].split(',').map((c: string) => c.trim());
        return { type: 'gradient' as const, angle, colors };
      }
    }
    return { type: 'solid' as const, color: background };
  }

  function getVideoTransform(
    canvasWidth: number, canvasHeight: number, padding: number, time: number,
    zoomEnabled: boolean, zoomKeyframes: any[],
    calculateZoom: (time: number, keyframes: any[]) => { scale: number; offsetX: number; offsetY: number }
  ) {
    const availableWidth = canvasWidth - padding * 2;
    const availableHeight = canvasHeight - padding * 2;
    const videoInfo = videoEditor.videoInfo;
    if (!videoInfo) return { videoX: padding, videoY: padding, videoWidth: availableWidth, videoHeight: availableHeight };

    const videoAspectRatio = videoInfo.width / videoInfo.height;
    const availableAspectRatio = availableWidth / availableHeight;

    // Base video size (no zoom) — fits inside available area preserving aspect ratio
    let baseWidth: number, baseHeight: number;
    if (videoAspectRatio > availableAspectRatio) {
      baseWidth = availableWidth;
      baseHeight = availableWidth / videoAspectRatio;
    } else {
      baseHeight = availableHeight;
      baseWidth = availableHeight * videoAspectRatio;
    }

    // Base video position (centered in available area)
    const baseX = padding + (availableWidth - baseWidth) / 2;
    const baseY = padding + (availableHeight - baseHeight) / 2;

    if (!zoomEnabled) {
      return { videoX: baseX, videoY: baseY, videoWidth: baseWidth, videoHeight: baseHeight };
    }

    const zoom = calculateZoom(time, zoomKeyframes);
    if (!zoom || zoom.scale <= 1.0001) {
      return { videoX: baseX, videoY: baseY, videoWidth: baseWidth, videoHeight: baseHeight };
    }

    // Replicate CSS transform-origin behaviour exactly:
    //   transform: scale(zoom.scale)
    //   transform-origin: (zoom.offsetX * 100)% (zoom.offsetY * 100)%
    //
    // The origin point is expressed in the VIDEO's own coordinate space (0-1).
    // After scaling, that point must stay at the same canvas position it was before.
    //
    // originCanvas = (baseX + offsetX * baseWidth,  baseY + offsetY * baseHeight)
    // newVideoX    = originCanvas.x - offsetX * newWidth
    // newVideoY    = originCanvas.y - offsetY * newHeight

    const originX = baseX + zoom.offsetX * baseWidth;
    const originY = baseY + zoom.offsetY * baseHeight;

    const newWidth  = baseWidth  * zoom.scale;
    const newHeight = baseHeight * zoom.scale;

    const videoX = originX - zoom.offsetX * newWidth;
    const videoY = originY - zoom.offsetY * newHeight;

    return { videoX, videoY, videoWidth: newWidth, videoHeight: newHeight };
  }

  function renderVideoWithEffects(
    ctx: OffscreenCanvasRenderingContext2D,
    videoSample: any,
    settings: any,
    parsedBackground: any,
    videoTransform: { videoX: number; videoY: number; videoWidth: number; videoHeight: number },
    backgroundImageEl: HTMLImageElement | null,
    bgAlreadyCached: boolean,
    frameTime?: number
  ): void {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;

    if (settings.shaderEnabled && settings.shaderParams) {
      // Shader background: render per-frame with current time
      renderShaderFrame(ctx, cw, ch, frameTime ?? 0, settings.shaderParams);
    } else {
      // OPTIMIZATION: Draw background from cached offscreen canvas (rendered once)
      if (!bgAlreadyCached) {
        renderBgToCache(cw, ch, parsedBackground, settings, backgroundImageEl);
      }
      ctx.drawImage(_bgCanvas!, 0, 0);
    }

    const { videoX, videoY, videoWidth, videoHeight } = videoTransform;
    const clampedRadius = Math.min(settings.borderRadius, videoWidth / 2, videoHeight / 2);

    // Shadow: draw a filled shape far offscreen so only the canvas shadow is visible.
    // This avoids the black fill bleeding through at globalAlpha < 1.
    const shadowOffX = cw + videoWidth + 1000;
    ctx.save();
    ctx.shadowColor = settings.shadowColor;
    ctx.shadowBlur = settings.shadowBlur;
    ctx.shadowOffsetX = settings.shadowX - shadowOffX;
    ctx.shadowOffsetY = settings.shadowY;
    ctx.globalAlpha = settings.shadowOpacity;
    ctx.fillStyle = 'black';
    // Draw the shape offscreen — only its shadow appears on the visible canvas
    ctx.beginPath();
    ctx.roundRect(videoX + shadowOffX, videoY, videoWidth, videoHeight, clampedRadius);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(videoX, videoY, videoWidth, videoHeight, clampedRadius);
    ctx.clip();
    videoSample.draw(ctx, videoX, videoY, videoWidth, videoHeight);
    ctx.restore();
  }

  function renderOverlaysAtTime(
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    width: number, height: number,
    motion: any,
    videoTransform?: { videoX: number; videoY: number; videoWidth: number; videoHeight: number }
  ): void {
    if (motion.cursorEnabled.value && motion.cursorVisible.value) {
      let cursorX: number, cursorY: number;
      if (videoTransform) {
        cursorX = videoTransform.videoX + motion.cursorX.value * videoTransform.videoWidth;
        cursorY = videoTransform.videoY + motion.cursorY.value * videoTransform.videoHeight;
      } else {
        cursorX = motion.cursorX.value * width;
        cursorY = motion.cursorY.value * height;
      }
      renderCursor(ctx, cursorX, cursorY, motion.cursorClicking.value, motion.cursorStyle.value);
    }

    if (motion.keysEnabled.value && motion.activeKeys.value.length > 0) {
      const keyStrings = resolveUniqueKeys(motion.activeKeys.value);
      if (keyStrings.length > 0) renderKeys(ctx, keyStrings, width, height);
    }
  }


  function renderCursor(
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    x: number, y: number, clicking: boolean, style: string
  ): void {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    if (style === 'text') {
      drawTextCursor(ctx, x, y);
    } else {
      drawDefaultCursor(ctx, x, y, clicking);
    }
    if (clicking) {
      ctx.beginPath();
      ctx.arc(x, y, 20, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 200, 50, 0.3)';
      ctx.fill();
    }
    ctx.restore();
  }

  function drawDefaultCursor(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, x: number, y: number, clicking: boolean): void {
    const scale = clicking ? 0.85 : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, 20); ctx.lineTo(5, 15);
    ctx.lineTo(9, 23); ctx.lineTo(12, 21); ctx.lineTo(8, 13);
    ctx.lineTo(15, 13); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function drawTextCursor(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, x: number, y: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(0, 10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-3, -10); ctx.lineTo(3, -10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-3, 10); ctx.lineTo(3, 10); ctx.stroke();
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  // OPTIMIZATION: resolveUniqueKeys — avoid sort+filter allocation on every frame
  // by using a pre-sorted activeKeys array from motion engine
  function resolveUniqueKeys(activeKeys: any[]): string[] {
    const SHIFT_MAP: Record<string, string> = {
      '1': '!', '2': '@', '3': '#', '4': '$', '5': '%',
      '6': '^', '7': '&', '8': '*', '9': '(', '0': ')',
      '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|',
      ';': ':', "'": '"', ',': '<', '.': '>', '/': '?', '`': '~'
    };

    if (activeKeys.length === 0) return [];

    // activeKeys is already sorted by timestamp from motion engine
    const newestTime = activeKeys[activeKeys.length - 1].timestamp;
    const modifiers = new Set<string>();
    const keysOrdered = new Map<string, number>();

    for (let i = 0; i < activeKeys.length; i++) {
      const event = activeKeys[i];
      if (newestTime - event.timestamp >= 300) continue; // skip old events inline
      (event.modifiers || []).forEach((m: string) => {
        if (m === 'Control') modifiers.add('Ctrl');
        else if (m === 'Shift') modifiers.add('Shift');
        else if (m === 'Alt') modifiers.add('Alt');
        else if (m === 'Meta') modifiers.add('Win');
        else modifiers.add(m);
      });
      if (event.key) {
        let k = event.key;
        if (k === 'Control' || k === 'Ctrl') modifiers.add('Ctrl');
        else if (k === 'Shift') modifiers.add('Shift');
        else if (k === 'Alt') modifiers.add('Alt');
        else if (k === 'Meta' || k === 'Win') modifiers.add('Win');
        else {
          if (k.length === 1) k = k.toUpperCase();
          if (!keysOrdered.has(k)) keysOrdered.set(k, event.timestamp);
        }
      }
    }

    const result: string[] = [];
    if (modifiers.has('Ctrl')) result.push('Ctrl');
    if (modifiers.has('Alt')) result.push('Alt');
    if (modifiers.has('Shift')) result.push('Shift');
    if (modifiers.has('Win')) result.push('Win');
    for (const [k] of keysOrdered) {
      result.push(modifiers.has('Shift') && SHIFT_MAP[k] ? SHIFT_MAP[k] : k);
    }
    return result;
  }


  function renderKeys(
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    keys: string[], width: number, height: number
  ): void {
    const theme = videoEditor.keyOverlayColor;
    const size  = videoEditor.keyOverlaySize;
    const pos   = videoEditor.keyOverlayPosition;

    const scale = size === 'small' ? 0.8 : size === 'large' ? 1.2 : 1.0;
    const keyH  = Math.round(32 * scale);
    const pad   = Math.round(10 * scale);
    const gap   = Math.round(8  * scale);
    const containerPadH = Math.round(20 * scale);
    const containerPadV = Math.round(12 * scale);
    const fontSize = Math.round(14 * scale);
    const font = `bold ${fontSize}px "Geist Mono", "Roboto Mono", monospace`;

    ctx.save();
    ctx.font = font;

    const keyWidths = keys.map(k => Math.max(keyH, ctx.measureText(k).width + pad * 2));
    const totalKeysWidth = keyWidths.reduce((s, w) => s + w, 0) + gap * (keys.length - 1);
    const containerW = totalKeysWidth + containerPadH * 2;
    const containerH = keyH + containerPadV * 2;

    const margin = Math.round(width * 0.05);
    let anchorX: number, anchorY: number;
    switch (pos) {
      case 'top-left':    anchorX = margin + containerW / 2; anchorY = Math.round(height * 0.1) + containerH / 2; break;
      case 'top-right':   anchorX = width - margin - containerW / 2; anchorY = Math.round(height * 0.1) + containerH / 2; break;
      case 'bottom-left': anchorX = margin + containerW / 2; anchorY = height - Math.round(height * 0.1) - containerH / 2; break;
      case 'bottom-right':anchorX = width - margin - containerW / 2; anchorY = height - Math.round(height * 0.1) - containerH / 2; break;
      default:            anchorX = width / 2; anchorY = height - Math.round(height * 0.1) - containerH / 2; break;
    }

    ctx.translate(anchorX, anchorY);

    const containerColors: Record<string, { bg: string; border: string }> = {
      light:  { bg: 'rgba(0,0,0,0.6)',   border: 'rgba(255,255,255,0.1)' },
      dark:   { bg: 'rgba(255,255,255,0.8)', border: 'rgba(0,0,0,0.1)' },
      accent: { bg: 'rgba(0,0,0,0.8)',   border: 'rgba(0,150,255,0.3)' },
    };
    const cc = containerColors[theme] ?? containerColors.light;

    ctx.fillStyle = cc.bg;
    ctx.strokeStyle = cc.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-containerW / 2, -containerH / 2, containerW, containerH, 12);
    ctx.fill();
    ctx.stroke();

    type KeyTheme = { bg0: string; bg1: string; border: string; text: string; shadow: string };
    const keyThemes: Record<string, KeyTheme> = {
      light:  { bg0: '#ffffff', bg1: '#e0e0e0', border: '#bbb',    text: '#333', shadow: '#bbb' },
      dark:   { bg0: '#444444', bg1: '#222222', border: '#000',    text: '#eee', shadow: '#000' },
      accent: { bg0: '#4facfe', bg1: '#00f2fe', border: '#0077aa', text: '#003', shadow: '#0077aa' },
    };
    const kt = keyThemes[theme] ?? keyThemes.light;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font;

    let offsetX = -containerW / 2 + containerPadH;
    keys.forEach((label, i) => {
      const kw = keyWidths[i];
      const grad = getKeyGrad(ctx, offsetX, keyH, kt.bg0, kt.bg1);
      ctx.fillStyle = grad;
      ctx.strokeStyle = kt.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(offsetX, -keyH / 2, kw, keyH, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = kt.shadow;
      ctx.beginPath();
      ctx.roundRect(offsetX, keyH / 2 - 3, kw, 3, [0, 0, 6, 6]);
      ctx.fill();
      ctx.fillStyle = kt.text;
      ctx.fillText(label, offsetX + kw / 2, 0);
      offsetX += kw + gap;
    });

    ctx.restore();
  }

  return { isExporting, exportProgress, exportVideo };
}
