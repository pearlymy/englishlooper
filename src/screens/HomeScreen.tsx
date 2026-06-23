import React, { useState, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,

  Alert,
  RefreshControl,
  Dimensions,
  Platform,
  TextInput,
  Modal,
  ScrollView,
  Image,
} from 'react-native';
import { Project, Folder } from '../types';
import { StorageService } from '../services/storageService';
import { auth, storage } from '../services/firebaseConfig';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { FirebaseSyncService } from '../services/firebaseSyncService';
import { showAlert } from '../utils/alert';

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
  const [searchQuery, setSearchQuery] = useState('');

  // Folder states
  const [folders, setFolders] = useState<Folder[]>([]);
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [isSubmittingFolder, setIsSubmittingFolder] = useState(false);
  const [folderThumbnail, setFolderThumbnail] = useState<string | null>(null);

  // Web file picker for folder thumbnail
  const pickFolderThumbnail = () => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      // Always resize for preview + upload (max 800px, JPEG 80%)
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new (window as any).Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxSize = 800;
          let w = img.width;
          let h = img.height;
          if (w > maxSize || h > maxSize) {
            if (w > h) { h = (h / w) * maxSize; w = maxSize; }
            else { w = (w / h) * maxSize; h = maxSize; }
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, w, h);
          setFolderThumbnail(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = ev.target?.result;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  // Upload thumbnail to Firebase Storage, returns download URL
  const uploadThumbnailToStorage = async (folderId: string, base64Data: string): Promise<string> => {
    // Convert base64 to blob
    const response = await fetch(base64Data);
    const blob = await response.blob();
    
    const userId = auth.currentUser?.uid || 'anonymous';
    const storageRef = ref(storage, `folder-thumbnails/${userId}/${folderId}.jpg`);
    await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
    return await getDownloadURL(storageRef);
  };

  // Auth Modal states
  const [isAuthModalVisible, setIsAuthModalVisible] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  // Custom confirm dialog state (replaces browser native alert)
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmText: string;
    confirmColor?: string;
    onConfirm: () => void;
  } | null>(null);

  const handleOpenCreateFolderModal = () => {
    setEditingFolderId(null);
    setNewFolderName('');
    setFolderThumbnail(null);
    setIsCreateModalVisible(true);
  };

  const handleCloseCreateFolderModal = () => {
    setIsCreateModalVisible(false);
    setEditingFolderId(null);
    setNewFolderName('');
    setFolderThumbnail(null);
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
      showAlert('Thành công', 'Đồng bộ dữ liệu đám mây hoàn tất!');
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

  // Inject CSS hover effects for folder cards on web
  React.useEffect(() => {
    if (!IS_WEB) return;
    const styleId = 'folder-card-hover-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .folder-grid-card {
        transition: all 0.2s ease, transform 0.15s ease;
      }
      .folder-grid-card:hover {
        transform: translateY(-3px) !important;
        border-color: #2a2a44 !important;
        box-shadow: 0 8px 24px rgba(0,0,0,0.35) !important;
      }
      .folder-grid-card .folder-actions {
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      .folder-grid-card:hover .folder-actions {
        opacity: 1 !important;
      }
      .mag-featured-card {
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
      }
      .mag-featured-card:hover {
        transform: translateY(-3px) !important;
        box-shadow: 0 20px 60px rgba(124, 58, 237, 0.18) !important;
        border-color: #2a2a50 !important;
      }
      .mag-grid-card {
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
      }
      .mag-grid-card:hover {
        transform: translateY(-4px) !important;
        border-color: #2a2a50 !important;
        box-shadow: 0 12px 32px rgba(124, 58, 237, 0.12) !important;
      }
      .mag-grid-card .mag-del-btn {
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      .mag-grid-card:hover .mag-del-btn {
        opacity: 0.6 !important;
      }
      .mag-grid-card .mag-del-btn:hover {
        opacity: 1 !important;
      }
    `;
    document.head.appendChild(style);
  }, []);

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
    setConfirmDialog({
      title: 'Xóa bài học',
      message: `Bạn chắc chắn muốn xóa "${project.title}"?`,
      confirmText: 'Xóa',
      confirmColor: '#ef4444',
      onConfirm: async () => {
        try {
          await StorageService.deleteProject(project.id);
          // Clean up cached audio hash from localStorage
          try { localStorage.removeItem(`audio_hash_${project.id}`); } catch (_) {}
          await FirebaseSyncService.deleteProject(project.id).catch(err => 
            console.warn('Firebase delete failed (non-blocking):', err)
          );
          onRefresh();
        } catch (err) {
          console.error('Lỗi xóa project:', err);
          showAlert('Lỗi', 'Không thể xóa bài học. Vui lòng thử lại.');
        } finally {
          setConfirmDialog(null);
        }
      },
    });
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) {
      showAlert('Lỗi', 'Vui lòng nhập tên thư mục.');
      return;
    }

    if (isSubmittingFolder) return;
    setIsSubmittingFolder(true);
    
    try {
      if (editingFolderId) {
        const folderToUpdate = folders.find(f => f.id === editingFolderId);
        if (folderToUpdate) {
          let thumbnailUrl = folderToUpdate.thumbnailUrl;
          // Upload new thumbnail to Firebase Storage if changed (base64 = new image)
          if (folderThumbnail && folderThumbnail.startsWith('data:')) {
            thumbnailUrl = await uploadThumbnailToStorage(editingFolderId, folderThumbnail);
          } else if (folderThumbnail === null && folderToUpdate.thumbnailUrl) {
            thumbnailUrl = undefined; // User removed thumbnail
          }
          const updatedFolder = { ...folderToUpdate, name, thumbnailUrl };
          await StorageService.saveFolder(updatedFolder);
          await FirebaseSyncService.uploadFolder(updatedFolder);
        }
        setEditingFolderId(null);
      } else {
        const folderId = `fold_${Date.now()}`;
        let thumbnailUrl: string | undefined;
        if (folderThumbnail && folderThumbnail.startsWith('data:')) {
          thumbnailUrl = await uploadThumbnailToStorage(folderId, folderThumbnail);
        }
        const newFolder: Folder = {
          id: folderId,
          name,
          createdAt: Date.now(),
          ...(thumbnailUrl ? { thumbnailUrl } : {}),
        };
        await StorageService.saveFolder(newFolder);
        await FirebaseSyncService.uploadFolder(newFolder);
      }
      
      setNewFolderName('');
      setFolderThumbnail(null);
      setIsCreateModalVisible(false);
      await loadFolders();
    } catch (err) {
      console.error(err);
      showAlert('Lỗi', 'Có lỗi xảy ra khi tạo thư mục.');
    } finally {
      setIsSubmittingFolder(false);
    }
  };

  const handleDeleteFolder = (folder: Folder) => {
    setConfirmDialog({
      title: 'Xóa thư mục',
      message: `Bạn chắc chắn muốn xóa thư mục "${folder.name}"? Hành động này sẽ xóa tất cả các bài học bên trong thư mục này.`,
      confirmText: 'Xóa toàn bộ',
      confirmColor: '#ef4444',
      onConfirm: async () => {
        try {
          await StorageService.deleteFolder(folder.id);
          await FirebaseSyncService.deleteFolder(folder.id).catch(err =>
            console.warn('Firebase folder delete failed (non-blocking):', err)
          );
          const folderProjects = projects.filter(p => p.folderId === folder.id);
          for (const p of folderProjects) {
            // Clean up cached audio hash
            try { localStorage.removeItem(`audio_hash_${p.id}`); } catch (_) {}
            await FirebaseSyncService.deleteProject(p.id).catch(err =>
              console.warn('Firebase project delete failed (non-blocking):', err)
            );
          }
          await loadFolders();
          onRefresh();
        } catch (err) {
          console.error('Lỗi xóa folder:', err);
          showAlert('Lỗi', 'Không thể xóa thư mục. Vui lòng thử lại.');
        } finally {
          setConfirmDialog(null);
        }
      },
    });
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

  // ─── MAGAZINE LAYOUT: Featured Card ───
  const renderFeaturedCard = (project: Project) => {
    const pct = getProgress(project);
    const c = getProgressColor(pct);
    const learned = project.segments.filter(s => (s.studyCount || 0) > 0).length;
    const notStarted = project.segments.length - learned;
    const dictDone = project.segments.filter(s => s.dictationAccuracy !== undefined).length;
    const dictNotDone = project.segments.length - dictDone;
    const dictAvg = getDictationAvgAccuracy(project);
    const transDone = project.segments.filter(s => s.translationAccuracy !== undefined).length;
    const transNotDone = project.segments.length - transDone;
    const transAvg = getTranslationAvgAccuracy(project);
    const ctaLabel = pct === 0 ? 'Bắt đầu học' : pct >= 100 ? 'Ôn lại bài' : 'Tiếp tục học';
    const ctaIcon = pct >= 100 ? '✓' : '▶';

    return (
      <TouchableOpacity
        key={`featured_${project.id}`}
        ref={(r: any) => { if (IS_WEB && r?.classList && !r.classList.contains('mag-featured-card')) r.classList.add('mag-featured-card'); }}
        style={[magStyles.featuredCard, IS_WEB && { background: `linear-gradient(135deg, #0e0e1e 0%, ${c}08 40%, #0e0e1e 100%)` } as any]}
        activeOpacity={0.85}
        onPress={() => onOpenProject(project)}
      >
        {/* Status label */}
        <View style={magStyles.featuredLabel}>
          <View style={[magStyles.featuredLabelDot, { backgroundColor: c }]} />
          <Text style={[magStyles.featuredLabelText, { color: c }]}>
            {pct >= 100 ? 'Hoàn thành' : pct > 0 ? 'Đang học' : 'Chưa bắt đầu'}
          </Text>
        </View>
        
        {/* Main content */}
        <View style={magStyles.featuredContent}>
          <View style={{ flexShrink: 0 }}>
            <ProgressRing pct={pct} color={c} size={isWide ? 88 : 68} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
            <Text style={magStyles.featuredTitle} numberOfLines={2}>{project.title}</Text>
            <View style={styles.metaRow}>
              <Text style={magStyles.featuredMeta}>{fmtDate(project.createdAt)}</Text>
              <Text style={[styles.metaSep, { marginHorizontal: 6 }]}>·</Text>
              <Text style={magStyles.featuredMeta}>{fmtDur(project.durationMs)}</Text>
              <Text style={[styles.metaSep, { marginHorizontal: 6 }]}>·</Text>
              <Text style={magStyles.featuredMeta}>{project.segments.length} câu</Text>
            </View>
            <View style={[styles.statsRow, { marginTop: 4, flexWrap: 'wrap' }]}>
              {progressMode === 'listening' ? (<>
                {notStarted > 0 && (
                  <View style={[styles.statPill, { backgroundColor: 'rgba(99,102,241,0.12)', borderColor: 'rgba(99,102,241,0.25)' }]}>
                    <View style={[styles.statDot, { backgroundColor: '#6366f1' }]} />
                    <Text style={[styles.statText, { color: '#818cf8' }]}>{notStarted} chưa</Text>
                  </View>
                )}
                {learned > 0 && (
                  <View style={[styles.statPill, { backgroundColor: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.25)' }]}>
                    <View style={[styles.statDot, { backgroundColor: '#10b981' }]} />
                    <Text style={[styles.statText, { color: '#34d399' }]}>{learned} đã học</Text>
                  </View>
                )}
              </>) : progressMode === 'dictation' ? (<>
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
              </>) : (<>
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
              </>)}
            </View>
          </View>
        </View>

        {/* Bottom CTA */}
        <View style={magStyles.featuredBottom}>
          <View style={[magStyles.featuredCta, pct === 0 ? styles.ctaBtnStart : pct >= 100 ? styles.ctaBtnDone : styles.ctaBtnContinue]}>
            <Text style={[styles.ctaBtnText, { fontSize: 14 }, pct >= 100 && { color: '#10b981' }]}>{ctaIcon}  {ctaLabel}</Text>
          </View>
          <TouchableOpacity
            style={[styles.delBtn, { opacity: 0.3 }]}
            onPress={(e) => { e?.stopPropagation?.(); handleDelete(project); }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            {IS_WEB ? (
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            ) : <Text style={styles.delBtnText}>🗑</Text>}
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  // ─── MAGAZINE LAYOUT: Stats Panel ───
  const renderStatsPanel = (projectsList: Project[]) => {
    const totalSegs = projectsList.reduce((s, p) => s + p.segments.length, 0);
    const totalDurMs = projectsList.reduce((s, p) => s + p.durationMs, 0);
    const totalMin = Math.floor(totalDurMs / 60000);
    const totalHr = Math.floor(totalMin / 60);
    const remMin = totalMin % 60;

    let doneSegs = 0;
    let avgAcc = 0;
    if (progressMode === 'listening') {
      doneSegs = projectsList.reduce((s, p) => s + p.segments.filter(seg => (seg.studyCount || 0) > 0).length, 0);
    } else if (progressMode === 'dictation') {
      const withAcc = projectsList.flatMap(p => p.segments.filter(seg => seg.dictationAccuracy !== undefined));
      doneSegs = withAcc.length;
      avgAcc = withAcc.length > 0 ? Math.round(withAcc.reduce((s, seg) => s + (seg.dictationAccuracy || 0), 0) / withAcc.length) : 0;
    } else {
      const withAcc = projectsList.flatMap(p => p.segments.filter(seg => seg.translationAccuracy !== undefined));
      doneSegs = withAcc.length;
      avgAcc = withAcc.length > 0 ? Math.round(withAcc.reduce((s, seg) => s + (seg.translationAccuracy || 0), 0) / withAcc.length) : 0;
    }
    const overallPct = totalSegs > 0 ? Math.round((doneSegs / totalSegs) * 100) : 0;
    const overallColor = getProgressColor(overallPct);

    return (
      <View style={magStyles.statsPanel}>
        <Text style={magStyles.statsPanelTitle}>📊 Tổng quan</Text>

        {/* Overall progress bar */}
        <View style={magStyles.statsProgressWrap}>
          <View style={magStyles.statsProgressBg}>
            {IS_WEB ? (
              <View style={[magStyles.statsProgressFill, { width: `${overallPct}%`, background: `linear-gradient(90deg, ${overallColor}, ${overallColor}aa)` } as any]} />
            ) : (
              <View style={[magStyles.statsProgressFill, { width: `${overallPct}%`, backgroundColor: overallColor } as any]} />
            )}
          </View>
          <Text style={[magStyles.statsProgressLabel, { color: overallColor }]}>{overallPct}%</Text>
        </View>

        {/* Stat grid */}
        <View style={magStyles.statsGrid}>
          <View style={magStyles.statsGridItem}>
            <Text style={magStyles.statsGridValue}>{projectsList.length}</Text>
            <Text style={magStyles.statsGridLabel}>bài học</Text>
          </View>
          <View style={magStyles.statsGridItem}>
            <Text style={[magStyles.statsGridValue, { color: '#a78bfa' }]}>{doneSegs}</Text>
            <Text style={magStyles.statsGridLabel}>câu xong</Text>
          </View>
          <View style={magStyles.statsGridItem}>
            <Text style={[magStyles.statsGridValue, { color: '#6366f1' }]}>{totalSegs - doneSegs}</Text>
            <Text style={magStyles.statsGridLabel}>còn lại</Text>
          </View>
          <View style={magStyles.statsGridItem}>
            <Text style={magStyles.statsGridValue}>{totalHr > 0 ? `${totalHr}h${remMin}` : `${remMin}p`}</Text>
            <Text style={magStyles.statsGridLabel}>thời gian</Text>
          </View>
        </View>

        {/* Average accuracy for dictation/translation modes */}
        {progressMode !== 'listening' && avgAcc > 0 && (
          <View style={magStyles.statsAccuracyWrap}>
            <Text style={magStyles.statsAccuracyLabel}>{progressMode === 'dictation' ? '✍️ Chính xác TB' : '🔄 Dịch TB'}</Text>
            <Text style={[magStyles.statsAccuracyValue, { color: avgAcc >= 80 ? '#10b981' : avgAcc >= 50 ? '#f59e0b' : '#ef4444' }]}>{avgAcc}%</Text>
          </View>
        )}
      </View>
    );
  };

  // ─── MAGAZINE LAYOUT: Grid Card (compact) ───
  const renderMagGridCard = (project: Project) => {
    const pct = getProgress(project);
    const c = getProgressColor(pct);
    const ctaLabel = pct === 0 ? 'Bắt đầu' : pct >= 100 ? 'Ôn lại' : 'Tiếp tục';
    const ctaIcon = pct >= 100 ? '✓' : '▶';

    // Stats for current mode
    let doneStat = 0, totalStat = project.segments.length;
    if (progressMode === 'listening') {
      doneStat = project.segments.filter(s => (s.studyCount || 0) > 0).length;
    } else if (progressMode === 'dictation') {
      doneStat = project.segments.filter(s => s.dictationAccuracy !== undefined).length;
    } else {
      doneStat = project.segments.filter(s => s.translationAccuracy !== undefined).length;
    }
    const remainStat = totalStat - doneStat;

    const magGridCols = isWide ? (dimensions.width > 1200 ? 3 : 2) : (dimensions.width > 480 ? 2 : 1);
    const cardWidth = `${(100 / magGridCols) - (magGridCols > 1 ? 1.5 : 0)}%`;

    return (
      <View
        key={project.id}
        ref={(r: any) => { if (IS_WEB && r?.classList && !r.classList.contains('mag-grid-card')) r.classList.add('mag-grid-card'); }}
        style={[magStyles.gridCard, { width: cardWidth as any }]}
      >
        <TouchableOpacity
          style={{ flex: 1 }}
          activeOpacity={0.7}
          onPress={() => onOpenProject(project)}
        >
          {/* Progress bar */}
          <View style={magStyles.gridProgressWrap}>
            <View style={magStyles.gridProgressBg}>
              {IS_WEB ? (
                <View style={[magStyles.gridProgressFill, { width: `${pct}%`, background: `linear-gradient(90deg, ${c}, ${c}88)` } as any]} />
              ) : (
                <View style={[magStyles.gridProgressFill, { width: `${pct}%`, backgroundColor: c } as any]} />
              )}
            </View>
            <Text style={[magStyles.gridProgressText, { color: pct > 0 ? c : '#4a4a6a' }]}>{pct}%</Text>
          </View>

          {/* Title */}
          <Text style={magStyles.gridTitle} numberOfLines={2}>{project.title}</Text>

          {/* Meta */}
          <Text style={magStyles.gridMeta}>{fmtDur(project.durationMs)} · {project.segments.length} câu</Text>

          {/* Stats row */}
          <View style={magStyles.gridStatsRow}>
            {remainStat > 0 && (
              <View style={magStyles.gridStatChip}>
                <View style={[magStyles.gridStatDot, { backgroundColor: '#6366f1' }]} />
                <Text style={[magStyles.gridStatText, { color: '#818cf8' }]}>{remainStat}</Text>
              </View>
            )}
            {doneStat > 0 && (
              <View style={magStyles.gridStatChip}>
                <View style={[magStyles.gridStatDot, { backgroundColor: '#10b981' }]} />
                <Text style={[magStyles.gridStatText, { color: '#34d399' }]}>{doneStat}</Text>
              </View>
            )}
          </View>

          {/* Bottom: Delete only (hover reveal) */}
          <View style={magStyles.gridBottom}>
            <View />
            <TouchableOpacity
              ref={(r: any) => { if (IS_WEB && r?.classList && !r.classList.contains('mag-del-btn')) r.classList.add('mag-del-btn'); }}
              style={magStyles.gridDelBtn}
              onPress={(e) => { e?.stopPropagation?.(); handleDelete(project); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {IS_WEB ? (
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              ) : <Text style={{ color: '#555', fontSize: 11 }}>🗑</Text>}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  // Gradient colors for folder thumbnails
  const folderGradients = [
    ['#2d1b69', '#1a1145', '#7c3aed'],
    ['#1b3a69', '#112045', '#3b82f6'],
    ['#1b6945', '#114530', '#10b981'],
    ['#69451b', '#453011', '#f59e0b'],
    ['#691b3a', '#451130', '#ec4899'],
    ['#1b6969', '#114545', '#06b6d4'],
    ['#4a1b69', '#301145', '#a855f7'],
    ['#691b1b', '#451111', '#ef4444'],
  ];

  const renderFolderCard = ({ item, index }: { item: Folder | { id: string; name: string; isVirtual?: boolean }; index: number }) => {
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

    const accentColor = progressMode === 'dictation'
      ? (folderPct >= 100 ? '#10b981' : folderPct > 0 ? '#22c55e' : '#4b5563')
      : progressMode === 'translation'
      ? (folderPct >= 100 ? '#10b981' : folderPct > 0 ? '#0d9488' : '#4b5563')
      : (folderPct >= 100 ? '#10b981' : folderPct > 0 ? '#a78bfa' : '#7c3aed');

    const gradientIdx = (index || 0) % folderGradients.length;
    const [gradStart, gradEnd, gradAccent] = folderGradients[gradientIdx];

    const folderNumColumns = isWide ? (dimensions.width > 1200 ? 5 : dimensions.width > 900 ? 4 : 3) : 2;
    const cardWidth = isWide 
      ? `${(100 / folderNumColumns) - 1.5}%` 
      : `${(100 / 2) - 2}%`;



    return (
      <View
        key={item.id}
        ref={(ref: any) => {
          if (IS_WEB && ref) {
            // Add class directly to DOM
            const el = ref as any;
            if (el.classList && !el.classList.contains('folder-grid-card')) {
              el.classList.add('folder-grid-card');
            }
          }
        }}
        style={[styles.folderCard, { width: cardWidth as any }]}
      >
      <TouchableOpacity
        style={{ flex: 1 }}
        activeOpacity={0.7}
        onPress={() => setActiveFolderId(item.id)}
      >
        {/* Thumbnail */}
        <View style={[styles.folderThumb, IS_WEB ? { background: `linear-gradient(135deg, ${gradStart} 0%, ${gradEnd} 100%)` } as any : { backgroundColor: gradStart }]}>
          {/* Show uploaded thumbnail image if available */}
          {(item as Folder).thumbnailUrl && (
            <Image
              source={{ uri: (item as Folder).thumbnailUrl }}
              style={[StyleSheet.absoluteFillObject, { borderTopLeftRadius: 13, borderTopRightRadius: 13 }]}
              resizeMode="contain"
            />
          )}
          {/* Folder icon + title overlay (only when no thumbnail) */}
          {!(item as Folder).thumbnailUrl && (
          <View style={styles.folderThumbTitleWrap}>
            <Text style={[styles.folderThumbTitle, !isWide && { fontSize: 14 }]} numberOfLines={2}>{item.name}</Text>
          </View>
          )}

          {/* Count badge */}
          <View style={styles.folderThumbBadge}>
            <Text style={styles.folderThumbBadgeText}>{count} bài</Text>
          </View>

          {/* Progress badge */}
          {folderPct > 0 && (
            <View style={[styles.folderThumbProgress, { backgroundColor: accentColor + '30', borderColor: accentColor + '50' }]}>
              <Text style={[styles.folderThumbProgressText, { color: accentColor }]}>{folderPct}%</Text>
            </View>
          )}

          {/* Hover actions - desktop only (no hover on mobile) */}
          {!isVirtual && IS_WEB && isWide && (
            <View
              ref={(ref: any) => {
                if (ref && ref.classList && !ref.classList.contains('folder-actions')) {
                  ref.classList.add('folder-actions');
                }
              }}
              style={styles.folderThumbActions}
            >
              <TouchableOpacity
                style={styles.folderThumbActionBtn}
                onPress={(e) => {
                  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
                  setEditingFolderId(item.id);
                  setNewFolderName(item.name);
                  setFolderThumbnail((item as any).thumbnailUrl || null);
                  setIsCreateModalVisible(true);
                }}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <EditIcon color="#ccc" size={11} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.folderThumbActionBtn}
                onPress={(e) => {
                  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
                  handleDeleteFolder(item as Folder);
                }}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Title & Meta */}
        <View style={[styles.folderCardBody, !isWide && { padding: 8 }]}>
          <Text style={[styles.folderName, !isWide && { fontSize: 12 }]} numberOfLines={1}>{item.name}</Text>
        </View>
      </TouchableOpacity>
      </View>
    );
  };

  const renderEmptyFolder = () => {
    if (searchQuery.trim()) {
      return (
        <View style={styles.emptyWrap}>
          {IS_WEB ? (
            <View style={{ marginBottom: 12 }}>
              <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="#4a4a6a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </View>
          ) : <Text style={styles.emptyIcon}>🔍</Text>}
          <Text style={styles.emptyTitle}>Không tìm thấy kết quả</Text>
          <Text style={styles.emptySub}>
            Không có bài học nào khớp với "{searchQuery.trim()}"
          </Text>
          <TouchableOpacity 
            style={styles.emptyBtn} 
            onPress={() => setSearchQuery('')}
          >
            <Text style={styles.emptyBtnText}>✕  Xóa tìm kiếm</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
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
  };

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

  const filteredProjects = projects.filter(p => {
    const inFolder = activeFolderId === 'uncategorized' ? !p.folderId : p.folderId === activeFolderId;
    if (!inFolder) return false;
    if (searchQuery.trim()) {
      return p.title.toLowerCase().includes(searchQuery.trim().toLowerCase());
    }
    return true;
  });

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
            <TouchableOpacity style={styles.backBtn} onPress={() => { setSearchQuery(''); setActiveFolderId(null); }}>
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
                        setFolderThumbnail(folder.thumbnailUrl || null);
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

      {/* Summary Stats + Search + Progress Mode Toggle — single row */}
      {activeFolderId !== null && (
        <View style={[styles.summaryBar, isWide && { paddingHorizontal: 40 }]}>
          {/* Search Bar (left) */}
          <View style={magStyles.searchBar}>
            {IS_WEB ? (
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#5a5a7a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 } as any}>
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            ) : null}
            <TextInput
              style={magStyles.searchInput}
              placeholder="Tìm bài học..."
              placeholderTextColor="#4a4a6a"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={{ padding: 4 }}>
                {IS_WEB ? (
                  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#5a5a7a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                ) : <Text style={{ color: '#5a5a7a', fontSize: 14 }}>✕</Text>}
              </TouchableOpacity>
            )}
          </View>

          {/* Stats + Toggle (right) */}
          {totalProjects > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={styles.toggleBar}>
                <TouchableOpacity
                  style={[styles.togglePill, progressMode === 'listening' && styles.togglePillActive]}
                  onPress={() => setProgressMode('listening')}
                  activeOpacity={0.7}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    {IS_WEB ? (
                      <svg width={14} height={14} viewBox="0 0 24 24" fill={progressMode === 'listening' ? '#c4b5fd' : '#555'} style={{ display: 'block' } as any}>
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke={progressMode === 'listening' ? '#c4b5fd' : '#555'} strokeWidth="2" strokeLinecap="round" />
                        <line x1="12" y1="19" x2="12" y2="23" stroke={progressMode === 'listening' ? '#c4b5fd' : '#555'} strokeWidth="2" strokeLinecap="round" />
                        <line x1="8" y1="23" x2="16" y2="23" stroke={progressMode === 'listening' ? '#c4b5fd' : '#555'} strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    ) : null}
                    <Text style={[styles.toggleText, progressMode === 'listening' && styles.toggleTextActive]}>Nghe</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.togglePill, progressMode === 'dictation' && styles.togglePillActiveDictation]}
                  onPress={() => setProgressMode('dictation')}
                  activeOpacity={0.7}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    {IS_WEB ? (
                      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={progressMode === 'dictation' ? '#34d399' : '#555'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                        <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                      </svg>
                    ) : null}
                    <Text style={[styles.toggleText, progressMode === 'dictation' && styles.toggleTextActiveDictation]}>Chính tả</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.togglePill, progressMode === 'translation' && styles.togglePillActiveTranslation]}
                  onPress={() => setProgressMode('translation')}
                  activeOpacity={0.7}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    {IS_WEB ? (
                      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={progressMode === 'translation' ? '#2dd4bf' : '#555'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                        <path d="M5 8l6 6" />
                        <path d="M4 14l6-6 2-3" />
                        <path d="M2 5h12" />
                        <path d="M7 2h1" />
                        <path d="M22 22l-5-10-5 10" />
                        <path d="M14 18h6" />
                      </svg>
                    ) : null}
                    <Text style={[styles.toggleText, progressMode === 'translation' && styles.toggleTextActiveTranslation]}>Dịch câu</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          )}
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
      {activeFolderId !== null ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={
            filteredProjects.length === 0
              ? styles.emptyContainer
              : [styles.listContent, isWide && styles.listContentWide]
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#a855f7" colors={['#a855f7']} />
          }
        >
          {filteredProjects.length === 0 ? renderEmptyFolder() : (
            <>
              {/* ── MAGAZINE TOP: Featured + Stats ── */}
              {filteredProjects.length > 0 && (
                <View style={[magStyles.magTopRow, !isWide && { flexDirection: 'column' }]}>
                  {/* Featured card */}
                  <View style={[magStyles.magFeaturedWrap, !isWide && { width: '100%' }]}>
                    {renderFeaturedCard(filteredProjects[0])}
                  </View>
                  {/* Stats panel */}
                  <View style={[magStyles.magStatsWrap, !isWide && { width: '100%' }]}>
                    {renderStatsPanel(filteredProjects)}
                  </View>
                </View>
              )}

              {/* ── MAGAZINE GRID: Remaining cards ── */}
              {filteredProjects.length > 1 && (
                <>
                  <View style={magStyles.magGridHeader}>
                    <View style={magStyles.magGridHeaderLine} />
                    <Text style={magStyles.magGridHeaderText}>Tất cả bài học</Text>
                    <View style={magStyles.magGridHeaderLine} />
                  </View>
                  <View style={magStyles.magGrid}>
                    {filteredProjects.slice(1).map(p => renderMagGridCard(p))}
                  </View>
                </>
              )}
            </>
          )}
        </ScrollView>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={
            folderListData.length === 0
              ? styles.emptyContainer
              : [styles.listContent, isWide && styles.listContentWide]
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#a855f7" colors={['#a855f7']} />
          }
        >
          {folderListData.length === 0 ? renderEmptyFolders() : (
            <View style={styles.folderGrid}>
              {folderListData.map((item, index) => renderFolderCard({ item, index } as any))}
            </View>
          )}
        </ScrollView>
      )}

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
              {editingFolderId ? '📁 Chỉnh Sửa Thư Mục' : '📁 Tạo Thư Mục Mới'}
            </Text>

            {/* Thumbnail Picker */}
            <Text style={styles.thumbPickerLabel}>Ảnh bìa</Text>
            <TouchableOpacity
              style={styles.thumbPickerContainer}
              onPress={pickFolderThumbnail}
              activeOpacity={0.7}
            >
              {folderThumbnail ? (
                <View style={styles.thumbPreviewWrap}>
                  <Image
                    source={{ uri: folderThumbnail }}
                    style={styles.thumbPreview}
                    resizeMode="contain"
                  />
                  <TouchableOpacity
                    style={styles.thumbRemoveBtn}
                    onPress={(e) => {
                      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
                      setFolderThumbnail(null);
                    }}
                  >
                    <Text style={styles.thumbRemoveText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.thumbPlaceholder}>
                  {IS_WEB ? (
                    <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="#5a5a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  ) : (
                    <Text style={{ fontSize: 24 }}>🖼</Text>
                  )}
                  <Text style={styles.thumbPlaceholderText}>Chọn ảnh bìa</Text>
                  <Text style={styles.thumbPlaceholderSub}>JPG, PNG — tối đa 500KB</Text>
                </View>
              )}
            </TouchableOpacity>

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
                  {isSubmittingFolder ? 'Đang lưu...' : (editingFolderId ? 'Lưu' : 'Tạo')}
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

      {/* Custom Confirm Dialog */}
      <Modal
        visible={!!confirmDialog}
        transparent
        animationType={isWide ? 'fade' : 'slide'}
        onRequestClose={() => setConfirmDialog(null)}
      >
        <View style={[styles.modalOverlay, !isWide && styles.confirmOverlayMobile]}>
          <TouchableOpacity style={styles.modalDismiss} onPress={() => setConfirmDialog(null)} />
          <View style={[styles.confirmSheet, !isWide && styles.confirmSheetMobile]}>
            {/* Warning icon */}
            <View style={styles.confirmIconWrap}>
              {IS_WEB ? (
                <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' } as any}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              ) : (
                <Text style={{ fontSize: 28 }}>⚠️</Text>
              )}
            </View>
            <Text style={styles.confirmTitle}>{confirmDialog?.title}</Text>
            <Text style={styles.confirmMessage}>{confirmDialog?.message}</Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={styles.confirmCancelBtn}
                onPress={() => setConfirmDialog(null)}
              >
                <Text style={styles.confirmCancelText}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmDeleteBtn, confirmDialog?.confirmColor ? { backgroundColor: confirmDialog.confirmColor } : {}]}
                onPress={confirmDialog?.onConfirm}
              >
                <Text style={styles.confirmDeleteText}>{confirmDialog?.confirmText || 'Xác nhận'}</Text>
              </TouchableOpacity>
            </View>
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
    justifyContent: 'space-between',
    gap: 14,
    paddingHorizontal: 24,
    paddingBottom: 10,
    flexWrap: 'wrap',
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
  folderGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 4,
  },
  folderCard: {
    backgroundColor: '#0c0c18',
    borderWidth: 1,
    borderColor: '#16162a',
    borderRadius: 14,
    overflow: 'hidden',
    ...(IS_WEB ? {
      cursor: 'pointer',
      transition: 'all 0.2s ease, transform 0.15s ease',
    } as any : {}),
  },
  folderThumb: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderTopLeftRadius: 13,
    borderTopRightRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  folderThumbIconWrap: {
    position: 'absolute',
    right: 12,
    bottom: 10,
    opacity: 0.6,
  },
  folderThumbTitleWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  folderThumbTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  folderThumbBadge: {
    position: 'absolute',
    left: 10,
    bottom: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    ...(IS_WEB ? { backdropFilter: 'blur(6px)' } as any : {}),
  },
  folderThumbBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#e0e0f0',
  },
  folderThumbProgress: {
    position: 'absolute',
    left: 10,
    top: 8,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  folderThumbProgressText: {
    fontSize: 11,
    fontWeight: '800',
  },
  folderThumbActions: {
    position: 'absolute',
    right: 6,
    top: 6,
    flexDirection: 'row',
    gap: 4,
    opacity: 0,
    ...(IS_WEB ? { transition: 'opacity 0.2s ease' } as any : {}),
  },
  folderThumbActionBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    ...(IS_WEB ? { cursor: 'pointer', backdropFilter: 'blur(4px)' } as any : {}),
  },
  folderCardBody: {
    padding: 12,
    paddingTop: 10,
    gap: 3,
  },
  folderName: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#e8e8f0',
    letterSpacing: -0.2,
    lineHeight: 18,
  },
  folderCount: {
    fontSize: 11.5,
    color: '#5a5a7a',
    fontWeight: '500',
  },
  headerEditFolderBtn: {
    padding: 4,
    opacity: 0.6,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    ...(IS_WEB ? { backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' } as any : {}),
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

  // Thumbnail picker styles
  thumbPickerLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8b8ba8',
    marginBottom: 8,
    marginTop: 4,
  },
  thumbPickerContainer: {
    marginBottom: 16,
    borderRadius: 12,
    overflow: 'hidden',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  thumbPreviewWrap: {
    position: 'relative',
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
    overflow: 'hidden',
  },
  thumbPreview: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  thumbRemoveBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    ...(IS_WEB ? { cursor: 'pointer', backdropFilter: 'blur(4px)' } as any : {}),
  },
  thumbRemoveText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  thumbPlaceholder: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#2a2a44',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,20,32,0.5)',
    gap: 6,
  },
  thumbPlaceholderText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
    marginTop: 4,
  },
  thumbPlaceholderSub: {
    fontSize: 11,
    color: '#4a4a6a',
  },

  // Confirm dialog styles
  confirmOverlayMobile: {
    justifyContent: 'flex-end',
  },
  confirmSheet: {
    backgroundColor: '#1a1a2e',
    borderRadius: 20,
    padding: 28,
    width: '90%',
    maxWidth: 420,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    ...(IS_WEB ? { boxShadow: '0 16px 48px rgba(0,0,0,0.5)' } as any : {}),
  },
  confirmSheetMobile: {
    width: '100%',
    maxWidth: '100%',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 36,
  },
  confirmIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f0f0f0',
    marginBottom: 10,
    textAlign: 'center',
  },
  confirmMessage: {
    fontSize: 14,
    color: '#8b8ba8',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  confirmCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  confirmCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#a0a0b8',
  },
  confirmDeleteBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#ef4444',
    alignItems: 'center',
  },
  confirmDeleteText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});

// ─── MAGAZINE LAYOUT STYLES ───
const magStyles = StyleSheet.create({
  // Top row: Featured + Stats side by side
  magTopRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 24,
  },
  magFeaturedWrap: {
    flex: 3,
    minWidth: 0,
  },
  magStatsWrap: {
    flex: 2,
    minWidth: 0,
  },

  // Featured Card
  featuredCard: {
    backgroundColor: '#0e0e1e',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1e1e38',
    padding: 20,
    gap: 16,
    height: '100%',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  featuredLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  featuredLabelDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  featuredLabelText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  featuredContent: {
    flexDirection: 'row',
    gap: 18,
    alignItems: 'center',
  },
  featuredTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.3,
    lineHeight: 26,
  },
  featuredMeta: {
    fontSize: 12,
    color: '#5a5a7a',
    fontWeight: '600',
  },
  featuredBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  featuredCta: {
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 12,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },

  // Stats Panel
  statsPanel: {
    backgroundColor: '#0e0e1e',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1e1e38',
    padding: 16,
    gap: 12,
    height: '100%',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  statsPanelTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#e0e0f0',
  },
  statsProgressWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statsProgressBg: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#1a1a2e',
    overflow: 'hidden',
  },
  statsProgressFill: {
    height: '100%',
    borderRadius: 4,
    ...(IS_WEB ? { transition: 'width 0.5s ease' } as any : {}),
  },
  statsProgressLabel: {
    fontSize: 14,
    fontWeight: '800',
    minWidth: 36,
    textAlign: 'right',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  statsGridItem: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#12122a',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1a1a30',
  },
  statsGridValue: {
    fontSize: 17,
    fontWeight: '800',
    color: '#e0e0f0',
    letterSpacing: -0.5,
  },
  statsGridLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#4a4a6a',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statsAccuracyWrap: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#12122a',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#1a1a30',
  },
  statsAccuracyLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8b8ba8',
  },
  statsAccuracyValue: {
    fontSize: 18,
    fontWeight: '800',
  },

  // Grid Header
  magGridHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
    marginTop: 8,
  },
  magGridHeaderLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#1a1a2e',
  },
  magGridHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4a4a6a',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // Grid container
  magGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },

  // Grid Card
  gridCard: {
    backgroundColor: '#0c0c18',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#16162a',
    overflow: 'hidden',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  gridProgressWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 2,
    gap: 8,
  },
  gridProgressBg: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#1a1a2e',
    overflow: 'hidden',
  },
  gridProgressFill: {
    height: '100%',
    borderRadius: 3,
    ...(IS_WEB ? { transition: 'width 0.4s ease' } as any : {}),
  },
  gridProgressText: {
    fontSize: 11,
    fontWeight: '800',
    minWidth: 28,
    textAlign: 'right',
  },
  gridTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#e8e8f0',
    letterSpacing: -0.2,
    lineHeight: 19,
    paddingHorizontal: 14,
    paddingTop: 4,
  },
  gridMeta: {
    fontSize: 11,
    color: '#4a4a6a',
    fontWeight: '600',
    paddingHorizontal: 14,
    marginTop: 2,
  },
  gridStatsRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 14,
    marginTop: 4,
  },
  gridStatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  gridStatDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  gridStatText: {
    fontSize: 11,
    fontWeight: '700',
  },
  gridBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 2,
  },
  gridCta: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  gridDelBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },

  // Search Bar
  searchWrap: {
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0c0c18',
    borderWidth: 1,
    borderColor: '#1e1e30',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 2,
    gap: 10,
    ...(IS_WEB ? { backdropFilter: 'blur(8px)' } as any : {}),
  },
  searchInput: {
    flex: 1,
    color: '#e0e0f0',
    fontSize: 13,
    fontWeight: '500',
    paddingVertical: 8,
    ...(IS_WEB ? { outlineStyle: 'none' } as any : {}),
  },
});
