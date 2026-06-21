import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * WhisperService — Dùng Whisper AI (qua Groq API) để transcribe + cắt câu
 *
 * Tại sao Whisper?
 * - AI hiểu NGÔN NGỮ → biết ranh giới câu thật sự
 * - Trả về timestamps chính xác cho từng câu
 * - Hỗ trợ 100+ ngôn ngữ
 * - Groq API: MIỄN PHÍ, nhanh (~3s cho file 5 phút)
 *
 * Flow: Upload MP3 → Whisper transcribe → segments[] với {start, end, text}
 */

const API_KEY_STORAGE = '@mp3looper_groq_api_key';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const WHISPER_MODEL = 'whisper-large-v3-turbo';
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024; // 24MB safety margin (Groq limit: 25MB)
const CHUNK_DURATION_SEC = 600; // 10 minutes per chunk for very long files
const CHUNK_OVERLAP_SEC = 30;  // 30s overlap between chunks to avoid cutting sentences

export interface WhisperWord {
  word: string;
  start: number;  // seconds
  end: number;    // seconds
}

export interface WhisperSegment {
  start: number;  // seconds
  end: number;    // seconds
  text: string;
}

export interface WhisperResult {
  text: string;
  segments: WhisperSegment[];
  words: WhisperWord[];  // word-level timestamps for precise alignment
  language: string;
  duration: number;
}

