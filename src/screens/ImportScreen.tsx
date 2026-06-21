import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Switch,
  Platform
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Project, Segment, Folder } from '../types';
import { AutocutService } from '../services/autocutService';
import { AudioService } from '../services/audioService';
import { StorageService } from '../services/storageService';
import { WhisperService } from '../services/whisperService';
import { AITranslationService } from '../services/aiTranslationService';
import { DBService } from '../services/dbService';
import { FirebaseSyncService } from '../services/firebaseSyncService';
import { showAlert } from '../utils/alert';

export interface ReviewPendingData {
  title: string;
  audioUri: string;
  audioBlobForWeb?: Blob;
  durationMs: number;
  segments: Segment[];
  transcriptText?: string;
  folderId?: string;
  useAI: boolean;
  apiKey: string;
}

interface ImportScreenProps {
  preselectedFolderId?: string;
  onProjectCreated: (project: Project) => void;
  onReview: (data: ReviewPendingData) => void;
  onBack: () => void;
}

export default function ImportScreen({ preselectedFolderId, onProjectCreated, onReview, onBack }: ImportScreenProps) {
  const [title, setTitle] = useState('');
  const [audioFile, setAudioFile] = useState<{ uri: string; name: string; size?: number } | null>(null);
  const [audioDurationMs, setAudioDurationMs] = useState<number>(0);
  const [transcript, setTranscript] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');

  // AI state
  const [useAI, setUseAI] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyValid, setApiKeyValid] = useState<boolean | null>(null);
  const [showApiSettings, setShowApiSettings] = useState(false);

  // Folder selector states
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>(preselectedFolderId);
  const [showFolderDropdown, setShowFolderDropdown] = useState(false);

  useEffect(() => {
    const loadFoldersData = async () => {
      try {
        const list = await StorageService.loadFolders();
        setFolders(list);
      } catch (err) {
        console.warn('Lỗi tải folders:', err);
      }
    };
    loadFoldersData();
  }, []);

  // Load saved API key, auto-configure if first time
  useEffect(() => {
    const initApiKey = async () => {
      let key = await WhisperService.getApiKey();
      // Force-migrate: replace old expired key with new valid key
      const OLD_EXPIRED_KEY = process.env.EXPO_PUBLIC_GROQ_OLD_KEY || '';
      const NEW_DEFAULT_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY || '';
      if ((!key || key === OLD_EXPIRED_KEY) && NEW_DEFAULT_KEY) {
        key = NEW_DEFAULT_KEY;
        await WhisperService.setApiKey(key);
      }
      setApiKey(key);
      setApiKeyInput(key);
      setApiKeyValid(true);
      setUseAI(true);
    };
    initApiKey();
  }, []);

  const handleSaveApiKey = async () => {
    const key = apiKeyInput.trim();
    if (!key) {
      showAlert('Lỗi', 'Vui lòng nhập API key');
      return;
    }
    setLoadingText('Đang kiểm tra API key...');
    setIsLoading(true);
    const valid = await WhisperService.validateApiKey(key);
    setIsLoading(false);
    setLoadingText('');
    if (valid) {
      await WhisperService.setApiKey(key);
      setApiKey(key);
      setApiKeyValid(true);
      setUseAI(true);
      showAlert('✅ Thành công', 'API key hợp lệ! AI cắt câu đã sẵn sàng.');
    } else {
      setApiKeyValid(false);
      showAlert('❌ Không hợp lệ', 'API key sai. Vui lòng kiểm tra lại.');
    }
  };

  // Chọn tệp MP3 native từ điện thoại
  const handleSelectAudio = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setAudioFile({
          uri: asset.uri,
          name: asset.name,
          size: asset.size
        });
        if (!title) {
          setTitle(asset.name.replace(/\.[^/.]+$/, ""));
        }

        // Đọc thời lượng thật từ metadata
        setLoadingText('Đang đọc metadata...');
        setIsLoading(true);
        try {
          const duration = await AudioService.getAudioDuration(asset.uri);
          setAudioDurationMs(duration);
        } catch {
          // Fallback nếu không đọc được
          setAudioDurationMs(0);
        }
        setIsLoading(false);
        setLoadingText('');
      }
    } catch (error) {
      showAlert('Lỗi', 'Không thể chọn tệp âm thanh.');
    }
  };

  const formatDuration = (ms: number) => {
    if (ms <= 0) return '--:--';
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  // Tạo và xử lý cắt câu tự động (sử dụng AudioAnalyzer thật)
  const handleProcess = async () => {
    if (!audioFile) {
      showAlert('Thiếu thông tin', 'Vui lòng chọn tệp MP3 trước.');
      return;
    }

    setIsLoading(true);
    setLoadingText('Đang chuẩn bị...');

    try {
      // Dùng AI (Whisper) hoặc RMS tùy setting
      const { segments, durationMs, method } = await AutocutService.analyzeAndSplit(
        audioFile.uri,
        transcript.trim() || undefined,
        (msg) => setLoadingText(msg),
        useAI && apiKeyValid === true,
        apiKey
      );

      console.log(`[ImportScreen] Method: ${method}, Segments: ${segments.length}`);

      let finalSegments = segments;
      if (useAI && apiKeyValid === true && apiKey) {
        setLoadingText('Đang dịch & phiên âm câu bằng AI...');
        try {
          const sentencesToTranslate = segments.map(seg => ({
            index: seg.index,
            text: seg.transcript || ''
          })).filter(s => s.text.length > 0);

          if (sentencesToTranslate.length > 0) {
            const translations = await AITranslationService.translateAndPhoneticsBatch(
              sentencesToTranslate,
              apiKey
            );
            
            finalSegments = segments.map(seg => {
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
          }
        } catch (e) {
          console.warn('[Import] AI translation failed:', e);
        }
      }

      const finalDuration = durationMs > 0 ? durationMs : (audioDurationMs > 0 ? audioDurationMs : 180000);

      // Instead of saving directly, pass data to ReviewScreen for user to preview & correct
      setIsLoading(false);
      setLoadingText('');

      onReview({
        title: title.trim() || 'Untitled Project',
        audioUri: audioFile.uri,
        durationMs: finalDuration,
        segments: finalSegments,
        transcriptText: transcript.trim() || undefined,
        folderId: selectedFolderId || undefined,
        useAI: useAI && apiKeyValid === true,
        apiKey: apiKey,
      });
    } catch (err) {
      setIsLoading(false);
      setLoadingText('');
      showAlert('Thất bại', 'Quá trình xử lý gặp lỗi. Vui lòng thử lại.');
    }
  };

  const IS_WEB = Platform.OS === 'web';

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
          <Text style={styles.headerTitle}>Tạo bài học mới</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── HERO ── */}
        <View style={styles.heroSection}>
          <Text style={styles.heroEmoji}>🎧</Text>
          <Text style={styles.heroTitle}>Import file & bắt đầu luyện</Text>
          <Text style={styles.heroSub}>Chọn file MP3, đặt tên bài học, và hệ thống sẽ tự động cắt câu cho bạn</Text>
        </View>

        {/* ── FORM CARD ── */}
        <View style={styles.formCard}>
          
          {/* STEP 1: Title */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>1</Text></View>
              <Text style={styles.sectionTitle}>Tiêu đề bài học</Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="VD: Unit 29 – On the road"
              placeholderTextColor="#3a3a5a"
              value={title}
              onChangeText={setTitle}
            />
          </View>

          <View style={styles.divider} />

          {/* STEP 2: Folder */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>2</Text></View>
              <Text style={styles.sectionTitle}>Lưu vào thư mục</Text>
            </View>
            <View style={styles.dropdownContainer}>
              <TouchableOpacity
                style={styles.dropdownBtn}
                onPress={() => setShowFolderDropdown(!showFolderDropdown)}
                activeOpacity={0.8}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 16 }}>📁</Text>
                  <Text style={styles.dropdownBtnText}>
                    {selectedFolderId ? (folders.find(f => f.id === selectedFolderId)?.name || 'Thư mục đã chọn') : 'Chưa phân loại'}
                  </Text>
                </View>
                <Text style={styles.dropdownChevron}>{showFolderDropdown ? '▲' : '▼'}</Text>
              </TouchableOpacity>
              {showFolderDropdown && (
                <View style={styles.dropdownList}>
                  <TouchableOpacity
                    style={[styles.dropdownItem, !selectedFolderId && styles.dropdownItemActive]}
                    onPress={() => { setSelectedFolderId(undefined); setShowFolderDropdown(false); }}
                  >
                    <Text style={[styles.dropdownItemText, !selectedFolderId && styles.dropdownItemTextActive]}>
                      📁 Chưa phân loại
                    </Text>
                  </TouchableOpacity>
                  {folders.map(folder => (
                    <TouchableOpacity
                      key={folder.id}
                      style={[styles.dropdownItem, selectedFolderId === folder.id && styles.dropdownItemActive]}
                      onPress={() => { setSelectedFolderId(folder.id); setShowFolderDropdown(false); }}
                    >
                      <Text style={[styles.dropdownItemText, selectedFolderId === folder.id && styles.dropdownItemTextActive]}>
                        📁 {folder.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </View>

          <View style={styles.divider} />

          {/* STEP 3: Audio File */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.stepBadge, audioFile && styles.stepBadgeDone]}><Text style={styles.stepBadgeText}>{audioFile ? '✓' : '3'}</Text></View>
              <Text style={styles.sectionTitle}>Tệp âm thanh</Text>
              {audioFile && <Text style={styles.sectionBadge}>Đã chọn</Text>}
            </View>
            <TouchableOpacity
              style={[styles.uploadArea, audioFile && styles.uploadAreaSelected]}
              onPress={handleSelectAudio}
              activeOpacity={0.7}
            >
              {audioFile ? (
                <View style={styles.fileInfo}>
                  <View style={styles.fileIconWrap}>
                    {IS_WEB ? (
                      <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                    ) : (
                      <Text style={{ fontSize: 24 }}>🎵</Text>
                    )}
                  </View>
                  <View style={styles.fileDetails}>
                    <Text style={styles.fileName} numberOfLines={1}>{audioFile.name}</Text>
                    <View style={styles.fileMeta}>
                      {audioFile.size && (
                        <Text style={styles.fileMetaText}>{(audioFile.size / (1024 * 1024)).toFixed(1)} MB</Text>
                      )}
                      {audioDurationMs > 0 && (
                        <Text style={styles.fileMetaText}>⏱ {formatDuration(audioDurationMs)}</Text>
                      )}
                    </View>
                  </View>
                  <View style={styles.changeFileBtn}>
                    <Text style={styles.changeFileBtnText}>Đổi file</Text>
                  </View>
                </View>
              ) : (
                <View style={styles.uploadPlaceholder}>
                  <View style={styles.uploadIconCircle}>
                    {IS_WEB ? (
                      <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    ) : (
                      <Text style={{ fontSize: 28 }}>📂</Text>
                    )}
                  </View>
                  <Text style={styles.uploadTitle}>Chọn tệp từ thiết bị</Text>
                  <Text style={styles.uploadHint}>Hỗ trợ MP3, M4A, WAV</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.divider} />

          {/* STEP 4: Transcript */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>4</Text></View>
              <Text style={styles.sectionTitle}>Transcript</Text>
              <Text style={styles.sectionOptional}>Tùy chọn</Text>
            </View>
            <Text style={styles.sectionHint}>Dán văn bản transcript để hệ thống tự phân bổ khớp vào từng đoạn</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Dán toàn bộ nội dung bài nghe tại đây..."
              placeholderTextColor="#3a3a5a"
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              value={transcript}
              onChangeText={setTranscript}
            />
            {transcript.length > 0 && (
              <Text style={styles.charCount}>
                {transcript.split(/(?<=[.?!])\s+|\n+/).filter(s => s.trim()).length} câu phát hiện
              </Text>
            )}
          </View>

          <View style={styles.divider} />

          {/* AI Settings */}
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.aiHeader}
              onPress={() => setShowApiSettings(!showApiSettings)}
              activeOpacity={0.7}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={[styles.stepBadge, { backgroundColor: useAI && apiKeyValid ? 'rgba(16,185,129,0.2)' : 'rgba(124,58,237,0.15)' }]}>
                  <Text style={[styles.stepBadgeText, { color: useAI && apiKeyValid ? '#34d399' : '#a78bfa' }]}>AI</Text>
                </View>
                <Text style={styles.sectionTitle}>Whisper AI cắt câu</Text>
              </View>
              <View style={styles.aiToggle}>
                {apiKeyValid && (
                  <Switch
                    value={useAI}
                    onValueChange={setUseAI}
                    trackColor={{ false: '#333', true: '#7c3aed' }}
                    thumbColor={useAI ? '#a855f7' : '#666'}
                  />
                )}
                <Text style={styles.aiExpandIcon}>{showApiSettings ? '▲' : '▼'}</Text>
              </View>
            </TouchableOpacity>

            {useAI && apiKeyValid && (
              <View style={styles.aiBadge}>
                <Text style={styles.aiBadgeText}>✅ AI sẽ cắt câu chính xác bằng Whisper</Text>
              </View>
            )}

            {showApiSettings && (
              <View style={styles.apiSettings}>
                <Text style={styles.apiHint}>
                  Dùng Groq API (miễn phí) để cắt câu bằng AI Whisper.{"\n"}
                  Lấy key tại: console.groq.com/keys
                </Text>
                <View style={styles.apiKeyRow}>
                  <TextInput
                    style={styles.apiKeyInput}
                    placeholder="gsk_..."
                    placeholderTextColor="#3a3a5a"
                    value={apiKeyInput}
                    onChangeText={setApiKeyInput}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                  <TouchableOpacity style={styles.apiKeyBtn} onPress={handleSaveApiKey} activeOpacity={0.7}>
                    <Text style={styles.apiKeyBtnText}>Lưu</Text>
                  </TouchableOpacity>
                </View>
                {apiKeyValid === true && <Text style={styles.apiKeyStatus}>✅ Key hợp lệ</Text>}
                {apiKeyValid === false && <Text style={[styles.apiKeyStatus, { color: '#ef4444' }]}>❌ Key không hợp lệ</Text>}
              </View>
            )}
          </View>
        </View>

        {/* ── SUBMIT ── */}
        {isLoading ? (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color="#a855f7" />
            <Text style={styles.loaderText}>{loadingText || 'Đang xử lý...'}</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.submitBtn, !audioFile && styles.submitBtnDisabled]}
            onPress={handleProcess}
            disabled={!audioFile}
            activeOpacity={0.8}
          >
            <Text style={styles.submitBtnText}>
              {useAI && apiKeyValid ? '🤖 AI cắt câu & Bắt đầu học' : '✨ Tự động cắt & Bắt đầu học'}
            </Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 60 }} />
      </ScrollView>
    </View>
  );
}

const IS_WEB = Platform.OS === 'web';

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: '#08080d',
  },
  // ── HEADER ──
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
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.2,
  },
  // ── SCROLL CONTENT ──
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    ...(IS_WEB ? {
      maxWidth: 640,
      alignSelf: 'center',
      width: '100%',
    } as any : {}),
  },
  // ── HERO ──
  heroSection: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  heroEmoji: {
    fontSize: 40,
    marginBottom: 12,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.3,
    marginBottom: 6,
    textAlign: 'center',
  },
  heroSub: {
    fontSize: 13,
    color: '#555',
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 340,
  },
  // ── FORM CARD ──
  formCard: {
    backgroundColor: '#0c0c18',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#16162a',
    overflow: 'hidden',
  },
  section: {
    padding: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(124,58,237,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeDone: {
    backgroundColor: 'rgba(16,185,129,0.2)',
  },
  stepBadgeText: {
    color: '#a78bfa',
    fontSize: 12,
    fontWeight: '800',
  },
  sectionTitle: {
    color: '#e0e0e0',
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  sectionBadge: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: 'rgba(16,185,129,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  sectionOptional: {
    color: '#4a4a6a',
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: 'rgba(74,74,106,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  sectionHint: {
    color: '#4a4a6a',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 12,
    marginTop: -4,
  },
  divider: {
    height: 1,
    backgroundColor: '#16162a',
    marginHorizontal: 20,
  },
  // ── INPUT ──
  input: {
    backgroundColor: '#08080f',
    borderWidth: 1,
    borderColor: '#1e1e30',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 14,
    ...(IS_WEB ? {
      outline: 'none',
    } as any : {}),
  },
  textArea: {
    height: 110,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  charCount: {
    color: '#4a4a6a',
    fontSize: 11,
    textAlign: 'right',
    marginTop: 6,
    fontWeight: '600',
  },
  // ── UPLOAD AREA ──
  uploadArea: {
    backgroundColor: '#08080f',
    borderWidth: 1.5,
    borderColor: '#1e1e30',
    borderStyle: 'dashed',
    borderRadius: 14,
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
    ...(IS_WEB ? { cursor: 'pointer', transition: 'all 0.2s ease' } as any : {}),
  },
  uploadAreaSelected: {
    borderStyle: 'solid',
    borderColor: 'rgba(124,58,237,0.4)',
    backgroundColor: 'rgba(124,58,237,0.05)',
    padding: 16,
  },
  uploadPlaceholder: {
    alignItems: 'center',
    gap: 8,
  },
  uploadIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(124,58,237,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  uploadTitle: {
    color: '#a78bfa',
    fontSize: 15,
    fontWeight: '700',
  },
  uploadHint: {
    color: '#4a4a6a',
    fontSize: 12,
    fontWeight: '500',
  },
  // ── FILE INFO ──
  fileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 12,
  },
  fileIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(124,58,237,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileDetails: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 3,
  },
  fileMeta: {
    flexDirection: 'row',
    gap: 12,
  },
  fileMetaText: {
    color: '#5a5a8a',
    fontSize: 12,
    fontWeight: '600',
  },
  changeFileBtn: {
    backgroundColor: 'rgba(124,58,237,0.12)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.25)',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  changeFileBtnText: {
    color: '#a78bfa',
    fontSize: 12,
    fontWeight: '700',
  },
  // ── DROPDOWN ──
  dropdownContainer: {
    position: 'relative',
    zIndex: 10,
  },
  dropdownBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#08080f',
    borderWidth: 1,
    borderColor: '#1e1e30',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  dropdownBtnText: {
    color: '#e0e0e0',
    fontSize: 14,
    fontWeight: '600',
  },
  dropdownChevron: {
    color: '#a855f7',
    fontSize: 11,
  },
  dropdownList: {
    backgroundColor: '#0c0c18',
    borderWidth: 1,
    borderColor: '#1e1e30',
    borderRadius: 12,
    marginTop: 6,
    overflow: 'hidden',
    ...(IS_WEB ? {
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    } as any : {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.3,
      shadowRadius: 16,
      elevation: 8,
    }),
  },
  dropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#16162a',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  dropdownItemActive: {
    backgroundColor: 'rgba(124,58,237,0.08)',
  },
  dropdownItemText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '500',
  },
  dropdownItemTextActive: {
    color: '#a855f7',
    fontWeight: '700',
  },
  // ── AI SECTION ──
  aiHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  aiToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiExpandIcon: {
    color: '#4a4a6a',
    fontSize: 11,
  },
  aiBadge: {
    backgroundColor: 'rgba(16,185,129,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.2)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginTop: 12,
  },
  aiBadgeText: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '600',
  },
  apiSettings: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#16162a',
  },
  apiHint: {
    color: '#4a4a6a',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  apiKeyRow: {
    flexDirection: 'row',
    gap: 8,
  },
  apiKeyInput: {
    flex: 1,
    backgroundColor: '#08080f',
    borderWidth: 1,
    borderColor: '#1e1e30',
    borderRadius: 10,
    padding: 11,
    color: '#fff',
    fontSize: 13,
    ...(IS_WEB ? { outline: 'none' } as any : {}),
  },
  apiKeyBtn: {
    backgroundColor: '#7c3aed',
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  apiKeyBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  apiKeyStatus: {
    color: '#34d399',
    fontSize: 12,
    marginTop: 8,
    fontWeight: '600',
  },
  // ── SUBMIT ──
  submitBtn: {
    borderRadius: 16,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: 20,
    ...(IS_WEB ? {
      background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
      cursor: 'pointer',
      boxShadow: '0 6px 20px rgba(168,85,247,0.3)',
    } as any : {
      backgroundColor: '#a855f7',
      shadowColor: '#a855f7',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35,
      shadowRadius: 12,
      elevation: 5,
    }),
  },
  submitBtnDisabled: {
    ...(IS_WEB ? {
      background: '#222',
      boxShadow: 'none',
      cursor: 'not-allowed',
    } as any : {
      backgroundColor: '#222',
      shadowOpacity: 0,
      elevation: 0,
    }),
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  loaderContainer: {
    alignItems: 'center',
    marginTop: 28,
    paddingVertical: 12,
  },
  loaderText: {
    color: '#666',
    fontSize: 13,
    marginTop: 12,
    fontWeight: '600',
  },
});
