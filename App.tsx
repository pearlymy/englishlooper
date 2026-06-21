import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StyleSheet, View, ActivityIndicator, Text, Platform, TouchableOpacity, PanResponder, BackHandler, TextInput, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';

// Polyfill Alert.alert for Web because default Alert.alert in react-native-web is a no-op stub
if (Platform.OS === 'web') {
  Alert.alert = (title: string, message?: string, buttons?: any[]) => {
    const formattedMessage = message ? `\n\n${message}` : '';
    const fullText = `${title}${formattedMessage}`;

    if (buttons && buttons.length > 0) {
      const cancelButton = buttons.find(b => b.style === 'cancel');
      const otherButton = buttons.find(b => b.style !== 'cancel') || buttons[0];

      if (buttons.length === 1) {
        window.alert(fullText);
        buttons[0].onPress?.();
      } else {
        const confirmed = window.confirm(fullText);
        if (confirmed) {
          otherButton.onPress?.();
        } else {
          cancelButton?.onPress?.();
        }
      }
    } else {
      window.alert(fullText);
    }
  };
}
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { Audio } from 'expo-av';

import { auth } from './src/services/firebaseConfig';
import { StorageService } from './src/services/storageService';
import { FirebaseSyncService } from './src/services/firebaseSyncService';
import { DBService } from './src/services/dbService';
import * as FileSystem from 'expo-file-system/legacy';
import { Project, Segment, ScreenName } from './src/types';

import HomeScreen from './src/screens/HomeScreen';
import ImportScreen, { ReviewPendingData } from './src/screens/ImportScreen';
import ReviewScreen from './src/screens/ReviewScreen';
import PlayerScreen from './src/screens/PlayerScreen';

