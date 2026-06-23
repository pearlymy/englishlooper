import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Dimensions,
  Platform,
  Animated,
  ScrollView,
} from 'react-native';
import { showToast } from '../utils/alert';

const IS_WEB = Platform.OS === 'web';
const SIDEBAR_WIDTH = 260;

interface SidebarMenuProps {
  currentUser: any;
  onSignOut?: () => void;
  onOpenAuth?: () => void;
  isVisible: boolean;
  onClose: () => void;
  activeScreen?: string;
  onGoHome?: () => void;
}

// SVG Icons for menu items
const HomeIcon = ({ color = '#9ca3af', size = 20 }) => IS_WEB ? (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 } as any}>
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
) : <Text style={{ color, fontSize: size }}>⌂</Text>;

const ShadowingIcon = ({ color = '#9ca3af', size = 20 }) => IS_WEB ? (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 } as any}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
) : <Text style={{ color, fontSize: size }}>🎧</Text>;

const DictationIcon = ({ color = '#9ca3af', size = 20 }) => IS_WEB ? (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 } as any}>
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
) : <Text style={{ color, fontSize: size }}>🎙</Text>;

const VocabIcon = ({ color = '#9ca3af', size = 20 }) => IS_WEB ? (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 } as any}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    <line x1="8" y1="7" x2="16" y2="7" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
) : <Text style={{ color, fontSize: size }}>📖</Text>;

const FileIcon = ({ color = '#9ca3af', size = 20 }) => IS_WEB ? (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 } as any}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
) : <Text style={{ color, fontSize: size }}>📂</Text>;

const WordListIcon = ({ color = '#9ca3af', size = 20 }) => IS_WEB ? (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 } as any}>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
) : <Text style={{ color, fontSize: size }}>📝</Text>;

const AIDictIcon = ({ color = '#9ca3af', size = 20 }) => IS_WEB ? (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 } as any}>
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
    <path d="M7 8h2l1.5 4L12 8h2" />
    <circle cx="17" cy="10" r="1" />
  </svg>
) : <Text style={{ color, fontSize: size }}>🤖</Text>;

const StatsIcon = ({ color = '#9ca3af', size = 20 }) => IS_WEB ? (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 } as any}>
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
) : <Text style={{ color, fontSize: size }}>📊</Text>;

const RankIcon = ({ color = '#9ca3af', size = 20 }) => IS_WEB ? (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 } as any}>
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
) : <Text style={{ color, fontSize: size }}>🏆</Text>;

const ProfileIcon = ({ color = '#9ca3af', size = 18 }) => IS_WEB ? (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 } as any}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
) : <Text style={{ color, fontSize: size }}>👤</Text>;

const SettingsIcon = ({ color = '#9ca3af', size = 18 }) => IS_WEB ? (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 } as any}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </svg>
) : <Text style={{ color, fontSize: size }}>⚙</Text>;

const LogoutIcon = ({ color = '#ef4444', size = 18 }) => IS_WEB ? (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 } as any}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
) : <Text style={{ color, fontSize: size }}>🚪</Text>;

const CrownIcon = ({ color = '#ec4899', size = 18 }) => IS_WEB ? (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 } as any}>
    <path d="M2 4l3 12h14l3-12-6 7-5-7-5 7-4-7z" />
    <line x1="5" y1="20" x2="19" y2="20" />
  </svg>
) : <Text style={{ color, fontSize: size }}>👑</Text>;

// Menu data
const menuSections = [
  {
    label: 'TỔNG QUAN',
    items: [
      { id: 'home', label: 'Trang chủ', Icon: HomeIcon },
    ],
  },
  {
    label: 'LUYỆN TẬP',
    items: [
      { id: 'shadowing', label: 'Shadowing', Icon: ShadowingIcon },
      { id: 'dictation', label: 'Dictation', Icon: DictationIcon },
      { id: 'vocab', label: 'Luyện từ vựng', Icon: VocabIcon },
    ],
  },
  {
    label: 'THƯ VIỆN',
    items: [
      { id: 'files', label: 'File của tôi', Icon: FileIcon },
      { id: 'wordlist', label: 'Danh sách từ', Icon: WordListIcon },
      { id: 'aidict', label: 'Từ điển AI', Icon: AIDictIcon },
    ],
  },
  {
    label: 'TIẾN ĐỘ',
    items: [
      { id: 'stats', label: 'Thống kê', Icon: StatsIcon },
      { id: 'ranking', label: 'Xếp hạng', Icon: RankIcon },
    ],
  },
];

