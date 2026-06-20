/**
 * WebAudioEngine — Hybrid: <audio> element + AudioBuffer
 * 
 * Architecture:
 * - <audio> element: handles actual PLAYBACK
 *   → Bypasses iOS silent mode (plays in "playback" category)
 *   → Continues playing when browser is backgrounded
 *   → Works with Media Session API (lock screen controls)
 * 
 * - AudioBuffer (Web Audio API): used ONLY for waveform analysis
 *   → Sample-accurate amplitude data for visualization
 *   → No longer used for playback
 */

export class WebAudioEngine {
  // Playback via <audio> element
  private audioElement: HTMLAudioElement | null = null;
  private audioSrc: string = '';

  // AudioBuffer for waveform analysis only
  private audioBuffer: AudioBuffer | null = null;

  private _isPlaying: boolean = false;
  private _playbackRate: number = 1.0;
  private _durationSec: number = 0;

  private positionInterval: ReturnType<typeof setInterval> | null = null;
  private onPositionUpdate: ((positionMs: number, isPlaying: boolean) => void) | null = null;

  /**
   * Load audio file → create <audio> element + decode AudioBuffer for waveform
   */
  async load(audioUri: string): Promise<number> {
    this.stop();
    this.audioSrc = audioUri;

    // 1. Create <audio> element for playback
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.removeAttribute('src');
      this.audioElement.load();
    }
    this.audioElement = new Audio();
    this.audioElement.preload = 'auto';
    this.audioElement.crossOrigin = 'anonymous';

    // iOS: enable inline playback, bypass silent mode
    (this.audioElement as any).playsInline = true;
    (this.audioElement as any).webkitPlaysInline = true;

    // Set source
    this.audioElement.src = audioUri;

    // Wait for audio to be ready
    await new Promise<void>((resolve, reject) => {
      const el = this.audioElement!;
      const onReady = () => {
        el.removeEventListener('canplaythrough', onReady);
        el.removeEventListener('error', onError);
        resolve();
      };
      const onError = (e: any) => {
        el.removeEventListener('canplaythrough', onReady);
        el.removeEventListener('error', onError);
        reject(new Error(`Audio load failed: ${e?.message || 'unknown error'}`));
      };
      el.addEventListener('canplaythrough', onReady, { once: true });
      el.addEventListener('error', onError, { once: true });
      el.load();
    });

    this._durationSec = this.audioElement.duration || 0;

    // Setup ended handler
    this.audioElement.onended = () => {
      if (this._isPlaying) {
        this._isPlaying = false;
        this.stopPositionTracking();
        this.onPositionUpdate?.(this.getPositionMs(), false);
      }
    };

    // 2. Decode AudioBuffer for waveform analysis (non-blocking)
    this.decodeForWaveform(audioUri).catch(err => {
      console.warn('[WebAudioEngine] Waveform decode failed (non-critical):', err);
    });

    // 3. Setup Media Session for lock screen controls
    this.setupMediaSession();

