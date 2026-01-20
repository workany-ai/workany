import type { PreviewStatus } from '@/shared/hooks/useVitePreview';

export type ArtifactType =
  | 'html'
  | 'jsx'
  | 'css'
  | 'json'
  | 'text'
  | 'image'
  | 'code'
  | 'markdown'
  | 'csv'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'font'
  | 'websearch';

export interface Artifact {
  id: string;
  name: string;
  type: ArtifactType;
  content?: string;
  path?: string;
  // For presentations: array of slide contents (HTML or image URLs)
  slides?: string[];
  // For spreadsheets: parsed data
  data?: string[][];
  // File size in bytes (used when file is too large)
  fileSize?: number;
  // Flag indicating the file is too large to preview
  fileTooLarge?: boolean;
}

export interface ArtifactPreviewProps {
  artifact: Artifact | null;
  onClose?: () => void;
  // All artifacts for resolving relative imports
  allArtifacts?: Artifact[];
  // Live preview props
  livePreviewUrl?: string | null;
  livePreviewStatus?: PreviewStatus;
  livePreviewError?: string | null;
  onStartLivePreview?: () => void;
  onStopLivePreview?: () => void;
}

export type PreviewMode = 'static' | 'live';

export type ViewMode = 'preview' | 'code';

// Props for individual preview components
export interface PreviewComponentProps {
  artifact: Artifact;
}

// Excel sheet interface
export interface ExcelSheet {
  name: string;
  data: string[][];
}

// PPTX slide interface
export interface PptxSlide {
  index: number;
  title: string;
  content: string[];
  imageUrl?: string;
}

// DOCX paragraph interface
export interface DocxParagraph {
  text: string;
  style?: string;
  isBold?: boolean;
  isItalic?: boolean;
  isHeading?: boolean;
  headingLevel?: number;
}
