import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { streamGenerate } from './api';
import type { Deck, GenerateOptions, ProgressPayload, Slide, StreamMeta, Usage } from '../types';

export interface GenLog {
  stage: string;
  message: string;
  at: number;
}

export interface GenState {
  status: 'idle' | 'running' | 'done' | 'error';
  slides: Slide[];
  meta: StreamMeta | null;
  progress: ProgressPayload;
  reasoning: string;
  raw: string;
  logs: GenLog[];
  deck: Deck | null;
  usage: Usage | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  /** true when the server answered 401 — the UI should show the access gate */
  needsAccess: boolean;
}

const emptyProgress: ProgressPayload = {
  slides: 0,
  total: null,
  reasoningChars: 0,
  contentChars: 0,
  elapsedMs: 0,
  tokens: null
};

const initialState: GenState = {
  status: 'idle',
  slides: [],
  meta: null,
  progress: emptyProgress,
  reasoning: '',
  raw: '',
  logs: [],
  deck: null,
  usage: null,
  error: null,
  startedAt: null,
  finishedAt: null,
  needsAccess: false
};

type Action =
  | { type: 'start' }
  | { type: 'status'; data: { stage: string; message: string } }
  | { type: 'meta'; data: { meta: StreamMeta } }
  | { type: 'slide'; data: { index: number; slide: Slide } }
  | { type: 'progress'; data: ProgressPayload }
  | { type: 'reasoning'; text: string }
  | { type: 'raw'; text: string }
  | { type: 'usage'; usage: Usage | null }
  | { type: 'done'; deck: Deck }
  | { type: 'fail'; message: string }
  | { type: 'unauthorized'; message: string }
  | { type: 'streamEnded' }
  | { type: 'reset' };

const REASONING_CAP = 8000;
const RAW_CAP = 40000;

function reducer(state: GenState, action: Action): GenState {
  switch (action.type) {
    case 'start':
      return {
        ...initialState,
        status: 'running',
        startedAt: Date.now(),
        logs: [{ stage: 'start', message: '正在提交文案…', at: Date.now() }]
      };
    case 'status': {
      const last = state.logs[state.logs.length - 1];
      if (last && last.message === action.data.message) return state;
      return {
        ...state,
        logs: [...state.logs, { stage: action.data.stage, message: action.data.message, at: Date.now() }]
      };
    }
    case 'meta':
      return { ...state, meta: { ...(state.meta ?? {}), ...action.data.meta } };
    case 'slide': {
      const slides = [...state.slides];
      slides[action.data.index] = action.data.slide;
      return { ...state, slides: slides.filter(Boolean) };
    }
    case 'progress':
      return { ...state, progress: action.data };
    case 'reasoning':
      return { ...state, reasoning: (state.reasoning + action.text).slice(-REASONING_CAP) };
    case 'raw':
      return { ...state, raw: (state.raw + action.text).slice(-RAW_CAP) };
    case 'usage':
      return { ...state, usage: action.usage };
    case 'done':
      return {
        ...state,
        status: 'done',
        deck: action.deck,
        slides: action.deck.slides,
        finishedAt: Date.now(),
        logs: [...state.logs, { stage: 'done', message: `已生成 ${action.deck.slides.length} 页`, at: Date.now() }]
      };
    case 'fail':
      return { ...state, status: 'error', error: action.message, finishedAt: Date.now() };
    case 'unauthorized':
      return { ...state, status: 'error', error: action.message, needsAccess: true, finishedAt: Date.now() };
    case 'streamEnded':
      if (state.status !== 'running') return state;
      if (state.slides.length) {
        return {
          ...state,
          status: 'error',
          error: '生成流意外结束，未收到完整结果，请重试。',
          finishedAt: Date.now()
        };
      }
      return { ...state, status: 'error', error: '生成流意外结束，请重试。', finishedAt: Date.now() };
    case 'reset':
      return initialState;
    default:
      return state;
  }
}

export function useGeneration() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const abortRef = useRef<AbortController | null>(null);
  const [, forceTick] = useState(0);

  // Live clock for the elapsed-time readout while a generation is running.
  useEffect(() => {
    if (state.status !== 'running') return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 400);
    return () => window.clearInterval(id);
  }, [state.status]);

  // Abort an in-flight request when the component goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(async (text: string, options: GenerateOptions) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ type: 'start' });
    try {
      await streamGenerate(
        text,
        options,
        {
          onStatus: (data) => dispatch({ type: 'status', data }),
          onMeta: (data) => dispatch({ type: 'meta', data }),
          onSlide: (data) => dispatch({ type: 'slide', data }),
          onProgress: (data) => dispatch({ type: 'progress', data }),
          onReasoning: (data) => dispatch({ type: 'reasoning', text: data.text }),
          onRaw: (data) => dispatch({ type: 'raw', text: data.text }),
          onUsage: (data) => dispatch({ type: 'usage', usage: data.usage }),
          onDone: (data) => dispatch({ type: 'done', deck: data.deck }),
          onError: (data) => dispatch({ type: 'fail', message: data.message })
        },
        controller.signal
      );
      dispatch({ type: 'streamEnded' });
    } catch (err) {
      if (controller.signal.aborted) return;
      const e = err as Error & { code?: string };
      if (e.code === 'ACCESS_REQUIRED') {
        dispatch({ type: 'unauthorized', message: e.message });
        return;
      }
      dispatch({ type: 'fail', message: e.message || '生成失败' });
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: 'reset' });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: 'reset' });
  }, []);

  const elapsedMs =
    state.status === 'running' && state.startedAt
      ? Date.now() - state.startedAt
      : state.progress.elapsedMs || (state.startedAt && state.finishedAt ? state.finishedAt - state.startedAt : 0);

  const percent = (() => {
    if (state.deck) return 100;
    const total = state.meta?.slideCount ?? state.progress.total;
    if (total && total > 0) return Math.min(96, Math.round((state.slides.length / total) * 100));
    // No declared page count yet: estimate from streamed characters.
    if (state.progress.contentChars > 0) return Math.min(90, Math.round((state.progress.contentChars / 3500) * 100));
    return state.progress.reasoningChars > 0 ? 6 : 2;
  })();

  return { ...state, elapsedMs, percent, start, cancel, reset };
}

export type Generation = ReturnType<typeof useGeneration>;
