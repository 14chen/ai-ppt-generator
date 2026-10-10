export type SlideLayout =
  | 'cover'
  | 'section'
  | 'bullets'
  | 'two-column'
  | 'stats'
  | 'quote'
  | 'timeline'
  | 'closing';

export interface Column {
  heading: string;
  items: string[];
}

export interface Stat {
  value: string;
  label: string;
}

export interface Step {
  title: string;
  detail?: string;
}

export interface Slide {
  layout: SlideLayout | string;
  title: string;
  subtitle?: string;
  icon?: string;
  bullets?: string[];
  columns?: Column[];
  stats?: Stat[];
  quote?: { text: string; author?: string };
  steps?: Step[];
  notes?: string;
  index?: number;
}

export interface Deck {
  version: number;
  title: string;
  subtitle?: string;
  theme: string;
  slides: Slide[];
  meta: {
    slideCount: number;
    requested: number | null;
    generatedAt: string;
    model?: string;
    sourceChars?: number;
    elapsedMs?: number;
    fromWholeBuffer?: boolean;
    usage?: Usage | null;
  };
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

export interface GenerateOptions {
  targetSlides: number;
  language: 'auto' | 'zh' | 'en';
  theme: string;
}

export interface StreamMeta {
  title?: string;
  subtitle?: string;
  slideCount?: number;
}

export interface ProgressPayload {
  slides: number;
  total: number | null;
  reasoningChars: number;
  contentChars: number;
  elapsedMs: number;
  tokens: number | null;
}

export interface HealthInfo {
  ok: boolean;
  model: string;
  baseUrl: string;
  effort: string;
  hasApiKey: boolean;
  maxSlides: number;
  minChars: number;
  maxChars: number;
}

export interface StreamHandlers {
  onStatus?: (data: { stage: string; message: string }) => void;
  onMeta?: (data: { meta: StreamMeta }) => void;
  onSlide?: (data: { index: number; slide: Slide; count: number }) => void;
  onProgress?: (data: ProgressPayload) => void;
  onReasoning?: (data: { text: string }) => void;
  onRaw?: (data: { text: string }) => void;
  onUsage?: (data: { usage: Usage | null; elapsedMs: number }) => void;
  onDone?: (data: { deck: Deck }) => void;
  onError?: (data: { code: string; message: string; partial?: boolean }) => void;
}
