import { Segment } from '../types';
import { AudioAnalyzer, AnalysisResult } from './audioAnalyzer';
import { WhisperService } from './whisperService';

export class AutocutService {
  /**
   * CHÍNH: Cắt câu — ưu tiên AI (Whisper) nếu có API key, fallback RMS
   */
  static async analyzeAndSplit(
    audioUri: string,
    transcriptText?: string,
    onProgress?: (msg: string) => void,
    useAI?: boolean,
    apiKey?: string
  ): Promise<{ segments: Segment[]; durationMs: number; method: string }> {

    // ── MODE 1: AI (Whisper) — chính xác nhất ──
    if (useAI && apiKey) {
      try {
        onProgress?.('🤖 Đang dùng Whisper AI cắt câu...');
        const result = await this.whisperSplit(audioUri, apiKey, transcriptText, onProgress);
        return result;
      } catch (err: any) {
        console.error('[AutocutService] Whisper failed:', err);
        onProgress?.(`⚠️ AI lỗi: ${err.message}. Chuyển sang RMS...`);
        // Fall through to RMS
      }
    }

    // ── MODE 2: RMS Silence Detection ──
    onProgress?.('Đang phân tích phổ âm thanh...');
    const analysis = await AudioAnalyzer.analyze(audioUri, onProgress);

    if (analysis.durationMs <= 0) {
      throw new Error('Không thể đọc thời lượng audio');
    }

    onProgress?.(`Phát hiện ${analysis.silenceRegions.length} khoảng lặng...`);

    let segments: Segment[];
    if (transcriptText?.trim()) {
      onProgress?.('Đang khớp transcript với đoạn nghe...');
      segments = this.createSegmentsWithTranscript(analysis, transcriptText);
    } else {
      onProgress?.('Đang tạo phân đoạn...');
      segments = this.createSegmentsFromAnalysis(analysis);
    }

    onProgress?.(`Hoàn tất: ${segments.length} câu`);
    return { segments, durationMs: analysis.durationMs, method: analysis.method };
  }

