import { Platform } from 'react-native';

/**
 * WebAudioEngine — Hybrid: <audio> element + AudioBuffer
 * 
 * Architecture:
 * - <audio> element: used for MP3 playback + WAV background playback.
 *   → Bypasses iOS silent mode (plays in "playback" category)
 *   → Continues playing when browser is backgrounded
 *   → Works with Media Session API (lock screen controls)
 * 
 * - Web Audio API (AudioBufferSourceNode): used for WAV playback on web (foreground).
 *   → Fixes Chrome/Edge seeking bug on blob WAV files (demuxer byte-estimation bug)
 *   → Sample-accurate seeking and playback
 * 
 * - AudioBuffer: always decoded for waveform visualization.
 * 
 * Background Playback Strategy:
 * - WAV: When page goes to background, seamlessly switch from Web Audio API
 *   to a shadow <audio> element. When returning, switch back.
 * - MP3: <audio> element naturally plays in background. Use timeupdate
 *   event (not throttled) as backup for position tracking.
 */

export class WebAudioEngine {
  // Playback via <audio> element (MP3 format)
  private audioElement: HTMLAudioElement | null = null;
  private audioSrc: string = '';

  // Playback via Web Audio API (WAV format — foreground only)
  private useWebAudioPlayback: boolean = false;
  private audioContext: AudioContext | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private playbackStartContextTime: number = 0;
  private playbackStartOffset: number = 0;
  private currentPositionMs: number = 0;

  // AudioBuffer for waveform analysis (and WAV playback)
  private audioBuffer: AudioBuffer | null = null;

  private _isPlaying: boolean = false;
  private _playbackRate: number = 1.0;
  private _durationSec: number = 0;

  private positionInterval: ReturnType<typeof setInterval> | null = null;
  private onPositionUpdate: ((positionMs: number, isPlaying: boolean) => void) | null = null;

  // Shadow <audio> element for WAV background playback
  private shadowAudio: HTMLAudioElement | null = null;
  private isInBackground: boolean = false;

  // Bound event handlers for cleanup
  private boundVisibilityHandler: (() => void) | null = null;

  // Callback to notify AudioService of background/foreground transitions
  private onVisibilityChange: ((isHidden: boolean) => void) | null = null;

  // Track if audio was playing before going to background
  private wasPlayingBeforeBackground: boolean = false;

