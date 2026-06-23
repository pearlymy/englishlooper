import { Alert, Platform } from 'react-native';

export interface AlertButton {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

export const showAlert = (
  title: string,
  message?: string,
  buttons?: AlertButton[]
) => {
  if (Platform.OS === 'web') {
    const formattedMessage = message ? `\n\n${message}` : '';
    const fullText = `${title}${formattedMessage}`;

    if (buttons && buttons.length > 0) {
      // Find standard React Native Alert button patterns
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
  } else {
    Alert.alert(title, message, buttons as any);
  }
};

/**
 * Show a non-blocking toast notification on web.
 * Auto-dismisses after `durationMs` (default 2500ms).
 */
export const showToast = (
  message: string,
  durationMs: number = 2500
) => {
  if (Platform.OS !== 'web') {
    Alert.alert('', message);
    return;
  }

  // Remove any existing toast
  const existing = document.getElementById('__app_toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = '__app_toast';
  toast.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" style="flex-shrink:0"><circle cx="12" cy="12" r="10" fill="#10b981"/><path d="M8 12.5l2.5 2.5 5.5-5.5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${message.replace(/^[✅❌⚠️🔄]\s*/, '')}</span>`;
  Object.assign(toast.style, {
    position: 'fixed',
    top: '24px',
    right: '-400px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    backgroundColor: 'rgba(16, 16, 32, 0.95)',
    color: '#e0e0e0',
    padding: '16px 24px',
    borderRadius: '14px',
    fontSize: '15px',
    fontWeight: '600',
    zIndex: '99999',
    pointerEvents: 'none',
    transition: 'right 0.4s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease',
    border: '1px solid rgba(16, 185, 129, 0.35)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(16,185,129,0.1)',
    maxWidth: '90vw',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    letterSpacing: '-0.2px',
  } as any);

  document.body.appendChild(toast);

  // Slide in from right
  requestAnimationFrame(() => {
    toast.style.right = '20px';
  });

  // Slide out to right
  setTimeout(() => {
    toast.style.right = '-400px';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
  }, durationMs);
};