export default function App() {
  // Parse URL synchronously to avoid dashboard flash
  const initialUrl = Platform.OS === 'web' ? (() => {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('project');
    const folderMatch = path.match(/^\/folder\/(.+)/);
    const folderId = folderMatch ? folderMatch[1].split('?')[0] : null;
    return { projectId, folderId };
  })() : { projectId: null, folderId: null };

  const [screen, setScreen] = useState<ScreenName>(initialUrl.projectId ? 'player' : 'home');
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [activeFolderId, setActiveFolderIdRaw] = useState<string | null>(initialUrl.folderId);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [authError, setAuthError] = useState('');
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authMethod, setAuthMethod] = useState<'options' | 'email'>('options');
  const [isRegistering, setIsRegistering] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [isGuestMode, setIsGuestMode] = useState(false);
  const [reviewPendingData, setReviewPendingData] = useState<ReviewPendingData | null>(null);
  const pendingProjectId = useRef<string | null>(initialUrl.projectId);

  const handleGoogleSignIn = async () => {
    try {
      setIsSigningIn(true);
      setAuthError('');
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
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
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleEmailSignIn = async () => {
    const email = emailInput.trim();
    const password = passwordInput.trim();
    if (!email || !password) {
      setAuthError('Vui lòng điền đầy đủ email và mật khẩu.');
      return;
    }
    try {
      setIsSigningIn(true);
      setAuthError('');
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      console.error(err);
      let friendlyMsg = 'Lỗi đăng nhập.';
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        friendlyMsg = 'Email hoặc mật khẩu không chính xác.';
      } else if (err.code === 'auth/invalid-email') {
        friendlyMsg = 'Địa chỉ email không hợp lệ.';
      } else if (err.message) {
        friendlyMsg = err.message;
      }
      setAuthError(friendlyMsg);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleEmailSignUp = async () => {
    const email = emailInput.trim();
    const password = passwordInput.trim();
    if (!email || !password) {
      setAuthError('Vui lòng điền đầy đủ email và mật khẩu.');
      return;
    }
    if (password.length < 6) {
      setAuthError('Mật khẩu phải có ít nhất 6 ký tự.');
      return;
    }
    try {
      setIsSigningIn(true);
      setAuthError('');
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      console.error(err);
      let friendlyMsg = 'Lỗi đăng ký tài khoản.';
      if (err.code === 'auth/email-already-in-use') {
        friendlyMsg = 'Email này đã được sử dụng bởi một tài khoản khác.';
      } else if (err.code === 'auth/invalid-email') {
        friendlyMsg = 'Địa chỉ email không hợp lệ.';
      } else if (err.message) {
        friendlyMsg = err.message;
      }
      setAuthError(friendlyMsg);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleGuestSignIn = () => {
    setIsGuestMode(true);
    const guestUser: Partial<User> = {
      uid: 'guest_dev_user',
      displayName: 'Offline Tester',
      email: 'guest@mp3looper.dev',
      emailVerified: true,
      isAnonymous: true,
      metadata: {},
      providerData: [],
      getIdToken: async () => 'mock-token',
      getIdTokenResult: async () => ({} as any),
      reload: async () => {},
      toJSON: () => ({}),
    };
    setCurrentUser(guestUser as User);
  };

  const handleSignOut = useCallback(async () => {
    if (isGuestMode) {
      setIsGuestMode(false);
      setCurrentUser(null);
    } else {
      await auth.signOut();
    }
  }, [isGuestMode]);

  // Inject Premium Google Sans/Plus Jakarta Sans equivalent on Web dynamically
  useEffect(() => {
    if (Platform.OS === 'web') {
      try {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap';
        document.head.appendChild(link);

        const style = document.createElement('style');
        style.type = 'text/css';
        style.appendChild(document.createTextNode(`
          * {
            font-family: 'Google Sans', 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
          }
        `));
        document.head.appendChild(style);
      } catch (err) {
        console.warn('Failed to load Google Sans font equivalent:', err);
      }
    }
  }, []);

  // Configure global audio settings on native devices early
  useEffect(() => {
    if (Platform.OS !== 'web') {
      try {
        Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          playThroughEarpieceAndroid: false,    // Ensure audio routes to speaker, not earpiece receiver
        }).catch((err: any) => console.warn('[App] Audio mode configuration error:', err));
      } catch (e) {
        console.warn('[App] Failed to configure audio session:', e);
      }
    }
  }, []);

  // Load all projects from storage
  const loadProjects = useCallback(async () => {
    try {
      const data = await StorageService.loadProjects();
      setProjects(data);
      return data;
    } catch (err) {
      console.warn('Failed to load projects:', err);
      return [];
    }
  }, []);

  // Sync logic when user logs in
  const syncAndRefresh = useCallback(async (user: User) => {
    try {
      console.log(`[App] Syncing down data for user: ${user.email}`);
      await FirebaseSyncService.syncDownAll();
      const allProjects = await loadProjects();

      // Check query parameter on startup
      if (Platform.OS === 'web') {
        const params = new URLSearchParams(window.location.search);
        const projectId = params.get('project');
        if (projectId) {
          let match = allProjects.find(p => p.id === projectId);
          if (!match) {
            const cloudProj = await FirebaseSyncService.getProjectFromFirestore(projectId);
            if (cloudProj) {
              await StorageService.saveProject(cloudProj);
              match = cloudProj;
            }
          }
          if (match) {
            setCurrentProject(match);
            setScreen('player');
          }
        }
      }
    } catch (err) {
      console.warn('[App] Sync down failed:', err);
    }
  }, [loadProjects]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (isGuestMode) {
        setIsInitializing(false);
        return;
      }
      setCurrentUser(user);
      if (user) {
        // Run background sync on login
        syncAndRefresh(user);
      }
      setIsInitializing(false);
    });

    return () => unsubscribe();
  }, [syncAndRefresh, isGuestMode]);

  // Load local projects initially
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Wrap setActiveFolderId to also push URL on web
  const setActiveFolderId = useCallback((id: string | null) => {
    setActiveFolderIdRaw(id);
    if (Platform.OS === 'web') {
      if (id !== null) {
        window.history.pushState({ folder: id }, '', `/folder/${id}`);
      } else {
        window.history.pushState(null, '', '/');
      }
    }
  }, []);

  // Listen to browser Back/Forward navigation on Web
  useEffect(() => {
    if (Platform.OS === 'web') {
      const handlePopState = () => {
        const path = window.location.pathname;
        const params = new URLSearchParams(window.location.search);
        const projectId = params.get('project');

        if (projectId) {
          const match = projects.find(p => p.id === projectId);
          if (match) {
            setCurrentProject(match);
            setScreen('player');
          } else {
            setScreen('home');
            setCurrentProject(null);
            setActiveFolderIdRaw(null);
          }
        } else if (path.startsWith('/folder/')) {
          const folderId = path.replace('/folder/', '');
          setScreen('home');
          setCurrentProject(null);
          setActiveFolderIdRaw(folderId || null);
        } else {
          setScreen('home');
          setCurrentProject(null);
          setActiveFolderIdRaw(null);
        }
      };

      window.addEventListener('popstate', handlePopState);
      return () => window.removeEventListener('popstate', handlePopState);
    }
  }, [projects]);

  // Resolve pending project from URL once projects are loaded
  useEffect(() => {
    if (pendingProjectId.current && projects.length > 0) {
      const match = projects.find(p => p.id === pendingProjectId.current);
      if (match) {
        setCurrentProject(match);
        setScreen('player');
      } else {
        // Project not found, fall back to folder or home
        setScreen('home');
      }
      pendingProjectId.current = null;
    }
  }, [projects]);

  const handleRefresh = useCallback(async () => {
    await loadProjects();
  }, [loadProjects]);

  const handleOpenProject = useCallback((project: Project) => {
    setCurrentProject(project);
    setScreen('player');
    if (Platform.OS === 'web') {
      window.history.pushState(null, '', `?project=${project.id}`);
    }
  }, []);

  const handleNewProject = useCallback((folderId?: string) => {
    setScreen('import');
  }, []);

  // Import → Review: receive unsaved data from ImportScreen
  const handleReview = useCallback((data: ReviewPendingData) => {
    setReviewPendingData(data);
    setScreen('review');
  }, []);

  // Review → Re-run AI: go back to ImportScreen to re-process
  const handleRerunAI = useCallback(() => {
    setReviewPendingData(null);
    setScreen('import');
  }, []);

  // Review → Confirm: save project & go to player
  const handleReviewConfirm = useCallback(async (finalSegments: Segment[]) => {
    if (!reviewPendingData) return;
    try {
      // Check if we're editing an existing project (came from PlayerScreen)
      const isExistingProject = currentProject && currentProject.audioUri === reviewPendingData.audioUri;

      if (isExistingProject) {
        // Update existing project with new segments
        const updatedProject: Project = {
          ...currentProject,
          segments: finalSegments,
          lastOpenedAt: Date.now(),
        };

        await StorageService.saveProject(updatedProject);
        FirebaseSyncService.uploadProject(updatedProject)
          .catch(err => console.warn('Background sync failed:', err));

        setReviewPendingData(null);
        setCurrentProject(updatedProject);
        setScreen('player');
      } else {
        // New project from ImportScreen — copy audio & create new entry
        const projectId = `proj_${Date.now()}`;
        let finalAudioUri = reviewPendingData.audioUri;

        if (Platform.OS === 'web') {
          const response = await fetch(reviewPendingData.audioUri);
          const blob = await response.blob();
          await DBService.saveAudio(projectId, blob);
          finalAudioUri = `db:${projectId}`;
        } else {
          const dest = `${FileSystem.documentDirectory}${projectId}.mp3`;
          await FileSystem.copyAsync({ from: reviewPendingData.audioUri, to: dest });
          finalAudioUri = dest;
        }

        const newProject: Project = {
          id: projectId,
          title: reviewPendingData.title,
          audioUri: finalAudioUri,
          durationMs: reviewPendingData.durationMs,
          segments: finalSegments,
          transcriptText: reviewPendingData.transcriptText,
          createdAt: Date.now(),
          lastOpenedAt: Date.now(),
          folderId: reviewPendingData.folderId,
        };

        await StorageService.saveProject(newProject);
        // Upload project metadata to Firestore
        FirebaseSyncService.uploadProject(newProject)
          .catch(err => console.warn('Background sync failed:', err));
        // Force-upload audio file to Firebase Storage (ensures cross-device sync)
        FirebaseSyncService.uploadAudioFile(projectId, finalAudioUri, true)
          .catch(err => console.warn('Background audio upload failed:', err));

        setReviewPendingData(null);
        setCurrentProject(newProject);
        setScreen('player');
        if (Platform.OS === 'web') {
          window.history.pushState(null, '', `?project=${newProject.id}`);
        }
      }
      loadProjects().catch(() => {});
    } catch (err) {
      console.error('[App] Save from review failed:', err);
    }
  }, [reviewPendingData, currentProject, loadProjects]);

  // Player → Review: open ReviewScreen with current segments for advanced editing
  const handleOpenReviewFromPlayer = useCallback((playerSegments: Segment[], proj: Project) => {
    setReviewPendingData({
      title: proj.title,
      audioUri: proj.audioUri,
      durationMs: proj.durationMs,
      segments: playerSegments,
      transcriptText: proj.transcriptText,
      folderId: proj.folderId,
      useAI: false,
      apiKey: '',
    });
    setScreen('review');
  }, []);

  const handleProjectCreated = useCallback(async (newProject: Project) => {
    // 1. Instantly transition UI screen to player
    setCurrentProject(newProject);
    setScreen('player');
    if (Platform.OS === 'web') {
      window.history.pushState(null, '', `?project=${newProject.id}`);
    }
    
    // 2. Refresh the projects list in background (non-blocking)
    loadProjects().catch(err => console.warn('Background project reload failed:', err));
  }, [loadProjects]);

  const handleBackToHome = useCallback(async () => {
    // 1. Instantly transition UI screen back to home dashboard
    setCurrentProject(null);
    setScreen('home');
    if (Platform.OS === 'web') {
      // Go back to folder view if there's an active folder, else root
      if (activeFolderId !== null) {
        window.history.pushState({ folder: activeFolderId }, '', `/folder/${activeFolderId}`);
      } else {
        window.history.pushState(null, '', '/');
      }
    }
    
    // 2. Reload projects in background (non-blocking)
    loadProjects().catch(err => console.warn('Background project reload failed:', err));
  }, [loadProjects, activeFolderId]);

  const handleBack = useCallback(() => {
    if (screen === 'review') {
      setReviewPendingData(null);
      if (currentProject) {
        // Came from PlayerScreen → go back to player
        setScreen('player');
      } else {
        // Came from ImportScreen → go back to import
        setScreen('import');
      }
    } else if (screen === 'player' || screen === 'import') {
      handleBackToHome();
    } else if (screen === 'home' && activeFolderId !== null) {
      setActiveFolderIdRaw(null);
      if (Platform.OS === 'web') {
        window.history.pushState(null, '', '/');
      }
    }
  }, [screen, activeFolderId, handleBackToHome]);

  // Handle hardware Back button on Android
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const onBackPress = () => {
      const canGoBack = screen !== 'home' || activeFolderId !== null;
      if (canGoBack) {
        handleBack();
        return true; // Prevents default behavior (exiting app)
      }
      return false; // Uses default behavior
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [screen, activeFolderId, handleBack]);

  // Keep a ref to handleBack so the web touch listener always has the latest
  const handleBackRef = useRef(handleBack);
  useEffect(() => { handleBackRef.current = handleBack; }, [handleBack]);
  const canGoBackRef = useRef(false);
  useEffect(() => { canGoBackRef.current = screen !== 'home' || activeFolderId !== null; }, [screen, activeFolderId]);

  // Web: swipe-from-left-edge to go back (touch events for mobile Safari/Chrome)
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    let startX = 0;
    let startY = 0;
    let swiping = false;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch.clientX < 35 && canGoBackRef.current) {
        startX = touch.clientX;
        startY = touch.clientY;
        swiping = true;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!swiping) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startX;
      const dy = Math.abs(touch.clientY - startY);
      // If moving too much vertically, cancel
      if (dy > 40) {
        swiping = false;
      }
      // Prevent default scroll when swiping horizontally from edge
      if (dx > 10 && dy < 30) {
        e.preventDefault();
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!swiping) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = Math.abs(touch.clientY - startY);
      swiping = false;
      if (dx > 80 && dy < 80) {
        handleBackRef.current();
      }
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  // PanResponder to capture left-to-right swipe-to-go-back gesture on mobile
  const panResponder = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        const canGoBack = screen !== 'home' || activeFolderId !== null;
        if (!canGoBack) return false;
        return gestureState.x0 < 50 && gestureState.dx > 20 && Math.abs(gestureState.dy) < 20;
      },
      onMoveShouldSetPanResponderCapture: (evt, gestureState) => {
        const canGoBack = screen !== 'home' || activeFolderId !== null;
        if (!canGoBack) return false;
        return gestureState.x0 < 50 && gestureState.dx > 20 && Math.abs(gestureState.dy) < 20;
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dx > 80 && Math.abs(gestureState.dy) < 80) {
          handleBack();
        }
      },
      onPanResponderTerminate: () => {},
    })
  ).current;

  if (isInitializing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#a855f7" />
        <Text style={styles.loadingText}>Đang khởi động...</Text>
      </View>
    );
  }


  if (!currentUser) {
    return (
      <View style={styles.loginContainer}>
        <StatusBar style="light" />
        <View style={styles.loginCard}>
          <View style={{ alignItems: 'center', marginBottom: 28, width: '100%' }}>
            <View style={styles.logoBadge}>
              <Text style={styles.logoBadgeText}>🎧 POUX LOOPER</Text>
            </View>
            <Text style={styles.loginTitle}>English Shadowing</Text>
            <Text style={styles.loginSubtitle}>
              {authMethod === 'email' 
                ? (isRegistering ? 'Đăng ký tài khoản mới để bắt đầu' : 'Đăng nhập để đồng bộ tiến trình học tập')
                : 'Vui lòng đăng nhập để đồng bộ tiến trình học tập và kết nối thiết bị của bạn.'
              }
            </Text>
          </View>

          {authError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{authError}</Text>
            </View>
          ) : null}

          {authMethod === 'options' ? (
            <View style={{ gap: 12, width: '100%' }}>
              {/* Google Button */}
              <TouchableOpacity 
                style={[styles.googleButton, isSigningIn && { opacity: 0.7 }]} 
                onPress={() => {
                  if (Platform.OS !== 'web') {
                    setAuthError('Đăng nhập Google trực tiếp trên App chưa hỗ trợ. Vui lòng dùng Đăng nhập Email bên dưới hoặc Dùng thử Offline.');
                    return;
                  }
                  handleGoogleSignIn();
                }}
                disabled={isSigningIn}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                  <View style={{ width: 20, height: 20 }}>
                    {Platform.OS === 'web' ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" style={{ display: 'block' } as any}>
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
                      </svg>
                    ) : (
                      <Text style={{ fontSize: 16, color: '#fff' }}>👤</Text>
                    )}
                  </View>
                  <Text style={styles.googleButtonText}>Đăng nhập bằng Google</Text>
                </View>
              </TouchableOpacity>

              {/* Email Login Button */}
              <TouchableOpacity 
                style={styles.emailButton} 
                onPress={() => {
                  setAuthMethod('email');
                  setAuthError('');
                }}
              >
                <Text style={styles.emailButtonText}>✉️ Đăng nhập bằng Email</Text>
              </TouchableOpacity>

              {/* Guest / Test Offline Button */}
              <TouchableOpacity 
                style={styles.guestButton} 
                onPress={handleGuestSignIn}
              >
                <Text style={styles.guestButtonText}>⚡ Dùng thử Ngoại tuyến (Offline)</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ gap: 14, width: '100%' }}>
              {/* Email Input */}
              <View style={{ width: '100%' }}>
                <Text style={styles.inputLabel}>Email</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="name@domain.com"
                  placeholderTextColor="#555"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={emailInput}
                  onChangeText={setEmailInput}
                />
              </View>

              {/* Password Input */}
              <View style={{ width: '100%' }}>
                <Text style={styles.inputLabel}>Mật khẩu</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="Tối thiểu 6 ký tự"
                  placeholderTextColor="#555"
                  secureTextEntry
                  value={passwordInput}
                  onChangeText={setPasswordInput}
                />
              </View>

              {/* Action Button */}
              <TouchableOpacity 
                style={styles.submitButton}
                onPress={isRegistering ? handleEmailSignUp : handleEmailSignIn}
                disabled={isSigningIn}
              >
                {isSigningIn ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.submitButtonText}>
                    {isRegistering ? 'Tạo tài khoản' : 'Đăng nhập'}
                  </Text>
                )}
              </TouchableOpacity>

              {/* Toggle Signin/Signup */}
              <TouchableOpacity 
                onPress={() => {
                  setIsRegistering(!isRegistering);
                  setAuthError('');
                }}
              >
                <Text style={styles.toggleRegisterText}>
                  {isRegistering ? 'Đã có tài khoản? Đăng nhập ngay' : 'Chưa có tài khoản? Đăng ký ngay'}
                </Text>
              </TouchableOpacity>

              {/* Back Link */}
              <TouchableOpacity 
                onPress={() => {
                  setAuthMethod('options');
                  setAuthError('');
                }}
                style={{ marginTop: 6 }}
              >
                <Text style={styles.backButtonText}>← Quay lại lựa chọn khác</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <View 
      style={styles.container}
      {...(Platform.OS !== 'web' ? panResponder.panHandlers : {})}
    >
      <StatusBar style="light" />
      {screen === 'home' && (
        <HomeScreen
          projects={projects}
          onRefresh={handleRefresh}
          onOpenProject={handleOpenProject}
          onNewProject={handleNewProject}
          activeFolderId={activeFolderId}
          setActiveFolderId={setActiveFolderId}
          currentUser={currentUser}
          onSignOut={handleSignOut}
        />
      )}
      {screen === 'import' && (
        <ImportScreen
          preselectedFolderId={activeFolderId || undefined}
          onProjectCreated={handleProjectCreated}
          onReview={handleReview}
          onBack={handleBackToHome}
        />
      )}
      {screen === 'review' && reviewPendingData && (
        <ReviewScreen
          pendingData={reviewPendingData}
          onConfirm={handleReviewConfirm}
          onRerunAI={handleRerunAI}
          onBack={handleBack}
        />
      )}
      {screen === 'player' && currentProject && (
        <PlayerScreen
          project={currentProject}
          onBack={handleBackToHome}
          onOpenReview={handleOpenReviewFromPlayer}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#08080d',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#08080d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#a78bfa',
    fontSize: 15,
    marginTop: 16,
    fontWeight: '600',
  },
  loginContainer: {
    flex: 1,
    backgroundColor: '#08080d',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loginCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#0f0f1a',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1e1e30',
    padding: 32,
    alignItems: 'center',
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 8,
  },
  logoBadge: {
    backgroundColor: 'rgba(124, 58, 237, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.35)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 16,
  },
  logoBadgeText: {
    color: '#c4b5fd',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  loginTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.5,
    marginBottom: 12,
    textAlign: 'center',
  },
  loginSubtitle: {
    fontSize: 13.5,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
  },
  googleButton: {
    width: '100%',
    backgroundColor: '#1b1b2f',
    borderWidth: 1,
    borderColor: '#3a3a55',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  googleButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },

  errorBox: {
    width: '100%',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  emailButton: {
    width: '100%',
    backgroundColor: '#1b1b2f',
    borderWidth: 1,
    borderColor: '#3a3a55',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  emailButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  guestButton: {
    width: '100%',
    backgroundColor: 'rgba(167, 139, 250, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.2)',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  guestButtonText: {
    color: '#a78bfa',
    fontSize: 14,
    fontWeight: '700',
  },
  inputLabel: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    alignSelf: 'flex-start',
  },
  textInput: {
    width: '100%',
    height: 48,
    backgroundColor: '#141424',
    borderWidth: 1,
    borderColor: '#2d2d44',
    borderRadius: 12,
    paddingHorizontal: 16,
    color: '#fff',
    fontSize: 14,
  },
  submitButton: {
    width: '100%',
    backgroundColor: '#7c3aed',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  toggleRegisterText: {
    color: '#a78bfa',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 12,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  backButtonText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
});