  /**
   * Helper to check if a source URL is a WAV file
   */
  private static async isWavFile(uri: string): Promise<boolean> {
    if (Platform.OS !== 'web') return false;
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const slicedBlob = blob.slice(0, 12);
      const buffer = await slicedBlob.arrayBuffer();
      const view = new DataView(buffer);
      if (view.byteLength < 12) return false;
      const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
      const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
      return riff === 'RIFF' && wave === 'WAVE';
    } catch {
      return uri.toLowerCase().includes('.wav') || uri.toLowerCase().includes('audio/wav');
    }
  }

  /**
   * Load audio file → create <audio> element OR decode AudioBuffer for Web Audio API
   */
  async load(audioUri: string): Promise<number> {
    this.stop();
    this.removeBackgroundListeners();
    this.destroyShadowAudio();
    this.audioSrc = audioUri;

    // Detect format
    const isWav = await WebAudioEngine.isWavFile(audioUri);
    console.log(`[WebAudioEngine] Loading audio. Format: ${isWav ? 'WAV' : 'MP3/Other'}`);

    if (isWav) {
      this.useWebAudioPlayback = true;
      
      // Decode audio immediately for Web Audio playback
      await this.decodeForWaveform(audioUri);
      this._durationSec = this.audioBuffer ? this.audioBuffer.duration : 0;
      
      // Create shadow <audio> element for background playback
      await this.createShadowAudio(audioUri);
      
      console.log(`[WebAudioEngine] Loaded WAV via Web Audio API. Duration: ${this._durationSec.toFixed(2)}s`);
    } else {
      this.useWebAudioPlayback = false;

      // 1. Create <audio> element for MP3 playback
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

      // timeupdate fires even in background — backup position tracker for looping
      this.audioElement.addEventListener('timeupdate', () => {
        if (this._isPlaying) {
          this.onPositionUpdate?.(this.getPositionMs(), true);
        }
      });

      // Decode AudioBuffer for waveform analysis (non-blocking for MP3)
      this.decodeForWaveform(audioUri).catch(err => {
        console.warn('[WebAudioEngine] Waveform decode failed (non-critical):', err);
      });

      console.log(`[WebAudioEngine] Loaded MP3 via HTML5 Audio. Duration: ${this._durationSec.toFixed(2)}s`);
    }

    this.currentPositionMs = 0;
    this.isInBackground = false;

    // Setup background/foreground switch listeners
    this.setupBackgroundListeners();

    // Setup Media Session for lock screen controls
    this.setupMediaSession();

    return Math.round(this._durationSec * 1000);
  }

  /**
   * Decode audio into AudioBuffer
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
   * Play from current position
   */
  play() {
    if (this._isPlaying) return;

    if (this.useWebAudioPlayback) {
      // WAV mode
      if (this.isInBackground) {
        // In background → play via shadow <audio> element
        this.playShadowAudio();
        return;
      }

      if (!this.audioBuffer) return;

      if (!this.audioContext) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioContextClass();
      }

      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      this.sourceNode = this.audioContext.createBufferSource();
      this.sourceNode.buffer = this.audioBuffer;
      this.sourceNode.playbackRate.value = this._playbackRate;

      this.gainNode = this.audioContext.createGain();
      this.sourceNode.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);

      this.sourceNode.onended = () => {
        const currentOffset = this.getPositionMs() / 1000;
        if (this._isPlaying && currentOffset >= this._durationSec - 0.1) {
          this._isPlaying = false;
          this.stopPositionTracking();
          this.onPositionUpdate?.(this.getPositionMs(), false);
        }
      };

      const startOffset = this.currentPositionMs / 1000;
      this.sourceNode.start(0, startOffset);

      this.playbackStartContextTime = this.audioContext.currentTime;
      this.playbackStartOffset = startOffset;
      this._isPlaying = true;
      this.startPositionTracking();
      
      // Fire initial state update
      this.onPositionUpdate?.(this.getPositionMs(), true);
    } else {
      // MP3 mode — <audio> element (works in background natively)
      if (!this.audioElement) return;
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
  }

  /**
   * Pause playback
   */
  pause() {
    if (!this._isPlaying) return;

    if (this.useWebAudioPlayback) {
      // WAV mode
      if (this.isInBackground && this.shadowAudio) {
        // Pausing while in background — pause shadow audio
        this.shadowAudio.pause();
        this.currentPositionMs = Math.round(this.shadowAudio.currentTime * 1000);
      } else {
        // Pausing while in foreground — stop Web Audio API
        this.currentPositionMs = this.getPositionMs();
        if (this.sourceNode) {
          try { this.sourceNode.stop(); } catch (e) {}
          this.sourceNode = null;
        }
      }
      this._isPlaying = false;
      this.stopPositionTracking();
      this.onPositionUpdate?.(this.currentPositionMs, false);
    } else {
      // MP3 mode
      if (!this.audioElement) return;
      this.audioElement.pause();
      this._isPlaying = false;
      this.stopPositionTracking();
      this.onPositionUpdate?.(this.getPositionMs(), false);
    }
  }

  /**
   * Seek to specific position (ms)
   */
  seekTo(positionMs: number) {
    const targetSec = Math.max(0, Math.min(positionMs / 1000, this._durationSec));
    const wasPlaying = this._isPlaying;

    if (this.useWebAudioPlayback) {
      if (this.isInBackground && this.shadowAudio) {
        // Seeking in background — seek shadow audio
        this.shadowAudio.currentTime = targetSec;
        this.currentPositionMs = Math.round(targetSec * 1000);
        this.onPositionUpdate?.(this.currentPositionMs, wasPlaying);
      } else if (wasPlaying) {
        if (this.sourceNode) {
          try { this.sourceNode.stop(); } catch (e) {}
          this.sourceNode = null;
        }
        this._isPlaying = false;
        this.stopPositionTracking();
        this.currentPositionMs = Math.round(targetSec * 1000);
        this.play();
      } else {
        this.currentPositionMs = Math.round(targetSec * 1000);
        this.onPositionUpdate?.(this.currentPositionMs, false);
      }
    } else {
      if (!this.audioElement) return;
      this.audioElement.currentTime = targetSec;
      this.onPositionUpdate?.(positionMs, wasPlaying);
    }
  }

  /**
   * Get current position (ms)
   */
  getPositionMs(): number {
    if (this.useWebAudioPlayback) {
      // WAV mode
      if (this.isInBackground && this.shadowAudio) {
        // In background → get from shadow <audio>
        return Math.round(this.shadowAudio.currentTime * 1000);
      }
      if (this._isPlaying && this.audioContext) {
        const elapsed = this.audioContext.currentTime - this.playbackStartContextTime;
        const currentSec = this.playbackStartOffset + elapsed * this._playbackRate;
        return Math.round(Math.max(0, Math.min(currentSec, this._durationSec)) * 1000);
      }
      return this.currentPositionMs;
    } else {
      // MP3 mode
      if (!this.audioElement) return 0;
      return Math.round(this.audioElement.currentTime * 1000);
    }
  }

  /**
   * Set playback rate
   */
  setPlaybackRate(rate: number) {
    const oldRate = this._playbackRate;
    this._playbackRate = rate;

    if (this.useWebAudioPlayback) {
      // Also update shadow audio rate
      if (this.shadowAudio) {
        this.shadowAudio.playbackRate = rate;
      }
      if (this._isPlaying && this.audioContext && this.sourceNode && !this.isInBackground) {
        const now = this.audioContext.currentTime;
        const currentPosMs = this.getPositionMs();
        this.playbackStartContextTime = now;
        this.playbackStartOffset = currentPosMs / 1000;
        this.sourceNode.playbackRate.setValueAtTime(rate, now);
      }
    } else {
      if (this.audioElement) {
        this.audioElement.playbackRate = rate;
      }
    }
  }

  /**
   * Is playing?
   */
  get isPlaying(): boolean {
    return this._isPlaying;
  }

  /**
   * Is current file using Web Audio API? (WAV mode)
   * WAV files use Web Audio API + shadow audio in background.
   * Shadow audio CANNOT seek accurately on blob WAV (Chrome bug).
   */
  get isWavMode(): boolean {
    return this.useWebAudioPlayback;
  }

  /**
   * Duration in ms
   */
  get durationMs(): number {
    return Math.round(this._durationSec * 1000);
  }

  /**
   * Set position update callback
   */
  setOnPositionUpdate(callback: (positionMs: number, isPlaying: boolean) => void) {
    this.onPositionUpdate = callback;
  }

  /**
   * Set callback for background/foreground visibility transitions.
   * Called with isHidden=true when page goes to background,
   * and isHidden=false when page returns to foreground.
   */
  setOnVisibilityChange(callback: (isHidden: boolean) => void) {
    this.onVisibilityChange = callback;
  }

  /**
   * Unload audio resources
   */
  async unload() {
    this.stop();
    this.removeBackgroundListeners();
    this.destroyShadowAudio();
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.removeAttribute('src');
      this.audioElement.load();
      this.audioElement.onended = null;
      this.audioElement = null;
    }
    if (this.audioContext) {
      await this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.sourceNode = null;
    this.gainNode = null;
    this.audioBuffer = null;
    this.audioSrc = '';
    this.isInBackground = false;
    this.onPositionUpdate = null;
  }

  /**
   * Get raw amplitude data for waveform drawing
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
    if (this.useWebAudioPlayback) {
      if (this.isInBackground && this.shadowAudio) {
        this.shadowAudio.pause();
      }
      if (this.sourceNode) {
        try { this.sourceNode.stop(); } catch (e) {}
        this.sourceNode = null;
      }
    } else {
      if (this.audioElement) {
        this.audioElement.pause();
      }
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

  // ─── Shadow <audio> for WAV Background Playback ───

  /**
   * Create a shadow <audio> element loaded with the WAV file.
   * This element takes over playback when the browser is backgrounded,
   * since Web Audio API (AudioContext) gets suspended by mobile browsers.
   */
  private async createShadowAudio(audioUri: string) {
    this.destroyShadowAudio();
    try {
      this.shadowAudio = new Audio();
      this.shadowAudio.preload = 'auto';
      (this.shadowAudio as any).playsInline = true;
      (this.shadowAudio as any).webkitPlaysInline = true;
      this.shadowAudio.src = audioUri;

      // timeupdate fires in background — keeps position tracking alive
      this.shadowAudio.addEventListener('timeupdate', () => {
        if (this._isPlaying && this.isInBackground) {
          const pos = Math.round(this.shadowAudio!.currentTime * 1000);
          this.onPositionUpdate?.(pos, true);
        }
      });

      // Handle end of playback in background
      this.shadowAudio.addEventListener('ended', () => {
        if (this._isPlaying && this.isInBackground) {
          this._isPlaying = false;
          this.stopPositionTracking();
          this.onPositionUpdate?.(this.getPositionMs(), false);
        }
      });

      // Wait for it to be ready
      await new Promise<void>((resolve) => {
        const el = this.shadowAudio!;
        const onReady = () => { el.removeEventListener('canplaythrough', onReady); resolve(); };
        el.addEventListener('canplaythrough', onReady, { once: true });
        el.addEventListener('error', () => { resolve(); }, { once: true });
        el.load();
      });

      console.log('[WebAudioEngine] Shadow <audio> created for WAV background playback');
    } catch (err) {
      console.warn('[WebAudioEngine] Failed to create shadow audio:', err);
      this.shadowAudio = null;
    }
  }

  /**
   * Start playing via shadow <audio> (used when going to background)
   */
  private playShadowAudio() {
    if (!this.shadowAudio) return;
    this.shadowAudio.currentTime = this.currentPositionMs / 1000;
    this.shadowAudio.playbackRate = this._playbackRate;
    const p = this.shadowAudio.play();
    if (p) p.catch(err => console.warn('[WebAudioEngine] Shadow play failed:', err));
    this._isPlaying = true;
    // Don't start setInterval — use timeupdate instead (works in background)
    this.onPositionUpdate?.(this.currentPositionMs, true);
    console.log(`[WebAudioEngine] Shadow audio playing from ${(this.currentPositionMs/1000).toFixed(1)}s`);
  }

  private destroyShadowAudio() {
    if (!this.shadowAudio) return;
    try {
      this.shadowAudio.pause();
      this.shadowAudio.removeAttribute('src');
      this.shadowAudio.load();
    } catch (e) {}
    this.shadowAudio = null;
  }

  // ─── Background/Foreground Switch ───

  /**
   * Listen for visibility changes to switch between Web Audio API (foreground)
   * and <audio> element (background) for WAV files.
   */
  private setupBackgroundListeners() {
    if (typeof document === 'undefined') return;

    this.boundVisibilityHandler = () => {
      if (document.visibilityState === 'hidden') {
        this.handleGoToBackground();
      } else if (document.visibilityState === 'visible') {
        this.handleReturnFromBackground();
      }
    };
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);
    console.log('[WebAudioEngine] Background/foreground listeners attached');
  }

  private removeBackgroundListeners() {
    if (typeof document === 'undefined') return;
    if (this.boundVisibilityHandler) {
      document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
      this.boundVisibilityHandler = null;
    }
  }

  /**
   * Page going to background:
   * - Notify AudioService to FREEZE segment loop logic (prevents chaos from throttled timers)
   * - WAV: Switch from Web Audio API to shadow <audio> for continuous background playback
   * - MP3: <audio> element keeps playing naturally
   */
  private handleGoToBackground() {
    console.log('[WebAudioEngine] Page going to background...');
    this.isInBackground = true;

    // Notify AudioService FIRST — it will freeze segment loop logic
    this.onVisibilityChange?.(true);

    if (this.useWebAudioPlayback && this._isPlaying && this.shadowAudio) {
      // Save current position from Web Audio API
      const pos = this.getPositionMs();
      this.currentPositionMs = pos;
      console.log(`[WebAudioEngine] Switching WAV to shadow <audio> at ${(pos/1000).toFixed(1)}s`);

      // Stop Web Audio API source (it will be suspended by browser anyway)
      if (this.sourceNode) {
        try { this.sourceNode.stop(); } catch (e) {}
        this.sourceNode = null;
      }
      this.stopPositionTracking();

      // Start shadow <audio> from same position
      this.shadowAudio.currentTime = pos / 1000;
      this.shadowAudio.playbackRate = this._playbackRate;
      const p = this.shadowAudio.play();
      if (p) p.catch(err => console.warn('[WebAudioEngine] Shadow bg play failed:', err));
      // _isPlaying stays true — shadow audio takes over
    }
    // MP3 mode: <audio> element keeps playing, timeupdate keeps firing
  }

  /**
   * Page returning from background:
   * - WAV: Get position from shadow <audio> → stop shadow → restart Web Audio API
   * - MP3: Ensure <audio> is still playing, restart position tracking
   * - Notify AudioService to re-sync segment state
   */
  private handleReturnFromBackground() {
    console.log('[WebAudioEngine] Page returning from background...');
    this.isInBackground = false;

    if (this.useWebAudioPlayback) {
      if (this._isPlaying && this.shadowAudio) {
        // Get position from shadow audio
        const pos = Math.round(this.shadowAudio.currentTime * 1000);
        console.log(`[WebAudioEngine] Switching back to Web Audio API at ${(pos/1000).toFixed(1)}s`);

        // Pause shadow audio
        this.shadowAudio.pause();

        // Resume AudioContext if suspended
        if (this.audioContext && (this.audioContext.state === 'suspended' || (this.audioContext.state as string) === 'interrupted')) {
          this.audioContext.resume().catch(() => {});
        }

        // Restart Web Audio API from shadow position
        this.currentPositionMs = pos;
        this._isPlaying = false; // Reset so play() works
        this.play();
      } else if (!this._isPlaying) {
        // Was paused in background — just make sure AudioContext is ready
        if (this.audioContext && this.audioContext.state === 'suspended') {
          this.audioContext.resume().catch(() => {});
        }
      }
    } else {
      // MP3 mode: <audio> element should still be playing
      if (this._isPlaying && this.audioElement && this.audioElement.paused) {
        console.log('[WebAudioEngine] Resuming paused <audio> element...');
        const p = this.audioElement.play();
        if (p) p.catch(err => console.warn('[WebAudioEngine] Audio resume failed:', err));
      }
      // Restart high-frequency position tracking (setInterval was throttled)
      if (this._isPlaying) {
        this.startPositionTracking();
      }
    }

    // Notify AudioService AFTER audio source is restored
    // AudioService will re-sync active segment to current position
    this.onVisibilityChange?.(false);
  }
}
