import React, { useState, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  Alert,
  RefreshControl,
  Dimensions,
  Platform,
  TextInput,
  Modal,
  ScrollView,
} from 'react-native';
import { Project, Folder } from '../types';
import { StorageService } from '../services/storageService';
import { auth } from '../services/firebaseConfig';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { FirebaseSyncService } from '../services/firebaseSyncService';

interface HomeScreenProps {
  projects: Project[];
  onRefresh: () => void;
  onOpenProject: (project: Project) => void;
  onNewProject: (folderId?: string) => void;
  activeFolderId: string | null;
  setActiveFolderId: (id: string | null) => void;
  currentUser: any;
  onSignOut?: () => void;
}

const IS_WEB = Platform.OS === 'web';

const EditIcon = ({ color = '#a78bfa', size = 12 }: { color?: string; size?: number }) => {
  if (Platform.OS === 'web') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    );
  }
  return <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>✎</Text>;
};

// Google Material Icons - account_circle
const AccountIcon = ({ isLoggedIn = false, size = 28 }: { isLoggedIn?: boolean; size?: number }) => {
  const color = isLoggedIn ? '#10b981' : '#7c3aed';
  if (Platform.OS === 'web') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' } as any}>
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
      </svg>
    );
  }
  return <Text style={{ color, fontSize: size }}>👤</Text>;
};

