/**
 * WebAudioEngine — Thay thế expo-av trên Web
 * 
 * Tại sao?
 * - expo-av dùng HTML5 <audio> → seek trên MP3 lệch ±500ms
 * - Web Audio API dùng AudioBuffer → seek CHÍNH XÁC đến từng sample
 * - AudioBufferSourceNode.start(0, offset) = sample-accurate playback
 */

export class WebAudioEngine {
  private audioContext: AudioContext | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;

  private _isPlaying: boolean = false;
  private _startedAt: number = 0;      // audioContext.currentTime khi bắt đầu phát
  private _offsetSec: number = 0;      // Vị trí offset trong audio (seconds)
  private _playbackRate: number = 1.0;
  private _durationSec: number = 0;

  private positionInterval: ReturnType<typeof setInterval> | null = null;
  private onPositionUpdate: ((positionMs: number, isPlaying: boolean) => void) | null = null;

  // Auto-unlock AudioContext on iOS Safari/Mobile Web on first user gesture
  private unlockAudioContext(context: AudioContext) {
    const unlock = () => {
      if (context.state === 'suspended') {
        context.resume().then(() => {
          cleanUp();
          console.log('[WebAudioEngine] AudioContext successfully unlocked!');
        }).catch((err) => console.warn('[WebAudioEngine] Failed to unlock AudioContext:', err));
      } else {
        cleanUp();
      }
    };
    const events = ['touchstart', 'touchend', 'click', 'keydown'];
    const cleanUp = () => {
      events.forEach(e => document.removeEventListener(e, unlock));
    };
    events.forEach(e => document.addEventListener(e, unlock, { passive: true }));
  }

  // Cross-browser iOS Safari compatible decodeAudioData wrapper
  private decodeAudio(context: AudioContext, arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    return new Promise((resolve, reject) => {
      try {
        // webkitAudioContext in Safari iOS historically did not return a Promise
        const promise = context.decodeAudioData(
          arrayBuffer,
          (buffer) => resolve(buffer),
          (err) => reject(err || new Error('Lỗi giải mã âm thanh (decodeAudioData)'))
        );
        
        if (promise && typeof promise.catch === 'function') {
          promise.then(resolve).catch(reject);
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Load audio file → decode thành AudioBuffer
   */
  async load(audioUri: string): Promise<number> {
    this.stop();

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.audioContext = new AudioContextClass();
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);

    // Register auto-unlocker
    this.unlockAudioContext(this.audioContext);

    const response = await fetch(audioUri);
    const arrayBuffer = await response.arrayBuffer();
    
    // Decode with browser compatibility wrapper
    this.audioBuffer = await this.decodeAudio(this.audioContext, arrayBuffer);
    this._durationSec = this.audioBuffer.duration;

    return Math.round(this._durationSec * 1000);
  }

  /**
   * Phát từ vị trí hiện tại
   */
  play() {
    if (!this.audioContext || !this.audioBuffer || this._isPlaying) return;

    // Resume context nếu bị suspended (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch((err) => console.warn('[WebAudioEngine] Failed to resume on play:', err));
    }

    this.source = this.audioContext.createBufferSource();
    this.source.buffer = this.audioBuffer;
    this.source.playbackRate.value = this._playbackRate;
    this.source.connect(this.gainNode || this.audioContext.destination);

    // Bắt đầu từ offset hiện tại
    this.source.start(0, this._offsetSec);
    this._startedAt = this.audioContext.currentTime;
    this._isPlaying = true;

    // Track position
    this.startPositionTracking();

    // Khi audio kết thúc tự nhiên
    this.source.onended = () => {
      if (this._isPlaying) {
        this._isPlaying = false;
        this.stopPositionTracking();
        this.onPositionUpdate?.(this.getPositionMs(), false);
      }
    };
  }

  /**
   * Tạm dừng
   */
  pause() {
    if (!this._isPlaying || !this.audioContext) return;

    // Lưu vị trí hiện tại trước khi dừng
    this._offsetSec = this.getCurrentOffsetSec();
    this.stopSource();
    this._isPlaying = false;
    this.stopPositionTracking();
    this.onPositionUpdate?.(this.getPositionMs(), false);
  }

  /**
   * Seek đến vị trí chính xác (ms)
   */
  seekTo(positionMs: number) {
    const wasPlaying = this._isPlaying;

    if (wasPlaying) {
      this.stopSource();
      this._isPlaying = false;
    }

    this._offsetSec = Math.max(0, Math.min(positionMs / 1000, this._durationSec));

    if (wasPlaying) {
      this.play();
    }

    this.onPositionUpdate?.(positionMs, wasPlaying);
  }

  /**
   * Lấy vị trí hiện tại (ms)
   */
  getPositionMs(): number {
    return Math.round(this.getCurrentOffsetSec() * 1000);
  }

  /**
   * Đổi tốc độ phát
   */
  setPlaybackRate(rate: number) {
    if (this._isPlaying && this.audioContext) {
      this._offsetSec = this.getCurrentOffsetSec();
      this._startedAt = this.audioContext.currentTime;
    }
    this._playbackRate = rate;
    if (this.source && this._isPlaying) {
      this.source.playbackRate.value = rate;
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
    if (this.audioContext) {
      await this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.audioBuffer = null;
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
      const channelData = this.audioBuffer.getChannelData(0); // Dùng channel đầu tiên (mono/left)
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

      // Chuẩn hóa về khoảng [0.15, 1.0] để hiển thị đẹp
      const maxVal = Math.max(...points, 0.01);
      return points.map(v => 0.15 + (v / maxVal) * 0.85);
    } catch {
      return new Array(numPoints).fill(0.1);
    }
  }

  // ─── Internal ───

  private getCurrentOffsetSec(): number {
    if (!this._isPlaying || !this.audioContext) return this._offsetSec;
    const elapsed = (this.audioContext.currentTime - this._startedAt) * this._playbackRate;
    return Math.min(this._offsetSec + elapsed, this._durationSec);
  }

  private stopSource() {
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch {}
      this.source.disconnect();
      this.source = null;
    }
  }

  private stop() {
    this.stopSource();
    this._isPlaying = false;
    this._offsetSec = 0;
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