  /**
   * AI MODE: Dùng Whisper transcribe → lấy timestamps câu
   * Whisper hiểu ngôn ngữ → biết ranh giới câu thật → KHÔNG BAO GIỜ cắt giữa câu
   */
  private static async whisperSplit(
    audioUri: string,
    apiKey: string,
    transcriptText?: string,
    onProgress?: (msg: string) => void
  ): Promise<{ segments: Segment[]; durationMs: number; method: string }> {
    const whisperResult = await WhisperService.transcribe(audioUri, apiKey, onProgress);

    const durationMs = Math.round(whisperResult.duration * 1000);
    const whisperSegs = whisperResult.segments;

    if (transcriptText?.trim()) {
      onProgress?.('🤖 Đang khớp transcript với âm thanh...');
      const sentences = this.smartSplitTranscript(transcriptText);
      const userSentences = this.groupSentences2by2(sentences);
      if (userSentences.length > 0) {
        const segments = this.alignSentencesWithWhisper(userSentences, whisperSegs, durationMs);
        onProgress?.(`✅ Khớp thành công ${segments.length} đoạn theo transcript (2 câu/đoạn)`);
        return { segments, durationMs, method: 'whisper-ai-aligned' };
      }
    }

    // Gộp raw Whisper segments 2-by-2
    const groupedWhisperSegs: typeof whisperSegs = [];
    for (let i = 0; i < whisperSegs.length; i += 2) {
      const seg1 = whisperSegs[i];
      const seg2 = whisperSegs[i + 1];
      if (seg2) {
        groupedWhisperSegs.push({
          start: seg1.start,
          end: seg2.end,
          text: (seg1.text + ' ' + seg2.text).trim()
        });
      } else {
        groupedWhisperSegs.push(seg1);
      }
    }

    // PRE_PAD: bắt đầu sớm hơn 300ms để không cắt mất đầu câu
    // POST_PAD: kết thúc muộn hơn 200ms để nghe hết cuối câu
    const PRE_PAD_MS = 300;
    const POST_PAD_MS = 200;

    // Tạo segments với padding
    const segments: Segment[] = groupedWhisperSegs.map((seg, i) => {
      // Start: lùi 300ms nhưng không sớm hơn end của segment trước (tránh overlap)
      const rawStart = Math.round(seg.start * 1000);
      const prevEnd = i > 0 ? Math.round(groupedWhisperSegs[i - 1].end * 1000) : 0;
      const startMs = Math.max(prevEnd, rawStart - PRE_PAD_MS);

      // End: thêm 200ms nhưng không muộn hơn start của segment sau (tránh overlap)
      const rawEnd = Math.round(seg.end * 1000);
      const nextStart = i < groupedWhisperSegs.length - 1
        ? Math.round(groupedWhisperSegs[i + 1].start * 1000)
        : durationMs;
      const endMs = Math.min(nextStart, rawEnd + POST_PAD_MS);

      return {
        id: `seg_ai_${i + 1}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        index: i + 1,
        startTimeMs: startMs,
        endTimeMs: endMs,
        durationMs: endMs - startMs,
        transcript: seg.text,
        status: 'not_started' as const,
      };
    });

    // Debug: log first 5 segments
    console.log('[WhisperSplit] First 5 segments (with padding):');
    segments.slice(0, 5).forEach(s =>
      console.log(`  #${s.index}: ${s.startTimeMs}ms → ${s.endTimeMs}ms (${s.durationMs}ms) "${(s.transcript || '').substring(0, 60)}..."`)
    );

    onProgress?.(`✅ AI cắt ${segments.length} đoạn (2 câu/đoạn)`);

    return { segments, durationMs, method: 'whisper-ai' };
  }

  /**
   * Khớp các câu trong user transcript với raw Whisper segments bằng Needleman-Wunsch
   */
  private static alignSentencesWithWhisper(
    userSentences: string[],
    whisperSegs: { start: number; end: number; text: string }[],
    durationMs: number
  ): Segment[] {
    // 1. Tách Whisper segments thành các từ kèm time (dựa trên character ratio)
    interface TimedWord {
      word: string;
      startMs: number;
      endMs: number;
    }
    const timedWords: TimedWord[] = [];
    for (const seg of whisperSegs) {
      const segText = seg.text.trim();
      const words = segText.split(/\s+/).filter(w => w.length > 0);
      if (words.length === 0) continue;

      const segStartMs = Math.round(seg.start * 1000);
      const segEndMs = Math.round(seg.end * 1000);
      const segDur = segEndMs - segStartMs;

      // Tính length của từng từ để chia tỉ lệ
      const charCounts = words.map(w => w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").length || 1);
      const totalChars = charCounts.reduce((a, b) => a + b, 0);

      let currentStart = segStartMs;
      for (let i = 0; i < words.length; i++) {
        const wordDur = Math.round(segDur * (charCounts[i] / totalChars));
        const wordEnd = currentStart + wordDur;
        timedWords.push({
          word: words[i],
          startMs: currentStart,
          endMs: wordEnd
        });
        currentStart = wordEnd;
      }
    }

    // 2. Tách userSentences thành các từ kèm index câu
    interface UserWord {
      word: string;
      sentenceIndex: number;
    }
    const userWords: UserWord[] = [];
    for (let sIdx = 0; sIdx < userSentences.length; sIdx++) {
      const words = userSentences[sIdx].trim().split(/\s+/).filter(w => w.length > 0);
      for (const w of words) {
        userWords.push({
          word: w,
          sentenceIndex: sIdx
        });
      }
    }

    if (userWords.length === 0 || timedWords.length === 0) {
      // Fallback: chia đều
      return userSentences.map((sentence, i) => {
        const ratio = i / userSentences.length;
        const nextRatio = (i + 1) / userSentences.length;
        const start = Math.round(durationMs * ratio);
        const end = Math.round(durationMs * nextRatio);
        return {
          id: `seg_ai_align_${i + 1}_${Date.now()}`,
          index: i + 1,
          startTimeMs: start,
          endTimeMs: end,
          durationMs: end - start,
          transcript: sentence,
          status: 'not_started',
        };
      });
    }

    // 3. Chạy Needleman-Wunsch Alignment để khớp userWords với timedWords
    const N = userWords.length;
    const M = timedWords.length;
    const dp: number[][] = [];
    const parent: ([number, number] | undefined)[][] = [];

    for (let i = 0; i <= N; i++) {
      dp[i] = new Array(M + 1).fill(0);
      parent[i] = new Array(M + 1);
    }

    // Init boundaries
    for (let i = 0; i <= N; i++) dp[i][0] = i * -1;
    for (let j = 0; j <= M; j++) dp[0][j] = j * -1;

    const cleanWord = (w: string) => w.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").trim();

    for (let i = 1; i <= N; i++) {
      const uWord = cleanWord(userWords[i - 1].word);
      for (let j = 1; j <= M; j++) {
        const tWord = cleanWord(timedWords[j - 1].word);

        let matchScore = -1;
        if (uWord === tWord) {
          matchScore = 2;
        } else if (uWord && tWord && (uWord.startsWith(tWord) || tWord.startsWith(uWord))) {
          matchScore = 0.5;
        }

        const match = dp[i - 1][j - 1] + matchScore;
        const delU = dp[i - 1][j] - 1;
        const delT = dp[i][j - 1] - 1;

        const max = Math.max(match, delU, delT);
        dp[i][j] = max;

        if (max === match) parent[i][j] = [i - 1, j - 1];
        else if (max === delU) parent[i][j] = [i - 1, j];
        else parent[i][j] = [i, j - 1];
      }
    }

    // 4. Backtrack để tìm mapping từ userWordIndex -> timedWordIndex
    const wordMatches: { userIdx: number; timedIdx: number }[] = [];
    let r = N, c = M;
    while (r > 0 && c > 0) {
      const p = parent[r][c];
      if (!p) break;
      const [pr, pc] = p;
      if (pr === r - 1 && pc === c - 1) {
        wordMatches.push({ userIdx: r - 1, timedIdx: c - 1 });
      }
      r = pr;
      c = pc;
    }
    wordMatches.reverse();

    // Nhóm các từ đã match theo sentenceIndex của user
    const sentenceWordTimes: { [sIdx: number]: { startMs: number; endMs: number }[] } = {};
    for (let sIdx = 0; sIdx < userSentences.length; sIdx++) {
      sentenceWordTimes[sIdx] = [];
    }

    for (const match of wordMatches) {
      const uWord = userWords[match.userIdx];
      const tWord = timedWords[match.timedIdx];
      sentenceWordTimes[uWord.sentenceIndex].push({
        startMs: tWord.startMs,
        endMs: tWord.endMs
      });
    }

    // 5. Xác định start/end cho từng user sentence
    const finalSentences: { text: string; startMs: number; endMs: number }[] = [];
    for (let sIdx = 0; sIdx < userSentences.length; sIdx++) {
      const times = sentenceWordTimes[sIdx];
      if (times.length > 0) {
        const startMs = Math.min(...times.map(t => t.startMs));
        const endMs = Math.max(...times.map(t => t.endMs));
        finalSentences.push({
          text: userSentences[sIdx],
          startMs,
          endMs
        });
      } else {
        finalSentences.push({
          text: userSentences[sIdx],
          startMs: -1,
          endMs: -1
        });
      }
    }

    // 6. Điền các câu unmatched (interpolate)
    for (let i = 0; i < finalSentences.length; i++) {
      if (finalSentences[i].startMs === -1) {
        // Tìm câu đã match gần nhất trước nó
        let prevEnd = 0;
        for (let j = i - 1; j >= 0; j--) {
          if (finalSentences[j].endMs !== -1) {
            prevEnd = finalSentences[j].endMs;
            break;
          }
        }
        // Tìm câu đã match gần nhất sau nó
        let nextStart = durationMs;
        for (let j = i + 1; j < finalSentences.length; j++) {
          if (finalSentences[j].startMs !== -1) {
            nextStart = finalSentences[j].startMs;
            break;
          }
        }

        finalSentences[i].startMs = prevEnd;
        finalSentences[i].endMs = nextStart;
      }
    }

    // 7. Tạo segments với padding (tránh nuốt từ)
    const PRE_PAD_MS = 300;
    const POST_PAD_MS = 200;

    const segments: Segment[] = finalSentences.map((s, i) => {
      const prevEnd = i > 0 ? finalSentences[i - 1].endMs : 0;
      const startMs = Math.max(prevEnd, s.startMs - PRE_PAD_MS);

      const nextStart = i < finalSentences.length - 1 ? finalSentences[i + 1].startMs : durationMs;
      const endMs = Math.min(nextStart, s.endMs + POST_PAD_MS);

      return {
        id: `seg_ai_align_${i + 1}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        index: i + 1,
        startTimeMs: startMs,
        endTimeMs: endMs,
        durationMs: endMs - startMs,
        transcript: s.text,
        status: 'not_started' as const,
      };
    });

    return segments;
  }

  /**
   * Tạo segments từ split points (không có transcript)
   */
  private static createSegmentsFromAnalysis(analysis: AnalysisResult): Segment[] {
    const { splitPoints, durationMs } = analysis;

    if (splitPoints.length === 0) {
      // Chỉ 1 segment = toàn bài
      return [{
        id: this.genId(1),
        index: 1,
        startTimeMs: 0,
        endTimeMs: durationMs,
        durationMs: durationMs,
        status: 'not_started',
      }];
    }

    const segments: Segment[] = [];
    let prevPoint = 0;

    for (let i = 0; i < splitPoints.length; i++) {
      const point = splitPoints[i];
      segments.push({
        id: this.genId(i + 1),
        index: i + 1,
        startTimeMs: prevPoint,
        endTimeMs: point,
        durationMs: point - prevPoint,
        status: 'not_started',
      });
      prevPoint = point;
    }

    // Segment cuối
    segments.push({
      id: this.genId(splitPoints.length + 1),
      index: splitPoints.length + 1,
      startTimeMs: prevPoint,
      endTimeMs: durationMs,
      durationMs: durationMs - prevPoint,
      status: 'not_started',
    });

    return segments;
  }

  /**
   * Tạo segments có transcript — ghép câu transcript với split points
   * 
   * Thuật toán:
   * 1. Tách transcript thành các câu
   * 2. Nếu số câu ≈ số segments → map 1:1
   * 3. Nếu số câu ≠ số segments → dùng word-based proportioning
   */
  private static createSegmentsWithTranscript(
    analysis: AnalysisResult,
    transcriptText: string
  ): Segment[] {
    const { splitPoints, durationMs } = analysis;
    const sentences = this.groupSentences2by2(this.smartSplitTranscript(transcriptText));

    if (sentences.length === 0) {
      return this.createSegmentsFromAnalysis(analysis);
    }

    const numAudioSegments = splitPoints.length + 1;

    // Case 1: Số câu transcript ≈ số audio segments → map 1:1
    if (Math.abs(sentences.length - numAudioSegments) <= Math.ceil(numAudioSegments * 0.2)) {
      return this.mapTranscriptToSplitPoints(sentences, splitPoints, durationMs);
    }

    // Case 2: Quá lệch → dùng word-based proportioning với audio split points
    if (sentences.length < numAudioSegments) {
      // Ít câu hơn segments → gộp segments lại theo transcript
      return this.distributeTranscriptOverTime(sentences, durationMs, splitPoints);
    }

    // Nhiều câu hơn segments → gộp câu lại
    return this.groupSentencesIntoSegments(sentences, splitPoints, durationMs);
  }

  /**
   * Map 1:1 câu transcript với audio segments
   */
  private static mapTranscriptToSplitPoints(
    sentences: string[],
    splitPoints: number[],
    durationMs: number
  ): Segment[] {
    const segments: Segment[] = [];
    let prevPoint = 0;

    // Tạo timeline points [0, ...splitPoints, durationMs]
    const boundaries = [0, ...splitPoints, durationMs];

    for (let i = 0; i < Math.min(sentences.length, boundaries.length - 1); i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1] || durationMs;

      segments.push({
        id: this.genId(i + 1),
        index: i + 1,
        startTimeMs: start,
        endTimeMs: end,
        durationMs: end - start,
        transcript: sentences[i],
        status: 'not_started',
      });
    }

    // Nếu còn dư sentences, gộp vào câu cuối
    if (sentences.length > boundaries.length - 1 && segments.length > 0) {
      const lastSeg = segments[segments.length - 1];
      const remaining = sentences.slice(boundaries.length - 1).join(' ');
      lastSeg.transcript = lastSeg.transcript
        ? `${lastSeg.transcript} ${remaining}`
        : remaining;
    }

    // Nếu còn dư segments (chưa có transcript), thêm vào
    for (let i = segments.length; i < boundaries.length - 1; i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1] || durationMs;
      segments.push({
        id: this.genId(i + 1),
        index: i + 1,
        startTimeMs: start,
        endTimeMs: end,
        durationMs: end - start,
        status: 'not_started',
      });
    }

    return segments;
  }

  /**
   * Word-based proportioning: Chia thời gian theo tỷ lệ số từ
   * Cải thiện: dùng word count thay vì character count vì tốc độ nói ≈ đều theo từ
   */
  private static distributeTranscriptOverTime(
    sentences: string[],
    durationMs: number,
    splitPoints: number[]
  ): Segment[] {
    const totalWords = sentences.reduce((sum, s) => sum + this.countWords(s), 0);
    if (totalWords === 0) return this.createSegmentsFromAnalysis({ durationMs, silenceRegions: [], speechSegments: [], splitPoints, method: 'equal-split' });

    const segments: Segment[] = [];
    let currentTime = 0;

    for (let i = 0; i < sentences.length; i++) {
      const wordRatio = this.countWords(sentences[i]) / totalWords;
      let segDuration = Math.round(durationMs * wordRatio);

      // Enforce min/max
      segDuration = Math.max(1500, Math.min(segDuration, 15000));

      const startMs = currentTime;
      let endMs = i === sentences.length - 1
        ? durationMs  // Câu cuối lấy hết
        : Math.min(currentTime + segDuration, durationMs);

      // Snap to nearest split point nếu gần (±500ms)
      const nearestSplit = splitPoints.find(sp =>
        Math.abs(sp - endMs) < 500 && sp > startMs + 1500
      );
      if (nearestSplit) {
        endMs = nearestSplit;
      }

      segments.push({
        id: this.genId(i + 1),
        index: i + 1,
        startTimeMs: startMs,
        endTimeMs: endMs,
        durationMs: endMs - startMs,
        transcript: sentences[i],
        status: 'not_started',
      });

      currentTime = endMs;
    }

    return segments;
  }

  /**
   * Gộp nhiều câu transcript vào ít segments (khi câu > segments)
   */
  private static groupSentencesIntoSegments(
    sentences: string[],
    splitPoints: number[],
    durationMs: number
  ): Segment[] {
    const numSegments = splitPoints.length + 1;
    const boundaries = [0, ...splitPoints, durationMs];

    // Chia đều câu vào mỗi segment
    const sentencesPerSegment = Math.ceil(sentences.length / numSegments);

    const segments: Segment[] = [];
    for (let i = 0; i < numSegments; i++) {
      const startSentence = i * sentencesPerSegment;
      const endSentence = Math.min(startSentence + sentencesPerSegment, sentences.length);
      const text = sentences.slice(startSentence, endSentence).join(' ');

      segments.push({
        id: this.genId(i + 1),
        index: i + 1,
        startTimeMs: boundaries[i],
        endTimeMs: boundaries[i + 1],
        durationMs: boundaries[i + 1] - boundaries[i],
        transcript: text || undefined,
        status: 'not_started',
      });
    }

    return segments;
  }

  /**
   * Tách transcript thông minh hơn
   * - Xử lý abbreviations (Mr., Mrs., Dr., etc.)
   * - Xử lý số thập phân (3.5)
   * - Xử lý ellipsis (...)
   * - Tách theo dấu câu và xuống dòng
   */
  static smartSplitTranscript(text: string): string[] {
    // Bước 1: Bảo vệ abbreviations
    let processed = text
      .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|Inc|Ltd|Corp)\./gi, '$1<DOT>')
      .replace(/\b([A-Z])\./g, '$1<DOT>')  // Initials: J.K. → J<DOT>K<DOT>
      .replace(/(\d+)\.(\d+)/g, '$1<DOT>$2')  // Decimal numbers
      .replace(/\.{3}/g, '<ELLIPSIS>')  // Ellipsis ...
      .replace(/\.{2}/g, '<ELLIPSIS>');

    // Bước 2: Tách theo dấu câu thật (.?!) và xuống dòng
    const rawSentences = processed
      .split(/(?<=[.?!])\s+|\n{1,}/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    // Bước 3: Khôi phục abbreviations
    const sentences = rawSentences.map(s =>
      s.replace(/<DOT>/g, '.').replace(/<ELLIPSIS>/g, '...')
    );

    // Bước 4: Gộp câu quá ngắn (< 3 từ) vào câu trước hoặc sau
    const merged: string[] = [];
    for (let i = 0; i < sentences.length; i++) {
      const wordCount = this.countWords(sentences[i]);
      if (wordCount < 3 && merged.length > 0) {
        // Gộp vào câu trước
        merged[merged.length - 1] += ' ' + sentences[i];
      } else if (wordCount < 3 && i < sentences.length - 1) {
        // Gộp vào câu sau
        sentences[i + 1] = sentences[i] + ' ' + sentences[i + 1];
      } else {
        merged.push(sentences[i]);
      }
    }

    return merged;
  }

  /**
   * Đếm số từ (word count) — chính xác hơn character count cho ước lượng thời gian nói
   */
  static countWords(text: string): number {
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  }

  /**
   * Sinh ID duy nhất cho segment
   */
  private static genId(index: number): string {
    return `seg_${index}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  // ══════════════════════════════════════════════════════
  // UTILITY METHODS (giữ lại cho merge/split trong PlayerScreen)
  // ══════════════════════════════════════════════════════

  /**
   * Tái nhóm 2 câu/cặp từ vị trí fromIndex trở về sau.
   * Gộp tất cả transcript từ fromIndex→end, tách lại theo dấu câu,
   * ghép 2 câu/cặp, chia thời gian tỉ lệ theo số từ.
   */
  static regroupSegmentsFrom(segments: Segment[], fromIndex: number): Segment[] {
    if (fromIndex < 0 || fromIndex >= segments.length) return segments;

    // Giữ nguyên phần đầu
    const before = segments.slice(0, fromIndex);
    const affected = segments.slice(fromIndex);

    // Lấy toàn bộ transcript text từ affected
    const fullText = affected.map(s => s.transcript || '').join(' ').trim();
    if (!fullText) return segments;

    // Tách câu thông minh → nhóm 2 câu/cặp
    const sentences = this.smartSplitTranscript(fullText);
    const grouped = this.groupSentences2by2(sentences);

    if (grouped.length === 0) return segments;

    // Tính tổng thời gian của vùng bị ảnh hưởng
    const totalStartMs = affected[0].startTimeMs;
    const totalEndMs = affected[affected.length - 1].endTimeMs;
    const totalDuration = totalEndMs - totalStartMs;

    // Chia thời gian tỉ lệ theo số từ
    const wordCounts = grouped.map(text => this.countWords(text));
    const totalWords = wordCounts.reduce((sum, c) => sum + c, 0) || 1;

    const newSegments: Segment[] = [];
    let currentTime = totalStartMs;

    for (let i = 0; i < grouped.length; i++) {
      const wordRatio = wordCounts[i] / totalWords;
      const segDuration = i === grouped.length - 1
        ? totalEndMs - currentTime  // Câu cuối lấy hết
        : Math.round(totalDuration * wordRatio);

      const endTime = i === grouped.length - 1
        ? totalEndMs
        : Math.min(currentTime + segDuration, totalEndMs);

      newSegments.push({
        id: `seg_regroup_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 4)}`,
        index: 0, // sẽ reindex sau
        startTimeMs: currentTime,
        endTimeMs: endTime,
        durationMs: endTime - currentTime,
        transcript: grouped[i],
        status: 'not_started' as const,
      });

      currentTime = endTime;
    }

    return this.reindexSegments([...before, ...newSegments]);
  }

  static mergeSegments(segments: Segment[], segId1: string, segId2: string): Segment[] {
    const idx1 = segments.findIndex(s => s.id === segId1);
    const idx2 = segments.findIndex(s => s.id === segId2);

    if (idx1 === -1 || idx2 === -1 || Math.abs(idx1 - idx2) !== 1) {
      return segments;
    }

    const firstIdx = Math.min(idx1, idx2);
    const secondIdx = Math.max(idx1, idx2);
    const firstSeg = segments[firstIdx];
    const secondSeg = segments[secondIdx];

    const mergedSegment: Segment = {
      id: `seg_merged_${Date.now()}`,
      index: firstSeg.index,
      startTimeMs: firstSeg.startTimeMs,
      endTimeMs: secondSeg.endTimeMs,
      durationMs: secondSeg.endTimeMs - firstSeg.startTimeMs,
      transcript: [firstSeg.transcript, secondSeg.transcript].filter(Boolean).join(' '),
      status: firstSeg.status === 'mastered' && secondSeg.status === 'mastered' ? 'mastered' : 'learning'
    };

    const newSegments = [...segments];
    newSegments.splice(firstIdx, 2, mergedSegment);
    return this.reindexSegments(newSegments);
  }

  static splitSegment(segments: Segment[], segId: string, splitTimeMs: number): Segment[] {
    const idx = segments.findIndex(s => s.id === segId);
    if (idx === -1) return segments;

    const seg = segments[idx];
    if (splitTimeMs <= seg.startTimeMs || splitTimeMs >= seg.endTimeMs) {
      return segments;
    }

    const transcript = seg.transcript || '';
    const words = transcript.split(/\s+/);
    const splitRatio = (splitTimeMs - seg.startTimeMs) / (seg.endTimeMs - seg.startTimeMs);
    const splitWordIdx = Math.round(words.length * splitRatio);

    const segA: Segment = {
      id: `seg_split_a_${Date.now()}`,
      index: seg.index,
      startTimeMs: seg.startTimeMs,
      endTimeMs: splitTimeMs,
      durationMs: splitTimeMs - seg.startTimeMs,
      transcript: words.slice(0, splitWordIdx).join(' ') || undefined,
      status: 'learning'
    };

    const segB: Segment = {
      id: `seg_split_b_${Date.now()}`,
      index: seg.index + 1,
      startTimeMs: splitTimeMs,
      endTimeMs: seg.endTimeMs,
      durationMs: seg.endTimeMs - splitTimeMs,
      transcript: words.slice(splitWordIdx).join(' ') || undefined,
      status: 'learning'
    };

    const newSegments = [...segments];
    newSegments.splice(idx, 1, segA, segB);
    return this.reindexSegments(newSegments);
  }

  static groupSentences2by2(sentences: string[]): string[] {
    const grouped: string[] = [];
    for (let i = 0; i < sentences.length; i += 2) {
      const chunk = sentences.slice(i, i + 2);
      grouped.push(chunk.join(' '));
    }
    return grouped;
  }

  private static reindexSegments(segments: Segment[]): Segment[] {
    return segments.map((seg, i) => ({
      ...seg,
      index: i + 1
    }));
  }
}
