import { Platform } from 'react-native';

/**
 * AudioConverter — Convert audio files to MP3 via Firebase Cloud Function
 *
 * WHY: Chrome/Edge cannot seek WAV files accurately via blob URLs.
 * Converting to MP3 permanently fixes background playback issues.
 *
 * HOW: Upload WAV to Cloud Function → ffmpeg converts → returns MP3
 */

const CONVERT_FUNCTION_URL = 'https://us-central1-englishlooper.cloudfunctions.net/convertToMp3';

export class AudioConverter {
  /**
   * Check if a file needs conversion (WAV/FLAC on web)
   */
  static needsConversion(fileName: string): boolean {
    if (Platform.OS !== 'web') return false;
    const ext = fileName.toLowerCase().split('.').pop() || '';
    return ['wav', 'wave', 'flac', 'aiff', 'aif'].includes(ext);
  }

  /**
   * Check if a blob is WAV format by reading magic bytes
   */
  static async isWavBlob(blob: Blob): Promise<boolean> {
    try {
      const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
      // RIFF....WAVE
      return (
        header[0] === 0x52 && header[1] === 0x49 &&
        header[2] === 0x46 && header[3] === 0x46 &&
        header[8] === 0x57 && header[9] === 0x41 &&
        header[10] === 0x56 && header[11] === 0x45
      );
    } catch {
      return false;
    }
  }

  /**
   * Convert audio to MP3 via Firebase Cloud Function.
   * Falls back to client-side WAV re-encoding if function fails.
   */
  static async convertToMp3(
    audioUri: string,
    onProgress?: (msg: string) => void
  ): Promise<{ blob: Blob; blobUrl: string }> {
    onProgress?.('🔄 Đang tải audio lên server...');

    try {
      // Fetch the audio file as blob
      const response = await fetch(audioUri);
      const audioBlob = await response.blob();

      const sizeMB = (audioBlob.size / (1024 * 1024)).toFixed(1);
      console.log(`[AudioConverter] Uploading ${sizeMB}MB to Cloud Function...`);
      onProgress?.(`🔄 Đang convert sang MP3... (${sizeMB}MB)`);

      // Upload to Cloud Function
      const formData = new FormData();
      formData.append('audio', audioBlob, 'input.wav');

      const convertResponse = await fetch(CONVERT_FUNCTION_URL, {
        method: 'POST',
        body: formData,
      });

      if (!convertResponse.ok) {
        const errText = await convertResponse.text();
        throw new Error(`Server error: ${convertResponse.status} - ${errText}`);
      }

      const mp3Blob = await convertResponse.blob();
      const mp3Url = URL.createObjectURL(mp3Blob);

      const mp3SizeMB = (mp3Blob.size / (1024 * 1024)).toFixed(1);
      console.log(`[AudioConverter] Converted: ${sizeMB}MB → ${mp3SizeMB}MB MP3`);
      onProgress?.(`✅ Convert thành công! (${sizeMB}MB → ${mp3SizeMB}MB)`);

      // Return with correct MIME type
      const typedBlob = new Blob([mp3Blob], { type: 'audio/mpeg' });
      const typedUrl = URL.createObjectURL(typedBlob);
      URL.revokeObjectURL(mp3Url);

      return { blob: typedBlob, blobUrl: typedUrl };
    } catch (err) {
      console.warn('[AudioConverter] Cloud Function failed, falling back to client-side:', err);
      onProgress?.('⚠️ Server lỗi, đang convert local...');

      // Fallback: client-side WAV re-encoding
      return this.clientSideConvert(audioUri, onProgress);
    }
  }

  /**
   * Fallback: client-side WAV re-encoding (standard 16-bit PCM)
   */
  private static async clientSideConvert(
    audioUri: string,
    onProgress?: (msg: string) => void
  ): Promise<{ blob: Blob; blobUrl: string }> {
    onProgress?.('🔄 Đang decode audio...');

    const response = await fetch(audioUri);
    const arrayBuffer = await response.arrayBuffer();
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    await audioContext.close();

    const numChannels = audioBuffer.numberOfChannels > 2 ? 2 : audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const numSamples = audioBuffer.length;

    onProgress?.(`🔄 Đang encode WAV chuẩn...`);

    const bytesPerSample = 2;
    const dataSize = numSamples * numChannels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // WAV header
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    this.writeString(view, 8, 'WAVE');
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, 16, true);
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // PCM data
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
      channels.push(audioBuffer.getChannelData(ch));
    }

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const s = Math.max(-1, Math.min(1, channels[ch][i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
      }
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    const blobUrl = URL.createObjectURL(blob);
    onProgress?.(`✅ Convert thành công!`);

    return { blob, blobUrl };
  }

  private static writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }
}
