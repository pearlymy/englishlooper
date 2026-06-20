import { Platform } from 'react-native';

/**
 * AudioAnalyzer v3 — Cắt câu chính xác
 *
 * Chiến lược mới: "SENTENCE BOUNDARY DETECTION"
 * Thay vì cắt tại MỌI khoảng lặng (gây cắt giữa câu),
 * chỉ cắt tại những khoảng lặng ĐỦ DÀI + ĐỦ SÂU = ranh giới câu thật.
 *
 * Thuật toán:
 * 1. Tính RMS → smoothing → tìm TẤT CẢ khoảng lặng
 * 2. Xếp hạng khoảng lặng theo "sentence boundary score"
 *    (= duration × depth) — lặng lâu + sâu = chắc chắn là ranh giới câu
 * 3. Chọn top-N khoảng lặng sao cho mỗi segment ≈ 5-12s
 * 4. Greedy filter: đảm bảo min/max constraint
 */

export interface SilenceRegion {
  startMs: number;
  endMs: number;
  durationMs: number;
  depth: number;       // Độ sâu: tỷ lệ im lặng so với trung bình
  score: number;       // Score = duration × depth — càng cao = càng chắc là ranh giới câu
}

export interface SpeechSegment {
  startMs: number;
  endMs: number;
}

export interface AnalysisResult {
  durationMs: number;
  silenceRegions: SilenceRegion[];
  speechSegments: SpeechSegment[];
  splitPoints: number[];
  method: 'silero-vad' | 'rms-adaptive' | 'equal-split';
}

// ─── CONFIG ───
const MIN_SEGMENT_MS = 3000;    // Mỗi câu tối thiểu 3s (tránh cắt quá nhỏ)
const MAX_SEGMENT_MS = 15000;   // Mỗi câu tối đa 15s
const IDEAL_SEGMENT_MS = 8000;  // Lý tưởng ~8s mỗi câu (phù hợp shadowing)
const MIN_SILENCE_MS = 400;     // Chỉ xét khoảng lặng ≥ 400ms

export class AudioAnalyzer {
  static async analyze(
    audioUri: string,
    onProgress?: (msg: string) => void
  ): Promise<AnalysisResult> {
    if (Platform.OS === 'web') {
      return this.analyzeWeb(audioUri, onProgress);
    }
    return this.analyzeNative(audioUri, onProgress);
  }

  // ═══════════════════════════════════════════════════════
  // WEB ANALYSIS
  // ═══════════════════════════════════════════════════════
  private static async analyzeWeb(
    audioUri: string,
    onProgress?: (msg: string) => void
  ): Promise<AnalysisResult> {
    try {
      onProgress?.('Đang decode audio...');
      const { samples, sampleRate, durationMs } = await this.decodeAudioWeb(audioUri);

      onProgress?.('Đang phân tích sóng âm...');
      return this.runSmartSilenceDetection(samples, sampleRate, durationMs, onProgress);
    } catch (err) {
      console.error('[AudioAnalyzer] Web analysis failed:', err);
      onProgress?.('Lỗi phân tích, chia đều...');
      return this.createEqualSplitResult(180000);
    }
  }

  private static async decodeAudioWeb(audioUri: string): Promise<{
    samples: Float32Array;
    sampleRate: number;
    durationMs: number;
  }> {
    const response = await fetch(audioUri);
    const arrayBuffer = await response.arrayBuffer();
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const sampleRate = audioBuffer.sampleRate;
    const durationMs = Math.round((audioBuffer.length / sampleRate) * 1000);
    const samples = this.mixToMono(audioBuffer);
    await audioContext.close();
    return { samples, sampleRate, durationMs };
  }