export default function SidebarMenu({
  currentUser,
  onSignOut,
  onOpenAuth,
  isVisible,
  onClose,
  activeScreen = 'home',
  onGoHome,
}: SidebarMenuProps) {
  const [activeItem, setActiveItem] = useState(activeScreen);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const slideAnim = useRef(new Animated.Value(-SIDEBAR_WIDTH)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const [dimensions, setDimensions] = useState(Dimensions.get('window'));
  const isWide = dimensions.width > 768;

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setDimensions(window));
    return () => sub?.remove();
  }, []);

  // Animate sidebar on mobile
  useEffect(() => {
    if (!isWide) {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: isVisible ? 0 : -SIDEBAR_WIDTH,
          duration: 280,
          useNativeDriver: false,
        }),
        Animated.timing(overlayAnim, {
          toValue: isVisible ? 1 : 0,
          duration: 280,
          useNativeDriver: false,
        }),
      ]).start();
    }
  }, [isVisible, isWide]);

  const handleMenuPress = (id: string) => {
    setActiveItem(id);
    if (id === 'home') {
      // Home is the current active screen, do nothing
    } else {
      showToast(`🚧 "${menuSections.flatMap(s => s.items).find(i => i.id === id)?.label}" — Coming soon!`);
    }
    if (!isWide) onClose();
  };

  const getUserDisplayName = () => {
    if (!currentUser) return 'Khách';
    const email = currentUser.email || '';
    const name = currentUser.displayName || email.split('@')[0];
    return name.length > 14 ? name.substring(0, 14) + '...' : name;
  };

  const getUserInitial = () => {
    if (!currentUser) return '?';
    const name = currentUser.displayName || currentUser.email || '';
    return name.charAt(0).toUpperCase();
  };

  const renderSidebar = () => (
    <View style={styles.sidebar}>
      {/* Logo */}
      <TouchableOpacity 
        style={styles.logoSection} 
        onPress={() => onGoHome?.()}
        activeOpacity={0.7}
        {...(IS_WEB ? { style: [styles.logoSection, { cursor: 'pointer' }] } : {})}
      >
        <View style={styles.logoRow}>
          <View style={styles.logoIcon}>
            <Text style={styles.logoEmoji}>🎧</Text>
          </View>
          <Text style={styles.logoText}>ENGLISH LOOPER</Text>
        </View>
      </TouchableOpacity>

      {/* Menu Sections */}
      <ScrollView 
        style={styles.menuScroll} 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 20 }}
      >
        {menuSections.map((section, sIdx) => (
          <View key={sIdx} style={styles.menuSection}>
            <Text style={styles.sectionLabel}>{section.label}</Text>
            {section.items.map((item) => {
              const isActive = activeItem === item.id;
              const iconColor = isActive ? '#a78bfa' : '#6b7280';
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.menuItem,
                    isActive && styles.menuItemActive,
                  ]}
                  onPress={() => handleMenuPress(item.id)}
                  activeOpacity={0.7}
                >
                  {isActive && <View style={styles.menuItemActiveBorder} />}
                  <item.Icon color={iconColor} size={20} />
                  <Text style={[styles.menuItemText, isActive && styles.menuItemTextActive]}>
                    {item.label}
                  </Text>
                  {item.id === 'wordlist' && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>0</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </ScrollView>

      {/* Bottom Section */}
      <View style={styles.bottomSection}>
        {/* Premium CTA */}
        <TouchableOpacity
          style={styles.premiumBtn}
          onPress={() => showToast('🚧 Premium — Coming soon!')}
          activeOpacity={0.8}
        >
          <CrownIcon color="#ec4899" size={18} />
          <Text style={styles.premiumText}>Nâng cấp Premium</Text>
        </TouchableOpacity>

        {/* User Section */}
        <View style={styles.userSection}>
          {/* User dropdown (above user info) */}
          {showUserDropdown && (
            <View style={styles.userDropdown}>
              <TouchableOpacity
                style={styles.dropdownItem}
                onPress={() => {
                  setShowUserDropdown(false);
                  showToast('🚧 Quản lý nâng cấp — Coming soon!');
                }}
              >
                <SettingsIcon color="#9ca3af" size={16} />
                <Text style={styles.dropdownText}>Quản lý nâng cấp</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dropdownItem}
                onPress={() => {
                  setShowUserDropdown(false);
                  showToast('🚧 Hồ sơ — Coming soon!');
                }}
              >
                <ProfileIcon color="#9ca3af" size={16} />
                <Text style={styles.dropdownText}>Hồ sơ</Text>
              </TouchableOpacity>
              {currentUser && (
                <TouchableOpacity
                  style={[styles.dropdownItem, styles.dropdownItemDanger]}
                  onPress={() => {
                    setShowUserDropdown(false);
                    onSignOut?.();
                  }}
                >
                  <LogoutIcon color="#ef4444" size={16} />
                  <Text style={[styles.dropdownText, { color: '#ef4444' }]}>Đăng xuất</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* User info bar */}
          <TouchableOpacity
            style={styles.userBar}
            onPress={() => {
              if (currentUser) {
                setShowUserDropdown(!showUserDropdown);
              } else {
                onOpenAuth?.();
              }
            }}
            activeOpacity={0.7}
          >
            {/* Avatar */}
            <View style={[styles.avatar, currentUser && styles.avatarLoggedIn]}>
              {currentUser ? (
                <Text style={styles.avatarText}>{getUserInitial()}</Text>
              ) : (
                <ProfileIcon color="#6b7280" size={18} />
              )}
            </View>

            {/* Name + plan */}
            <View style={styles.userInfo}>
              <View style={styles.userNameRow}>
                <Text style={styles.userName} numberOfLines={1}>
                  {currentUser ? getUserDisplayName() : 'Đăng nhập'}
                </Text>
                {currentUser && (
                  <Text style={styles.userChevron}>{showUserDropdown ? '▲' : '▼'}</Text>
                )}
              </View>
              {currentUser && (
                <View style={styles.planRow}>
                  <View style={styles.planDot} />
                  <Text style={styles.planText}>Miễn phí</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  // Desktop: always visible
  if (isWide) {
    return renderSidebar();
  }

  // Mobile: overlay + animated slide
  if (!isVisible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Overlay */}
      <Animated.View
        style={[
          styles.overlay,
          { opacity: overlayAnim },
        ]}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          onPress={() => {
            setShowUserDropdown(false);
            onClose();
          }}
          activeOpacity={1}
        />
      </Animated.View>

      {/* Sidebar */}
      <Animated.View
        style={[
          styles.sidebarMobileWrap,
          { transform: [{ translateX: slideAnim }] },
        ]}
      >
        {renderSidebar()}
      </Animated.View>
    </View>
  );
}

export { SIDEBAR_WIDTH };

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    zIndex: 998,
  },
  sidebarMobileWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: SIDEBAR_WIDTH,
    zIndex: 999,
  },
  sidebar: {
    width: SIDEBAR_WIDTH,
    height: '100%',
    backgroundColor: '#0c0c14',
    borderRightWidth: 1,
    borderRightColor: '#1a1a2a',
    ...(IS_WEB ? {
      display: 'flex',
      flexDirection: 'column',
    } as any : {}),
  },

  // Logo
  logoSection: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#141420',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(124,58,237,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoEmoji: {
    fontSize: 18,
  },
  logoText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#e0e0f0',
    letterSpacing: 0.5,
  },

  // Menu
  menuScroll: {
    flex: 1,
  },
  menuSection: {
    paddingTop: 20,
    paddingHorizontal: 12,
  },
  sectionLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#4a4a6a',
    letterSpacing: 1.2,
    paddingHorizontal: 12,
    marginBottom: 8,
    textTransform: 'uppercase',
  } as any,
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 2,
    gap: 12,
    position: 'relative',
    ...(IS_WEB ? { cursor: 'pointer', transition: 'background-color 0.15s ease' } as any : {}),
  },
  menuItemActive: {
    backgroundColor: 'rgba(124,58,237,0.12)',
  },
  menuItemActiveBorder: {
    position: 'absolute',
    left: 0,
    top: 6,
    bottom: 6,
    width: 3,
    borderRadius: 2,
    backgroundColor: '#a78bfa',
  },
  menuItemText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#8b8ba8',
    flex: 1,
  },
  menuItemTextActive: {
    color: '#c4b5fd',
    fontWeight: '600',
  },
  badge: {
    backgroundColor: 'rgba(99,102,241,0.2)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 1,
    minWidth: 22,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#818cf8',
  },

  // Bottom
  bottomSection: {
    paddingHorizontal: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#141420',
  },

  // Premium
  premiumBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    marginTop: 14,
    marginBottom: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(236,72,153,0.35)',
    backgroundColor: 'rgba(236,72,153,0.06)',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  premiumText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#ec4899',
  },

  // User section
  userSection: {
    position: 'relative',
  },
  userDropdown: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#12121e',
    borderWidth: 1,
    borderColor: '#1e1e30',
    borderRadius: 12,
    marginBottom: 8,
    paddingVertical: 6,
    ...(IS_WEB ? {
      boxShadow: '0 -8px 32px rgba(0,0,0,0.4)',
    } as any : {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.3,
      shadowRadius: 12,
      elevation: 8,
    }),
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  dropdownItemDanger: {
    borderTopWidth: 1,
    borderTopColor: '#1e1e30',
    marginTop: 4,
    paddingTop: 12,
  },
  dropdownText: {
    fontSize: 13.5,
    fontWeight: '500',
    color: '#c0c0d0',
  },

  // User bar
  userBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(20,20,32,0.6)',
    ...(IS_WEB ? { cursor: 'pointer' } as any : {}),
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1e1e30',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#2a2a44',
  },
  avatarLoggedIn: {
    borderColor: '#7c3aed',
    backgroundColor: 'rgba(124,58,237,0.15)',
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#c4b5fd',
  },
  userInfo: {
    flex: 1,
    minWidth: 0,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  userName: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#d0d0e0',
    flex: 1,
  },
  userChevron: {
    fontSize: 8,
    color: '#6b7280',
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  planDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
  },
  planText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#6b7280',
  },
});
