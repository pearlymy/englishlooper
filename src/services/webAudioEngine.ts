import { Platform } from 'react-native';

/**
 * WebAudioEngine — Hybrid: <audio> element + AudioBuffer
 * 
 * Architecture:
 * - <audio> element: used for MP3 playback.
 *   → Bypasses iOS silent mode (plays in "playback" category)
 *   → Continues playing when browser is backgrounded
 *   → Works with Media Session API (lock screen controls)
 * 
 * - Web Audio API (AudioBufferSourceNode): used for WAV playback on web.
 *   → Fixes Chrome/Edge seeking bug on blob WAV files (demuxer byte-estimation bug)
 *   → Sample-accurate seeking and playback
 * 
 * - AudioBuffer: always decoded for waveform visualization.
 */

export class WebAudioEngine {
  // Playback via <audio> element (MP3 format)
  private audioElement: HTMLAudioElement | null = null;
  private audioSrc: string = '';

  // Playback via Web Audio API (WAV format)
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
    this.audioSrc = audioUri;

    // Detect format
    const isWav = await WebAudioEngine.isWavFile(audioUri);
    console.log(`[WebAudioEngine] Loading audio. Format: ${isWav ? 'WAV' : 'MP3/Other'}`);

    if (isWav) {
      this.useWebAudioPlayback = true;
      
      // Decode audio immediately for Web Audio playback
      await this.decodeForWaveform(audioUri);
      this._durationSec = this.audioBuffer ? this.audioBuffer.duration : 0;
      
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

      // Decode AudioBuffer for waveform analysis (non-blocking for MP3)
      this.decodeForWaveform(audioUri).catch(err => {
        console.warn('[WebAudioEngine] Waveform decode failed (non-critical):', err);
      });

      console.log(`[WebAudioEngine] Loaded MP3 via HTML5 Audio. Duration: ${this._durationSec.toFixed(2)}s`);
    }

    this.currentPositionMs = 0;

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
      this._isPlaying = false;
      this.stopPositionTracking();

      this.currentPositionMs = this.getPositionMs();

      if (this.sourceNode) {
        try {
          this.sourceNode.stop();
        } catch (e) {}
        this.sourceNode = null;
      }
      this.onPositionUpdate?.(this.currentPositionMs, false);
    } else {
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
      if (wasPlaying) {
        if (this.sourceNode) {
          try {
            this.sourceNode.stop();
          } catch (e) {}
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
      if (this._isPlaying && this.audioContext) {
        const elapsed = this.audioContext.currentTime - this.playbackStartContextTime;
        const currentSec = this.playbackStartOffset + elapsed * this._playbackRate;
        return Math.round(Math.max(0, Math.min(currentSec, this._durationSec)) * 1000);
      }
      return this.currentPositionMs;
    } else {
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
      if (this._isPlaying && this.audioContext && this.sourceNode) {
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
   * Unload audio resources
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
    if (this.audioContext) {
      await this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.sourceNode = null;
    this.gainNode = null;
    this.audioBuffer = null;
    this.audioSrc = '';
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
      if (this.sourceNode) {
        try {
          this.sourceNode.stop();
        } catch (e) {}
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
}