  // ═══════════════════════════════════════════════════════
  // SMART SILENCE DETECTION — Thuật toán mới
  // ═══════════════════════════════════════════════════════
  private static runSmartSilenceDetection(
    samples: Float32Array,
    sampleRate: number,
    durationMs: number,
    onProgress?: (msg: string) => void
  ): AnalysisResult {
    // ── BƯỚC 1: Tính RMS energy cho từng frame ──
    const FRAME_MS = 30;
    const frameSize = Math.round((FRAME_MS / 1000) * sampleRate);

    const rawRMS: number[] = [];
    for (let i = 0; i < samples.length; i += frameSize) {
      const end = Math.min(i + frameSize, samples.length);
      let sumSq = 0;
      for (let j = i; j < end; j++) {
        sumSq += samples[j] * samples[j];
      }
      rawRMS.push(Math.sqrt(sumSq / (end - i)));
    }

    // ── BƯỚC 2: Heavy smoothing — lọc bỏ spike ngắn ──
    // Smoothing 7 frames = ~210ms → loại bỏ consonant/click ngắn
    const smoothed = this.movingAverage(rawRMS, 7);

    // ── BƯỚC 3: Adaptive threshold ──
    const sorted = [...smoothed].sort((a, b) => a - b);
    const noiseFloor = sorted[Math.floor(sorted.length * 0.05)] || 0;  // Bottom 5%
    const speechLevel = sorted[Math.floor(sorted.length * 0.60)] || 0; // 60th percentile (speech)

    // Threshold: 40% giữa noise floor và speech level
    // Cao hơn trước (25%) → ít nhạy hơn → ít cắt sai
    const silenceThreshold = noiseFloor + (speechLevel - noiseFloor) * 0.40;

    console.log(`[SmartSilence] noiseFloor=${noiseFloor.toFixed(4)} speechLevel=${speechLevel.toFixed(4)} threshold=${silenceThreshold.toFixed(4)}`);

    // ── BƯỚC 4: Tìm TẤT CẢ khoảng lặng ──
    const allSilences: SilenceRegion[] = [];
    let silenceStart: number | null = null;
    let minRMSInSilence = Infinity;

    for (let i = 0; i < smoothed.length; i++) {
      const timeMs = i * FRAME_MS;

      if (smoothed[i] <= silenceThreshold) {
        if (silenceStart === null) {
          silenceStart = timeMs;
          minRMSInSilence = smoothed[i];
        }
        minRMSInSilence = Math.min(minRMSInSilence, smoothed[i]);
      } else {
        if (silenceStart !== null) {
          const dur = timeMs - silenceStart;
          if (dur >= MIN_SILENCE_MS) {
            // Depth: ratio silence vs speech — càng sâu càng chắc là ranh giới
            const depth = speechLevel > 0 ? 1 - (minRMSInSilence / speechLevel) : 1;
            allSilences.push({
              startMs: silenceStart,
              endMs: timeMs,
              durationMs: dur,
              depth: Math.max(0, depth),
              score: dur * Math.max(0.1, depth), // Score = duration × depth
            });
          }
          silenceStart = null;
          minRMSInSilence = Infinity;
        }
      }
    }

    // Close nếu file kết thúc bằng silence
    if (silenceStart !== null) {
      const dur = durationMs - silenceStart;
      if (dur >= MIN_SILENCE_MS) {
        const depth = speechLevel > 0 ? 1 - (minRMSInSilence / speechLevel) : 1;
        allSilences.push({
          startMs: silenceStart, endMs: durationMs, durationMs: dur,
          depth: Math.max(0, depth), score: dur * Math.max(0.1, depth),
        });
      }
    }

    console.log(`[SmartSilence] Found ${allSilences.length} silence regions (≥${MIN_SILENCE_MS}ms)`);

    onProgress?.(`Phát hiện ${allSilences.length} khoảng lặng`);

    // ── BƯỚC 5: Chọn TOP-N khoảng lặng = ranh giới câu thật ──
    // Số câu lý tưởng dựa trên tổng duration
    const idealSegments = Math.max(2, Math.round(durationMs / IDEAL_SEGMENT_MS));
    const idealSplits = idealSegments - 1; // Số điểm cắt = số câu - 1

    const splitPoints = this.selectBestSplitPoints(
      allSilences,
      durationMs,
      idealSplits
    );

    console.log(`[SmartSilence] Selected ${splitPoints.length} split points (target: ${idealSplits})`);
    onProgress?.(`Chọn ${splitPoints.length} điểm cắt tối ưu`);

    // Tính speech segments từ split points
    const speechSegments = this.splitPointsToSpeechSegments(splitPoints, durationMs);

    return {
      durationMs,
      silenceRegions: allSilences,
      speechSegments,
      splitPoints,
      method: 'rms-adaptive',
    };
  }

