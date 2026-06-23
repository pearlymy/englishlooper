export interface Segment {
  id: string;
  index: number; // 1-based (e.g. 1, 2, 3...)
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  transcript?: string;
  status: 'not_started' | 'learning' | 'mastered';
  studyCount?: number;
  dictationAccuracy?: number;
  translationAccuracy?: number;
  ipa?: string;
  translation?: string;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  thumbnailUrl?: string; // base64 data URL for folder card thumbnail
}

export interface Project {
  id: string;
  title: string;
  audioUri: string;
  durationMs: number;
  segments: Segment[];
  transcriptText?: string;
  createdAt: number;
  lastOpenedAt?: number;       // Timestamp lần mở gần nhất
  activeSegmentId?: string;    // Câu đang học gần nhất (để resume)
  folderId?: string;           // ID thư mục chứa bài học
}

// Kiểu cho navigation state đơn giản
export type ScreenName = 'home' | 'import' | 'review' | 'player';