    return Math.round(this._durationSec * 1000);
  }

  /**
   * Decode audio into AudioBuffer for waveform analysis only
   */
  private async decodeForWaveform(audioUri: string): Promise<void> {
    try {
      const response = await fetch(audioUri);
      const arrayBuffer = await response.arrayBuffer();

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();

      this.audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
        const promise = ctx.decodeAudioData(
          arrayBuffer,
          (buffer) => resolve(buffer),
          (err) => reject(err || new Error('Decode failed'))
        );
        if (promise && typeof promise.catch === 'function') {
          promise.then(resolve).catch(reject);
        }
      });

      await ctx.close().catch(() => {});
      console.log('[WebAudioEngine] Waveform buffer decoded');
    } catch (err) {
      console.warn('[WebAudioEngine] Waveform decode error:', err);
    }
  }

  /**
   * Setup Media Session API for lock screen / notification controls
   */
  private setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'English Looper',
        artist: 'Shadowing Practice',
      });

      navigator.mediaSession.setActionHandler('play', () => this.play());
      navigator.mediaSession.setActionHandler('pause', () => this.pause());
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime != null) {
          this.seekTo(details.seekTime * 1000);
        }
      });
    } catch (err) {
      console.warn('[WebAudioEngine] Media Session setup failed:', err);
    }
  }

  /**
   * Phát từ vị trí hiện tại
   */
  play() {
    if (!this.audioElement || this._isPlaying) return;

    this.audioElement.playbackRate = this._playbackRate;
    const playPromise = this.audioElement.play();
    if (playPromise) {
      playPromise.catch(err => {
        console.warn('[WebAudioEngine] Play failed:', err);
      });
    }
    this._isPlaying = true;
    this.startPositionTracking();
  }

  /**
   * Tạm dừng
   */
  pause() {
    if (!this._isPlaying || !this.audioElement) return;
    this.audioElement.pause();
    this._isPlaying = false;
    this.stopPositionTracking();
    this.onPositionUpdate?.(this.getPositionMs(), false);
  }

  /**
   * Seek đến vị trí chính xác (ms)
   */
  seekTo(positionMs: number) {
    if (!this.audioElement) return;

    const wasPlaying = this._isPlaying;
    const targetSec = Math.max(0, Math.min(positionMs / 1000, this._durationSec));

    this.audioElement.currentTime = targetSec;
    this.onPositionUpdate?.(positionMs, wasPlaying);
  }

  /**
   * Lấy vị trí hiện tại (ms)
   */
  getPositionMs(): number {
    if (!this.audioElement) return 0;
    return Math.round(this.audioElement.currentTime * 1000);
  }

  /**
   * Đổi tốc độ phát
   */
  setPlaybackRate(rate: number) {
    this._playbackRate = rate;
    if (this.audioElement) {
      this.audioElement.playbackRate = rate;
    }
  }

  /**
   * Đang phát?
   */
  get isPlaying(): boolean {
    return this._isPlaying;
  }

  /**
   * Tổng thời lượng (ms)
   */
  get durationMs(): number {
    return Math.round(this._durationSec * 1000);
  }

  /**
   * Đăng ký callback position update
   */
  setOnPositionUpdate(callback: (positionMs: number, isPlaying: boolean) => void) {
    this.onPositionUpdate = callback;
  }

  /**
   * Giải phóng
   */
  async unload() {
    this.stop();
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.removeAttribute('src');
      this.audioElement.load();
      this.audioElement.onended = null;
      this.audioElement = null;
    }
    this.audioBuffer = null;
    this.audioSrc = '';
    this.onPositionUpdate = null;
  }

  /**
   * Lấy dữ liệu amplitude thật của một khoảng thời gian (dùng cho waveform)
   */
  getAmplitudeData(startTimeMs: number, endTimeMs: number, numPoints: number): number[] {
    if (!this.audioBuffer) return new Array(numPoints).fill(0.1);

    const sampleRate = this.audioBuffer.sampleRate;
    const startSample = Math.max(0, Math.floor((startTimeMs / 1000) * sampleRate));
    const endSample = Math.min(this.audioBuffer.length, Math.ceil((endTimeMs / 1000) * sampleRate));
    const totalSamples = endSample - startSample;

    if (totalSamples <= 0) return new Array(numPoints).fill(0.1);

    try {
      const channelData = this.audioBuffer.getChannelData(0);
      const points: number[] = [];
      const samplesPerPoint = Math.max(1, Math.floor(totalSamples / numPoints));

      for (let i = 0; i < numPoints; i++) {
        const pointStart = startSample + i * samplesPerPoint;
        const pointEnd = Math.min(endSample, pointStart + samplesPerPoint);
        
        let sumSq = 0;
        let count = 0;
        for (let j = pointStart; j < pointEnd; j++) {
          const val = channelData[j];
          sumSq += val * val;
          count++;
        }
        
        const rms = count > 0 ? Math.sqrt(sumSq / count) : 0.0;
        points.push(rms);
      }

      const maxVal = Math.max(...points, 0.01);
      return points.map(v => 0.15 + (v / maxVal) * 0.85);
    } catch {
      return new Array(numPoints).fill(0.1);
    }
  }

  // ─── Internal ───

  private stopSource() {
    if (this.audioElement) {
      this.audioElement.pause();
    }
  }

  private stop() {
    this.stopSource();
    this._isPlaying = false;
    this.stopPositionTracking();
  }

  private startPositionTracking() {
    this.stopPositionTracking();
    this.positionInterval = setInterval(() => {
      if (this._isPlaying) {
        this.onPositionUpdate?.(this.getPositionMs(), true);
      }
    }, 50); // 50ms = 20fps update
  }

  private stopPositionTracking() {
    if (this.positionInterval) {
      clearInterval(this.positionInterval);
      this.positionInterval = null;
    }
  }
}