export class WhisperService {
  /**
   * Lấy API key đã lưu
   */
  static async getApiKey(): Promise<string | null> {
    try {
      const stored = await AsyncStorage.getItem(API_KEY_STORAGE);
      if (stored) return stored;
      // Fallback: check env variable and auto-save
      const envKey = (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_GROQ_API_KEY) || '';
      if (envKey) {
        await AsyncStorage.setItem(API_KEY_STORAGE, envKey);
        return envKey;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Lưu API key
   */
  static async setApiKey(key: string): Promise<void> {
    await AsyncStorage.setItem(API_KEY_STORAGE, key.trim());
  }

  /**
   * Xóa API key
   */
  static async clearApiKey(): Promise<void> {
    await AsyncStorage.removeItem(API_KEY_STORAGE);
  }

  /**
   * Kiểm tra API key có hợp lệ không
   */
  static async validateApiKey(key: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${key.trim()}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * CHÍNH: Transcribe audio file bằng Whisper AI
   * Trả về segments với timestamps chính xác ở mức câu
   */
  static async transcribe(
    audioUri: string,
    apiKey: string,
    onProgress?: (msg: string) => void,
    language?: string
  ): Promise<WhisperResult> {
    onProgress?.('Đang chuẩn bị upload audio...');

    // 1. Lấy audio file dưới dạng Blob
    let blob = await this.getAudioBlob(audioUri);
    let fileName = 'audio.mp3';

    // 1.5. Auto-compress if file exceeds Groq's 25MB limit (web only)
    if (blob.size > MAX_UPLOAD_BYTES && Platform.OS === 'web') {
      onProgress?.(`File ${(blob.size / (1024 * 1024)).toFixed(1)}MB vượt giới hạn 25MB. Đang nén audio...`);
      blob = await this.compressAudioBlob(blob);
      fileName = 'audio.wav';
      console.log(`[Whisper] Compressed to ${(blob.size / (1024 * 1024)).toFixed(1)}MB`);

      // If still too large after compression, split into chunks
      if (blob.size > MAX_UPLOAD_BYTES) {
        onProgress?.('File vẫn lớn sau khi nén. Đang chia nhỏ và xử lý từng phần...');
        return await this.transcribeChunked(audioUri, apiKey, onProgress, language);
      }
      onProgress?.(`Đã nén xuống ${(blob.size / (1024 * 1024)).toFixed(1)}MB`);
    }

    // 2. Tạo FormData — request BOTH segment + word timestamps
    const formData = new FormData();
    formData.append('file', blob, fileName);
    formData.append('model', WHISPER_MODEL);
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'segment');
    formData.append('timestamp_granularities[]', 'word');

    if (language) {
      formData.append('language', language);
    }

    // 3. Gửi lên Groq API
    onProgress?.('Đang gửi audio tới Whisper AI...');

    const response = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Whisper] API error:', response.status, errorText);

      if (response.status === 401) {
        throw new Error('API key không hợp lệ. Vui lòng kiểm tra lại.');
      }
      if (response.status === 413) {
        throw new Error('File quá lớn. Groq hỗ trợ tối đa 25MB.');
      }
      if (response.status === 429) {
        throw new Error('Đã vượt giới hạn API. Vui lòng thử lại sau vài phút.');
      }
      throw new Error(`Lỗi API: ${response.status}`);
    }

    onProgress?.('Đang xử lý kết quả AI...');

    const data = await response.json();

    console.log('[Whisper] Transcription complete:', {
      language: data.language,
      segments: data.segments?.length,
      duration: data.duration,
    });

    // 4. Xử lý segments — dùng TRỰC TIẾP raw Whisper text (không sửa dấu câu)
    const segments: WhisperSegment[] = (data.segments || []).map((seg: any) => ({
      start: seg.start,
      end: seg.end,
      text: (seg.text || '').trim(),
    }));

    // 5. Extract word-level timestamps (chính xác hơn character ratio)
    const words: WhisperWord[] = (data.words || []).map((w: any) => ({
      word: (w.word || '').trim(),
      start: w.start,
      end: w.end,
    })).filter((w: WhisperWord) => w.word.length > 0);

    console.log(`[Whisper] ${segments.length} sentences, ${words.length} words detected`);
    segments.slice(0, 5).forEach((s, i) =>
      console.log(`  #${i}: ${s.start.toFixed(2)}s → ${s.end.toFixed(2)}s "${s.text.substring(0, 50)}"`)
    );

    onProgress?.(`AI phát hiện ${segments.length} câu, ${words.length} từ`);

    return {
      text: data.text || '',
      segments,
      words,
      language: data.language || 'unknown',
      duration: data.duration || 0,
    };
  }

  /**
   * Lấy audio file dưới dạng Blob (web + native)
   */
  private static async getAudioBlob(audioUri: string): Promise<Blob> {
    if (Platform.OS === 'web') {
      const response = await fetch(audioUri);
      return await response.blob();
    }

    // Native: đọc file qua fetch (Expo hỗ trợ file:// URI)
    const response = await fetch(audioUri);
    return await response.blob();
  }

  /**
   * Compress audio to 16kHz mono WAV using Web Audio API.
   * Whisper internally uses 16kHz mono, so this preserves quality while drastically reducing file size.
   */
  private static async compressAudioBlob(blob: Blob): Promise<Blob> {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const TARGET_SAMPLE_RATE = 16000;
    const numSamples = Math.ceil(audioBuffer.duration * TARGET_SAMPLE_RATE);
    const offlineContext = new OfflineAudioContext(1, numSamples, TARGET_SAMPLE_RATE);

    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start(0);

    const renderedBuffer = await offlineContext.startRendering();
    const wavBlob = this.audioBufferToWav(renderedBuffer);

    await audioContext.close();
    console.log(`[Whisper] Compressed: ${(blob.size / (1024 * 1024)).toFixed(1)}MB → ${(wavBlob.size / (1024 * 1024)).toFixed(1)}MB (16kHz mono WAV)`);

    return wavBlob;
  }

  /**
   * Chunked transcription for very long audio files (>12 min at 16kHz mono).
   * Splits audio into 10-minute chunks, transcribes each, and merges results with adjusted timestamps.
   */
  private static async transcribeChunked(
    audioUri: string,
    apiKey: string,
    onProgress?: (msg: string) => void,
    language?: string
  ): Promise<WhisperResult> {
    const blob = await this.getAudioBlob(audioUri);
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const TARGET_SAMPLE_RATE = 16000;
    const totalDuration = audioBuffer.duration;
    // Use stride = CHUNK_DURATION - OVERLAP to create overlapping chunks
    const stride = CHUNK_DURATION_SEC - CHUNK_OVERLAP_SEC;
    const numChunks = Math.ceil(totalDuration / stride);

    const allSegments: WhisperSegment[] = [];
    const allWords: WhisperWord[] = [];
    let fullText = '';
    let detectedLanguage = 'unknown';

    for (let i = 0; i < numChunks; i++) {
      const chunkStart = i * stride;
      const chunkEnd = Math.min(chunkStart + CHUNK_DURATION_SEC, totalDuration);
      const chunkDuration = chunkEnd - chunkStart;

      // Skip if chunk is too short (< 1s)
      if (chunkDuration < 1) continue;

      const startMin = Math.floor(chunkStart / 60);
      const endMin = Math.floor(chunkEnd / 60);
      onProgress?.(`🤖 Đang xử lý phần ${i + 1}/${numChunks} (${startMin}:00 → ${endMin}:00)...`);

      // Create chunk at 16kHz mono
      const chunkSamples = Math.ceil(chunkDuration * TARGET_SAMPLE_RATE);
      const offlineContext = new OfflineAudioContext(1, chunkSamples, TARGET_SAMPLE_RATE);
      const source = offlineContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineContext.destination);
      source.start(0, chunkStart, chunkDuration);

      const renderedBuffer = await offlineContext.startRendering();
      const wavBlob = this.audioBufferToWav(renderedBuffer);

      // Send chunk to Groq API — request both segment + word timestamps
      const formData = new FormData();
      formData.append('file', wavBlob, `chunk_${i}.wav`);
      formData.append('model', WHISPER_MODEL);
      formData.append('response_format', 'verbose_json');
      formData.append('timestamp_granularities[]', 'segment');
      formData.append('timestamp_granularities[]', 'word');
      if (language) formData.append('language', language);

      const response = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey.trim()}` },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Whisper] Chunk ${i + 1} API error:`, response.status, errorText);
        if (response.status === 401) throw new Error('API key không hợp lệ. Vui lòng kiểm tra lại.');
        if (response.status === 429) throw new Error('Đã vượt giới hạn API. Vui lòng thử lại sau vài phút.');
        throw new Error(`Lỗi API phần ${i + 1}: ${response.status}`);
      }

      const data = await response.json();

      if (i === 0) detectedLanguage = data.language || 'unknown';

      // Determine the overlap zone: segments from previous chunk that fall in overlap region
      // Only keep segments whose midpoint is NOT in the overlap zone of the previous chunk
      const overlapBoundary = i > 0 ? chunkStart + CHUNK_OVERLAP_SEC : 0;

      // Adjust timestamps: add chunkStart offset, dedup overlap
      for (const seg of (data.segments || [])) {
        const globalStart = seg.start + chunkStart;
        const globalEnd = seg.end + chunkStart;
        const midpoint = (globalStart + globalEnd) / 2;

        // For chunks after the first: skip segments whose midpoint falls
        // within the overlap region (already covered by previous chunk)
        if (i > 0 && midpoint < overlapBoundary) {
          continue;
        }

        allSegments.push({
          start: globalStart,
          end: globalEnd,
          text: (seg.text || '').trim(),
        });
      }

      // Process word-level timestamps with same dedup
      for (const w of (data.words || [])) {
        const globalStart = w.start + chunkStart;
        const globalEnd = w.end + chunkStart;
        const midpoint = (globalStart + globalEnd) / 2;

        if (i > 0 && midpoint < overlapBoundary) {
          continue;
        }

        allWords.push({
          word: (w.word || '').trim(),
          start: globalStart,
          end: globalEnd,
        });
      }

      // Only add text from non-overlapping parts
      if (i === 0) {
        fullText = data.text || '';
      } else {
        // Approximate: use segments we kept to reconstruct text for this chunk
        const keptText = (data.segments || [])
          .filter((seg: any) => {
            const mid = (seg.start + seg.end) / 2 + chunkStart;
            return mid >= overlapBoundary;
          })
          .map((seg: any) => (seg.text || '').trim())
          .join(' ');
        fullText += ' ' + keptText;
      }
    }

    await audioContext.close();

    console.log(`[Whisper] Chunked transcription complete: ${allSegments.length} segments, ${allWords.length} words from ${numChunks} overlapping chunks`);
    onProgress?.(`AI phát hiện ${allSegments.length} câu, ${allWords.length} từ (${numChunks} phần)`);

    return {
      text: fullText.trim(),
      segments: allSegments,
      words: allWords,
      language: detectedLanguage,
      duration: totalDuration,
    };
  }

  /**
   * Encode AudioBuffer to WAV Blob (16-bit PCM)
   */
  private static audioBufferToWav(buffer: AudioBuffer): Blob {
    const sampleRate = buffer.sampleRate;
    const numChannels = 1;
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;

    const channelData = buffer.getChannelData(0);
    const dataLength = channelData.length * bytesPerSample;
    const headerSize = 44;
    const totalSize = headerSize + dataLength;

    const arrayBuffer = new ArrayBuffer(totalSize);
    const view = new DataView(arrayBuffer);

    // RIFF header
    this.wavWriteString(view, 0, 'RIFF');
    view.setUint32(4, totalSize - 8, true);
    this.wavWriteString(view, 8, 'WAVE');

    // fmt sub-chunk
    this.wavWriteString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, bitDepth, true);

    // data sub-chunk
    this.wavWriteString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    // Write PCM samples
    let offset = headerSize;
    for (let i = 0; i < channelData.length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += bytesPerSample;
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  private static wavWriteString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  /**
   * SMART MERGE: Gộp Whisper segments thành CÂU HOÀN CHỈNH
   * 
   * Whisper trả segments theo phrase/clause (cụm từ ngắn 2-4s).
   * Logic merge: tích lũy segments cho đến khi:
   *   1. Gặp dấu kết thúc câu (. ? ! ...)  VÀ
   *   2. Tổng duration ≥ MIN_SENTENCE_SEC
   * 
   * → Tạo segments tự nhiên 5-15s = 1 câu hoàn chỉnh
   */
  private static mergeIntoSentences(segments: WhisperSegment[]): WhisperSegment[] {
    if (segments.length <= 1) return segments;

    const SENTENCES_PER_SEGMENT = 1;  // Mỗi segment = 1 câu
    const MAX_SENTENCE_SEC = 15;      // Tối đa 15s

    // Đếm số câu thực sự trong text (dựa trên dấu câu)
    const countSentences = (text: string): number => {
      const matches = text.match(/[.!?。？！…]+/g);
      return matches ? matches.length : 0;
    };

    const result: WhisperSegment[] = [];
    let accStart = segments[0].start;
    let accEnd = segments[0].end;
    let accText = segments[0].text;
    let sentenceCount = countSentences(segments[0].text);

    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      const wouldBeDuration = seg.end - accStart;

      // Kết thúc segment khi đủ câu HOẶC quá dài
      if (sentenceCount >= SENTENCES_PER_SEGMENT || wouldBeDuration > MAX_SENTENCE_SEC) {
        result.push({
          start: accStart,
          end: accEnd,
          text: accText.trim(),
        });
        accStart = seg.start;
        accEnd = seg.end;
        accText = seg.text;
        sentenceCount = countSentences(seg.text);
      } else {
        accEnd = seg.end;
        accText = accText + ' ' + seg.text;
        sentenceCount += countSentences(seg.text);
      }
    }

    // Đẩy câu cuối
    result.push({ start: accStart, end: accEnd, text: accText.trim() });

    // Gộp câu cuối nếu quá ngắn (< 2s)
    if (result.length > 1) {
      const last = result[result.length - 1];
      if (last.end - last.start < 2) {
        const prev = result[result.length - 2];
        prev.end = last.end;
        prev.text = (prev.text + ' ' + last.text).trim();
        result.pop();
      }
    }

    console.log(`[Whisper] Merged ${segments.length} phrases → ${result.length} segments (${SENTENCES_PER_SEGMENT} sentences each)`);
    return result;
  }

  /**
   * Fix missing punctuation — SAFE version.
   * Chỉ chèn dấu "." khi chắc chắn là ranh giới câu:
   * - Sau từ kết thúc dài ≥ 4 ký tự (tránh abbreviations/initials)
   * - Trước từ bắt đầu dài ≥ 2 ký tự viết hoa (tránh "I")
   * - Loại trừ proper nouns phổ biến (New York, Mr Smith, etc.)
   * 
   * NOTE: Hàm này giờ chỉ được dùng cho display, KHÔNG dùng cho alignment.
   */
  static fixMissingPunctuation(text: string): string {
    if (!text) return text;

    // Common words that start with uppercase but are NOT sentence starts
    const PROPER_PREFIXES = new Set([
      'I', 'Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Sr', 'Jr', 'St',
      'New', 'Old', 'North', 'South', 'East', 'West',
      'United', 'Great', 'San', 'Los', 'Las', 'El', 'La',
      'Mac', 'Mc', 'Van', 'Von', 'De', 'Du', 'Le',
    ]);

    return text.replace(/([a-z]{4,})\s+([A-Z][a-z]{2,})/g, (match, before, after) => {
      // Don't insert period if the capitalized word is a known proper noun prefix
      if (PROPER_PREFIXES.has(after)) return match;
      return `${before}. ${after}`;
    });
  }
}
