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
