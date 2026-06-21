import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Alert,
  Dimensions,
  Modal,
  PanResponder,
  Platform,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { DBService } from '../services/dbService';
import * as Haptics from 'expo-haptics';
import { Project, Segment } from '../types';
import { AudioService, PlaybackCallbackData } from '../services/audioService';
import { AutocutService } from '../services/autocutService';
import { StorageService } from '../services/storageService';
import { WhisperService } from '../services/whisperService';
import { AITranslationService } from '../services/aiTranslationService';
import { FirebaseSyncService } from '../services/firebaseSyncService';
import { showAlert } from '../utils/alert';

interface PlayerScreenProps {
  project: Project;
  onBack: () => void;
  onOpenReview?: (segments: Segment[], project: Project) => void;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const IS_WEB = Platform.OS === 'web';
const SETTINGS_KEY = '@player_settings';
const IS_WIDE = SCREEN_WIDTH > 768;
const WebInput = 'input' as any;

// Google Material Icons for Mobile UI
const MaterialListIcon = ({ size = 20, color = '#a78bfa' }: { size?: number; color?: string }) => {
  if (Platform.OS === 'web') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </svg>
    );
  }
  return <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>☰</Text>;
};

const MaterialLoopIcon = ({ size = 18, color = '#a78bfa' }: { size?: number; color?: string }) => {
  if (Platform.OS === 'web') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
        <polyline points="17 1 21 5 17 9" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <polyline points="7 23 3 19 7 15" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      </svg>
    );
  }
  return <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>↻</Text>;
};

const MaterialTimerIcon = ({ size = 18, color = '#f472b6' }: { size?: number; color?: string }) => {
  if (Platform.OS === 'web') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
  }
  return <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>⏱</Text>;
};

const MaterialArrowRightIcon = ({ size = 18, color = '#38bdf8' }: { size?: number; color?: string }) => {
  if (Platform.OS === 'web') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
    );
  }
  return <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>→</Text>;
};

const MaterialSettingsIcon = ({ size = 20, color = '#666' }: { size?: number; color?: string }) => {
  if (Platform.OS === 'web') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    );
  }
  return <Text style={{ color, fontSize: size }}>⚙</Text>;
};

const MaterialPrevIcon = ({ size = 20, color = '#ccc' }: { size?: number; color?: string }) => {
  if (Platform.OS === 'web') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
        <polygon points="19 20 9 12 19 4 19 20" />
        <line x1="5" y1="19" x2="5" y2="5" />
      </svg>
    );
  }
  return <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>⏮</Text>;
};

const MaterialNextIcon = ({ size = 20, color = '#ccc' }: { size?: number; color?: string }) => {
  if (Platform.OS === 'web') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
        <polygon points="5 4 15 12 5 20 5 4" />
        <line x1="19" y1="5" x2="19" y2="19" />
      </svg>
    );
  }
  return <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>⏭</Text>;
};

const MaterialPlayPauseIcon = ({ isPlaying = false, size = 28, color = '#fff' }: { isPlaying?: boolean; size?: number; color?: string }) => {
  if (Platform.OS === 'web') {
    if (isPlaying) {
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
          <line x1="10" y1="4" x2="10" y2="20" />
          <line x1="14" y1="4" x2="14" y2="20" />
        </svg>
      );
    } else {
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', marginLeft: 3 } as any}>
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      );
    }
  }
  return <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>{isPlaying ? '⏸' : '▶'}</Text>;
};


const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
const LOOP_OPTIONS = [1, 2, 3, 5, 10, 15, 20, 30, 50];
const REST_OPTIONS = [0, 0.5, 1.0, 2.0, 3.0];