  /**
   * CHIẾN LƯỢC CHỌN SPLIT POINTS:
   * 
   * 1. Sắp xếp khoảng lặng theo SCORE giảm dần (lặng lâu + sâu = ưu tiên cao)
   * 2. Greedy chọn từng khoảng lặng, bỏ qua nếu tạo segment quá ngắn
   * 3. Kiểm tra max segment constraint
   * 
   * → Ưu tiên cắt tại ranh giới câu rõ ràng nhất!
   */
  private static selectBestSplitPoints(
    silences: SilenceRegion[],
    durationMs: number,
    targetSplits: number
  ): number[] {
    if (silences.length === 0) {
      return this.generateEqualSplits(durationMs);
    }

    // Bỏ silences ở đầu/cuối file (< 1s từ biên)
    const interior = silences.filter(
      s => s.startMs > 1000 && s.endMs < durationMs - 1000
    );

    if (interior.length === 0) {
      return this.generateEqualSplits(durationMs);
    }

    // Sắp xếp theo SCORE giảm dần — khoảng lặng "chắc chắn nhất" lên đầu
    const ranked = [...interior].sort((a, b) => b.score - a.score);

    // Greedy: chọn từng khoảng lặng, kiểm tra constraint
    const selected: number[] = [];

    for (const silence of ranked) {
      if (selected.length >= targetSplits * 1.3) break; // Cho phép vượt 30%

      const point = Math.round((silence.startMs + silence.endMs) / 2);

      // Kiểm tra: không tạo segment quá ngắn
      const allPoints = [...selected, point].sort((a, b) => a - b);
      const boundaries = [0, ...allPoints, durationMs];
      
      let valid = true;
      for (let i = 0; i < boundaries.length - 1; i++) {
        const segLen = boundaries[i + 1] - boundaries[i];
        if (segLen < MIN_SEGMENT_MS) {
          valid = false;
          break;
        }
      }

      if (valid) {
        selected.push(point);
      }
    }

    // Sort chronologically
    selected.sort((a, b) => a - b);

    // Kiểm tra: nếu có segment > MAX, chèn split tại silence gần nhất
    const finalPoints: number[] = [];
    let prev = 0;

    for (const point of selected) {
      if (point - prev > MAX_SEGMENT_MS) {
        // Tìm silence tốt nhất giữa prev và point
        const midSilence = interior
          .filter(s => {
            const c = (s.startMs + s.endMs) / 2;
            return c > prev + MIN_SEGMENT_MS && c < point - MIN_SEGMENT_MS;
          })
          .sort((a, b) => b.score - a.score)[0];

        if (midSilence) {
          finalPoints.push(Math.round((midSilence.startMs + midSilence.endMs) / 2));
        } else {
          finalPoints.push(prev + Math.round((point - prev) / 2));
        }
      }
      finalPoints.push(point);
      prev = point;
    }

    // Kiểm tra đoạn cuối
    if (durationMs - prev > MAX_SEGMENT_MS) {
      const midSilence = interior
        .filter(s => {
          const c = (s.startMs + s.endMs) / 2;
          return c > prev + MIN_SEGMENT_MS && c < durationMs - MIN_SEGMENT_MS;
        })
        .sort((a, b) => b.score - a.score)[0];

      if (midSilence) {
        finalPoints.push(Math.round((midSilence.startMs + midSilence.endMs) / 2));
      } else {
        finalPoints.push(prev + Math.round((durationMs - prev) / 2));
      }
    }

    return finalPoints.sort((a, b) => a - b);
  }

  /**
   * Convert split points → speech segments (for AnalysisResult)
   */
  private static splitPointsToSpeechSegments(
    splitPoints: number[],
    durationMs: number
  ): SpeechSegment[] {
    const boundaries = [0, ...splitPoints, durationMs];
    const segments: SpeechSegment[] = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
      segments.push({ startMs: boundaries[i], endMs: boundaries[i + 1] });
    }
    return segments;
  }

  // ═══════════════════════════════════════════════════════
  // NATIVE FALLBACK
  // ═══════════════════════════════════════════════════════
  private static async analyzeNative(
    audioUri: string,
    onProgress?: (msg: string) => void
  ): Promise<AnalysisResult> {
    onProgress?.('Đang đọc file audio...');
    let durationMs = 0;
    try {
      const { Audio } = require('expo-av');
      const { sound, status } = await Audio.Sound.createAsync(
        { uri: audioUri }, { shouldPlay: false }
      );
      if (status.isLoaded && status.durationMillis) {
        durationMs = status.durationMillis;
      }
      await sound.unloadAsync();
    } catch { durationMs = 180000; }

    onProgress?.('Tạo phân đoạn...');
    return this.createEqualSplitResult(durationMs);
  }

  // ═══════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════
  private static mixToMono(buffer: AudioBuffer): Float32Array {
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
    const mixed = new Float32Array(buffer.length);
    const n = buffer.numberOfChannels;
    for (let ch = 0; ch < n; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < buffer.length; i++) {
        mixed[i] += data[i] / n;
      }
    }
    return mixed;
  }

  private static movingAverage(values: number[], windowSize: number): number[] {
    const result: number[] = [];
    const half = Math.floor(windowSize / 2);
    for (let i = 0; i < values.length; i++) {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
        sum += values[j]; count++;
      }
      result.push(sum / count);
    }
    return result;
  }

  private static generateEqualSplits(durationMs: number): number[] {
    const n = Math.max(1, Math.round(durationMs / IDEAL_SEGMENT_MS));
    const seg = durationMs / n;
    const points: number[] = [];
    for (let i = 1; i < n; i++) points.push(Math.round(i * seg));
    return points;
  }

  private static createEqualSplitResult(durationMs: number): AnalysisResult {
    return {
      durationMs,
      silenceRegions: [],
      speechSegments: [],
      splitPoints: this.generateEqualSplits(durationMs),
      method: 'equal-split',
    };
  }
}
