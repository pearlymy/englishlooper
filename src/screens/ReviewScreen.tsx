import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
  Dimensions,
} from 'react-native';
import { Segment, Project } from '../types';
import { AutocutService } from '../services/autocutService';
import { AudioService, PlaybackCallbackData } from '../services/audioService';
import { WhisperService } from '../services/whisperService';
import { AITranslationService } from '../services/aiTranslationService';
import { DBService } from '../services/dbService';
import { AutocutService as AutocutServiceType } from '../services/autocutService';
import { showAlert } from '../utils/alert';

const IS_WEB = Platform.OS === 'web';
const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface ReviewScreenProps {
  /** Unsaved data from ImportScreen */
  pendingData: {
    title: string;
    audioUri: string;
    audioBlobForWeb?: Blob;
    durationMs: number;
    segments: Segment[];
    transcriptText?: string;
    folderId?: string;
    useAI: boolean;
    apiKey: string;
  };
  onConfirm: (finalSegments: Segment[]) => void;
  onRerunAI: () => void;
  onBack: () => void;
}

// ─── Warnings ───
interface SegmentWarning {
  type: 'too_long' | 'too_short' | 'no_transcript';
  message: string;
}

function getWarnings(seg: Segment): SegmentWarning[] {
  const warnings: SegmentWarning[] = [];
  const durSec = seg.durationMs / 1000;
  if (durSec > 8) {
    warnings.push({ type: 'too_long', message: `Câu dài bất thường (${durSec.toFixed(1)}s) — Nên tách?` });
  }
  if (durSec < 0.8) {
    warnings.push({ type: 'too_short', message: `Câu quá ngắn (${durSec.toFixed(1)}s) — Nên ghép?` });
  }
  if (!seg.transcript || seg.transcript.trim().length === 0) {
    warnings.push({ type: 'no_transcript', message: 'Không có văn bản — Nhập thủ công?' });
  }
  return warnings;
}