export default function PlayerScreen({ project: initialProject, onBack, onOpenReview }: PlayerScreenProps) {
  const [project, setProject] = useState<Project>(initialProject);
  const [segments, setSegments] = useState<Segment[]>(initialProject.segments);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(
    initialProject.activeSegmentId || null
  );
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAudioLoading, setIsAudioLoading] = useState(true);
  const [positionMs, setPositionMs] = useState(0);
  const [loopProgress, setLoopProgress] = useState(0);
  const [waveformAmplitudes, setWaveformAmplitudes] = useState<number[]>([]);

  // Tab mode: shadowing | dictation | translation
  type PlayerTab = 'shadowing' | 'dictation' | 'translation';
  const [activeTab, setActiveTab] = useState<PlayerTab>('shadowing');

  // Dictation states
  const [dictationInput, setDictationInput] = useState('');
  const [showDictationAnswer, setShowDictationAnswer] = useState(false);
  const [isDictationChecked, setIsDictationChecked] = useState(false);

  // Translation practice states
  const [translationInput, setTranslationInput] = useState('');
  const [showTranslationAnswer, setShowTranslationAnswer] = useState(false);
  const [isTranslationChecked, setIsTranslationChecked] = useState(false);

  // Reset dictation + translation states on segment change
  useEffect(() => {
    setDictationInput('');
    setShowDictationAnswer(false);
    setIsDictationChecked(false);
    setTranslationInput('');
    setShowTranslationAnswer(false);
    setIsTranslationChecked(false);
    // Also reset inline edit states
    setIsEditingTranscript(false);
    setEditTranscriptText('');
  }, [activeSegmentId]);

  // Inline edit states
  const [isEditingTranscript, setIsEditingTranscript] = useState(false);
  const [editTranscriptText, setEditTranscriptText] = useState('');

  const prevActiveSegmentIdRef = useRef<string | null>(null);

  useEffect(() => {
    const prevId = prevActiveSegmentIdRef.current;
    const currentId = activeSegmentId;
    prevActiveSegmentIdRef.current = currentId;

    if (prevId && currentId && prevId !== currentId) {
      setSegments(prevSegs =>
        prevSegs.map(seg =>
          seg.id === prevId
            ? { ...seg, studyCount: (seg.studyCount || 0) + 1 }
            : seg
        )
      );
    }
  }, [activeSegmentId]);

  const [speed, setSpeed] = useState(1.0);
  const [loops, setLoops] = useState(10);
  const [restTime, setRestTime] = useState(1.0);
  const [autoAdvance, setAutoAdvance] = useState(true);

  const [showSettings, setShowSettings] = useState(false);
  const [showTimelineModal, setShowTimelineModal] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isRetranscribing, setIsRetranscribing] = useState(false);
  const [retranscribeProgress, setRetranscribeProgress] = useState('');

  // Load persisted settings from localStorage on mount
  const settingsLoadedRef = useRef(false);
  useEffect(() => {
    try {
      if (IS_WEB) {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.loops !== undefined) setLoops(saved.loops);
          if (saved.restTime !== undefined) setRestTime(saved.restTime);
          if (saved.autoAdvance !== undefined) setAutoAdvance(saved.autoAdvance);
          if (saved.showTools !== undefined) setShowTools(saved.showTools);
        }
      }
    } catch (e) { /* ignore */ }
    settingsLoadedRef.current = true;
  }, []);

  // Persist settings to localStorage on change
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    try {
      if (IS_WEB) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ loops, restTime, autoAdvance, showTools }));
      }
    } catch (e) { /* ignore */ }
  }, [loops, restTime, autoAdvance, showTools]);

  // Word-level split states
  const [isSplittingWords, setIsSplittingWords] = useState(false);
  const [splitWordIdx, setSplitWordIdx] = useState<number | null>(null);

  // Audio load failure & file picker states
  const [audioLoadFailed, setAudioLoadFailed] = useState(false);
  const [showFilePickerModal, setShowFilePickerModal] = useState(false);
  const [isReloadingAudio, setIsReloadingAudio] = useState(false);

  // Web responsive
  const [dimensions, setDimensions] = useState({ width: SCREEN_WIDTH, height: SCREEN_HEIGHT });
  const isWide = dimensions.width > 768;

  // Update waveform amplitudes when active segment changes
  useEffect(() => {
    if (audioServiceRef.current && activeSegmentId) {
      const points = audioServiceRef.current.getAmplitudeData(isWide ? 64 : 50);
      setWaveformAmplitudes(points);
    } else {
      setWaveformAmplitudes([]);
    }
  }, [activeSegmentId, isWide]);

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      setDimensions({ width: window.width, height: window.height });
    });
    return () => sub?.remove();
  }, []);

  const audioServiceRef = useRef<AudioService | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineRef = useRef<FlatList>(null);

  const inlineSliderWidth = useRef(200);
  const modalSliderWidth = useRef(200);
  const seekSliderWidth = useRef(300);
  const inlineRestSliderWidth = useRef(200);
  const modalRestSliderWidth = useRef(200);

  // Khởi tạo Audio Service
  useEffect(() => {
    const audioService = new AudioService();
    audioServiceRef.current = audioService;

    let active = true;

    async function init() {
      let resolvedUri = '';
      try {
        setIsAudioLoading(true);
        resolvedUri = await FirebaseSyncService.resolveAndDownloadAudio(project.id, project.audioUri);
        if (!active) return;

        await audioService.loadSound(
          resolvedUri,
          segments,
          (data: PlaybackCallbackData) => {
            if (!active) return;
            setPositionMs(data.positionMs);
            setIsPlaying(data.isPlaying);
            setActiveSegmentId(data.activeSegmentId);
            setLoopProgress(data.loopProgress);
          }
        );

        if (!active) return;
        setIsAudioLoading(false);

        // Resume at T+1: first segment that is NOT mastered (next to learn)
        if (segments.length > 0 && audioServiceRef.current) {
          const firstUnmastered = segments.find(s => s.status !== 'mastered');
          const resumeSeg = firstUnmastered || segments[0]; // If all mastered, go to first
          audioServiceRef.current.selectSegment(resumeSeg);
        }
      } catch (err: any) {
        if (!active) return;
        console.error('[PlayerScreen] Audio load failed:', err);
        setIsAudioLoading(false);
        setAudioLoadFailed(true);
        setShowFilePickerModal(true);
      }
    }

    init();

    return () => {
      active = false;
      audioService.unload().catch(err => console.warn('Lỗi giải phóng âm thanh:', err));
    };
  }, [project.id, project.audioUri]);

  useEffect(() => {
    if (audioServiceRef.current) {
      audioServiceRef.current.setLoopConfig(loops, restTime, autoAdvance);
    }
  }, [loops, restTime, autoAdvance]);

  // Auto-save
  const saveProgress = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const updatedFields = {
          segments,
          activeSegmentId: activeSegmentId || undefined,
          lastOpenedAt: Date.now()
        };
        await StorageService.updateProject(project.id, updatedFields);
        await FirebaseSyncService.uploadProject({
          ...project,
          ...updatedFields
        });
      } catch (err) {
        console.warn('Auto-save failed:', err);
      }
    }, 2000);
  }, [project, segments, activeSegmentId]);

  useEffect(() => {
    saveProgress();
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [segments, activeSegmentId, saveProgress]);

  const handleBack = useCallback(async () => {
    try {
      const updatedFields = {
        segments,
        activeSegmentId: activeSegmentId || undefined,
        lastOpenedAt: Date.now()
      };
      // 1. Save to local storage instantly
      await StorageService.updateProject(project.id, updatedFields);
      
      // 2. Trigger Firestore cloud upload in background (non-blocking)
      FirebaseSyncService.uploadProject({
        ...project,
        ...updatedFields
      }).catch(err => console.warn('Background sync failed on back:', err));
    } catch (err) {
      console.warn('Local save failed on back:', err);
    }
    // 3. Immediately transition back to home screen
    onBack();
  }, [project, segments, activeSegmentId, onBack]);

  const activeSegment = segments.find(s => s.id === activeSegmentId);

  // Scroll timeline to active segment
  useEffect(() => {
    if (activeSegmentId && timelineRef.current) {
      const idx = segments.findIndex(s => s.id === activeSegmentId);
      if (idx !== -1) {
        try {
          timelineRef.current.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 });
        } catch (e) {}
      }
    }
  }, [activeSegmentId, showTimelineModal]);

  // ─── Playback Controls ───
  const triggerHaptic = (style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => {
    if (!IS_WEB) Haptics.impactAsync(style);
  };

  const handlePlayPause = async () => {
    if (audioLoadFailed) {
      // Audio không tải được → hiện popup chọn file
      setShowFilePickerModal(true);
      return;
    }
    if (!audioServiceRef.current) return;
    triggerHaptic();
    if (isPlaying) {
      await audioServiceRef.current.pause();
    } else {
      if (!activeSegmentId && segments.length > 0) {
        await handleSelectSegment(segments[0]);
      } else {
        await audioServiceRef.current.play();
      }
    }
  };

  // --- FILE PICKER: Reload audio from local device ---
  const handlePickAndReloadAudio = async (fileUri: string, fileBlob?: Blob) => {
    setIsReloadingAudio(true);
    try {
      // 1. Save file locally
      if (Platform.OS === 'web' && fileBlob) {
        await DBService.saveAudio(project.id, fileBlob);
      } else if (Platform.OS !== 'web') {
        const FS = require('expo-file-system/legacy');
        const localPath = `${FS.documentDirectory}${project.id}.mp3`;
        await FS.copyAsync({ from: fileUri, to: localPath });
        fileUri = localPath;
      }

      // 2. Resolve new URI
      let newUri = fileUri;
      if (Platform.OS === 'web' && fileBlob) {
        newUri = URL.createObjectURL(fileBlob);
      }

      // 3. Unload old audio & reload
      if (audioServiceRef.current) {
        await audioServiceRef.current.unload();
      }
      const audioService = new AudioService();
      audioServiceRef.current = audioService;

      await audioService.loadSound(
        newUri,
        segments,
        (data: PlaybackCallbackData) => {
          setPositionMs(data.positionMs);
          setIsPlaying(data.isPlaying);
          setActiveSegmentId(data.activeSegmentId);
          setLoopProgress(data.loopProgress);
        }
      );

      // 4. Apply current settings
      audioService.setLoopConfig(loops, restTime, autoAdvance);
      if (speed !== 1.0) await audioService.setPlaybackRate(speed);

      // 5. Upload audio to Firebase Storage in background (force upload since user picked a new file)
      FirebaseSyncService.uploadAudioFile(project.id, newUri, true)
        .catch((e: any) => console.warn('Background audio upload failed:', e));

      setAudioLoadFailed(false);
      setShowFilePickerModal(false);
    } catch (err: any) {
      console.error('[PlayerScreen] Reload audio failed:', err);
      showAlert('Lỗi', `Không thể nạp tệp âm thanh đã chọn.\n${err.message || err}`);
    } finally {
      setIsReloadingAudio(false);
    }
  };

  // ─── AI Re-transcribe (word-level timestamps) ───
  const handleRetranscribe = async () => {
    setIsRetranscribing(true);
    setRetranscribeProgress('Đang chuẩn bị audio...');
    setShowSettings(false);

    try {
      // Pause playback
      if (audioServiceRef.current && isPlaying) {
        await audioServiceRef.current.pause();
      }

      // Resolve API key
      let apiKey = await WhisperService.getApiKey();
      if (!apiKey) {
        showAlert('Thiếu API Key', 'Cần API Key để AI cắt câu lại. Vào Settings để thêm.');
        setIsRetranscribing(false);
        return;
      }

      // Resolve audio URI
      let audioUri = project.audioUri;
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
      const { segments: newSegments } = await AutocutService.analyzeAndSplit(
        audioUri,
        undefined,
        (msg) => setRetranscribeProgress(msg),
        true,
        apiKey
      );

      // Translate
      let finalSegments = newSegments;
      try {
        setRetranscribeProgress('Đang dịch & phiên âm...');
        const sentencesToTranslate = newSegments
          .map(seg => ({ index: seg.index, text: seg.transcript || '' }))
          .filter(s => s.text.length > 0);
        if (sentencesToTranslate.length > 0) {
          const translations = await AITranslationService.translateAndPhoneticsBatch(sentencesToTranslate, apiKey);
          finalSegments = newSegments.map(seg => {
            const match = translations.find(t => t.index === seg.index);
            return match ? { ...seg, ipa: match.ipa || undefined, translation: match.vietnamese || undefined } : seg;
          });
        }
      } catch (e) {
        console.warn('[PlayerScreen] AI translation failed during retranscribe:', e);
      }

      // Update state + save
      setSegments(finalSegments);
      setActiveSegmentId(finalSegments[0]?.id || null);

      const updatedProject = { ...project, segments: finalSegments };
      setProject(updatedProject);
      await StorageService.saveProject(updatedProject);
      FirebaseSyncService.uploadProject(updatedProject).catch(() => {});

      // Reload audio with new segments
      if (audioServiceRef.current) {
        audioServiceRef.current.updateSegments(finalSegments);
      }

      showAlert('✅ Thành công', `AI đã cắt lại ${finalSegments.length} câu với timestamps mới.`);
    } catch (err: any) {
      console.error('[PlayerScreen] Retranscribe failed:', err);
      showAlert('Lỗi', `AI cắt câu lại thất bại: ${err.message || 'Vui lòng thử lại.'}`);
    } finally {
      setIsRetranscribing(false);
      setRetranscribeProgress('');
    }
  };

  const handleWebFilePick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/mpeg,audio/mp3,audio/x-m4a,audio/mp4,audio/wav,audio/x-wav,.mp3,.m4a,.wav,.mp4';
    input.onchange = (e: any) => {
      const file = e.target?.files?.[0];
      if (file) {
        handlePickAndReloadAudio(URL.createObjectURL(file), file);
      }
    };
    input.click();
  };

  const handleNativeFilePick = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        handlePickAndReloadAudio(asset.uri);
      }
    } catch (err) {
      console.warn('File pick cancelled or failed:', err);
    }
  };

  const handleSelectSegment = async (segment: Segment, shouldAutoPlay: boolean = false) => {
    triggerHaptic();
    if (audioServiceRef.current) {
      await audioServiceRef.current.selectSegment(segment);
      if (shouldAutoPlay) {
        await audioServiceRef.current.play();
      }
    }
  };

  const handleNext = async () => {
    const i = segments.findIndex(s => s.id === activeSegmentId);
    if (i !== -1 && i < segments.length - 1) {
      triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
      await handleSelectSegment(segments[i + 1]);
    }
  };

  const handlePrev = async () => {
    const i = segments.findIndex(s => s.id === activeSegmentId);
    if (i !== -1 && i > 0) {
      triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
      await handleSelectSegment(segments[i - 1]);
    }
  };

  const handleSpeedChange = async (s: number) => {
    setSpeed(s);
    if (!IS_WEB) Haptics.selectionAsync();
    if (audioServiceRef.current) await audioServiceRef.current.setPlaybackRate(s);
  };



  const handleSeek = async (ratio: number) => {
    if (!activeSegment || !audioServiceRef.current) return;
    const targetMs = activeSegment.startTimeMs + ratio * (activeSegment.endTimeMs - activeSegment.startTimeMs);
    await audioServiceRef.current.seekTo(targetMs);
    if (!IS_WEB) Haptics.selectionAsync();
  };

  // Swipe gesture (mobile)
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 30 && Math.abs(gs.dy) < 40,
      onPanResponderRelease: (_, gs) => {
        if (gs.dx > 60) handlePrev();
        else if (gs.dx < -60) handleNext();
      },
    })
  ).current;

  // Merge / Split
  const handleMerge = () => {
    if (!activeSegmentId) return;
    const i = segments.findIndex(s => s.id === activeSegmentId);
    const next = segments[i + 1];
    if (!next) { showAlert('Không thể ghép', 'Đây là câu cuối.'); return; }
    if (!IS_WEB) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const updated = AutocutService.mergeSegments(segments, activeSegmentId, next.id);
    setSegments(updated);
    if (audioServiceRef.current) audioServiceRef.current.updateSegments(updated);
    const merged = updated.find(s => s.startTimeMs === segments[i].startTimeMs);
    if (merged) handleSelectSegment(merged);
  };

  const handleSplit = () => {
    if (!activeSegmentId || !activeSegment) return;
    const transcript = activeSegment.transcript || '';
    const words = transcript.trim().split(/\s+/).filter(w => w.length > 0);
    if (words.length < 2) {
      showAlert('Không thể tách', 'Câu cần có ít nhất 2 từ để tách.');
      return;
    }
    setIsSplittingWords(true);
    setSplitWordIdx(null);
    if (!showTools) setShowTools(true);
  };

  const cancelWordSplit = () => {
    setIsSplittingWords(false);
    setSplitWordIdx(null);
  };

  const confirmWordSplit = () => {
    if (!activeSegment || splitWordIdx === null) return;
    const words = (activeSegment.transcript || '').trim().split(/\s+/);
    if (splitWordIdx <= 0 || splitWordIdx >= words.length) return;

    const ratio = splitWordIdx / words.length;
    const splitTimeMs = activeSegment.startTimeMs + Math.round(ratio * (activeSegment.endTimeMs - activeSegment.startTimeMs));

    if (splitTimeMs - activeSegment.startTimeMs < 300 || activeSegment.endTimeMs - splitTimeMs < 300) {
      showAlert('Không thể tách', 'Phần tách quá ngắn (< 300ms).');
      return;
    }

    if (!IS_WEB) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const updated = AutocutService.splitSegment(segments, activeSegment.id, splitTimeMs);
    setSegments(updated);
    if (audioServiceRef.current) audioServiceRef.current.updateSegments(updated);
    const seg = updated.find(s => s.startTimeMs === activeSegment.startTimeMs);
    if (seg) handleSelectSegment(seg);
    setIsSplittingWords(false);
    setSplitWordIdx(null);
  };

  const handleAITranslate = async () => {
    if (isTranslating) return;

    const key = await WhisperService.getApiKey();
    if (!key) {
      showAlert(
        'Thiếu API Key',
        'Vui lòng cấu hình API Key ở màn hình Import trước để sử dụng tính năng này.'
      );
      return;
    }

    setIsTranslating(true);
    triggerHaptic();

    try {
      const sentencesToTranslate = segments.map(seg => ({
        index: seg.index,
        text: seg.transcript || ''
      })).filter(s => s.text.length > 0);

      if (sentencesToTranslate.length === 0) {
        showAlert('Không có dữ liệu', 'Không tìm thấy câu nào có văn bản transcript để dịch.');
        setIsTranslating(false);
        return;
      }

      const translations = await AITranslationService.translateAndPhoneticsBatch(
        sentencesToTranslate,
        key
      );

      const updatedSegments = segments.map(seg => {
        const match = translations.find(t => t.index === seg.index);
        if (match) {
          return {
            ...seg,
            ipa: match.ipa || undefined,
            translation: match.vietnamese || undefined
          };
        }
        return seg;
      });

      setSegments(updatedSegments);

      // Force save immediately
      const updatedFields = {
        segments: updatedSegments,
        lastOpenedAt: Date.now()
      };
      await StorageService.updateProject(project.id, updatedFields);
      await FirebaseSyncService.uploadProject({
        ...project,
        ...updatedFields
      });

      showAlert('✅ Thành công', 'Đã dịch nghĩa và tạo phiên âm IPA hoàn tất cho tất cả các câu!');
    } catch (err) {
      console.error(err);
      showAlert('Thất bại', 'Không thể hoàn thành dịch thuật AI. Vui lòng kiểm tra kết nối.');
    } finally {
      setIsTranslating(false);
    }
  };

  const handleLoopSliderPress = (ratio: number) => {
    const val = Math.max(1, Math.round(ratio * 49) + 1); // 1 to 50
    setLoops(val);
  };

  const handleInlineLoopSliderTouch = (e: any) => {
    let ratio = 0;
    if (IS_WEB) {
      const rect = e.currentTarget?.getBoundingClientRect?.();
      if (rect) {
        let clientX = e.nativeEvent?.clientX;
        if (clientX === undefined && e.nativeEvent?.touches?.[0]) {
          clientX = e.nativeEvent.touches[0].clientX;
        }
        if (clientX === undefined && e.nativeEvent?.changedTouches?.[0]) {
          clientX = e.nativeEvent.changedTouches[0].clientX;
        }
        clientX = clientX || 0;
        const relativeX = clientX - rect.left;
        ratio = Math.max(0, Math.min(1, relativeX / rect.width));
      }
    } else {
      const locationX = e.nativeEvent?.locationX || 0;
      ratio = Math.max(0, Math.min(1, locationX / inlineSliderWidth.current));
    }
    handleLoopSliderPress(ratio);
  };

  const handleModalLoopSliderTouch = (e: any) => {
    let ratio = 0;
    if (IS_WEB) {
      const rect = e.currentTarget?.getBoundingClientRect?.();
      if (rect) {
        let clientX = e.nativeEvent?.clientX;
        if (clientX === undefined && e.nativeEvent?.touches?.[0]) {
          clientX = e.nativeEvent.touches[0].clientX;
        }
        if (clientX === undefined && e.nativeEvent?.changedTouches?.[0]) {
          clientX = e.nativeEvent.changedTouches[0].clientX;
        }
        clientX = clientX || 0;
        const relativeX = clientX - rect.left;
        ratio = Math.max(0, Math.min(1, relativeX / rect.width));
      }
    } else {
      const locationX = e.nativeEvent?.locationX || 0;
      ratio = Math.max(0, Math.min(1, locationX / modalSliderWidth.current));
    }
    handleLoopSliderPress(ratio);
  };

  const handleSeekBarTouch = (e: any) => {
    let ratio = 0;
    if (IS_WEB) {
      const rect = e.currentTarget?.getBoundingClientRect?.();
      if (rect) {
        let clientX = e.nativeEvent?.clientX;
        if (clientX === undefined && e.nativeEvent?.touches?.[0]) {
          clientX = e.nativeEvent.touches[0].clientX;
        }
        if (clientX === undefined && e.nativeEvent?.changedTouches?.[0]) {
          clientX = e.nativeEvent.changedTouches[0].clientX;
        }
        clientX = clientX || 0;
        const relativeX = clientX - rect.left;
        ratio = Math.max(0, Math.min(1, relativeX / rect.width));
      }
    } else {
      const locationX = e.nativeEvent?.locationX || 0;
      ratio = Math.max(0, Math.min(1, locationX / seekSliderWidth.current));
    }
    handleSeek(ratio);
  };

  const handleRestSliderPress = (ratio: number) => {
    const rawVal = ratio * 10;
    const rounded = Math.round(rawVal * 2) / 2; // round to nearest 0.5
    setRestTime(Math.max(0, Math.min(10, rounded)));
  };

  const handleInlineRestSliderTouch = (e: any) => {
    let ratio = 0;
    if (IS_WEB) {
      const rect = e.currentTarget?.getBoundingClientRect?.();
      if (rect) {
        let clientX = e.nativeEvent?.clientX;
        if (clientX === undefined && e.nativeEvent?.touches?.[0]) {
          clientX = e.nativeEvent.touches[0].clientX;
        }
        if (clientX === undefined && e.nativeEvent?.changedTouches?.[0]) {
          clientX = e.nativeEvent.changedTouches[0].clientX;
        }
        clientX = clientX || 0;
        const relativeX = clientX - rect.left;
        ratio = Math.max(0, Math.min(1, relativeX / rect.width));
      }
    } else {
      const locationX = e.nativeEvent?.locationX || 0;
      ratio = Math.max(0, Math.min(1, locationX / inlineRestSliderWidth.current));
    }
    handleRestSliderPress(ratio);
  };

  const handleModalRestSliderTouch = (e: any) => {
    let ratio = 0;
    if (IS_WEB) {
      const rect = e.currentTarget?.getBoundingClientRect?.();
      if (rect) {
        let clientX = e.nativeEvent?.clientX;
        if (clientX === undefined && e.nativeEvent?.touches?.[0]) {
          clientX = e.nativeEvent.touches[0].clientX;
        }
        if (clientX === undefined && e.nativeEvent?.changedTouches?.[0]) {
          clientX = e.nativeEvent.changedTouches[0].clientX;
        }
        clientX = clientX || 0;
        const relativeX = clientX - rect.left;
        ratio = Math.max(0, Math.min(1, relativeX / rect.width));
      }
    } else {
      const locationX = e.nativeEvent?.locationX || 0;
      ratio = Math.max(0, Math.min(1, locationX / modalRestSliderWidth.current));
    }
    handleRestSliderPress(ratio);
  };

  // Helper to clean word for comparison
  const cleanWord = (w: string) => w.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").trim();

  const handleCheckDictation = () => {
    if (!activeSegment) return;
    const targetText = activeSegment.transcript || '';
    const targetWords = targetText.split(/\s+/).filter(w => w.length > 0);
    const inputWords = dictationInput.trim().split(/\s+/).filter(w => w.length > 0);

    const correctWordsCount = targetWords.filter((tWord, idx) => idx < inputWords.length && cleanWord(inputWords[idx]) === cleanWord(tWord)).length;
    const pct = targetWords.length > 0 ? Math.round((correctWordsCount / targetWords.length) * 100) : 0;

    setSegments(prevSegs =>
      prevSegs.map(seg =>
        seg.id === activeSegment.id
          ? { ...seg, dictationAccuracy: pct }
          : seg
      )
    );

    setIsDictationChecked(true);
  };

  const handleDictationHint = () => {
    if (!activeSegment) return;
    const targetText = activeSegment.transcript || '';
    const targetWords = targetText.split(/\s+/).filter(w => w.length > 0);
    const inputWords = dictationInput.trim().split(/\s+/).filter(w => w.length > 0);

    let firstErrorIdx = -1;
    for (let i = 0; i < targetWords.length; i++) {
      if (i >= inputWords.length || cleanWord(inputWords[i]) !== cleanWord(targetWords[i])) {
        firstErrorIdx = i;
        break;
      }
    }

    if (firstErrorIdx !== -1) {
      const correctWord = targetWords[firstErrorIdx];
      const newWords = [...inputWords];
      newWords[firstErrorIdx] = correctWord;
      const updatedInput = newWords.slice(0, firstErrorIdx + 1).join(' ') + ' ';
      setDictationInput(updatedInput);
      setIsDictationChecked(false); // Reset check state on hint
    }
  };

  const renderDictation = () => {
    if (!activeSegment) return null;
    const targetText = activeSegment.transcript || '';
    const targetWords = targetText.split(/\s+/).filter(w => w.length > 0);
    const inputWords = dictationInput.trim().split(/\s+/).filter(w => w.length > 0);

    const isFullyCorrect = targetWords.length > 0 &&
      inputWords.length === targetWords.length &&
      targetWords.every((tWord, idx) => cleanWord(inputWords[idx] || '') === cleanWord(tWord));

    const wordRender = targetWords.map((tWord, idx) => {
      const cleanTarget = cleanWord(tWord);
      
      if (showDictationAnswer) {
        return (
          <Text key={idx} style={[s.dictationWord, s.dictationWordHint]}>
            {tWord}{' '}
          </Text>
        );
      }

      if (idx < inputWords.length) {
        const cleanInput = cleanWord(inputWords[idx]);
        if (isDictationChecked) {
          if (cleanTarget === cleanInput) {
            return (
              <Text key={idx} style={[s.dictationWord, s.dictationWordCorrect]}>
                {tWord}{' '}
              </Text>
            );
          } else {
            return (
              <Text key={idx} style={[s.dictationWord, s.dictationWordIncorrect]}>
                {inputWords[idx] || '?'}{' '}
              </Text>
            );
          }
        } else {
          // Render plain white if not checked yet
          return (
            <Text key={idx} style={[s.dictationWord, { color: '#fff' }]}>
              {inputWords[idx]}{' '}
            </Text>
          );
        }
      } else {
        const strippedWord = tWord.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
        const punctuation = tWord.substring(strippedWord.length);
        const underscores = '_'.repeat(Math.max(1, strippedWord.length));
        return (
          <Text key={idx} style={[s.dictationWord, s.dictationWordMissing]}>
            {underscores}{punctuation}{' '}
          </Text>
        );
      }
    });

    const correctWordsCount = targetWords.filter((tWord, idx) => idx < inputWords.length && cleanWord(inputWords[idx]) === cleanWord(tWord)).length;
    const pct = targetWords.length > 0 ? Math.round((correctWordsCount / targetWords.length) * 100) : 0;

    return (
      <View style={{ width: '100%', alignItems: 'center' }}>
        <View style={s.dictationWordsWrap}>
          {wordRender}
        </View>

        {isDictationChecked && (
          <View style={[
            s.dictationScoreBox,
            pct === 100 ? s.dictationScoreBoxPerfect : s.dictationScoreBoxNormal
          ]}>
            <Text style={[
              s.dictationScoreText,
              pct === 100 ? s.dictationScoreTextPerfect : s.dictationScoreTextNormal
            ]}>
              {pct === 100 
                ? `✨ HOÀN HẢO: 100% đúng (${correctWordsCount}/${targetWords.length} từ) ✨`
                : `Kết quả: ${pct}% đúng (${correctWordsCount}/${targetWords.length} từ) — Hãy sửa các từ màu đỏ/thiếu nhé!`}
            </Text>
          </View>
        )}

        <TextInput
          style={s.dictationInput}
          placeholder="Nghe và gõ lại câu tại đây..."
          placeholderTextColor="#4b5563"
          autoCapitalize="none"
          autoCorrect={false}
          value={dictationInput}
          onChangeText={(text) => {
            setDictationInput(text);
            setIsDictationChecked(false); // Reset check state on type
          }}
          onSubmitEditing={handleCheckDictation}
          blurOnSubmit={false}
        />

        <View style={s.dictationActions}>
          <TouchableOpacity style={[s.dictationActionBtn, { borderColor: '#7c3aed' }]} onPress={handleCheckDictation}>
            <Text style={[s.dictationActionBtnText, { color: '#c4b5fd' }]}>🔍 Kiểm tra</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.dictationActionBtn} onPress={handleDictationHint}>
            <Text style={s.dictationActionBtnText}>💡 Gợi ý</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.dictationActionBtn} onPress={() => setShowDictationAnswer(!showDictationAnswer)}>
            <Text style={s.dictationActionBtnText}>
              {showDictationAnswer ? '👁 Ẩn đáp án' : '👁 Hiện đáp án'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.dictationActionBtn} onPress={() => {
            setDictationInput('');
            setIsDictationChecked(false);
          }}>
            <Text style={s.dictationActionBtnText}>🧹 Xóa</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ─── Translation Practice: check / hint / show answer ───
  const handleCheckTranslation = () => {
    if (!activeSegment) return;
    const targetText = activeSegment.transcript || '';
    const targetWords = targetText.split(/\s+/).filter(w => w.length > 0);
    const inputWords = translationInput.trim().split(/\s+/).filter(w => w.length > 0);

    const correctWordsCount = targetWords.filter((tWord, idx) => idx < inputWords.length && cleanWord(inputWords[idx]) === cleanWord(tWord)).length;
    const pct = targetWords.length > 0 ? Math.round((correctWordsCount / targetWords.length) * 100) : 0;

    setSegments(prevSegs =>
      prevSegs.map(seg =>
        seg.id === activeSegment.id
          ? { ...seg, translationAccuracy: Math.max(seg.translationAccuracy || 0, pct) }
          : seg
      )
    );

    setIsTranslationChecked(true);
  };

  const handleTranslationHint = () => {
    if (!activeSegment) return;
    const targetText = activeSegment.transcript || '';
    const targetWords = targetText.split(/\s+/).filter(w => w.length > 0);
    const inputWords = translationInput.trim().split(/\s+/).filter(w => w.length > 0);

    let firstErrorIdx = -1;
    for (let i = 0; i < targetWords.length; i++) {
      if (i >= inputWords.length || cleanWord(inputWords[i]) !== cleanWord(targetWords[i])) {
        firstErrorIdx = i;
        break;
      }
    }

    if (firstErrorIdx !== -1) {
      const correctWord = targetWords[firstErrorIdx];
      const newWords = [...inputWords];
      newWords[firstErrorIdx] = correctWord;
      const updatedInput = newWords.slice(0, firstErrorIdx + 1).join(' ') + ' ';
      setTranslationInput(updatedInput);
      setIsTranslationChecked(false);
    }
  };

  const renderTranslation = () => {
    if (!activeSegment) return null;

    // If no translation data, show prompt to translate first
    if (!activeSegment.translation) {
      return (
        <View style={{ width: '100%', alignItems: 'center', paddingVertical: 20 }}>
          <Text style={{ color: '#6b7280', fontSize: 14, textAlign: 'center', lineHeight: 22 }}>
            ⚠️ Chưa có bản dịch tiếng Việt.{'\n'}
            Hãy dùng chức năng{' '}
            <Text style={{ color: '#a78bfa', fontWeight: '700' }}>Dịch & Phiên âm AI</Text>
            {' '}trước nhé!
          </Text>
        </View>
      );
    }

    const targetText = activeSegment.transcript || '';
    const targetWords = targetText.split(/\s+/).filter(w => w.length > 0);
    const inputWords = translationInput.trim().split(/\s+/).filter(w => w.length > 0);

    const isFullyCorrect = targetWords.length > 0 &&
      inputWords.length === targetWords.length &&
      targetWords.every((tWord, idx) => cleanWord(inputWords[idx] || '') === cleanWord(tWord));

    // Build word-by-word rendering for answer display
    const wordRender = showTranslationAnswer ? (
      <View style={{ width: '100%', alignItems: 'center', gap: 6 }}>
        <Text style={[s.heroTranscript, isWide && s.heroTranscriptWide, { color: '#a78bfa' }]}>
          {targetText}
        </Text>
        {activeSegment.ipa ? (
          <Text style={[s.heroIpa, isWide && s.heroIpaWide]}>
            {activeSegment.ipa}
          </Text>
        ) : null}
      </View>
    ) : isTranslationChecked ? (
      <View style={s.dictationWordsWrap}>
        {targetWords.map((tWord, idx) => {
          if (idx < inputWords.length) {
            const cleanTarget = cleanWord(tWord);
            const cleanInput = cleanWord(inputWords[idx]);
            if (cleanTarget === cleanInput) {
              return (
                <Text key={idx} style={[s.dictationWord, s.dictationWordCorrect]}>
                  {tWord}{' '}
                </Text>
              );
            } else {
              return (
                <Text key={idx} style={[s.dictationWord, s.dictationWordIncorrect]}>
                  {inputWords[idx] || '?'}{' '}
                </Text>
              );
            }
          } else {
            const strippedWord = tWord.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
            const punctuation = tWord.substring(strippedWord.length);
            const underscores = '_'.repeat(Math.max(1, strippedWord.length));
            return (
              <Text key={idx} style={[s.dictationWord, s.dictationWordMissing]}>
                {underscores}{punctuation}{' '}
              </Text>
            );
          }
        })}
      </View>
    ) : null;

    const correctWordsCount = targetWords.filter((tWord, idx) => idx < inputWords.length && cleanWord(inputWords[idx]) === cleanWord(tWord)).length;
    const pct = targetWords.length > 0 ? Math.round((correctWordsCount / targetWords.length) * 100) : 0;

    return (
      <View style={{ width: '100%', alignItems: 'center' }}>
        {/* Vietnamese prompt */}
        <View style={{
          width: '100%',
          backgroundColor: 'rgba(16,185,129,0.06)',
          borderWidth: 1,
          borderColor: 'rgba(16,185,129,0.15)',
          borderRadius: 12,
          paddingVertical: 14,
          paddingHorizontal: 16,
          marginBottom: 12,
          alignItems: 'center',
        }}>
          <Text style={{ color: '#6b7280', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 4, textTransform: 'uppercase' }}>
            🇻🇳 Dịch sang tiếng Anh
          </Text>
          <Text style={{ color: '#34d399', fontSize: 17, fontWeight: '700', textAlign: 'center', lineHeight: 26 }}>
            {activeSegment.translation}
          </Text>
        </View>

        {/* Answer area (word-by-word check or show answer) */}
        {wordRender}

        {/* Score */}
        {isTranslationChecked && !showTranslationAnswer && (
          <View style={[
            s.dictationScoreBox,
            pct === 100 ? s.dictationScoreBoxPerfect : s.dictationScoreBoxNormal
          ]}>
            <Text style={[
              s.dictationScoreText,
              pct === 100 ? s.dictationScoreTextPerfect : s.dictationScoreTextNormal
            ]}>
              {pct === 100
                ? `✨ HOÀN HẢO: 100% đúng (${correctWordsCount}/${targetWords.length} từ) ✨`
                : `Kết quả: ${pct}% đúng (${correctWordsCount}/${targetWords.length} từ) — Hãy sửa các từ sai nhé!`}
            </Text>
          </View>
        )}

        {/* Input */}
        <TextInput
          style={s.dictationInput}
          placeholder="Gõ câu tiếng Anh tại đây..."
          placeholderTextColor="#4b5563"
          autoCapitalize="none"
          autoCorrect={false}
          value={translationInput}
          onChangeText={(text) => {
            setTranslationInput(text);
            setIsTranslationChecked(false);
          }}
          onSubmitEditing={handleCheckTranslation}
          blurOnSubmit={false}
        />

        {/* Action buttons */}
        <View style={s.dictationActions}>
          <TouchableOpacity style={[s.dictationActionBtn, { borderColor: '#7c3aed' }]} onPress={handleCheckTranslation}>
            <Text style={[s.dictationActionBtnText, { color: '#c4b5fd' }]}>🔍 Kiểm tra</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.dictationActionBtn} onPress={handleTranslationHint}>
            <Text style={s.dictationActionBtnText}>💡 Gợi ý</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.dictationActionBtn} onPress={() => setShowTranslationAnswer(!showTranslationAnswer)}>
            <Text style={s.dictationActionBtnText}>
              {showTranslationAnswer ? '👁 Ẩn đáp án' : '👁 Hiện đáp án'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.dictationActionBtn} onPress={() => {
            setTranslationInput('');
            setIsTranslationChecked(false);
          }}>
            <Text style={s.dictationActionBtnText}>🧹 Xóa</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ─── Computed ───
  const learnedCount = segments.filter(s => (s.studyCount || 0) > 0).length;
  const percentComplete = segments.length > 0 ? Math.round((learnedCount / segments.length) * 100) : 0;

  const dictDoneCount = segments.filter(s => s.dictationAccuracy !== undefined).length;
  const dictPercent = segments.length > 0 ? Math.round((dictDoneCount / segments.length) * 100) : 0;

  const transDoneCount = segments.filter(s => s.translationAccuracy !== undefined).length;
  const transPercent = segments.length > 0 ? Math.round((transDoneCount / segments.length) * 100) : 0;

  const segmentProgress = activeSegment
    ? Math.max(0, Math.min(1, (positionMs - activeSegment.startTimeMs) / (activeSegment.endTimeMs - activeSegment.startTimeMs)))
    : 0;

  const formatTime = (ms: number) => {
    const sec = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, '0')}`;
  };

  // ═══════════════════════════════════════════════
  // RENDER: TIMELINE ITEM
  // ═══════════════════════════════════════════════
  const renderTimelineItem = ({ item }: { item: Segment }) => {
    const isActive = item.id === activeSegmentId;
    const dotColor = isActive ? '#a855f7' : ((item.studyCount || 0) > 0 ? '#10b981' : '#4b5563');

    return (
      <TouchableOpacity
        style={[s.tlItem, isActive && s.tlItemActive]}
        onPress={() => handleSelectSegment(item)}
        activeOpacity={0.6}
      >
        {/* Left: index + dot */}
        <View style={s.tlLeft}>
          <View style={[s.tlDot, { backgroundColor: dotColor }]} />
          <Text style={[s.tlIndex, isActive && s.tlIndexActive]}>
            {String(item.index).padStart(2, '0')}
          </Text>
        </View>

        {/* Center: text */}
        <View style={s.tlCenter}>
          <Text style={[s.tlText, isActive && s.tlTextActive, (activeTab === 'dictation' || activeTab === 'translation') && (IS_WEB ? { filter: 'blur(5px)' } as any : { opacity: 0.15 })]} numberOfLines={2}>
            {item.transcript || `Đoạn nghe ${item.index}`}
          </Text>
          {item.ipa ? (
            <Text style={[s.tlIpa, isActive && s.tlIpaActive, (activeTab === 'dictation' || activeTab === 'translation') && (IS_WEB ? { filter: 'blur(5px)' } as any : { opacity: 0.15 })]} numberOfLines={1}>
              {item.ipa}
            </Text>
          ) : null}
          {item.translation ? (
            <Text style={[s.tlTranslation, isActive && s.tlTranslationActive, activeTab === 'dictation' && (IS_WEB ? { filter: 'blur(5px)' } as any : { opacity: 0.15 })]} numberOfLines={1}>
              {item.translation}
            </Text>
          ) : null}
          <Text style={s.tlDur}>
            {((item.endTimeMs - item.startTimeMs) / 1000).toFixed(1)}s
          </Text>
        </View>


        {/* Right: study count & accuracy badges */}
        <View style={s.tlRight}>
          {item.dictationAccuracy !== undefined && (
            <View style={[
              s.accuracyBadge,
              item.dictationAccuracy === 100 ? s.accuracyBadgePerfect : s.accuracyBadgeNormal
            ]}>
              <Text style={[
                s.accuracyBadgeText,
                item.dictationAccuracy === 100 ? s.accuracyBadgeTextPerfect : s.accuracyBadgeTextNormal
              ]}>
                ✍️ {item.dictationAccuracy}%
              </Text>
            </View>
          )}
          {item.translationAccuracy !== undefined && (
            <View style={[
              s.accuracyBadge,
              { borderColor: 'rgba(52,211,153,0.3)', backgroundColor: 'rgba(52,211,153,0.08)' },
              item.translationAccuracy === 100 ? { borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.15)' } : null
            ]}>
              <Text style={[
                s.accuracyBadgeText,
                { color: '#34d399' },
                item.translationAccuracy === 100 ? { color: '#10b981', fontWeight: 'bold' } : null
              ]}>
                🔄 {item.translationAccuracy}%
              </Text>
            </View>
          )}
          <View style={s.studyBadge}>
            <Text style={s.studyBadgeText}>🎧 {item.studyCount || 0}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // ═══════════════════════════════════════════════
  // RENDER: MAIN PLAYER (left side on web)
  // ═══════════════════════════════════════════════
  const renderPlayer = () => (
    <View style={[s.playerCol, isWide && s.playerColWide]}>
      {/* ── HEADER ── */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={handleBack}>
          <Text style={s.backIcon}>←</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle} numberOfLines={1}>{project.title}</Text>
          <View style={s.headerStatsRow}>
            <Text style={s.headerPercent}>🎧 {percentComplete}%</Text>
            <Text style={s.headerPercentDictation}>✍️ {dictPercent}%</Text>
            <Text style={[s.headerPercentDictation, { color: '#34d399' }]}>🔄 {transPercent}%</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          {!isWide && (
            <TouchableOpacity style={s.settingsBtn} onPress={() => setShowTimelineModal(true)}>
              <MaterialListIcon />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.settingsBtn} onPress={() => setShowSettings(true)}>
            <MaterialSettingsIcon />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── HERO CARD ── */}
      <View style={[s.heroCard, isWide && s.heroCardWide]}>
        <View style={s.heroTop}>
          <View style={s.heroBadgeRow}>
            <Text style={s.heroSegLabel}>
              {activeSegment ? `CÂU ${activeSegment.index} / ${segments.length}` : 'CHỌN CÂU ĐỂ BẮT ĐẦU'}
            </Text>
            {activeSegment && (
              <View style={s.loopBadge}>
                <Text style={s.loopBadgeLabel}>LẶP</Text>
                <View style={s.loopBadgeDivider} />
                <Text style={s.loopBadgeValue}>{loopProgress + 1}/{loops}</Text>
              </View>
            )}
          </View>
        </View>

        {activeSegment && (
          <View style={s.heroTabs}>
            <TouchableOpacity
              style={[s.heroTab, activeTab === 'shadowing' && s.heroTabActive]}
              onPress={() => setActiveTab('shadowing')}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[s.heroTabTxt, activeTab === 'shadowing' && s.heroTabTxtActive]}>🎧 Nghe</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.heroTab, activeTab === 'dictation' && s.heroTabActive]}
              onPress={() => setActiveTab('dictation')}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[s.heroTabTxt, activeTab === 'dictation' && s.heroTabTxtActive]}>✍️ Chính tả</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.heroTab, activeTab === 'translation' && s.heroTabActive]}
              onPress={() => setActiveTab('translation')}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[s.heroTabTxt, activeTab === 'translation' && s.heroTabTxtActive]}>🔄 Dịch câu</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={s.heroBody}>
          {activeTab === 'shadowing' ? (
            <View style={{ alignItems: 'center', width: '100%', gap: 6 }}>
              {/* ── Inline Editable Transcript ── */}
              {isEditingTranscript && activeSegment ? (
                <View style={{ width: '100%', gap: 8 }}>
                  <TextInput
                    style={[s.heroTranscript, isWide && s.heroTranscriptWide, {
                      backgroundColor: '#0c0c18',
                      borderWidth: 1,
                      borderColor: '#7c3aed',
                      borderRadius: 10,
                      padding: 12,
                      minHeight: 80,
                      lineHeight: 28,
                      textAlignVertical: 'top',
                      ...(IS_WEB ? { outline: 'none', overflow: 'hidden', resize: 'none' } as any : {}),
                    }]}
                    value={editTranscriptText}
                    onChangeText={setEditTranscriptText}
                    multiline
                    scrollEnabled={false}
                    autoFocus
                    placeholder="Nhập transcript..."
                    placeholderTextColor="#4a4a6a"
                    {...(IS_WEB ? {
                      onLayout: (e: any) => {
                        const el = e?.target || e?.nativeEvent?.target;
                        if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
                      },
                      onChange: (e: any) => {
                        const el = e?.target || e?.nativeEvent?.target;
                        if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
                      },
                    } : {})}
                  />
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
                    <TouchableOpacity
                      style={{
                        paddingVertical: 6,
                        paddingHorizontal: 14,
                        borderRadius: 8,
                        backgroundColor: '#12121f',
                        borderWidth: 1,
                        borderColor: '#2d2d44',
                        ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
                      }}
                      onPress={() => {
                        setIsEditingTranscript(false);
                        setEditTranscriptText('');
                      }}
                    >
                      <Text style={{ color: '#9ca3af', fontSize: 12, fontWeight: '600' }}>❌ Hủy</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{
                        paddingVertical: 6,
                        paddingHorizontal: 14,
                        borderRadius: 8,
                        backgroundColor: 'rgba(16,185,129,0.1)',
                        borderWidth: 1,
                        borderColor: 'rgba(16,185,129,0.3)',
                        ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
                      }}
                      onPress={() => {
                        const newText = editTranscriptText.trim();
                        setSegments(prevSegs =>
                          prevSegs.map(seg =>
                            seg.id === activeSegment.id
                              ? { ...seg, transcript: newText || undefined }
                              : seg
                          )
                        );
                        setIsEditingTranscript(false);
                        setEditTranscriptText('');
                      }}
                    >
                      <Text style={{ color: '#34d399', fontSize: 12, fontWeight: '700' }}>💾 Lưu</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => {
                    if (activeSegment) {
                      setEditTranscriptText(activeSegment.transcript || '');
                      setIsEditingTranscript(true);
                    }
                  }}
                  activeOpacity={0.7}
                  style={{ ...(IS_WEB ? { cursor: 'pointer' } as any : {}) }}
                >
                  <Text style={[s.heroTranscript, isWide && s.heroTranscriptWide]}>
                    {activeSegment?.transcript || (activeSegment ? `Đoạn nghe thứ ${activeSegment.index}` : '🎧 Chọn một câu từ danh sách bên phải')}
                  </Text>
                </TouchableOpacity>
              )}
              {activeSegment?.ipa ? (
                <Text style={[s.heroIpa, isWide && s.heroIpaWide]}>
                  {activeSegment.ipa}
                </Text>
              ) : null}
              {activeSegment?.translation ? (
                <Text style={[s.heroTranslation, isWide && s.heroTranslationWide]}>
                  {activeSegment.translation}
                </Text>
              ) : null}
            </View>
          ) : activeTab === 'dictation' ? (
            <View style={{ width: '100%' }}>
              {renderDictation()}
            </View>
          ) : (
            <View style={{ width: '100%' }}>
              {renderTranslation()}
            </View>
          )}
        </View>
      </View>

      {/* ── SEEK BAR ── */}
      <View style={s.seekSection}>
        <Text style={s.seekTime}>
          {activeSegment ? formatTime(positionMs - activeSegment.startTimeMs) : '0:00'}
        </Text>
        {IS_WEB ? (
          <View style={s.seekBarWrap}>
            <WebInput
              type="range"
              min={activeSegment?.startTimeMs || 0}
              max={activeSegment?.endTimeMs || 100}
              value={positionMs}
              onChange={(e: any) => {
                const targetMs = parseInt(e.target.value, 10);
                audioServiceRef.current?.seekTo(targetMs);
              }}
              style={{
                width: '100%',
                accentColor: '#d946ef',
                cursor: 'pointer',
                height: 28,
                backgroundColor: 'transparent',
                border: 'none',
                outline: 'none',
              }}
            />
          </View>
        ) : (
          <View
            style={s.seekBarWrap}
            onLayout={(e) => { seekSliderWidth.current = e.nativeEvent.layout.width; }}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={handleSeekBarTouch}
            onResponderMove={handleSeekBarTouch}
          >
            <View style={s.seekTrack}>
              <View style={[s.seekFill, { width: `${segmentProgress * 100}%` }]} />
              <View style={[s.seekThumb, { left: `${segmentProgress * 100}%` }]} />
            </View>
          </View>
        )}
        <Text style={s.seekTime}>
          {activeSegment ? formatTime(activeSegment.endTimeMs - activeSegment.startTimeMs) : '0:00'}
        </Text>
      </View>


      {/* ── PLAYBACK CONTROLS ── */}
      <View style={s.ctrlRow}>
        <TouchableOpacity style={s.ctrlBtn} onPress={handlePrev}>
          <MaterialPrevIcon />
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.playBtn, audioLoadFailed && { backgroundColor: '#92400e', borderColor: '#f59e0b' }]}
          onPress={handlePlayPause}
        >
          {audioLoadFailed ? (
            IS_WEB ? (
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <line x1="12" y1="11" x2="12" y2="17" />
                <polyline points="9 14 12 11 15 14" />
              </svg>
            ) : (
              <Text style={{ color: '#fbbf24', fontSize: 20, fontWeight: '800' }}>📂</Text>
            )
          ) : isAudioLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <MaterialPlayPauseIcon isPlaying={isPlaying} />
          )}
        </TouchableOpacity>
        <TouchableOpacity style={s.ctrlBtn} onPress={handleNext}>
          <MaterialNextIcon />
        </TouchableOpacity>
      </View>

      {/* Warning banner when audio not found */}
      {audioLoadFailed && (
        <TouchableOpacity
          style={{
            backgroundColor: 'rgba(146,64,14,0.2)',
            borderWidth: 1,
            borderColor: 'rgba(245,158,11,0.3)',
            borderRadius: 12,
            paddingVertical: 8,
            paddingHorizontal: 14,
            marginTop: 6,
            alignItems: 'center',
            ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
          }}
          onPress={() => setShowFilePickerModal(true)}
          activeOpacity={0.7}
        >
          <Text style={{ color: '#fbbf24', fontSize: 12, fontWeight: '700', textAlign: 'center' }}>
            ⚠  Không tìm thấy tệp nhạc — Nhấn để chọn file
          </Text>
        </TouchableOpacity>
      )}

      {/* ── SPEED SELECTOR ── */}
      <View style={s.speedRow}>
        {SPEED_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt}
            style={[s.speedChip, speed === opt && s.speedChipActive]}
            onPress={() => handleSpeedChange(opt)}
          >
            <Text style={[s.speedChipText, speed === opt && s.speedChipTextActive]}>
              {opt}x
            </Text>
          </TouchableOpacity>
        ))}
      </View>



      {/* ── EDIT TOOLS ── */}
      <TouchableOpacity style={s.toolsToggle} onPress={() => setShowTools(!showTools)}>
        <Text style={s.toolsToggleText}>
          {showTools ? '▲ Ẩn công cụ' : '✂ Tách / Ghép câu'}
        </Text>
      </TouchableOpacity>
      {showTools && (
        <View style={s.toolsRow}>
          {isSplittingWords && activeSegment ? (
            /* ── Word-level split UI ── */
            <View style={{ width: '100%' }}>
              <Text style={{ color: '#fbbf24', fontSize: 11, fontWeight: '700', marginBottom: 8 }}>
                👆 Tap vào từ để đặt điểm tách
              </Text>
              <View style={s.wordChipsRow}>
                {(activeSegment.transcript || '').trim().split(/\s+/).filter((w: string) => w.length > 0).map((word: string, wIdx: number) => (
                  <TouchableOpacity
                    key={wIdx}
                    style={[
                      s.wordChip,
                      wIdx > 0 && splitWordIdx === wIdx && s.wordChipSelected,
                      wIdx === 0 && s.wordChipDisabled,
                    ]}
                    onPress={() => { if (wIdx > 0) setSplitWordIdx(wIdx); }}
                    disabled={wIdx === 0}
                    activeOpacity={0.7}
                  >
                    {wIdx > 0 && splitWordIdx === wIdx && (
                      <View style={s.splitMarker}>
                        <Text style={s.splitMarkerText}>✂</Text>
                      </View>
                    )}
                    <Text style={[
                      s.wordChipText,
                      wIdx > 0 && splitWordIdx === wIdx && s.wordChipTextSelected,
                    ]}>
                      {word}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {splitWordIdx !== null && (() => {
                const words = (activeSegment.transcript || '').trim().split(/\s+/);
                return (
                  <View style={s.splitPreview}>
                    <Text style={s.splitPreviewLabel}>Kết quả tách:</Text>
                    <Text style={s.splitPreviewText}>
                      <Text style={{ color: '#a78bfa' }}>Phần A: </Text>
                      "{words.slice(0, splitWordIdx).join(' ')}"
                    </Text>
                    <Text style={s.splitPreviewText}>
                      <Text style={{ color: '#38bdf8' }}>Phần B: </Text>
                      "{words.slice(splitWordIdx).join(' ')}"
                    </Text>
                  </View>
                );
              })()}

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                <TouchableOpacity
                  style={[s.toolBtn, { borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)' }]}
                  onPress={cancelWordSplit}
                >
                  <Text style={[s.toolBtnText, { color: '#ef4444' }]}>❌ Hủy</Text>
                </TouchableOpacity>
                {splitWordIdx !== null && (
                  <TouchableOpacity
                    style={[s.toolBtn, { borderColor: '#fbbf24', backgroundColor: 'rgba(251,191,36,0.1)' }]}
                    onPress={confirmWordSplit}
                  >
                    <Text style={[s.toolBtnText, { color: '#fbbf24' }]}>✂ Xác nhận tách</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ) : (
            /* ── Normal tool buttons ── */
            <>
              <TouchableOpacity style={s.toolBtn} onPress={handleSplit}>
                {IS_WEB ? (
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                    <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" /><line x1="8.12" y1="8.12" x2="12" y2="12" />
                  </svg>
                ) : (
                  <Text style={s.toolBtnIcon}>✂</Text>
                )}
                <Text style={s.toolBtnText}>Tách theo từ</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.toolBtn} onPress={handleMerge}>
                {IS_WEB ? (
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </svg>
                ) : (
                  <Text style={s.toolBtnIcon}>⊕</Text>
                )}
                <Text style={s.toolBtnText}>Ghép với câu sau</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[s.toolBtn, isTranslating && { opacity: 0.7 }]} 
                onPress={handleAITranslate}
                disabled={isTranslating}
              >
                {isTranslating ? (
                  <ActivityIndicator size="small" color="#c4b5fd" />
                ) : (
                  <>
                    {IS_WEB ? (
                      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                        <path d="m5 8 6 6" /><path d="m4 14 6-6 2-3" /><path d="M2 5h12" /><path d="M7 2h1" /><path d="m22 22-5-10-5 10" /><path d="M14 18h6" />
                      </svg>
                    ) : (
                      <Text style={s.toolBtnIcon}>Aa</Text>
                    )}
                    <Text style={s.toolBtnText}>Dịch & Phiên âm AI</Text>
                  </>
                )}
              </TouchableOpacity>
              {onOpenReview && (
                <TouchableOpacity
                  style={[s.toolBtn, { borderColor: 'rgba(56,189,248,0.3)', backgroundColor: 'rgba(56,189,248,0.08)' }]}
                  onPress={() => onOpenReview(segments, project)}
                >
                  {IS_WEB ? (
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  ) : (
                    <Text style={s.toolBtnIcon}>✎</Text>
                  )}
                  <Text style={[s.toolBtnText, { color: '#38bdf8' }]}>Chỉnh sửa nâng cao</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      )}


    </View>
  );

  // ═══════════════════════════════════════════════
  // RENDER: TIMELINE PANEL (right side on web)
  // ═══════════════════════════════════════════════
  const renderTimeline = () => (
    <View style={[s.timelineCol, isWide && s.timelineColWide]}>
      <View style={s.tlHeader}>
        <Text style={s.tlTitle}>📚 Danh sách câu</Text>
        <Text style={s.tlCount}>{segments.length} câu</Text>
      </View>
      <FlatList
        ref={timelineRef}
        data={segments}
        keyExtractor={item => item.id}
        renderItem={renderTimelineItem}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        onScrollToIndexFailed={() => {}}
      />
    </View>
  );

  // ═══════════════════════════════════════════════
  // MAIN LAYOUT
  // ═══════════════════════════════════════════════
  return (
    <View style={s.root}>
      {isWide ? (
        // ── DESKTOP: 2-column layout ──
        <View style={s.desktopContainer}>
          <ScrollView
            style={s.desktopLeft}
            contentContainerStyle={s.desktopLeftContent}
            showsVerticalScrollIndicator={false}
          >
            {renderPlayer()}
          </ScrollView>
          <View style={s.desktopRight}>
            {renderTimeline()}
          </View>
        </View>
      ) : (
        // ── MOBILE: stacked layout ──
        <View style={s.mobileContainer}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={s.mobileScroll}
            showsVerticalScrollIndicator={false}
            stickyHeaderIndices={[]}
            bounces={false}
          >
            {renderPlayer()}
          </ScrollView>
        </View>
      )}

      {/* ── SETTINGS MODAL (mobile only, web uses inline) ── */}
      <Modal
        visible={showSettings}
        animationType={isWide ? 'fade' : 'slide'}
        transparent
        onRequestClose={() => setShowSettings(false)}
      >
        <View style={[s.modalOverlay, isWide && { justifyContent: 'center', alignItems: 'center' }]}>
          {isWide ? (
            <TouchableOpacity
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as any}
              onPress={() => setShowSettings(false)}
              activeOpacity={1}
            />
          ) : (
            <TouchableOpacity style={s.modalDismiss} onPress={() => setShowSettings(false)} />
          )}
          <View style={[
            s.modalSheet,
            isWide ? {
              width: 520,
              borderRadius: 24,
              borderWidth: 1,
              borderColor: '#1e1e30',
              paddingBottom: 24,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.5,
              shadowRadius: 20,
              elevation: 10,
              maxHeight: '85%',
            } : {}
          ]}>
            {!isWide && <View style={s.modalHandle} />}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <View style={{ width: 32 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialSettingsIcon size={22} color="#fff" />
                <Text style={[s.modalTitle, { marginBottom: 0 }]}>Cài đặt</Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowSettings(false)}
                style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center', ...(IS_WEB ? { cursor: 'pointer' } as any : {}) }}
                activeOpacity={0.7}
              >
                {IS_WEB ? (
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                ) : (
                  <Text style={{ color: '#888', fontSize: 16, fontWeight: '600' }}>✕</Text>
                )}
              </TouchableOpacity>
            </View>

            <Text style={s.modalLabel}>Lặp mỗi câu</Text>
            <View style={[s.sliderRow, { marginVertical: 12 }]}>
              <TouchableOpacity
                style={s.stepperBtn}
                onPress={() => setLoops(Math.max(1, loops - 1))}
              >
                <Text style={s.stepperBtnText}>-</Text>
              </TouchableOpacity>
              
              {IS_WEB ? (
                <View style={s.sliderTrackWrap}>
                  <WebInput
                    type="range"
                    min="1"
                    max="50"
                    value={loops}
                    onChange={(e: any) => setLoops(parseInt(e.target.value, 10))}
                    style={{
                      width: '100%',
                      accentColor: '#a855f7',
                      cursor: 'pointer',
                      height: 28,
                      backgroundColor: 'transparent',
                      border: 'none',
                      outline: 'none',
                    }}
                  />
                </View>
              ) : (
                <View
                  style={s.sliderTrackWrap}
                  onLayout={(e) => { modalSliderWidth.current = e.nativeEvent.layout.width; }}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={handleModalLoopSliderTouch}
                  onResponderMove={handleModalLoopSliderTouch}
                >
                  <View style={s.sliderTrack}>
                    <View style={[s.sliderFill, { width: `${((loops - 1) / 49) * 100}%` }]} />
                    <View style={[s.sliderThumb, { left: `${((loops - 1) / 49) * 100}%` }]} />
                  </View>
                </View>
              )}

              <TouchableOpacity
                style={s.stepperBtn}
                onPress={() => setLoops(Math.min(100, loops + 1))}
              >
                <Text style={s.stepperBtnText}>+</Text>
              </TouchableOpacity>
              
              <Text style={s.sliderValueText}>{loops} lần</Text>
            </View>

            <Text style={s.modalLabel}>Nghỉ giữa lần lặp</Text>
            <View style={[s.sliderRow, { marginVertical: 12 }]}>
              <TouchableOpacity
                style={s.stepperBtn}
                onPress={() => setRestTime(Math.max(0, Math.round((restTime - 0.5) * 2) / 2))}
              >
                <Text style={s.stepperBtnText}>-</Text>
              </TouchableOpacity>
              
              {IS_WEB ? (
                <View style={s.sliderTrackWrap}>
                  <WebInput
                    type="range"
                    min="0"
                    max="10"
                    step="0.5"
                    value={restTime}
                    onChange={(e: any) => setRestTime(parseFloat(e.target.value))}
                    style={{
                      width: '100%',
                      accentColor: '#a855f7',
                      cursor: 'pointer',
                      height: 28,
                      backgroundColor: 'transparent',
                      border: 'none',
                      outline: 'none',
                    }}
                  />
                </View>
              ) : (
                <View
                  style={s.sliderTrackWrap}
                  onLayout={(e) => { modalRestSliderWidth.current = e.nativeEvent.layout.width; }}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={handleModalRestSliderTouch}
                  onResponderMove={handleModalRestSliderTouch}
                >
                  <View style={s.sliderTrack}>
                    <View style={[s.sliderFill, { width: `${(restTime / 10) * 100}%` }]} />
                    <View style={[s.sliderThumb, { left: `${(restTime / 10) * 100}%` }]} />
                  </View>
                </View>
              )}

              <TouchableOpacity
                style={s.stepperBtn}
                onPress={() => setRestTime(Math.min(10, Math.round((restTime + 0.5) * 2) / 2))}
              >
                <Text style={s.stepperBtnText}>+</Text>
              </TouchableOpacity>
              
              <Text style={s.sliderValueText}>{restTime === 0 ? 'Không' : `${restTime}s`}</Text>
            </View>

            <Text style={s.modalLabel}>Tự chuyển câu</Text>
            <View style={s.modalOpts}>
              <TouchableOpacity
                style={[s.modalOpt, { flex: 1 }, autoAdvance && s.modalOptActive]}
                onPress={() => setAutoAdvance(true)}
              >
                <Text style={[s.modalOptText, autoAdvance && s.modalOptTextActive]}>Bật</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalOpt, { flex: 1 }, !autoAdvance && s.modalOptActive]}
                onPress={() => setAutoAdvance(false)}
              >
                <Text style={[s.modalOptText, !autoAdvance && s.modalOptTextActive]}>Tắt</Text>
              </TouchableOpacity>
            </View>

            {/* ── Re-pick audio file ── */}
            <TouchableOpacity
              style={{
                width: '100%',
                paddingVertical: 14,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 8,
                backgroundColor: 'rgba(16,185,129,0.1)',
                borderWidth: 1,
                borderColor: 'rgba(16,185,129,0.25)',
                marginTop: 20,
                marginBottom: 10,
                ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
              }}
              onPress={() => {
                setShowSettings(false);
                setTimeout(() => {
                  if (IS_WEB) {
                    handleWebFilePick();
                  } else {
                    handleNativeFilePick();
                  }
                }, 300);
              }}
              activeOpacity={0.7}
            >
              {IS_WEB ? (
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              ) : (
                <Text style={{ color: '#34d399', fontSize: 16 }}>♪</Text>
              )}
              <Text style={{ color: '#34d399', fontSize: 14, fontWeight: '700' }}>
                Chọn lại file nhạc
              </Text>
            </TouchableOpacity>

            {/* ── 🤖 AI Re-transcribe ── */}
            <TouchableOpacity
              style={{
                width: '100%',
                paddingVertical: 14,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 8,
                backgroundColor: 'rgba(245,158,11,0.1)',
                borderWidth: 1,
                borderColor: 'rgba(245,158,11,0.25)',
                marginBottom: 10,
                ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
              }}
              onPress={handleRetranscribe}
              activeOpacity={0.7}
              disabled={isRetranscribing}
            >
              {IS_WEB ? (
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                  <path d="M12 8V4H8" />
                  <rect width="16" height="12" x="4" y="8" rx="2" />
                  <path d="M2 14h2" /><path d="M20 14h2" />
                  <path d="M15 13v2" /><path d="M9 13v2" />
                </svg>
              ) : (
                <Text style={{ color: '#f59e0b', fontSize: 16 }}>🤖</Text>
              )}
              <Text style={{ color: '#f59e0b', fontSize: 14, fontWeight: '700' }}>
                🤖 AI cắt câu lại (fix lệch tiếng)
              </Text>
            </TouchableOpacity>

            {/* ── Open ReviewScreen for advanced editing ── */}
            {onOpenReview && (
              <TouchableOpacity
                style={{
                  width: '100%',
                  paddingVertical: 14,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  gap: 8,
                  backgroundColor: 'rgba(56,189,248,0.08)',
                  borderWidth: 1,
                  borderColor: 'rgba(56,189,248,0.25)',
                  marginBottom: 10,
                  ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
                }}
                onPress={() => {
                  setShowSettings(false);
                  setTimeout(() => onOpenReview(segments, project), 300);
                }}
                activeOpacity={0.7}
              >
                {IS_WEB ? (
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                ) : (
                  <Text style={{ color: '#38bdf8', fontSize: 16 }}>✎</Text>
                )}
                <Text style={{ color: '#38bdf8', fontSize: 14, fontWeight: '700' }}>
                  Chỉnh sửa nâng cao (tách / ghép / regroup)
                </Text>
              </TouchableOpacity>
            )}

          </View>
        </View>
      </Modal>

      {/* ── TIMELINE MODAL (mobile only, web uses sidebar) ── */}
      <Modal
        visible={showTimelineModal && !isWide}
        animationType="slide"
        transparent
        onRequestClose={() => setShowTimelineModal(false)}
      >
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalDismiss} onPress={() => setShowTimelineModal(false)} />
          <View style={[s.modalSheet, { height: '85%', maxHeight: '85%', paddingBottom: 20 }]}>
            <View style={s.modalHandle} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialListIcon size={22} color="#fff" />
                <Text style={[s.modalTitle, { marginBottom: 0 }]}>Danh sách câu</Text>
              </View>
              <TouchableOpacity 
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onPress={() => setShowTimelineModal(false)}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1 }}>
              <FlatList
                ref={timelineRef}
                data={segments}
                keyExtractor={item => item.id}
                renderItem={({ item }) => {
                  const isActive = item.id === activeSegmentId;
                  const dotColor = isActive ? '#a855f7' : ((item.studyCount || 0) > 0 ? '#10b981' : '#4b5563');

                  return (
                    <TouchableOpacity
                      style={[s.tlItem, isActive && s.tlItemActive]}
                      onPress={async () => {
                        await handleSelectSegment(item);
                        setShowTimelineModal(false);
                      }}
                      activeOpacity={0.6}
                    >
                      {/* Left: index + dot */}
                      <View style={s.tlLeft}>
                        <View style={[s.tlDot, { backgroundColor: dotColor }]} />
                        <Text style={[s.tlIndex, isActive && s.tlIndexActive]}>
                          {String(item.index).padStart(2, '0')}
                        </Text>
                      </View>

                      {/* Center: text */}
                      <View style={s.tlCenter}>
                        <Text style={[s.tlText, isActive && s.tlTextActive, (activeTab === 'dictation' || activeTab === 'translation') && (IS_WEB ? { filter: 'blur(5px)' } as any : { opacity: 0.15 })]} numberOfLines={2}>
                          {item.transcript || `Đoạn nghe ${item.index}`}
                        </Text>
                        {item.ipa ? (
                          <Text style={[s.tlIpa, isActive && s.tlIpaActive, (activeTab === 'dictation' || activeTab === 'translation') && (IS_WEB ? { filter: 'blur(5px)' } as any : { opacity: 0.15 })]} numberOfLines={1}>
                            {item.ipa}
                          </Text>
                        ) : null}
                        {item.translation ? (
                          <Text style={[s.tlTranslation, isActive && s.tlTranslationActive, activeTab === 'dictation' && (IS_WEB ? { filter: 'blur(5px)' } as any : { opacity: 0.15 })]} numberOfLines={1}>
                            {item.translation}
                          </Text>
                        ) : null}
                        <Text style={s.tlDur}>
                          {((item.endTimeMs - item.startTimeMs) / 1000).toFixed(1)}s
                        </Text>
                      </View>

                      {/* Right: study count & accuracy badges */}
                      <View style={s.tlRight}>
                        {item.dictationAccuracy !== undefined && (
                          <View style={[
                            s.accuracyBadge,
                            item.dictationAccuracy === 100 ? s.accuracyBadgePerfect : s.accuracyBadgeNormal
                          ]}>
                            <Text style={[
                              s.accuracyBadgeText,
                              item.dictationAccuracy === 100 ? s.accuracyBadgeTextPerfect : s.accuracyBadgeTextNormal
                            ]}>
                              ✍️ {item.dictationAccuracy}%
                            </Text>
                          </View>
                        )}
                        {item.translationAccuracy !== undefined && (
                          <View style={[
                            s.accuracyBadge,
                            { borderColor: 'rgba(52,211,153,0.3)', backgroundColor: 'rgba(52,211,153,0.08)' },
                            item.translationAccuracy === 100 ? { borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.15)' } : null
                          ]}>
                            <Text style={[
                              s.accuracyBadgeText,
                              { color: '#34d399' },
                              item.translationAccuracy === 100 ? { color: '#10b981', fontWeight: 'bold' } : null
                            ]}>
                              🔄 {item.translationAccuracy}%
                            </Text>
                          </View>
                        )}
                        <View style={s.studyBadge}>
                          <Text style={s.studyBadgeText}>🎧 {item.studyCount || 0}</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                }}
                contentContainerStyle={{ paddingBottom: 40 }}
                showsVerticalScrollIndicator={false}
                onScrollToIndexFailed={() => {}}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* ═══ FILE PICKER MODAL ═══ */}
      <Modal
        visible={showFilePickerModal}
        transparent={true}
        animationType={isWide ? 'fade' : 'fade'}
        onRequestClose={() => setShowFilePickerModal(false)}
      >
        <View style={s.filePickerOverlay}>
          <View style={[s.filePickerCard, isWide && s.filePickerCardWide]}>
            {/* Close button */}
            <TouchableOpacity
              style={s.filePickerClose}
              onPress={() => setShowFilePickerModal(false)}
            >
              <Text style={{ color: '#888', fontSize: 22, fontWeight: '700' }}>✕</Text>
            </TouchableOpacity>

            {/* Icon */}
            <View style={s.filePickerIconWrap}>
              {IS_WEB ? (
                <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  <line x1="12" y1="11" x2="12" y2="17" />
                  <polyline points="9 14 12 11 15 14" />
                </svg>
              ) : (
                <Text style={{ fontSize: 48 }}>📂</Text>
              )}
            </View>

            {/* Title */}
            <Text style={s.filePickerTitle}>Không tìm thấy tệp nhạc</Text>
            <Text style={s.filePickerDesc}>
              Tệp âm thanh của bài học này chưa có trên thiết bị.{'\n'}
              Vui lòng chọn tệp MP3 từ máy của bạn để tiếp tục học.
            </Text>

            {/* Loading indicator */}
            {isReloadingAudio ? (
              <View style={s.filePickerLoading}>
                <ActivityIndicator size="large" color="#a78bfa" />
                <Text style={s.filePickerLoadingText}>Đang nạp âm thanh...</Text>
              </View>
            ) : (
              <>
                {/* Pick button */}
                <TouchableOpacity
                  style={s.filePickerBtn}
                  onPress={() => {
                    if (IS_WEB) {
                      handleWebFilePick();
                    } else {
                      handleNativeFilePick();
                    }
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={s.filePickerBtnText}>🎵  Chọn tệp MP3 từ thiết bị</Text>
                </TouchableOpacity>

                {/* Cancel */}
                <TouchableOpacity
                  style={s.filePickerCancelBtn}
                  onPress={() => setShowFilePickerModal(false)}
                  activeOpacity={0.5}
                >
                  <Text style={s.filePickerCancelText}>Hủy</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── RETRANSCRIBE LOADING OVERLAY ── */}
      {isRetranscribing && (
        <View style={{
          position: 'absolute' as any,
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(8,8,13,0.92)',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999,
        }}>
          <ActivityIndicator size="large" color="#f59e0b" />
          <Text style={{ color: '#f59e0b', fontSize: 18, fontWeight: '800', marginTop: 20, textAlign: 'center' }}>
            🤖 AI đang cắt câu lại...
          </Text>
          <Text style={{ color: '#8a8aaa', fontSize: 14, marginTop: 10, textAlign: 'center', maxWidth: 300 }}>
            {retranscribeProgress || 'Đang chuẩn bị...'}
          </Text>
          <Text style={{ color: '#4a4a6a', fontSize: 12, marginTop: 20, textAlign: 'center', maxWidth: 280 }}>
            Quá trình này mất 30s - 2 phút tùy độ dài audio
          </Text>
        </View>
      )}

    </View>
  );
}

// ═══════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════
const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#08080d',
  },

  // ─── DESKTOP LAYOUT ───
  desktopContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  desktopLeft: {
    flex: 1,
    maxWidth: 640,
  },
  desktopLeftContent: {
    padding: 32,
    paddingTop: 32,
  },
  desktopRight: {
    flex: 1,
    borderLeftWidth: 1,
    borderLeftColor: '#1a1a28',
    backgroundColor: '#0b0b14',
  },

  // ─── MOBILE LAYOUT ───
  mobileContainer: {
    flex: 1,
    flexDirection: 'column',
  },
  mobileScroll: {
    padding: 16,
    paddingTop: IS_WEB ? 20 : 52,
    paddingBottom: 8,
  },
  mobileTimeline: {
    height: 260,
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopColor: '#1a1a28',
    backgroundColor: '#0b0b14',
  },

  // ─── PLAYER COLUMN ───
  playerCol: {},
  playerColWide: {
    paddingTop: 8,
  },

  // ─── HEADER ───
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#13131f',
    borderWidth: 1,
    borderColor: '#1e1e30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: {
    color: '#ccc',
    fontSize: 18,
    fontWeight: '600',
  },
  headerCenter: {
    flex: 1,
    marginHorizontal: 14,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.3,
  },
  headerStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 12,
  },
  headerPercent: {
    fontSize: 12,
    color: '#a855f7',
    fontWeight: '800',
  },
  headerPercentDictation: {
    fontSize: 12,
    color: '#10b981',
    fontWeight: '800',
  },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#13131f',
    borderWidth: 1,
    borderColor: '#1e1e30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsIcon: {
    fontSize: 18,
    color: '#666',
  },

  // ─── STATS ROW ───
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  statPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#0e0e18',
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  statDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statLabel: {
    color: '#666',
    fontSize: 11,
    fontWeight: '600',
  },
  statNum: {
    fontSize: 14,
    fontWeight: '800',
  },

  // ─── HERO CARD ───
  heroCard: {
    backgroundColor: '#0f0f1a',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1c1c30',
    padding: 24,
    minHeight: 160,
    marginBottom: 16,
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 4,
  },
  heroCardWide: {
    minHeight: 180,
    padding: 28,
  },
  heroTop: {
    marginBottom: 16,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroSegLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#ec4899',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  loopBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(124, 58, 237, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.35)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3.5,
  },
  loopBadgeLabel: {
    color: '#c4b5fd',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  loopBadgeDivider: {
    width: 1,
    height: 10,
    backgroundColor: 'rgba(124, 58, 237, 0.35)',
    marginHorizontal: 6,
  },
  loopBadgeValue: {
    color: '#ffffff',
    fontSize: 10.5,
    fontWeight: '800',
  },
  heroBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 60,
  },
  heroTranscript: {
    fontSize: 22,
    lineHeight: 34,
    color: '#fff',
    fontWeight: '700',
    textAlign: 'center',
  },
  heroTranscriptWide: {
    fontSize: 26,
    lineHeight: 40,
  },
  swipeHint: {
    textAlign: 'center',
    color: '#282838',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 8,
  },

  // ─── SEEK BAR ───
  seekSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 10,
  },
  seekTime: {
    color: '#555',
    fontSize: 12,
    fontWeight: '600',
    minWidth: 34,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  seekBarWrap: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  seekTrack: {
    height: 4,
    backgroundColor: '#1a1a28',
    borderRadius: 2,
    position: 'relative',
  },
  seekFill: {
    height: '100%',
    backgroundColor: '#d946ef',
    borderRadius: 2,
  },
  seekThumb: {
    position: 'absolute',
    top: -6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#d946ef',
    marginLeft: -8,
    shadowColor: '#d946ef',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 3,
    borderWidth: 2,
    borderColor: '#fff',
  },

  // ─── WAVEFORM ───
  waveContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 28,
    marginBottom: 16,
    overflow: 'hidden',
  },
  waveBar: {
    width: 2.5,
    marginHorizontal: 0.7,
    borderRadius: 2,
  },
  waveBarOn: {
    backgroundColor: '#d946ef',
  },
  waveBarOff: {
    backgroundColor: '#18182a',
  },

  // ─── CONTROLS ───
  ctrlRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 28,
    marginBottom: 16,
  },
  ctrlBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#13131f',
    borderWidth: 1,
    borderColor: '#1e1e30',
    alignItems: 'center',
    justifyContent: 'center',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  ctrlBtnText: {
    color: '#ccc',
    fontSize: 18,
  },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#a855f7',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  playBtnText: {
    color: '#fff',
    fontSize: 28,
  },

  // ─── SPEED ───
  speedRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 14,
  },
  speedChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#0e0e18',
    borderWidth: 1,
    borderColor: '#1a1a28',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  speedChipActive: {
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
  },
  speedChipText: {
    color: '#555',
    fontSize: 12,
    fontWeight: '700',
  },
  speedChipTextActive: {
    color: '#fff',
  },

  // ─── TOOLS ───
  toolsToggle: {
    alignItems: 'center',
    paddingVertical: 8,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  toolsToggleText: {
    color: '#555',
    fontSize: 12,
    fontWeight: '700',
  },
  toolsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
  },
  toolBtn: {
    flex: 1,
    minWidth: 140,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#150e28',
    borderWidth: 1,
    borderColor: '#7c3aed',
    borderRadius: 12,
    paddingVertical: 12,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  toolBtnIcon: {
    fontSize: 14,
  },
  toolBtnText: {
    color: '#c4b5fd',
    fontSize: 12,
    fontWeight: '700',
  },

  // ─── WORD SPLIT ───
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

  // ─── INLINE SETTINGS (web wide) ───
  inlineSettings: {
    marginTop: 20,
    backgroundColor: '#0e0e18',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1a1a28',
    padding: 16,
    gap: 12,
  },
  inlineSettingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  inlineLabel: {
    color: '#666',
    fontSize: 12,
    fontWeight: '700',
    minWidth: 64,
  },
  inlineOpts: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
  },
  inlineOpt: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
    backgroundColor: '#131320',
    borderWidth: 1,
    borderColor: '#1e1e30',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  inlineOptActive: {
    backgroundColor: '#2d1054',
    borderColor: '#7c3aed',
  },
  inlineOptText: {
    color: '#555',
    fontSize: 11,
    fontWeight: '700',
  },
  inlineOptTextActive: {
    color: '#c4b5fd',
  },

  // ─── TIMELINE COLUMN ───
  timelineCol: {
    flex: 1,
  },
  timelineColWide: {
    paddingTop: 0,
  },
  tlHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a28',
  },
  tlTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#999',
  },
  tlCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#555',
    backgroundColor: '#13131f',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },

  // ─── TIMELINE ITEMS ───
  tlItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#0e0e18',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  tlItemActive: {
    backgroundColor: '#140e24',
    borderBottomColor: '#1e1030',
    borderLeftWidth: 3,
    borderLeftColor: '#a855f7',
  },
  tlLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 42,
  },
  tlDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tlIndex: {
    fontSize: 13,
    fontWeight: '800',
    color: '#444',
  },
  tlIndexActive: {
    color: '#d946ef',
  },
  tlCenter: {
    flex: 1,
    marginHorizontal: 12,
  },
  tlText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  tlTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  tlDur: {
    color: '#3a3a4a',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  tlBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 10,
    minWidth: 54,
    alignItems: 'center',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  tlBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  tlRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  studyBadge: {
    backgroundColor: '#2e1065',
    borderColor: '#7c3aed',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
    minWidth: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  studyBadgeText: {
    color: '#c084fc',
    fontSize: 10,
    fontWeight: '800',
  },
  accuracyBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
    minWidth: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accuracyBadgeNormal: {
    backgroundColor: '#1e1b4b',
    borderColor: '#4338ca',
  },
  accuracyBadgePerfect: {
    backgroundColor: '#064e3b',
    borderColor: '#059669',
  },
  accuracyBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  accuracyBadgeTextNormal: {
    color: '#818cf8',
  },
  accuracyBadgeTextPerfect: {
    color: '#34d399',
  },
  dictationScoreBox: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  dictationScoreBoxNormal: {
    backgroundColor: '#1b1b3a',
    borderColor: '#4c1d95',
  },
  dictationScoreBoxPerfect: {
    backgroundColor: '#064e3b',
    borderColor: '#059669',
  },
  dictationScoreText: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  dictationScoreTextNormal: {
    color: '#c084fc',
  },
  dictationScoreTextPerfect: {
    color: '#34d399',
  },

  // ─── MODAL ───
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalDismiss: {
    flex: 1,
  },
  modalSheet: {
    backgroundColor: '#13131f',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: '#1e1e30',
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#333',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 24,
    textAlign: 'center',
  },
  modalLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
    marginBottom: 8,
    marginTop: 8,
  },
  modalOpts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  modalOpt: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#0e0e18',
    borderWidth: 1,
    borderColor: '#1e1e30',
    minWidth: 55,
    alignItems: 'center',
  },
  modalOptActive: {
    backgroundColor: '#2d1054',
    borderColor: '#7c3aed',
  },
  modalOptText: {
    color: '#555',
    fontSize: 14,
    fontWeight: '700',
  },
  modalOptTextActive: {
    color: '#c4b5fd',
  },
  modalDoneBtn: {
    backgroundColor: '#a855f7',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  modalDoneBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  // ─── DICTATION MODE STYLES ───
  heroTabs: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: '#07070d',
    borderRadius: 8,
    padding: 3,
    marginBottom: 16,
  },
  heroTab: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 6,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  heroTabActive: {
    backgroundColor: '#7c3aed',
  },
  heroTabTxt: {
    color: '#666',
    fontSize: 12,
    fontWeight: '700',
  },
  heroTabTxtActive: {
    color: '#fff',
  },
  dictationInput: {
    width: '100%',
    backgroundColor: '#06060c',
    borderWidth: 1,
    borderColor: '#1e1e30',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
  dictationWordsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    minHeight: 60,
    alignItems: 'center',
  },
  dictationWord: {
    fontSize: 20,
    fontWeight: '700',
  },
  dictationWordCorrect: {
    color: '#10b981',
  },
  dictationWordIncorrect: {
    color: '#ef4444',
    textDecorationLine: 'underline',
  },
  dictationWordMissing: {
    color: '#4b5563',
  },
  dictationWordHint: {
    color: '#f59e0b',
  },
  dictationActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
  },
  dictationActionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#18182c',
    borderWidth: 1,
    borderColor: '#2d2d44',
    alignItems: 'center',
    justifyContent: 'center',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  dictationActionBtnText: {
    color: '#999',
    fontSize: 11,
    fontWeight: '700',
  },
  dictationCompleteMsg: {
    color: '#10b981',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 8,
    textTransform: 'uppercase',
  },

  // ─── CUSTOM SLIDER STYLES ───
  sliderRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepperBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1b1b2f',
    borderWidth: 1,
    borderColor: '#3a3a55',
    alignItems: 'center',
    justifyContent: 'center',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  stepperBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  sliderTrackWrap: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
    minWidth: 120,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  sliderTrack: {
    height: 6,
    backgroundColor: '#1a1a28',
    borderRadius: 3,
    position: 'relative',
  },
  sliderFill: {
    height: '100%',
    backgroundColor: '#a855f7',
    borderRadius: 3,
  },
  sliderThumb: {
    position: 'absolute',
    top: -5,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#a855f7',
    marginLeft: -8,
    borderWidth: 2,
    borderColor: '#fff',
  },
  sliderValueText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    minWidth: 46,
    textAlign: 'right',
  },
  heroIpa: {
    color: '#c4b5fd',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 4,
  },
  heroIpaWide: {
    fontSize: 16,
    marginTop: 6,
  },
  heroTranslation: {
    color: '#9ca3af',
    fontSize: 14,
    fontStyle: 'italic',
    fontWeight: '400',
    textAlign: 'center',
    marginTop: 4,
  },
  heroTranslationWide: {
    fontSize: 16,
    marginTop: 6,
  },
  tlTranslation: {
    color: '#555566',
    fontSize: 12,
    marginTop: 2,
    fontStyle: 'italic',
  },
  tlTranslationActive: {
    color: '#a855f7',
  },
  tlIpa: {
    color: '#8b5cf6',
    fontSize: 12,
    marginTop: 2,
  },
  tlIpaActive: {
    color: '#c4b5fd',
  },
  mobileInlineSettings: {
    marginTop: 6,
    marginBottom: 10,
    backgroundColor: '#0c0c14',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#18182b',
    padding: 12,
    gap: 10,
  },
  mobileInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  mobileInlineLabel: {
    color: '#8b8ba0',
    fontSize: 12,
    fontWeight: '700',
  },
  mobileInlineStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#12121f',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1d1d35',
    padding: 2,
  },
  mobileInlineStepBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#19192c',
    borderRadius: 8,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  mobileInlineStepText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  mobileInlineValue: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    minWidth: 54,
    textAlign: 'center',
  },
  mobileInlineOpts: {
    flexDirection: 'row',
    backgroundColor: '#12121f',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1d1d35',
    padding: 2,
    width: 114,
  },
  mobileInlineOpt: {
    flex: 1,
    paddingVertical: 4.5,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  mobileInlineOptActive: {
    backgroundColor: '#2e1065',
  },
  mobileInlineOptText: {
    color: '#555',
    fontSize: 11,
    fontWeight: '700',
  },
  mobileInlineOptTextActive: {
    color: '#c4b5fd',
  },

  // ─── FILE PICKER MODAL ───
  filePickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  filePickerCard: {
    backgroundColor: '#14142a',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#2a2a50',
    padding: 32,
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    ...(IS_WEB ? {
      boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 80px rgba(139,92,246,0.08)',
      backdropFilter: 'blur(20px)',
    } as any : {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: 0.5,
      shadowRadius: 32,
      elevation: 24,
    }),
  },
  filePickerCardWide: {
    maxWidth: 460,
    padding: 40,
  },
  filePickerClose: {
    position: 'absolute',
    top: 14,
    right: 18,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  filePickerIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(139,92,246,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  filePickerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  filePickerDesc: {
    color: '#8b8ba0',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 28,
    paddingHorizontal: 8,
  },
  filePickerBtn: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    ...(IS_WEB ? {
      background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
      cursor: 'pointer',
    } as any : {
      backgroundColor: '#7c3aed',
    }),
  },
  filePickerBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  filePickerCancelBtn: {
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 20,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  filePickerCancelText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '600',
  },
  filePickerLoading: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 20,
  },
  filePickerLoadingText: {
    color: '#a78bfa',
    fontSize: 14,
    fontWeight: '600',
  },
});
