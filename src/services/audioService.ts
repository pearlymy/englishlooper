import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import { Segment } from '../types';
import { WebAudioEngine } from './webAudioEngine';

export interface PlaybackCallbackData {
  positionMs: number;
  isPlaying: boolean;
  activeSegmentId: string | null;
  loopProgress: number;
}

export class AudioService {
  // Native (expo-av)
  private sound: any = null;
  
  // Web (WebAudioEngine)
  private webEngine: WebAudioEngine | null = null;

  private segments: Segment[] = [];
  private activeSegment: Segment | null = null;
  
  private maxLoops: number = 3;
  private restTimeMs: number = 1000;
  private autoAdvance: boolean = true;
  private loopCount: number = 0;
  private isWaitingRest: boolean = false;
  private playbackRate: number = 1.0;
  private isTransitioning: boolean = false;
  // When true, audio plays freely without segment boundary checks
  private isInBackground: boolean = false;
  // Track active rest timeout so we can cancel it during transitions
  private restTimeoutId: ReturnType<typeof setTimeout> | null = null;

  private onStatusUpdateCallback: ((data: PlaybackCallbackData) => void) | null = null;

  constructor() {
    if (Platform.OS !== 'web' && Audio) {
      Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        playThroughEarpieceAndroid: false,    // Route through loud speaker
      }).catch((err: any) => console.warn('Audio Mode error:', err));
    }
  }

  static async getAudioDuration(audioUri: string): Promise<number> {
    if (Platform.OS === 'web') {
      // Web: dùng HTML5 Audio để lấy duration nhanh
      return new Promise((resolve) => {
        const audio = new window.Audio();
        audio.addEventListener('loadedmetadata', () => {
          resolve(Math.round(audio.duration * 1000));
        });
        audio.addEventListener('error', () => resolve(0));
        audio.src = audioUri;
      });
    }

    try {
      const { sound, status } = await Audio.Sound.createAsync(
        { uri: audioUri }, { shouldPlay: false }
      );
      let durationMs = 0;
      if (status.isLoaded && status.durationMillis) {
        durationMs = status.durationMillis;
      }
      await sound.unloadAsync();
      return durationMs;
    } catch {
      return 0;
    }
  }

  async loadSound(
    audioUri: string,
    segments: Segment[],
    onStatusUpdate: (data: PlaybackCallbackData) => void
  ) {
    await this.unload();
    this.segments = segments;
    this.onStatusUpdateCallback = onStatusUpdate;
    this.loopCount = 0;
    this.isWaitingRest = false;
    this.isTransitioning = false;

    if (Platform.OS === 'web') {
      // Web: dùng WebAudioEngine (sample-accurate)
      this.webEngine = new WebAudioEngine();
      await this.webEngine.load(audioUri);

      this.webEngine.setOnPositionUpdate((positionMs, isPlaying) => {
        this.handlePositionUpdate(positionMs, isPlaying);
      });

      // Listen for background/foreground transitions to avoid sentence-cutting bug
      this.webEngine.setOnVisibilityChange((isHidden: boolean) => {
        this.handleVisibilityChange(isHidden);
      });

      console.log('[AudioService] Web: Loaded with WebAudioEngine (sample-accurate)');
    } else {
      // Native: dùng expo-av
      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUri },
        { shouldPlay: false, rate: this.playbackRate, shouldCorrectPitch: true, volume: 1.0 },
        this.handleNativeStatus.bind(this)
      );
      this.sound = sound;
    }
  }

  updateSegments(segments: Segment[]) {
    this.segments = segments;
  }

  setLoopConfig(maxLoops: number, restTimeSec: number, autoAdvance: boolean) {
    this.maxLoops = maxLoops;
    this.restTimeMs = restTimeSec * 1000;
    this.autoAdvance = autoAdvance;
  }

  async setPlaybackRate(rate: number) {
    this.playbackRate = rate;
    if (Platform.OS === 'web' && this.webEngine) {
      this.webEngine.setPlaybackRate(rate);
    } else if (this.sound) {
      await this.sound.setRateAsync(rate, true);
    }
  }

  async seekTo(positionMs: number) {
    if (!this.activeSegment) return;
    const clamped = Math.max(
      this.activeSegment.startTimeMs,
      Math.min(positionMs, this.activeSegment.endTimeMs)
    );

    if (Platform.OS === 'web' && this.webEngine) {
      this.webEngine.seekTo(clamped);
    } else if (this.sound) {
      await this.sound.setPositionAsync(clamped);
    }
  }

  async selectSegment(segment: Segment) {
    if (this.isTransitioning) return;
    this.isTransitioning = true;

    try {
      this.activeSegment = segment;
      this.loopCount = 0;
      this.isWaitingRest = false;

      if (Platform.OS === 'web' && this.webEngine) {
        this.webEngine.seekTo(segment.startTimeMs);
      } else if (this.sound) {
        await this.sound.setPositionAsync(segment.startTimeMs);
      }

      this.triggerUpdate(segment.startTimeMs, false);
    } finally {
      setTimeout(() => { this.isTransitioning = false; }, 100);
    }
  }

  async play() {
    if (this.isWaitingRest) return;

    if (Platform.OS === 'web' && this.webEngine) {
      this.webEngine.play();
    } else if (this.sound) {
      await this.sound.playAsync();
    }
  }

  async pause() {
    if (Platform.OS === 'web' && this.webEngine) {
      this.webEngine.pause();
    } else if (this.sound) {
      await this.sound.pauseAsync();
    }
  }

  async unload() {
    // Cancel any pending rest timeout
    if (this.restTimeoutId) {
      clearTimeout(this.restTimeoutId);
      this.restTimeoutId = null;
    }
    if (Platform.OS === 'web' && this.webEngine) {
      await this.webEngine.unload();
      this.webEngine = null;
    } else if (this.sound) {
      await this.sound.unloadAsync();
      this.sound = null;
    }
    this.segments = [];
    this.activeSegment = null;
    this.onStatusUpdateCallback = null;
    this.isTransitioning = false;
    this.isInBackground = false;
    this.isWaitingRest = false;
  }

  getActiveSegment(): Segment | null {
    return this.activeSegment;
  }

  // ─── Position tracking ───

  /**
   * Web: callback từ WebAudioEngine (50ms interval)
   */
  private handlePositionUpdate(positionMs: number, isPlaying: boolean) {
    if (!this.activeSegment || this.isWaitingRest || this.isTransitioning) return;

    this.triggerUpdate(positionMs, isPlaying);

    // WAV + background: SKIP segment boundary checks.
    // Shadow <audio> can't seek accurately on blob WAV (Chrome bug),
    // so any seek in handleSegmentEnd would land at wrong position,
    // causing rapid-fire cascading segment jumps.
    // MP3 in background: loop normally (seeking works fine for MP3).
    if (this.isInBackground && this.webEngine?.isWavMode) {
      return;
    }

    // Kiểm tra vượt ranh giới segment
    if (isPlaying && positionMs >= this.activeSegment.endTimeMs) {
      this.handleSegmentEnd();
    }
  }

  /**
   * Native: callback từ expo-av
   */
  private handleNativeStatus(status: any) {
    if (!status.isLoaded || !this.activeSegment || this.isWaitingRest || this.isTransitioning) return;

    const position = status.positionMillis;
    const isPlaying = status.isPlaying;

    this.triggerUpdate(position, isPlaying);

    if (isPlaying && position >= this.activeSegment.endTimeMs) {
      this.handleSegmentEnd();
    }
  }

  // ─── Segment loop logic ───

  private async handleSegmentEnd() {
    if (!this.activeSegment || this.isTransitioning) return;
    this.isTransitioning = true;

    try {
      await this.pause();
      this.loopCount++;
      this.triggerUpdate(this.activeSegment.endTimeMs, false);

      if (this.loopCount >= this.maxLoops) {
        this.loopCount = 0;

        if (this.autoAdvance) {
          const currentIndex = this.segments.findIndex(s => s.id === this.activeSegment?.id);
          const nextSegment = this.segments[currentIndex + 1];

          if (nextSegment) {
            this.activeSegment = nextSegment;

            if (Platform.OS === 'web' && this.webEngine) {
              this.webEngine.seekTo(nextSegment.startTimeMs);
            } else if (this.sound) {
              await this.sound.setPositionAsync(nextSegment.startTimeMs);
            }

            if (this.restTimeMs > 0) {
              await this.waitRestTime(() => this.play());
            } else {
              await this.play();
            }
          } else {
            this.triggerUpdate(0, false);
          }
        }
      } else {
        // Lặp lại câu hiện tại
        if (Platform.OS === 'web' && this.webEngine) {
          this.webEngine.seekTo(this.activeSegment.startTimeMs);
        } else if (this.sound) {
          await this.sound.setPositionAsync(this.activeSegment.startTimeMs);
        }

        if (this.restTimeMs > 0) {
          await this.waitRestTime(() => this.play());
        } else {
          await this.play();
        }
      }
    } finally {
      this.isTransitioning = false;
    }
  }

  private async waitRestTime(onComplete: () => void) {
    this.isWaitingRest = true;
    this.triggerUpdate(this.activeSegment ? this.activeSegment.startTimeMs : 0, false);

    // Cancel any previous pending rest timeout
    if (this.restTimeoutId) {
      clearTimeout(this.restTimeoutId);
      this.restTimeoutId = null;
    }

    this.restTimeoutId = setTimeout(() => {
      this.restTimeoutId = null;
      this.isWaitingRest = false;
      onComplete();
    }, this.restTimeMs);
  }

  // ─── Background/Foreground transition handling ───

  /**
   * Handle visibility change from WebAudioEngine.
   * Loop logic runs NORMALLY in background (via shadow audio timeupdate).
   * This handler only ensures clean state transitions:
   * - Going to background: clear any stale transitioning/rest states
   * - Returning: re-sync active segment if position drifted
   */
  private handleVisibilityChange(isHidden: boolean) {
    if (isHidden) {
      console.log('[AudioService] Page hidden — loop continues via shadow audio');
      this.isInBackground = true;
      // Clear any stuck transitioning state to prevent deadlocks
      this.isTransitioning = false;
    } else {
      console.log('[AudioService] Page visible — re-syncing segment if needed');
      this.isInBackground = false;

      if (Platform.OS === 'web' && this.webEngine && this.activeSegment) {
        const currentPos = this.webEngine.getPositionMs();
        const isPlaying = this.webEngine.isPlaying;

        // Check if position ended up outside the active segment
        // (can happen if shadow audio seeking was slightly inaccurate)
        if (currentPos >= this.activeSegment.endTimeMs || currentPos < this.activeSegment.startTimeMs) {
          // Find the correct segment for current position
          const matchedSegment = this.findSegmentForPosition(currentPos);
          if (matchedSegment) {
            if (matchedSegment.id !== this.activeSegment.id) {
              console.log(`[AudioService] Re-synced to segment #${matchedSegment.index} (was #${this.activeSegment.index})`);
              this.activeSegment = matchedSegment;
              this.loopCount = 0;
            }
            // Seek to the start of the matched segment to resume cleanly
            this.webEngine.seekTo(matchedSegment.startTimeMs);
            this.triggerUpdate(matchedSegment.startTimeMs, isPlaying);
          }
        }
      }
    }
  }

  /**
   * Find the segment that contains the given position.
   * Returns the segment if found, or the last segment if position is past all segments.
   */
  private findSegmentForPosition(positionMs: number): Segment | null {
    if (this.segments.length === 0) return null;

    // Find segment that contains this position
    for (const seg of this.segments) {
      if (positionMs >= seg.startTimeMs && positionMs < seg.endTimeMs) {
        return seg;
      }
    }

    // Position is past all segments — return the last one
    if (positionMs >= this.segments[this.segments.length - 1].endTimeMs) {
      return this.segments[this.segments.length - 1];
    }

    // Position is before all segments — return the first one
    return this.segments[0];
  }

  getAmplitudeData(numPoints: number): number[] {
    if (Platform.OS === 'web' && this.webEngine && this.activeSegment) {
      return this.webEngine.getAmplitudeData(
        this.activeSegment.startTimeMs,
        this.activeSegment.endTimeMs,
        numPoints
      );
    }
    // Fallback: smooth deterministic pattern
    return Array.from({ length: numPoints }).map((_, i) => {
      const start = this.activeSegment ? this.activeSegment.startTimeMs : 0;
      return 0.15 + (Math.abs(Math.sin(i * 0.32 + start * 0.0008)) * 0.85);
    });
  }

  private triggerUpdate(positionMs: number, isPlaying: boolean) {
    if (this.onStatusUpdateCallback) {
      this.onStatusUpdateCallback({
        positionMs,
        isPlaying: isPlaying && !this.isWaitingRest,
        activeSegmentId: this.activeSegment ? this.activeSegment.id : null,
        loopProgress: this.loopCount,
      });
    }
  }
}