export default function ReviewScreen({ pendingData, onConfirm, onRerunAI, onBack }: ReviewScreenProps) {
  const [segments, setSegments] = useState<Segment[]>(pendingData.segments);
  const [editingSegId, setEditingSegId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [playingSegId, setPlayingSegId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingPosition, setPlayingPosition] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isRetranscribing, setIsRetranscribing] = useState(false);
  const [retranscribeProgress, setRetranscribeProgress] = useState('');

  // Word-level split state
  const [splittingSegId, setSplittingSegId] = useState<string | null>(null);
  const [splitWordIdx, setSplitWordIdx] = useState<number | null>(null);

  // Warning filter
  const [filterWarningsOnly, setFilterWarningsOnly] = useState(false);

  // Resolved API key (load from storage if not provided)
  const [resolvedApiKey, setResolvedApiKey] = useState(pendingData.apiKey || '');

  useEffect(() => {
    if (!resolvedApiKey) {
      WhisperService.getApiKey().then(key => {
        if (key) setResolvedApiKey(key);
      }).catch(() => {});
    }
  }, []);

  const audioRef = useRef<AudioService | null>(null);

  // ─── Audio init ───
  useEffect(() => {
    const service = new AudioService();
    audioRef.current = service;

    // Resolve audio URI — handle db: protocol for saved projects
    const resolveAndLoad = async () => {
      let resolvedUri = pendingData.audioUri;

      // If URI starts with 'db:', resolve from IndexedDB
      if (resolvedUri.startsWith('db:')) {
        const projectId = resolvedUri.replace('db:', '');
        try {
          const blob = await DBService.getAudio(projectId);
          if (blob) {
            resolvedUri = URL.createObjectURL(blob);
            console.log('[ReviewScreen] Resolved db: URI to blob URL for playback');
          } else {
            console.warn('[ReviewScreen] No audio blob found in IndexedDB for', projectId);
            return;
          }
        } catch (err) {
          console.warn('[ReviewScreen] Failed to resolve db: URI:', err);
          return;
        }
      }

      await service.loadSound(
        resolvedUri,
        segments,
        (data: PlaybackCallbackData) => {
          setPlayingPosition(data.positionMs);
          setIsPlaying(data.isPlaying);
        }
      );
    };

    resolveAndLoad().catch(err => console.warn('[ReviewScreen] Audio load failed:', err));

    return () => {
      service.unload().catch(() => {});
    };
  }, [pendingData.audioUri]);

  // Keep audio service synced with segment changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.updateSegments(segments);
    }
  }, [segments]);

  // ─── Playback ───
  const handlePlaySegment = async (seg: Segment) => {
    if (!audioRef.current) return;
    if (playingSegId === seg.id && isPlaying) {
      await audioRef.current.pause();
      setPlayingSegId(null);
      return;
    }
    await audioRef.current.selectSegment(seg);
    await audioRef.current.play();
    setPlayingSegId(seg.id);
  };

  const handleStopAll = async () => {
    if (audioRef.current && isPlaying) {
      await audioRef.current.pause();
    }
    setPlayingSegId(null);
  };

  // ─── Edit ───
  const startEdit = (seg: Segment) => {
    setEditingSegId(seg.id);
    setEditText(seg.transcript || '');
  };

  const cancelEdit = () => {
    setEditingSegId(null);
    setEditText('');
  };

  const saveEdit = (segId: string) => {
    setSegments(prev =>
      prev.map(seg =>
        seg.id === segId
          ? { ...seg, transcript: editText.trim() || undefined }
          : seg
      )
    );
    setEditingSegId(null);
    setEditText('');
  };

  // ─── Merge ───
  const handleMergeDown = (segId: string) => {
    const idx = segments.findIndex(s => s.id === segId);
    if (idx === -1 || idx >= segments.length - 1) return;
    const updated = AutocutService.mergeSegments(segments, segId, segments[idx + 1].id);
    setSegments(updated);
  };

  const handleMergeUp = (segId: string) => {
    const idx = segments.findIndex(s => s.id === segId);
    if (idx <= 0) return;
    const updated = AutocutService.mergeSegments(segments, segments[idx - 1].id, segId);
    setSegments(updated);
  };

  // ─── Word-level Split ───
  const startWordSplit = (seg: Segment) => {
    if (!seg.transcript || seg.transcript.trim().split(/\s+/).length < 2) {
      showAlert('Không thể tách', 'Câu cần có ít nhất 2 từ để tách.');
      return;
    }
    setSplittingSegId(seg.id);
    setSplitWordIdx(null);
  };

  const cancelWordSplit = () => {
    setSplittingSegId(null);
    setSplitWordIdx(null);
  };

  const confirmWordSplit = (seg: Segment, wordIndex: number) => {
    const words = (seg.transcript || '').trim().split(/\s+/);
    if (wordIndex <= 0 || wordIndex >= words.length) return;

    // Calculate split time proportionally by word position
    const ratio = wordIndex / words.length;
    const splitTimeMs = seg.startTimeMs + Math.round(ratio * (seg.endTimeMs - seg.startTimeMs));

    // Minimum gap check
    if (splitTimeMs - seg.startTimeMs < 300 || seg.endTimeMs - splitTimeMs < 300) {
      showAlert('Không thể tách', 'Phần tách quá ngắn (< 300ms).');
      return;
    }

    const updated = AutocutService.splitSegment(segments, seg.id, splitTimeMs);
    setSegments(updated);
    setSplittingSegId(null);
    setSplitWordIdx(null);
  };

  // ─── Delete segment ───
  const handleDeleteSegment = (segId: string) => {
    if (segments.length <= 1) {
      showAlert('Không thể xóa', 'Phải giữ ít nhất 1 câu.');
      return;
    }
    showAlert('Xóa câu?', 'Bạn có chắc muốn xóa câu này? Hành động này không thể hoàn tác.', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa', style: 'destructive', onPress: () => {
          setSegments(prev => {
            const filtered = prev.filter(s => s.id !== segId);
            return filtered.map((s, i) => ({ ...s, index: i + 1 }));
          });
        }
      }
    ]);
  };

  // ─── Regroup 2-by-2 from here ───
  const handleRegroupFrom = (segId: string) => {
    const idx = segments.findIndex(s => s.id === segId);
    if (idx === -1) return;
    const updated = AutocutService.regroupSegmentsFrom(segments, idx);
    setSegments(updated);
  };

  // ─── AI Translate (IPA + Vietnamese) ───
  const handleAITranslate = async () => {
    let apiKey = resolvedApiKey;
    if (!apiKey) {
      apiKey = await WhisperService.getApiKey() || '';
      if (apiKey) setResolvedApiKey(apiKey);
    }
    if (!apiKey) {
      showAlert('Thiếu API Key', 'Cần API Key để dịch và phiên âm. Vui lòng vào Import và lưu API Key trước.');
      return;
    }

    const sentencesToTranslate = segments
      .map(seg => ({ index: seg.index, text: seg.transcript || '' }))
      .filter(s => s.text.length > 0);

    if (sentencesToTranslate.length === 0) {
      showAlert('Không có gì để dịch', 'Không có câu nào có transcript.');
      return;
    }

    setIsTranslating(true);
    try {
      const translations = await AITranslationService.translateAndPhoneticsBatch(
        sentencesToTranslate,
        resolvedApiKey || apiKey
      );

      setSegments(prev =>
        prev.map(seg => {
          const match = translations.find(t => t.index === seg.index);
          if (match) {
            return {
              ...seg,
              ipa: match.ipa || seg.ipa || undefined,
              translation: match.vietnamese || seg.translation || undefined,
            };
          }
          return seg;
        })
      );
    } catch (err) {
      console.warn('[ReviewScreen] AI translate failed:', err);
      showAlert('Lỗi', 'Dịch AI thất bại. Vui lòng thử lại.');
    } finally {
      setIsTranslating(false);
    }
  };

  // ─── Confirm & Save ───
  const handleConfirm = async () => {
    setIsSaving(true);
    await handleStopAll();
    // Small delay to ensure audio is released
    await new Promise(r => setTimeout(r, 200));
    onConfirm(segments);
  };

  // ─── AI Re-transcribe (dùng pipeline mới với word-level timestamps) ───
  const handleRetranscribe = async () => {
    let apiKey = resolvedApiKey;
    if (!apiKey) {
      apiKey = await WhisperService.getApiKey() || '';
      if (apiKey) setResolvedApiKey(apiKey);
    }
    if (!apiKey) {
      showAlert('Thiếu API Key', 'Cần API Key để AI cắt câu lại.');
      return;
    }

    setIsRetranscribing(true);
    setRetranscribeProgress('Đang chuẩn bị audio...');
    await handleStopAll();

    try {
      // Resolve audio URI for transcription
      let audioUri = pendingData.audioUri;
      if (audioUri.startsWith('db:')) {
        const projectId = audioUri.replace('db:', '');
        const blob = await DBService.getAudio(projectId);
        if (blob) {
          audioUri = URL.createObjectURL(blob);
        } else {
          throw new Error('Không tìm thấy audio trong IndexedDB');
        }
      }

      // Re-run AI transcription — let Whisper detect sentences from audio
      // (KHÔNG truyền transcript cũ vì sẽ gộp sai câu từ các unit khác nhau)
      const { segments: newSegments, durationMs } = await AutocutService.analyzeAndSplit(
        audioUri,
        undefined,
        (msg) => setRetranscribeProgress(msg),
        true, // useAI
        resolvedApiKey || apiKey
      );

      // Optionally translate
      let finalSegments = newSegments;
      try {
        setRetranscribeProgress('Đang dịch & phiên âm...');
        const sentencesToTranslate = newSegments
          .map(seg => ({ index: seg.index, text: seg.transcript || '' }))
          .filter(s => s.text.length > 0);

        if (sentencesToTranslate.length > 0) {
          const translations = await AITranslationService.translateAndPhoneticsBatch(
            sentencesToTranslate,
            resolvedApiKey || apiKey
          );
          finalSegments = newSegments.map(seg => {
            const match = translations.find(t => t.index === seg.index);
            if (match) {
              return { ...seg, ipa: match.ipa || undefined, translation: match.vietnamese || undefined };
            }
            return seg;
          });
        }
      } catch (e) {
        console.warn('[ReviewScreen] AI translation failed during retranscribe:', e);
      }

      setSegments(finalSegments);
      setRetranscribeProgress('');
      showAlert('✅ Thành công', `AI đã cắt lại ${finalSegments.length} câu với word-level timestamps mới.`);
    } catch (err) {
      console.error('[ReviewScreen] Retranscribe failed:', err);
      showAlert('Lỗi', 'AI cắt câu lại thất bại. Vui lòng thử lại.');
    } finally {
      setIsRetranscribing(false);
      setRetranscribeProgress('');
    }
  };

  // ── Ngắt lại tất cả theo dấu câu ──
  const doResplitAll = () => {
    // 1. Gộp toàn bộ transcript
    const fullText = segments.map(s => s.transcript || '').join(' ').trim();
    if (!fullText) {
      showAlert('Không có dữ liệu', 'Không có transcript để ngắt lại.');
      return;
    }

    // 2. Tách theo dấu câu → nhóm 2 câu/cặp
    const sentences = AutocutService.smartSplitTranscript(fullText);
    const grouped = AutocutService.groupSentences2by2(sentences);

    if (grouped.length === 0) {
      showAlert('Không thể ngắt', 'Không tìm thấy dấu câu để tách.');
      return;
    }

    // 3. Tính thời gian theo tỉ lệ số từ
    const totalStartMs = segments[0].startTimeMs;
    const totalEndMs = segments[segments.length - 1].endTimeMs;
    const totalDuration = totalEndMs - totalStartMs;

    const wordCounts = grouped.map(text => AutocutService.countWords(text));
    const totalWords = wordCounts.reduce((sum, c) => sum + c, 0) || 1;

    const newSegments: Segment[] = [];
    let currentTime = totalStartMs;

    for (let i = 0; i < grouped.length; i++) {
      const wordRatio = wordCounts[i] / totalWords;
      const endTime = i === grouped.length - 1
        ? totalEndMs
        : Math.min(currentTime + Math.round(totalDuration * wordRatio), totalEndMs);

      newSegments.push({
        id: `seg_resplit_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 4)}`,
        index: i + 1,
        startTimeMs: currentTime,
        endTimeMs: endTime,
        durationMs: endTime - currentTime,
        transcript: grouped[i],
        status: 'not_started' as const,
      });

      currentTime = endTime;
    }

    setSegments(newSegments);
  };

  const handleResplitAll = () => {
    showAlert(
      'Ngắt lại tất cả?',
      'Gộp toàn bộ transcript và tách lại theo dấu câu (. ? !). Thời gian sẽ được chia lại theo tỉ lệ số từ.',
      [
        { text: 'Hủy', style: 'cancel' },
        { text: 'Ngắt lại', style: 'destructive', onPress: doResplitAll }
      ]
    );
  };

  // ─── Computed ───
  const totalWarnings = segments.reduce((sum, seg) => sum + getWarnings(seg).length, 0);
  const segsWithTranscript = segments.filter(s => s.transcript && s.transcript.trim().length > 0).length;

  const formatTime = (ms: number) => {
    const sec = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, '0')}`;
  };

  // ─── Render segment card ───
  const renderSegmentCard = (seg: Segment, index: number) => {
    const warnings = getWarnings(seg);
    const isEditing = editingSegId === seg.id;
    const isSplitting = splittingSegId === seg.id;
    const isPlayingThis = playingSegId === seg.id && isPlaying;
    const words = (seg.transcript || '').trim().split(/\s+/).filter(w => w.length > 0);

    return (
      <View key={seg.id} style={[styles.segCard, warnings.length > 0 && styles.segCardWarning]}>
        {/* Header */}
        <View style={styles.segHeader}>
          <View style={styles.segIndexBadge}>
            <Text style={styles.segIndexText}>{String(seg.index).padStart(2, '0')}</Text>
          </View>
          <Text style={styles.segTime}>
            {formatTime(seg.startTimeMs)} → {formatTime(seg.endTimeMs)}
          </Text>
          <Text style={styles.segDuration}>
            {(seg.durationMs / 1000).toFixed(1)}s
          </Text>
          <TouchableOpacity
            style={[styles.playMiniBtn, isPlayingThis && styles.playMiniBtnActive]}
            onPress={() => handlePlaySegment(seg)}
          >
            <Text style={styles.playMiniBtnText}>{isPlayingThis ? '⏸' : '▶'}</Text>
          </TouchableOpacity>
        </View>

        {/* Warnings */}
        {warnings.map((w, i) => (
          <View key={i} style={styles.warningBadge}>
            <Text style={styles.warningText}>⚠️ {w.message}</Text>
          </View>
        ))}

        {/* Transcript content */}
        {isEditing ? (
          <View style={styles.editSection}>
            <TextInput
              style={styles.editInput}
              value={editText}
              onChangeText={setEditText}
              multiline
              autoFocus
              placeholder="Nhập văn bản transcript..."
              placeholderTextColor="#4a4a6a"
            />
            <View style={styles.editActions}>
              <TouchableOpacity style={styles.editActionBtn} onPress={cancelEdit}>
                <Text style={styles.editActionBtnText}>❌ Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.editActionBtn, styles.editActionBtnSave]}
                onPress={() => saveEdit(seg.id)}
              >
                <Text style={[styles.editActionBtnText, styles.editActionBtnTextSave]}>💾 Lưu</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : isSplitting ? (
          // ─── Word-level split UI ───
          <View style={styles.splitSection}>
            <Text style={styles.splitHint}>👆 Tap vào từ để đặt điểm tách (phía trước từ đó)</Text>
            <View style={styles.wordChipsRow}>
              {words.map((word, wIdx) => (
                <TouchableOpacity
                  key={wIdx}
                  style={[
                    styles.wordChip,
                    wIdx > 0 && splitWordIdx === wIdx && styles.wordChipSelected,
                    wIdx === 0 && styles.wordChipDisabled,
                  ]}
                  onPress={() => {
                    if (wIdx > 0) setSplitWordIdx(wIdx);
                  }}
                  disabled={wIdx === 0}
                >
                  {wIdx > 0 && splitWordIdx === wIdx && (
                    <View style={styles.splitMarker}>
                      <Text style={styles.splitMarkerText}>✂</Text>
                    </View>
                  )}
                  <Text style={[
                    styles.wordChipText,
                    wIdx > 0 && splitWordIdx === wIdx && styles.wordChipTextSelected,
                  ]}>
                    {word}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {splitWordIdx !== null && (
              <View style={styles.splitPreview}>
                <Text style={styles.splitPreviewLabel}>Kết quả tách:</Text>
                <Text style={styles.splitPreviewText}>
                  <Text style={{ color: '#a78bfa' }}>Phần A: </Text>
                  "{words.slice(0, splitWordIdx).join(' ')}"
                </Text>
                <Text style={styles.splitPreviewText}>
                  <Text style={{ color: '#38bdf8' }}>Phần B: </Text>
                  "{words.slice(splitWordIdx).join(' ')}"
                </Text>
              </View>
            )}

            <View style={styles.editActions}>
              <TouchableOpacity style={styles.editActionBtn} onPress={cancelWordSplit}>
                <Text style={styles.editActionBtnText}>❌ Hủy</Text>
              </TouchableOpacity>
              {splitWordIdx !== null && (
                <TouchableOpacity
                  style={[styles.editActionBtn, styles.editActionBtnSplit]}
                  onPress={() => confirmWordSplit(seg, splitWordIdx)}
                >
                  <Text style={[styles.editActionBtnText, styles.editActionBtnTextSplit]}>
                    ✂ Tách tại "{words[splitWordIdx]}"
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : (
          <TouchableOpacity onPress={() => startEdit(seg)} activeOpacity={0.7} style={{ ...(IS_WEB ? { cursor: 'text' } as any : {}) }}>
            <Text style={styles.segTranscript}>
              {seg.transcript || '(Không có văn bản — tap để nhập)'}
            </Text>
            {seg.ipa ? <Text style={styles.segIpa}>{seg.ipa}</Text> : null}
            {seg.translation ? <Text style={styles.segTranslation}>{seg.translation}</Text> : null}
          </TouchableOpacity>
        )}

        {/* Actions (only when not editing/splitting) */}
        {!isEditing && !isSplitting && (
          <View style={styles.segActions}>
            <TouchableOpacity style={styles.segActionBtn} onPress={() => startEdit(seg)}>
              <Text style={styles.segActionBtnText}>✏️ Sửa</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.segActionBtn} onPress={() => startWordSplit(seg)}>
              <Text style={styles.segActionBtnText}>✂ Tách</Text>
            </TouchableOpacity>
            {index > 0 && (
              <TouchableOpacity style={styles.segActionBtn} onPress={() => handleMergeUp(seg.id)}>
                <Text style={styles.segActionBtnText}>🔗 Ghép ↑</Text>
              </TouchableOpacity>
            )}
            {index < segments.length - 1 && (
              <TouchableOpacity style={styles.segActionBtn} onPress={() => handleMergeDown(seg.id)}>
                <Text style={styles.segActionBtnText}>🔗 Ghép ↓</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.segActionBtn, styles.segActionBtnRegroup]}
              onPress={() => handleRegroupFrom(seg.id)}
            >
              <Text style={[styles.segActionBtnText, { color: '#38bdf8' }]}>🔄 Tái nhóm từ đây</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.segActionBtn} onPress={() => handleDeleteSegment(seg.id)}>
              <Text style={[styles.segActionBtnText, { color: '#ef4444' }]}>🗑</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.wrapper}>
      {/* ── HEADER ── */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.7}>
          {IS_WEB ? (
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
              <polyline points="15 18 9 12 15 6" />
            </svg>
          ) : (
            <Text style={{ color: '#ccc', fontSize: 20, fontWeight: '400' }}>‹</Text>
          )}
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Xem lại kết quả</Text>
        </View>
        <View style={styles.headerActions}>
          {/* Ngắt lại tất cả */}
          <TouchableOpacity style={[styles.headerActionBtn, { borderColor: 'rgba(251,191,36,0.3)' }]} onPress={handleResplitAll} activeOpacity={0.7}>
            {IS_WEB ? (
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            ) : (
              <Text style={{ color: '#fbbf24', fontSize: 14 }}>🔄</Text>
            )}
          </TouchableOpacity>
          {/* 🤖 AI Re-transcribe */}
          <TouchableOpacity
            style={[styles.headerActionBtn, { borderColor: 'rgba(16,185,129,0.3)' }, isRetranscribing && { opacity: 0.5 }]}
            onPress={handleRetranscribe}
            activeOpacity={0.7}
            disabled={isRetranscribing}
          >
            {isRetranscribing ? (
              <ActivityIndicator size="small" color="#10b981" />
            ) : IS_WEB ? (
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                <path d="M12 8V4H8" />
                <rect width="16" height="12" x="4" y="8" rx="2" />
                <path d="M2 14h2" /><path d="M20 14h2" />
                <path d="M15 13v2" /><path d="M9 13v2" />
              </svg>
            ) : (
              <Text style={{ color: '#10b981', fontSize: 14 }}>🤖</Text>
            )}
          </TouchableOpacity>
          {/* Dịch & Phiên âm AI */}
          <TouchableOpacity
            style={[styles.headerActionBtn, { borderColor: 'rgba(167,139,250,0.3)' }, isTranslating && { opacity: 0.7 }]}
            onPress={handleAITranslate}
            activeOpacity={0.7}
            disabled={isTranslating}
          >
            {isTranslating ? (
              <ActivityIndicator size="small" color="#a78bfa" />
            ) : IS_WEB ? (
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                <path d="m5 8 6 6" /><path d="m4 14 6-6 2-3" /><path d="M2 5h12" /><path d="M7 2h1" />
                <path d="m22 22-5-10-5 10" /><path d="M14 18h6" />
              </svg>
            ) : (
              <Text style={{ color: '#a78bfa', fontSize: 12, fontWeight: '800' }}>Aa</Text>
            )}
          </TouchableOpacity>
          {/* Lưu & Bắt đầu luyện */}
          {isSaving ? (
            <View style={[styles.headerActionBtn, { borderColor: '#7c3aed', backgroundColor: '#7c3aed' }]}>
              <ActivityIndicator size="small" color="#fff" />
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.headerActionBtn, { borderColor: '#7c3aed', backgroundColor: '#7c3aed' }]}
              onPress={handleConfirm}
              activeOpacity={0.7}
            >
              {IS_WEB ? (
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <Text style={{ color: '#fff', fontSize: 14 }}>✓</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── SUMMARY ── */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>📊 {pendingData.title}</Text>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{segments.length}</Text>
              <Text style={styles.summaryLabel}>câu</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{segsWithTranscript}</Text>
              <Text style={styles.summaryLabel}>có transcript</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, totalWarnings > 0 && { color: '#f59e0b' }]}>
                {totalWarnings}
              </Text>
              <Text style={styles.summaryLabel}>cảnh báo</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{formatTime(pendingData.durationMs)}</Text>
              <Text style={styles.summaryLabel}>tổng thời gian</Text>
            </View>
          </View>

          {totalWarnings > 0 && (
            <TouchableOpacity
              style={[styles.warningBanner, filterWarningsOnly && { backgroundColor: 'rgba(245,158,11,0.2)', borderColor: 'rgba(245,158,11,0.5)' }]}
              onPress={() => setFilterWarningsOnly(!filterWarningsOnly)}
              activeOpacity={0.7}
            >
              <Text style={styles.warningBannerText}>
                {filterWarningsOnly
                  ? `📌 Đang lọc ${segments.filter(s => getWarnings(s).length > 0).length} câu cảnh báo — Nhấn để xem tất cả`
                  : `⚠️ Có ${totalWarnings} cảnh báo — Nhấn để lọc chỉ câu cảnh báo`
                }
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── SEGMENT LIST ── */}
        {(filterWarningsOnly
          ? segments.filter(s => getWarnings(s).length > 0)
          : segments
        ).map((seg, _i) => {
          const realIndex = segments.findIndex(s => s.id === seg.id);
          return renderSegmentCard(seg, realIndex);
        })}

        {/* Loading overlay for retranscribe */}
        {isRetranscribing && (
          <View style={{
            position: 'absolute' as any,
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(8,8,13,0.85)',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 100,
            borderRadius: 16,
            padding: 40,
          }}>
            <ActivityIndicator size="large" color="#10b981" />
            <Text style={{ color: '#10b981', fontSize: 15, fontWeight: '700', marginTop: 16, textAlign: 'center' }}>
              🤖 AI đang cắt câu lại...
            </Text>
            <Text style={{ color: '#5a5a8a', fontSize: 13, marginTop: 8, textAlign: 'center' }}>
              {retranscribeProgress || 'Đang chuẩn bị...'}
            </Text>
          </View>
        )}


      </ScrollView>
    </View>
  );
}

// ═══════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════
const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: '#08080d',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: IS_WEB ? 16 : 52,
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 4,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#12121f',
    borderWidth: 1,
    borderColor: '#1e1e30',
    alignItems: 'center',
    justifyContent: 'center',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#12121f',
    borderWidth: 1,
    borderColor: '#1e1e30',
    alignItems: 'center',
    justifyContent: 'center',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.2,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    ...(IS_WEB ? {
      maxWidth: 720,
      alignSelf: 'center',
      width: '100%',
    } as any : {}),
  },

  // ── Summary Card ──
  summaryCard: {
    backgroundColor: '#0c0c18',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#16162a',
    padding: 20,
    marginBottom: 16,
  },
  summaryTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 16,
    letterSpacing: -0.3,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  summaryItem: {
    alignItems: 'center',
    flex: 1,
  },
  summaryValue: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
  },
  summaryLabel: {
    color: '#5a5a8a',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  summaryDivider: {
    width: 1,
    height: 30,
    backgroundColor: '#1e1e30',
  },
  warningBanner: {
    backgroundColor: 'rgba(245,158,11,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.25)',
    borderRadius: 10,
    padding: 10,
    marginTop: 16,
  },
  warningBannerText: {
    color: '#f59e0b',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },

  // ── Segment Card ──
  segCard: {
    backgroundColor: '#0c0c18',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#16162a',
    padding: 16,
    marginBottom: 10,
  },
  segCardWarning: {
    borderColor: 'rgba(245,158,11,0.3)',
  },
  segHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  segIndexBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(124,58,237,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segIndexText: {
    color: '#a78bfa',
    fontSize: 12,
    fontWeight: '800',
  },
  segTime: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  segDuration: {
    color: '#4a4a6a',
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: 'rgba(74,74,106,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  playMiniBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(124,58,237,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.25)',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  playMiniBtnActive: {
    backgroundColor: 'rgba(168,85,247,0.3)',
    borderColor: '#a855f7',
  },
  playMiniBtnText: {
    fontSize: 14,
  },

  // ── Warnings ──
  warningBadge: {
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.2)',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  warningText: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '600',
  },

  // ── Transcript ──
  segTranscript: {
    color: '#e0e0e0',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 21,
    marginBottom: 4,
  },
  segIpa: {
    color: '#7dd3fc',
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 18,
    marginBottom: 2,
  },
  segTranslation: {
    color: '#86efac',
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 18,
  },

  // ── Edit Section ──
  editSection: {
    marginTop: 4,
  },
  editInput: {
    backgroundColor: '#08080f',
    borderWidth: 1,
    borderColor: '#2d2d44',
    borderRadius: 10,
    padding: 12,
    color: '#fff',
    fontSize: 14,
    lineHeight: 22,
    minHeight: 120,
    maxHeight: 300,
    textAlignVertical: 'top',
    ...(IS_WEB ? { outline: 'none' } as any : {}),
  },
  editActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  editActionBtn: {
    borderWidth: 1,
    borderColor: '#2d2d44',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#12121f',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  editActionBtnSave: {
    borderColor: 'rgba(16,185,129,0.3)',
    backgroundColor: 'rgba(16,185,129,0.1)',
  },
  editActionBtnText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
  },
  editActionBtnTextSave: {
    color: '#34d399',
  },

  // ── Word-level Split ──
  splitSection: {
    marginTop: 4,
  },
  splitHint: {
    color: '#7dd3fc',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
  },
  wordChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  wordChip: {
    position: 'relative',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#12121f',
    borderWidth: 1,
    borderColor: '#2d2d44',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  wordChipSelected: {
    borderColor: '#f59e0b',
    backgroundColor: 'rgba(245,158,11,0.1)',
    paddingLeft: 22,
  },
  wordChipDisabled: {
    opacity: 0.5,
  },
  wordChipText: {
    color: '#e0e0e0',
    fontSize: 13,
    fontWeight: '600',
  },
  wordChipTextSelected: {
    color: '#fbbf24',
  },
  splitMarker: {
    position: 'absolute',
    left: 4,
    top: 4,
  },
  splitMarkerText: {
    fontSize: 12,
  },
  splitPreview: {
    backgroundColor: 'rgba(124,58,237,0.06)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.15)',
  },
  splitPreviewLabel: {
    color: '#a78bfa',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  splitPreviewText: {
    color: '#d1d5db',
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 18,
  },
  editActionBtnSplit: {
    borderColor: 'rgba(245,158,11,0.4)',
    backgroundColor: 'rgba(245,158,11,0.1)',
  },
  editActionBtnTextSplit: {
    color: '#fbbf24',
  },

  // ── Actions ──
  segActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#16162a',
  },
  segActionBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#12121f',
    borderWidth: 1,
    borderColor: '#1e1e30',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  segActionBtnText: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '600',
  },
  segActionBtnRegroup: {
    borderColor: 'rgba(56,189,248,0.3)',
    backgroundColor: 'rgba(56,189,248,0.08)',
  },

  // ── Bottom Actions ──
  bottomActions: {
    marginTop: 16,
    gap: 10,
  },
  confirmBtn: {
    backgroundColor: '#7c3aed',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  confirmBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  rerunBtn: {
    backgroundColor: 'rgba(124,58,237,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.25)',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  rerunBtnText: {
    color: '#a78bfa',
    fontSize: 14,
    fontWeight: '700',
  },
  savingContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 12,
  },
  savingText: {
    color: '#a78bfa',
    fontSize: 14,
    fontWeight: '600',
  },
});