export default function HomeScreen({
  projects,
  onRefresh,
  onOpenProject,
  onNewProject,
  activeFolderId,
  setActiveFolderId,
  currentUser,
  onSignOut,
}: HomeScreenProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [dimensions, setDimensions] = useState(Dimensions.get('window'));
  const [syncToast, setSyncToast] = useState<string | null>(null);
  const [progressMode, setProgressMode] = useState<'listening' | 'dictation' | 'translation'>('listening');

  // Folder states
  const [folders, setFolders] = useState<Folder[]>([]);
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [isSubmittingFolder, setIsSubmittingFolder] = useState(false);

  // Auth Modal states
  const [isAuthModalVisible, setIsAuthModalVisible] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  const handleOpenCreateFolderModal = () => {
    setEditingFolderId(null);
    setNewFolderName('');
    setIsCreateModalVisible(true);
  };

  const handleCloseCreateFolderModal = () => {
    setIsCreateModalVisible(false);
    setEditingFolderId(null);
    setNewFolderName('');
  };

  const handleOpenAuthModal = () => {
    setAuthEmail('');
    setAuthPassword('');
    setAuthError('');
    setIsAuthModalVisible(true);
  };

  const handleCloseAuthModal = () => {
    setIsAuthModalVisible(false);
  };

  const handleSignIn = async () => {
    const email = authEmail.trim();
    const password = authPassword.trim();
    if (!email || !password) {
      setAuthError('Vui lòng điền đầy đủ email và mật khẩu.');
      return;
    }
    try {
      setAuthError('');
      await signInWithEmailAndPassword(auth, email, password);
      setIsAuthModalVisible(false);
    } catch (err: any) {
      console.error(err);
      setAuthError(err.message || 'Lỗi đăng nhập, vui lòng kiểm tra lại.');
    }
  };

  const handleSignUp = async () => {
    const email = authEmail.trim();
    const password = authPassword.trim();
    if (!email || !password) {
      setAuthError('Vui lòng điền đầy đủ email và mật khẩu.');
      return;
    }
    if (password.length < 6) {
      setAuthError('Mật khẩu phải có ít nhất 6 ký tự.');
      return;
    }
    try {
      setAuthError('');
      await createUserWithEmailAndPassword(auth, email, password);
      setIsAuthModalVisible(false);
    } catch (err: any) {
      console.error(err);
      setAuthError(err.message || 'Lỗi đăng ký tài khoản.');
    }
  };

  const handleSignOut = async () => {
    try {
      if (onSignOut) {
        await onSignOut();
      } else {
        await signOut(auth);
      }
      setIsAuthModalVisible(false);
    } catch (err) {
      console.error('Lỗi đăng xuất:', err);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setAuthError('');
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      setIsAuthModalVisible(false);
    } catch (err: any) {
      console.error(err);
      let friendlyMsg = 'Lỗi đăng nhập Google.';
      if (err.code === 'auth/configuration-not-found') {
        friendlyMsg = 'Chưa bật đăng nhập Google trong Firebase Console.';
      } else if (err.code === 'auth/popup-closed-by-user') {
        friendlyMsg = 'Bạn đã đóng cửa sổ đăng nhập.';
      } else if (err.code === 'auth/cancelled-popup-request') {
        friendlyMsg = 'Đã hủy yêu cầu đăng nhập cũ.';
      } else if (err.message) {
        friendlyMsg = err.message;
      }
      setAuthError(friendlyMsg);
    }
  };

  const handleManualSync = async () => {
    try {
      setIsSyncing(true);
      setAuthError('');
      await FirebaseSyncService.syncDownAll();
      onRefresh();
      setIsAuthModalVisible(false);
      Alert.alert('Thành công', 'Đồng bộ dữ liệu đám mây hoàn tất!');
    } catch (err: any) {
      console.error(err);
      setAuthError('Lỗi đồng bộ dữ liệu: ' + (err.message || err));
    } finally {
      setIsSyncing(false);
    }
  };

  const getUserDisplayName = () => {
    if (!currentUser) return 'Đăng nhập';
    const email = currentUser.email || '';
    return email.split('@')[0];
  };

  const loadFolders = useCallback(async () => {
    try {
      const list = await StorageService.loadFolders();
      setFolders(list);
    } catch (err) {
      console.warn('Lỗi tải folders:', err);
    }
  }, []);

  React.useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setDimensions(window));
    loadFolders();
    return () => sub?.remove();
  }, [loadFolders, projects, currentUser]);

  const isWide = dimensions.width > 768;
  const numColumns = isWide ? (dimensions.width > 1200 ? 3 : 2) : 1;
  const folderCardMaxWidth = isWide ? (numColumns === 3 ? '31.5%' : '48%') : '100%';

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    if (currentUser) {
      try {
        setSyncToast('🔄 Đang đồng bộ dữ liệu đám mây...');
        await FirebaseSyncService.syncDownAll();
        setSyncToast('✅ Đã đồng bộ dữ liệu thành công!');
        setTimeout(() => setSyncToast(null), 2500);
      } catch (err) {
        console.warn('[HomeScreen] Pull-to-refresh sync failed:', err);
        setSyncToast('❌ Đồng bộ đám mây thất bại');
        setTimeout(() => setSyncToast(null), 2500);
      }
    }
    onRefresh();
    await loadFolders();
    setTimeout(() => setRefreshing(false), 500);
  }, [onRefresh, loadFolders, currentUser]);

  const handleDelete = (project: Project) => {
    if (Platform.OS === 'web') {
      const ok = window.confirm(`Bạn chắc chắn muốn xóa "${project.title}"?`);
      if (ok) {
        StorageService.deleteProject(project.id).then(async () => {
          await FirebaseSyncService.deleteProject(project.id);
          onRefresh();
        });
      }
      return;
    }

    Alert.alert(
      'Xóa bài học',
      `Bạn chắc chắn muốn xóa "${project.title}"?`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa',
          style: 'destructive',
          onPress: async () => {
            await StorageService.deleteProject(project.id);
            await FirebaseSyncService.deleteProject(project.id);
            onRefresh();
          }
        }
      ]
    );
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) {
      Alert.alert('Lỗi', 'Vui lòng nhập tên thư mục.');
      return;
    }

    if (isSubmittingFolder) return;
    setIsSubmittingFolder(true);
    
    try {
      if (editingFolderId) {
        // Đổi tên thư mục đang có
        const folderToUpdate = folders.find(f => f.id === editingFolderId);
        if (folderToUpdate) {
          const updatedFolder = { ...folderToUpdate, name };
          await StorageService.saveFolder(updatedFolder);
          await FirebaseSyncService.uploadFolder(updatedFolder);
        }
        setEditingFolderId(null);
      } else {
        // Tạo thư mục mới
        const newFolder: Folder = {
          id: `fold_${Date.now()}`,
          name,
          createdAt: Date.now(),
        };
        await StorageService.saveFolder(newFolder);
        await FirebaseSyncService.uploadFolder(newFolder);
      }
      
      setNewFolderName('');
      setIsCreateModalVisible(false);
      await loadFolders();
    } catch (err) {
      console.error(err);
      Alert.alert('Lỗi', 'Có lỗi xảy ra khi tạo thư mục.');
    } finally {
      setIsSubmittingFolder(false);
    }
  };

  const handleDeleteFolder = (folder: Folder) => {
    if (Platform.OS === 'web') {
      const ok = window.confirm(`Bạn chắc chắn muốn xóa thư mục "${folder.name}"? Hành động này sẽ xóa tất cả các bài học bên trong thư mục này.`);
      if (ok) {
        StorageService.deleteFolder(folder.id).then(async () => {
          await FirebaseSyncService.deleteFolder(folder.id);
          // Delete folder projects from Firebase as well
          const folderProjects = projects.filter(p => p.folderId === folder.id);
          for (const p of folderProjects) {
            await FirebaseSyncService.deleteProject(p.id);
          }
          loadFolders();
          onRefresh();
        });
      }
      return;
    }

    Alert.alert(
      'Xóa thư mục',
      `Bạn chắc chắn muốn xóa thư mục "${folder.name}"? Hành động này sẽ xóa tất cả các bài học bên trong thư mục này.`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa toàn bộ',
          style: 'destructive',
          onPress: async () => {
            await StorageService.deleteFolder(folder.id);
            await FirebaseSyncService.deleteFolder(folder.id);
            const folderProjects = projects.filter(p => p.folderId === folder.id);
            for (const p of folderProjects) {
              await FirebaseSyncService.deleteProject(p.id);
            }
            await loadFolders();
            onRefresh();
          }
        }
      ]
    );
  };

  const getListeningProgress = (p: Project) => {
    if (!p.segments.length) return 0;
    const learned = p.segments.filter(s => (s.studyCount || 0) > 0).length;
    return Math.round((learned / p.segments.length) * 100);
  };

  const getDictationProgress = (p: Project) => {
    if (!p.segments.length) return 0;
    const done = p.segments.filter(s => s.dictationAccuracy !== undefined).length;
    return Math.round((done / p.segments.length) * 100);
  };

  const getDictationAvgAccuracy = (p: Project) => {
    const withAccuracy = p.segments.filter(s => s.dictationAccuracy !== undefined);
    if (withAccuracy.length === 0) return 0;
    const sum = withAccuracy.reduce((acc, s) => acc + (s.dictationAccuracy || 0), 0);
    return Math.round(sum / withAccuracy.length);
  };

  const getTranslationProgress = (p: Project) => {
    if (!p.segments.length) return 0;
    const done = p.segments.filter(s => s.translationAccuracy !== undefined).length;
    return Math.round((done / p.segments.length) * 100);
  };

  const getTranslationAvgAccuracy = (p: Project) => {
    const withAccuracy = p.segments.filter(s => s.translationAccuracy !== undefined);
    if (withAccuracy.length === 0) return 0;
    const sum = withAccuracy.reduce((acc, s) => acc + (s.translationAccuracy || 0), 0);
    return Math.round(sum / withAccuracy.length);
  };

  const getProgress = (p: Project) => {
    if (progressMode === 'dictation') {
      return getDictationProgress(p);
    } else if (progressMode === 'translation') {
      return getTranslationProgress(p);
    } else {
      return getListeningProgress(p);
    }
  };

  const getProgressColor = (pct: number) => {
    if (progressMode === 'dictation') {
      if (pct >= 100) return '#10b981';
      if (pct >= 40) return '#22c55e';
      if (pct > 0) return '#34d399';
      return '#4b5563';
    }
    if (progressMode === 'translation') {
      if (pct >= 100) return '#10b981';
      if (pct >= 40) return '#0d9488';
      if (pct > 0) return '#2dd4bf';
      return '#4b5563';
    }
    if (pct >= 100) return '#10b981';
    if (pct >= 40) return '#a855f7';
    if (pct > 0) return '#6366f1';
    return '#4b5563';
  };

  // SVG Progress Ring component for web
  const ProgressRing = ({ pct, color, size = 52 }: { pct: number; color: string; size?: number }) => {
    const strokeWidth = 4;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (pct / 100) * circumference;

    if (!IS_WEB) {
      return (
        <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 3, borderColor: pct > 0 ? color : '#1a1a28', alignItems: 'center', justifyContent: 'center', backgroundColor: pct > 0 ? `${color}10` : '#0a0a14' }}>
          <Text style={{ color: pct > 0 ? color : '#555', fontSize: 13, fontWeight: '800' }}>{pct}%</Text>
        </View>
      );
    }

    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <svg width={size} height={size} style={{ position: 'absolute', transform: 'rotate(-90deg)' } as any}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1a1a28" strokeWidth={strokeWidth} />
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.5s ease' } as any} />
        </svg>
        <Text style={{ color: pct > 0 ? '#fff' : '#555', fontSize: 13, fontWeight: '800' }}>{pct}%</Text>
      </View>
    );
  };

  const fmtDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
  };

  const fmtDur = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  };

  const renderCard = ({ item }: { item: Project }) => {
    const pct = getProgress(item);
    const c = getProgressColor(pct);

    // Listening stats
    const learned = item.segments.filter(s => (s.studyCount || 0) > 0).length;
    const notStarted = item.segments.length - learned;

    // Dictation stats
    const dictDone = item.segments.filter(s => s.dictationAccuracy !== undefined).length;
    const dictNotDone = item.segments.length - dictDone;
    const dictAvg = getDictationAvgAccuracy(item);

    // Translation stats
    const transDone = item.segments.filter(s => s.translationAccuracy !== undefined).length;
    const transNotDone = item.segments.length - transDone;
    const transAvg = getTranslationAvgAccuracy(item);

    const ctaLabel = pct === 0 ? 'Bắt đầu' : pct >= 100 ? 'Ôn lại' : 'Tiếp tục';
    const ctaIcon = pct >= 100 ? '✓' : '▶';

    return (
      <TouchableOpacity
        style={[styles.card, isWide && styles.cardWide]}
        activeOpacity={0.7}
        onPress={() => onOpenProject(item)}
      >
        {/* Left: Progress Ring */}
        <View style={styles.cardRingWrap}>
          <ProgressRing pct={pct} color={c} size={isWide ? 56 : 48} />
        </View>

        {/* Center: Info */}
        <View style={styles.cardCenter}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{fmtDate(item.createdAt)}</Text>
            <Text style={styles.metaSep}>·</Text>
            <Text style={styles.meta}>{fmtDur(item.durationMs)}</Text>
            <Text style={styles.metaSep}>·</Text>
            <Text style={styles.meta}>{item.segments.length} câu</Text>
          </View>
          {/* Stat pills */}
          <View style={styles.statsRow}>
            {progressMode === 'listening' ? (
              <>
                {notStarted > 0 && (
                  <View style={[styles.statPill, { backgroundColor: 'rgba(99,102,241,0.12)', borderColor: 'rgba(99,102,241,0.25)' }]}>
                    <View style={[styles.statDot, { backgroundColor: '#6366f1' }]} />
                    <Text style={[styles.statText, { color: '#818cf8' }]}>{notStarted}</Text>
                  </View>
                )}
                {learned > 0 && (
                  <View style={[styles.statPill, { backgroundColor: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.25)' }]}>
                    <View style={[styles.statDot, { backgroundColor: '#10b981' }]} />
                    <Text style={[styles.statText, { color: '#34d399' }]}>{learned}</Text>
                  </View>
                )}
              </>
            ) : progressMode === 'dictation' ? (
              <>
                {dictNotDone > 0 && (
                  <View style={[styles.statPill, { backgroundColor: 'rgba(107,114,128,0.12)', borderColor: 'rgba(107,114,128,0.25)' }]}>
                    <View style={[styles.statDot, { backgroundColor: '#6b7280' }]} />
                    <Text style={[styles.statText, { color: '#9ca3af' }]}>{dictNotDone}</Text>
                  </View>
                )}
                {dictDone > 0 && (
                  <View style={[styles.statPill, { backgroundColor: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.25)' }]}>
                    <View style={[styles.statDot, { backgroundColor: '#10b981' }]} />
                    <Text style={[styles.statText, { color: '#34d399' }]}>{dictDone}</Text>
                  </View>
                )}
                {dictAvg > 0 && (
                  <View style={[styles.statPill, { backgroundColor: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.25)' }]}>
                    <Text style={[styles.statText, { color: '#22c55e', fontWeight: '700' }]}>⌀ {dictAvg}%</Text>
                  </View>
                )}
              </>
            ) : (
              <>
                {transNotDone > 0 && (
                  <View style={[styles.statPill, { backgroundColor: 'rgba(107,114,128,0.12)', borderColor: 'rgba(107,114,128,0.25)' }]}>
                    <View style={[styles.statDot, { backgroundColor: '#6b7280' }]} />
                    <Text style={[styles.statText, { color: '#9ca3af' }]}>{transNotDone}</Text>
                  </View>
                )}
                {transDone > 0 && (
                  <View style={[styles.statPill, { backgroundColor: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.25)' }]}>
                    <View style={[styles.statDot, { backgroundColor: '#10b981' }]} />
                    <Text style={[styles.statText, { color: '#34d399' }]}>{transDone}</Text>
                  </View>
                )}
                {transAvg > 0 && (
                  <View style={[styles.statPill, { backgroundColor: 'rgba(13,148,136,0.12)', borderColor: 'rgba(13,148,136,0.25)' }]}>
                    <Text style={[styles.statText, { color: '#2dd4bf', fontWeight: '700' }]}>⌀ {transAvg}%</Text>
                  </View>
                )}
              </>
            )}
          </View>
        </View>

        {/* Right: CTA + Delete */}
        <View style={styles.cardRight}>
          <View style={[styles.ctaBtn, pct === 0 ? styles.ctaBtnStart : pct >= 100 ? styles.ctaBtnDone : styles.ctaBtnContinue]}>
            <Text style={[styles.ctaBtnText, pct >= 100 && { color: '#10b981' }]}>{ctaIcon} {ctaLabel}</Text>
          </View>
          <TouchableOpacity
            style={styles.delBtn}
            onPress={(e) => {
              if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
              handleDelete(item);
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            {IS_WEB ? (
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            ) : (
              <Text style={styles.delBtnText}>🗑</Text>
            )}
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const renderFolderCard = ({ item }: { item: Folder | { id: string; name: string; isVirtual?: boolean } }) => {
    const isVirtual = item.id === 'uncategorized';
    const count = isVirtual
      ? projects.filter(p => !p.folderId).length
      : projects.filter(p => p.folderId === item.id).length;

    // Calculate folder progress based on mode
    const folderProjects = isVirtual
      ? projects.filter(p => !p.folderId)
      : projects.filter(p => p.folderId === item.id);
    const totalSegments = folderProjects.reduce((sum, p) => sum + p.segments.length, 0);

    let folderPct = 0;
    if (progressMode === 'dictation') {
      const dictSegments = folderProjects.reduce((sum, p) => sum + p.segments.filter(s => s.dictationAccuracy !== undefined).length, 0);
      folderPct = totalSegments > 0 ? Math.round((dictSegments / totalSegments) * 100) : 0;
    } else if (progressMode === 'translation') {
      const transSegments = folderProjects.reduce((sum, p) => sum + p.segments.filter(s => s.translationAccuracy !== undefined).length, 0);
      folderPct = totalSegments > 0 ? Math.round((transSegments / totalSegments) * 100) : 0;
    } else {
      const learnedSegments = folderProjects.reduce((sum, p) => sum + p.segments.filter(s => (s.studyCount || 0) > 0).length, 0);
      folderPct = totalSegments > 0 ? Math.round((learnedSegments / totalSegments) * 100) : 0;
    }

    // Color based on progress and mode
    const accentColor = progressMode === 'dictation'
      ? (folderPct >= 100 ? '#10b981' : folderPct > 0 ? '#22c55e' : '#4b5563')
      : progressMode === 'translation'
      ? (folderPct >= 100 ? '#10b981' : folderPct > 0 ? '#0d9488' : '#4b5563')
      : (folderPct >= 100 ? '#10b981' : folderPct > 0 ? '#a78bfa' : '#7c3aed');

    return (
      <TouchableOpacity
        style={styles.folderCard}
        activeOpacity={0.7}
        onPress={() => setActiveFolderId(item.id)}
      >
        {/* Left: Circle icon */}
        <View style={[styles.folderIconCircle, { borderColor: accentColor + '40', backgroundColor: accentColor + '12' }]}>
          {IS_WEB ? (
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          ) : (
            <Text style={{ fontSize: 18, color: accentColor }}>📂</Text>
          )}
        </View>

        {/* Center: Info */}
        <View style={styles.folderInfo}>
          <Text style={styles.folderName} numberOfLines={1}>{item.name}</Text>
          <View style={styles.folderMetaRow}>
            <Text style={styles.folderCount}>{count} bài học</Text>
            {folderPct > 0 && (
              <>
                <Text style={styles.folderMetaDot}>·</Text>
                <Text style={[styles.folderCount, { color: accentColor }]}>{folderPct}%</Text>
              </>
            )}
          </View>
          {/* Progress bar */}
          {count > 0 && (
            <View style={styles.folderProgressTrack}>
              <View style={[styles.folderProgressFill, { width: `${Math.max(folderPct, 2)}%` as any, backgroundColor: accentColor }]} />
            </View>
          )}
        </View>

        {/* Right: Actions */}
        <View style={styles.folderActionsRow}>
          {!isVirtual && (
            <>
              <TouchableOpacity
                style={styles.folderActionBtn}
                onPress={(e) => {
                  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
                  setEditingFolderId(item.id);
                  setNewFolderName(item.name);
                  setIsCreateModalVisible(true);
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <EditIcon color="#3a3a5a" size={13} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.folderActionBtn}
                onPress={(e) => {
                  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
                  handleDeleteFolder(item as Folder);
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                {IS_WEB ? (
                  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#3a3a5a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                ) : (
                  <Text style={{ color: '#3a3a5a', fontSize: 12 }}>🗑</Text>
                )}
              </TouchableOpacity>
            </>
          )}
          {/* Chevron */}
          {IS_WEB ? (
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#2a2a4a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          ) : (
            <Text style={{ color: '#2a2a4a', fontSize: 18, fontWeight: '300' }}>›</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmptyFolder = () => (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyIcon}>📂</Text>
      <Text style={styles.emptyTitle}>Thư mục trống</Text>
      <Text style={styles.emptySub}>
        Chưa có bài học nào trong thư mục này.
      </Text>
      <TouchableOpacity 
        style={styles.emptyBtn} 
        onPress={() => onNewProject(activeFolderId === 'uncategorized' ? undefined : activeFolderId || undefined)}
      >
        <Text style={styles.emptyBtnText}>＋  Tạo bài học đầu tiên</Text>
      </TouchableOpacity>
    </View>
  );

  const renderEmptyFolders = () => (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyIcon}>📁</Text>
      <Text style={styles.emptyTitle}>Chưa có thư mục nào</Text>
      <Text style={styles.emptySub}>
        Tạo thư mục đầu tiên để tổ chức bài học của bạn!
      </Text>
      <TouchableOpacity style={styles.emptyBtn} onPress={handleOpenCreateFolderModal}>
        <Text style={styles.emptyBtnText}>＋  Tạo thư mục mới</Text>
      </TouchableOpacity>
    </View>
  );

  const getFolderLastActiveTime = (folder: Folder | { id: string; name: string; isVirtual?: boolean; createdAt: number }) => {
    const isVirtual = folder.id === 'uncategorized';
    const folderProjects = isVirtual
      ? projects.filter(p => !p.folderId)
      : projects.filter(p => p.folderId === folder.id);

    if (folderProjects.length > 0) {
      return Math.max(...folderProjects.map(p => p.lastOpenedAt || p.createdAt || 0));
    }
    return folder.createdAt || 0;
  };

  const folderListData = [
    ...folders,
    ...(projects.filter(p => !p.folderId).length > 0
      ? [{ id: 'uncategorized', name: 'Chưa phân loại', createdAt: 0 }]
      : [])
  ].sort((a, b) => {
    const timeA = getFolderLastActiveTime(a);
    const timeB = getFolderLastActiveTime(b);
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  const currentFolder = folders.find(f => f.id === activeFolderId);
  const activeFolderTitle = activeFolderId === 'uncategorized' ? 'Chưa phân loại' : (currentFolder?.name || 'Thư mục');

  const filteredProjects = projects.filter(p => 
    activeFolderId === 'uncategorized' ? !p.folderId : p.folderId === activeFolderId
  );

  // Summary stats for header
  const totalProjects = activeFolderId !== null ? filteredProjects.length : projects.length;
  const learningProjects = (activeFolderId !== null ? filteredProjects : projects).filter(p => {
    const pct = getProgress(p);
    return pct > 0 && pct < 100;
  }).length;
  const completedProjects = (activeFolderId !== null ? filteredProjects : projects).filter(p => getProgress(p) >= 100).length;

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, isWide && styles.headerWide]}>
        {activeFolderId !== null ? (
          <View style={styles.headerLeftRow}>
            <TouchableOpacity style={styles.backBtn} onPress={() => setActiveFolderId(null)}>
              <Text style={styles.backBtnText}>‹</Text>
            </TouchableOpacity>
            <View style={{ marginLeft: 10, flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.headerTitle, { fontSize: isWide ? 26 : 18 }]} numberOfLines={1}>{activeFolderTitle}</Text>
                {activeFolderId !== 'uncategorized' && (
                  <TouchableOpacity
                    style={styles.headerEditFolderBtn}
                    onPress={() => {
                      const folder = folders.find(f => f.id === activeFolderId);
                      if (folder) {
                        setEditingFolderId(folder.id);
                        setNewFolderName(folder.name);
                        setIsCreateModalVisible(true);
                      }
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    {IS_WEB ? (
                      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#5a5a7a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                        <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                      </svg>
                    ) : (
                      <Text style={{ color: '#5a5a7a', fontSize: 13 }}>✏</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        ) : (
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.headerTitle, { fontSize: isWide ? 30 : 22 }]}>🎧 MP3 Looper</Text>
            <Text style={styles.headerSub}>Luyện Shadowing tiếng Anh</Text>
          </View>
        )}

        <View style={styles.headerRightRow}>
          <TouchableOpacity
            style={[
              styles.headerUserBtn,
              currentUser && styles.headerUserBtnLoggedIn,
            ]}
            onPress={handleOpenAuthModal}
          >
            <AccountIcon isLoggedIn={!!currentUser} size={isWide ? 26 : 24} />
            {currentUser && (
              <View style={styles.headerUserOnlineDot} />
            )}
          </TouchableOpacity>

          {isWide && (
            activeFolderId !== null ? (
              <TouchableOpacity
                style={styles.headerAddBtn}
                onPress={() => onNewProject(activeFolderId === 'uncategorized' ? undefined : activeFolderId)}
              >
                <Text style={styles.headerAddBtnText}>＋ Tạo mới</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.headerAddBtn}
                onPress={handleOpenCreateFolderModal}
              >
                <Text style={styles.headerAddBtnText}>＋ Tạo thư mục</Text>
              </TouchableOpacity>
            )
          )}
        </View>
      </View>

      {/* Summary Stats + Progress Mode Toggle */}
      {activeFolderId !== null && totalProjects > 0 && (
        <View style={[styles.summaryBar, isWide && { paddingHorizontal: 40 }]}>
          <Text style={styles.summaryText}>
            {totalProjects} bài học
            {learningProjects > 0 ? `  ·  ${learningProjects} đang học` : ''}
            {completedProjects > 0 ? `  ·  ${completedProjects} hoàn thành` : ''}
          </Text>
          <View style={styles.toggleBar}>
            <TouchableOpacity
              style={[styles.togglePill, progressMode === 'listening' && styles.togglePillActive]}
              onPress={() => setProgressMode('listening')}
              activeOpacity={0.7}
            >
              <Text style={[styles.toggleText, progressMode === 'listening' && styles.toggleTextActive]}>🎧 Nghe</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.togglePill, progressMode === 'dictation' && styles.togglePillActiveDictation]}
              onPress={() => setProgressMode('dictation')}
              activeOpacity={0.7}
            >
              <Text style={[styles.toggleText, progressMode === 'dictation' && styles.toggleTextActiveDictation]}>✍️ Chính tả</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.togglePill, progressMode === 'translation' && styles.togglePillActiveTranslation]}
              onPress={() => setProgressMode('translation')}
              activeOpacity={0.7}
            >
              <Text style={[styles.toggleText, progressMode === 'translation' && styles.toggleTextActiveTranslation]}>🔄 Dịch câu</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Sync Toast Notification */}
      {syncToast && (
        <View style={styles.syncToastContainer}>
          <View style={[
            styles.syncToastContent,
            syncToast.includes('✅') ? styles.syncToastSuccess : syncToast.includes('❌') ? styles.syncToastError : styles.syncToastPending
          ]}>
            <Text style={[
              styles.syncToastText,
              syncToast.includes('✅') ? styles.syncToastTextSuccess : syncToast.includes('❌') ? styles.syncToastTextError : styles.syncToastTextPending
            ]}>
              {syncToast}
            </Text>
          </View>
        </View>
      )}

      {/* List */}
      <FlatList
        key={'list_1'}
        data={(activeFolderId !== null ? filteredProjects : folderListData) as any}
        keyExtractor={(item: any) => item.id}
        renderItem={activeFolderId !== null ? renderCard : (renderFolderCard as any)}
        numColumns={1}
        ListEmptyComponent={activeFolderId !== null ? renderEmptyFolder : renderEmptyFolders}
        contentContainerStyle={
          (activeFolderId !== null ? filteredProjects.length : folderListData.length) === 0
            ? styles.emptyContainer
            : [styles.listContent, isWide && styles.listContentWide]
        }
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#a855f7" colors={['#a855f7']} />
        }
      />

      {/* FAB (mobile) */}
      {!isWide && (
        <TouchableOpacity 
          style={styles.fab} 
          onPress={() => {
            if (activeFolderId !== null) {
              onNewProject(activeFolderId === 'uncategorized' ? undefined : activeFolderId);
            } else {
              handleOpenCreateFolderModal();
            }
          }} 
          activeOpacity={0.8}
        >
          <Text style={styles.fabText}>＋</Text>
        </TouchableOpacity>
      )}

      {/* Folder Creation Modal */}
      <Modal
        visible={isCreateModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCloseCreateFolderModal}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalDismiss} onPress={handleCloseCreateFolderModal} />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>
              {editingFolderId ? '📁 Đổi Tên Thư Mục' : '📁 Tạo Thư Mục Mới'}
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Nhập tên thư mục..."
              placeholderTextColor="#555"
              value={newFolderName}
              onChangeText={setNewFolderName}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={handleCloseCreateFolderModal}>
                <Text style={styles.modalCancelBtnText}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalConfirmBtn, isSubmittingFolder && { opacity: 0.5 }]} 
                onPress={handleCreateFolder}
                disabled={isSubmittingFolder}
              >
                <Text style={styles.modalConfirmBtnText}>
                  {isSubmittingFolder ? 'Đang tạo...' : (editingFolderId ? 'Lưu' : 'Tạo')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Auth Modal */}
      <Modal
        visible={isAuthModalVisible}
        transparent
        animationType={isWide ? 'fade' : 'slide'}
        onRequestClose={handleCloseAuthModal}
      >
        <View style={[styles.modalOverlay, !isWide && styles.modalOverlayBottom]}>
          <TouchableOpacity style={styles.modalDismiss} onPress={handleCloseAuthModal} />
          <View style={[styles.modalSheet, !isWide && styles.modalSheetBottom]}>
            {!isWide && <View style={styles.modalHandle} />}
            <TouchableOpacity style={styles.modalCloseBtn} onPress={handleCloseAuthModal} activeOpacity={0.7}>
              <Text style={styles.modalCloseText}>✕</Text>
            </TouchableOpacity>

            <Text style={styles.modalTitle}>
              {currentUser ? 'Tài khoản' : 'Đăng nhập'}
            </Text>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: Dimensions.get('window').height * 0.7 }}>
              {currentUser ? (
                <View style={{ marginBottom: 24 }}>
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 10 }}>
                    {currentUser.email}
                  </Text>
                  
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                    {isSyncing ? (
                      <Text style={{ color: '#a855f7', fontSize: 13, fontWeight: '600' }}>
                        🔄 Đang tự động đồng bộ...
                      </Text>
                    ) : (
                      <>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#10b981' }} />
                        <Text style={{ color: '#10b981', fontSize: 13, fontWeight: '600' }}>
                          Đã tự động đồng bộ đám mây
                        </Text>
                      </>
                    )}
                  </View>
                </View>
              ) : (
                <View style={{ marginBottom: 10 }}>
                  <Text style={{ color: '#aaa', fontSize: 14, lineHeight: 20, marginBottom: 20 }}>
                    Đồng bộ tiến trình học qua Google.
                  </Text>

                  {/* Google Sign-In Button (Web only) */}
                  {Platform.OS === 'web' ? (
                    <TouchableOpacity 
                      style={styles.googleBtn} 
                      onPress={handleGoogleSignIn}
                      activeOpacity={0.8}
                    >
                      <View style={styles.googleIconContainer}>
                        <svg width="18" height="18" viewBox="0 0 24 24" style={{ display: 'block' } as any}>
                          <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v3.92h6.69a5.74 5.74 0 0 1-2.48 3.77v3.13h3.99c2.34-2.16 3.68-5.32 3.68-8.75z"/>
                          <path fill="#34A853" d="M12 24c3.24 0 5.97-1.08 7.96-2.91l-3.99-3.13c-1.11.75-2.53 1.19-3.97 1.19-3.05 0-5.64-2.06-6.56-4.83H1.36v3.23C3.34 21.6 7.42 24 12 24z"/>
                          <path fill="#FBBC05" d="M5.44 14.32a7.18 7.18 0 0 1 0-4.64V6.45H1.36a11.96 11.96 0 0 0 0 11.1l4.08-3.23z"/>
                          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.96 1.19 15.24 0 12 0 7.42 0 3.34 2.4 1.36 6.45l4.08 3.23c.92-2.77 3.51-4.83 6.56-4.83z"/>
                        </svg>
                      </View>
                      <Text style={styles.googleBtnText}>Đăng nhập Google</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={{ color: '#ff8b8b', fontSize: 13, textAlign: 'center', marginVertical: 10, lineHeight: 20 }}>
                      * Tính năng đồng bộ Google khả dụng khi bạn sử dụng phiên bản Web của ứng dụng.
                    </Text>
                  )}
                </View>
              )}

              {authError ? (
                <Text style={{ color: '#f87171', fontSize: 13, marginBottom: 16, fontWeight: '600' }}>
                  ⚠️ {authError}
                </Text>
              ) : null}

              {currentUser && (
                <TouchableOpacity 
                  style={[styles.signOutBtn, { marginBottom: 10 }]} 
                  onPress={handleSignOut}
                  disabled={isSyncing}
                  activeOpacity={0.8}
                >
                  <Text style={styles.signOutBtnText}>Đăng xuất</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#08080d',
    paddingTop: IS_WEB ? 0 : 48,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: IS_WEB ? 24 : 12,
    marginBottom: 24,
  },
  headerRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerUserBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1b132e',
    borderWidth: 1.5,
    borderColor: '#4c1d95',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  headerUserBtnLoggedIn: {
    borderColor: '#10b981',
    backgroundColor: '#064e3b22',
  },
  headerUserOnlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#10b981',
    borderWidth: 1.5,
    borderColor: '#08080d',
  },
  headerUserBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 10,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  googleIconContainer: {
    marginRight: 12,
  },
  googleBtnText: {
    color: '#3c4043',
    fontSize: 14,
    fontWeight: '700',
  },
  headerWide: {
    paddingHorizontal: 40,
    marginBottom: 32,
  },
  headerTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 14,
    color: '#555',
    marginTop: 4,
    fontWeight: '500',
  },
  headerAddBtn: {
    backgroundColor: '#a855f7',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 20,
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  headerAddBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  toggleBar: {
    flexDirection: 'row',
    backgroundColor: '#0f0f1a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e1e30',
    padding: 2,
  },
  togglePill: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 8,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  togglePillActive: {
    backgroundColor: 'rgba(168,85,247,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.35)',
  },
  togglePillActiveDictation: {
    backgroundColor: 'rgba(16,185,129,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.35)',
  },
  togglePillActiveTranslation: {
    backgroundColor: 'rgba(13,148,136,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(13,148,136,0.35)',
  },
  toggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#555',
  },
  toggleTextActive: {
    color: '#c4b5fd',
  },
  toggleTextActiveDictation: {
    color: '#34d399',
  },
  toggleTextActiveTranslation: {
    color: '#2dd4bf',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  listContentWide: {
    paddingHorizontal: 36,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  // ─── SUMMARY BAR ───
  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 24,
    paddingBottom: 10,
  },
  summaryText: {
    color: '#555',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  // ─── CARD (list-row) ───
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0c0c18',
    borderRadius: 16,
    marginBottom: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#16162a',
    gap: 14,
    ...(IS_WEB ? {
      cursor: 'pointer',
      transition: 'all 0.2s ease',
    } as any : {}),
  },
  cardWide: {
    maxWidth: 820,
    alignSelf: 'center',
    width: '100%',
    padding: 18,
    borderRadius: 18,
    ...(IS_WEB ? {
      ':hover': {
        borderColor: '#2a2a50',
        backgroundColor: '#10101f',
      },
    } as any : {}),
  },
  cardRingWrap: {
    flexShrink: 0,
  },
  cardCenter: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.2,
  },
  cardRight: {
    flexShrink: 0,
    alignItems: 'flex-end',
    gap: 8,
  },
  delBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.4,
    ...(IS_WEB ? { cursor: 'pointer', ':hover': { opacity: 1 } } as any : {}),
  },
  delBtnText: {
    color: '#555',
    fontSize: 12,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  meta: {
    color: '#4a4a6a',
    fontSize: 11,
    fontWeight: '600',
  },
  metaSep: {
    color: '#2a2a3a',
    marginHorizontal: 5,
    fontSize: 9,
    fontWeight: '800',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  statDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  statText: {
    fontSize: 11,
    fontWeight: '700',
  },
  ctaBtn: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  ctaBtnStart: {
    ...(IS_WEB ? {
      background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
    } as any : {
      backgroundColor: '#7c3aed',
    }),
  },
  ctaBtnContinue: {
    backgroundColor: 'rgba(124,58,237,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.3)',
  },
  ctaBtnDone: {
    backgroundColor: 'rgba(16,185,129,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.25)',
  },
  ctaBtnText: {
    color: '#c4b5fd',
    fontSize: 12,
    fontWeight: '700',
  },
  // ─── EMPTY ───
  emptyWrap: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    fontSize: 56,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 15,
    color: '#555',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  emptyBtn: {
    backgroundColor: '#a855f7',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 5,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  emptyBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  // ─── FAB ───
  fab: {
    position: 'absolute',
    bottom: 32,
    right: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#a855f7',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 8,
  },
  fabText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '300',
    marginTop: -2,
  },
  headerLeftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 16,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#13131f',
    borderWidth: 1,
    borderColor: '#1e1e30',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  backBtnText: {
    color: '#ccc',
    fontSize: 22,
    fontWeight: '400',
    lineHeight: 24,
    marginTop: -1,
  },
  folderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0c0c18',
    borderWidth: 1,
    borderColor: '#16162a',
    borderRadius: 16,
    marginBottom: 12,
    padding: 16,
    gap: 14,
    ...(IS_WEB ? {
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      maxWidth: 820,
      alignSelf: 'center',
      width: '100%',
    } as any : {}),
  },
  folderIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  folderInfo: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  folderMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  folderMetaDot: {
    color: '#2a2a3a',
    marginHorizontal: 6,
    fontSize: 10,
    fontWeight: '800',
  },
  folderProgressTrack: {
    height: 3,
    backgroundColor: '#16162a',
    borderRadius: 2,
    marginTop: 6,
    overflow: 'hidden',
  },
  folderProgressFill: {
    height: 3,
    borderRadius: 2,
  },
  folderActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  folderActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.4,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  folderName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#e8e8f0',
    letterSpacing: -0.2,
  },
  folderCount: {
    fontSize: 12,
    color: '#4a4a6a',
    fontWeight: '600',
  },
  headerEditFolderBtn: {
    padding: 4,
    opacity: 0.6,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlayBottom: {
    justifyContent: 'flex-end',
    alignItems: 'stretch',
  },
  modalDismiss: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  modalSheet: {
    width: '90%',
    maxWidth: 400,
    backgroundColor: '#0f0f1a',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#26263b',
    padding: 24,
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  modalSheetBottom: {
    width: '100%',
    maxWidth: '100%',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 34,
    paddingTop: 16,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3a3a55',
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: '#08080f',
    borderWidth: 1,
    borderColor: '#26263b',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 14,
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalCancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: '#13131f',
    borderWidth: 1,
    borderColor: '#26263b',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  modalCancelBtnText: {
    color: '#aaa',
    fontSize: 14,
    fontWeight: '700',
  },
  modalConfirmBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    backgroundColor: '#a855f7',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  modalConfirmBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  modalCloseBtn: {
    position: 'absolute',
    top: 18,
    right: 18,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    zIndex: 10,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  modalCloseText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: 'bold',
  },
  signOutBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#1b131c',
    borderWidth: 1,
    borderColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  signOutBtnText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '700',
  },
  syncBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#131e1b',
    borderWidth: 1,
    borderColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  syncBtnText: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: '700',
  },
  syncToastContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingHorizontal: 24,
    marginVertical: 10,
    zIndex: 99,
  },
  syncToastContent: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  syncToastPending: {
    backgroundColor: 'rgba(124, 58, 237, 0.12)',
    borderColor: 'rgba(124, 58, 237, 0.35)',
  },
  syncToastSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  syncToastError: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  syncToastText: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  syncToastTextPending: {
    color: '#c4b5fd',
  },
  syncToastTextSuccess: {
    color: '#a7f3d0',
  },
  syncToastTextError: {
    color: '#fca5a5',
  },
});
