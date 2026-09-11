import type { KataGoBackendPreference } from '../types';
import { t } from '../i18n';

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface EngineActivityPresentationArgs {
  status: EngineStatus;
  error?: string | null;
  isAiThinking: boolean;
  isGameAnalysisRunning: boolean;
  isContinuousAnalysis: boolean;
  isAnalysisMode: boolean;
}

export interface EngineActivityPresentation {
  state: 'loading' | 'running' | 'ready' | 'error';
  label: string;
}

export function getEngineActivityPresentation(
  args: EngineActivityPresentationArgs,
): EngineActivityPresentation {
  if (args.error) return { state: 'error', label: t('Engine error') };
  if (args.status === 'loading') return { state: 'loading', label: t(ENGINE_LOADING_LABEL) };
  if (args.isAiThinking) return { state: 'running', label: t('AI thinking…') };
  if (args.isGameAnalysisRunning || args.isContinuousAnalysis) {
    return { state: 'running', label: t('Analyzing…') };
  }
  if (args.isAnalysisMode) return { state: 'ready', label: t('Analysis mode') };
  return { state: 'ready', label: t('KataGo ready') };
}

/**
 * What the engine's loading state is called wherever there is room for a
 * sentence. `stateLabel` below stays the bare word because it is set beside the
 * backend name in a status chip ("Loading · WebGPU"); these are the surfaces
 * that spell it out. Three wordings were in use, and the header pill's "Loading
 * model" and the note panel's "Loading engine..." were on screen together.
 *
 * "Model", not "engine": the state means the net is not resident yet, not that
 * a request is in flight — see the note beside `engineStatus: 'loading'` in
 * gameStore.
 */
export const ENGINE_LOADING_LABEL = 'Loading model';

export interface EngineStatusSummaryArgs {
  status: EngineStatus;
  error?: string | null;
  requestedBackend: KataGoBackendPreference | string;
  activeBackend?: string | null;
  modelLabel?: string | null;
  modelUrl?: string | null;
  /** Why the engine is not on the requested backend, from the worker. */
  backendNote?: string | null;
}

export interface EngineStatusSummary {
  stateLabel: string;
  activeBackendLabel: string;
  requestedBackendLabel: string;
  modelSource: string;
  isFallback: boolean;
  reasonLabel: string;
  compactLabel: string;
  title: string;
  dotClass: string;
  tone: 'default' | 'error';
}

export function formatEngineBackendLabel(backend: string | null | undefined): string {
  const normalized = backend?.trim().toLowerCase();
  switch (normalized) {
    case 'webgpu':
      return t('WebGPU');
    case 'webgpu-gc':
      return t('WebGPU GC');
    case 'wasm':
      return t('CPU (WASM)');
    case 'cpu':
      return t('CPU');
    case 'tensorflow':
    case 'tfjs':
      return t('TensorFlow.js');
    case 'webnn':
      return t('WebNN');
    case 'native':
    case 'native-gpu':
      return t('Native GPU');
    case 'native-cpu':
      return t('Native CPU');
    case 'pytorch':
      return t('PyTorch');
    case '':
    case undefined:
      return t('Not loaded');
    default:
      return backend ?? t('Not loaded');
  }
}

function isBundledModelPath(modelUrl: string): boolean {
  const cleanUrl = modelUrl.split('#')[0]?.split('?')[0] ?? modelUrl;
  const segments = cleanUrl.split('/').filter(Boolean);
  const startsWithModels = segments[0] === 'models';
  const hasSingleBaseBeforeModels = segments.length >= 3 && segments[1] === 'models';

  if (startsWithModels) return true;
  if (!hasSingleBaseBeforeModels) return false;

  // Avoid misclassifying common filesystem-style paths as app-public assets.
  return !['Users', 'home', 'Volumes', 'tmp', 'var', 'opt'].includes(segments[0]!);
}

export function getEngineModelSource(modelUrl: string | null | undefined): string {
  const rawUrl = modelUrl?.trim();
  if (!rawUrl) return t('Unknown');
  if (rawUrl.startsWith('blob:')) return t('Uploaded');
  if (/^https?:\/\//i.test(rawUrl)) return t('Remote');
  if (/^file:/i.test(rawUrl)) return t('Local');
  if (isBundledModelPath(rawUrl)) return t('Bundled');
  return t('Local');
}

function getEngineBackendReason(args: {
  status: EngineStatus;
  error?: string | null;
  requestedBackendLabel: string;
  activeBackendLabel: string;
  activeBackend?: string | null;
  isFallback: boolean;
  backendNote?: string | null;
}): string {
  if (args.error) {
    return args.isFallback
      ? `${args.requestedBackendLabel} failed; ${args.activeBackendLabel} is the active fallback.`
      : `${args.activeBackendLabel} failed to start.`;
  }

  if (args.status === 'loading') {
    return t('Loading {backend} analysis.', { backend: args.activeBackendLabel });
  }

  if (args.isFallback) {
    return args.backendNote
      ? `${args.backendNote}.`
      : t('{requested} was requested; {active} is running.', { requested: args.requestedBackendLabel, active: args.activeBackendLabel });
  }

  const normalized = args.activeBackend?.trim().toLowerCase();
  if (normalized === 'webgpu' || normalized === 'webgpu-gc') {
    return t('Browser GPU acceleration is active.');
  }
  if (normalized === 'wasm') {
    return t('Compatible CPU analysis path; slower than WebGPU but broadly supported.');
  }
  if (normalized === 'cpu') {
    return t('Plain CPU analysis path selected for maximum compatibility.');
  }
  if (!normalized) {
    return t('Analysis engine will start when analysis runs.');
  }
  return t('{backend} analysis path is active.', { backend: args.activeBackendLabel });
}

export function getEngineStatusSummary(args: EngineStatusSummaryArgs): EngineStatusSummary {
  const hasLoadedBackend = !!args.activeBackend?.trim();
  const hasConfiguredModel = !!args.modelLabel?.trim();
  const reportsReadyWhileIdle = args.status === 'idle' && (hasLoadedBackend || hasConfiguredModel);
  // Internal canonical token, kept in English because consumers compare it
  // literally (e.g. `stateLabel === 'Ready'`); display surfaces translate it.
  const stateLabel = args.error
    ? 'Error'
    : args.status === 'loading'
      ? 'Loading'
      : args.status === 'ready' || reportsReadyWhileIdle
        ? 'Ready'
        : 'Idle';
  const activeBackend = args.activeBackend ?? args.requestedBackend;
  const activeBackendLabel = formatEngineBackendLabel(activeBackend);
  const requestedBackendLabel = formatEngineBackendLabel(args.requestedBackend);
  const isFallback = !!args.activeBackend && args.activeBackend !== args.requestedBackend;
  const stateDisplay = isFallback ? t('{state} fallback', { state: t(stateLabel) }) : t(stateLabel);
  // Model names are long developer detail (often a training-run hash); the
  // compact label stays at state · backend and the title carries the model.
  const parts = [stateDisplay, activeBackendLabel];
  const modelSource = getEngineModelSource(args.modelUrl);
  const isReady = stateLabel === 'Ready';
  const reasonLabel = getEngineBackendReason({
    status: args.status,
    error: args.error,
    requestedBackendLabel,
    activeBackendLabel,
    activeBackend: args.activeBackend,
    isFallback,
    backendNote: args.backendNote,
  });
  const titleLines = [
    t('State: {state}', { state: t(stateLabel) }),
    reportsReadyWhileIdle ? t('Activity: Idle') : '',
    t('Backend: {backend}', { backend: activeBackendLabel }),
    isFallback ? t('Requested: {backend}', { backend: requestedBackendLabel }) : '',
    args.modelLabel ? t('Model: {model}', { model: args.modelLabel }) : '',
    t('Source: {source}', { source: modelSource }),
    reasonLabel ? t('Reason: {reason}', { reason: reasonLabel }) : '',
    args.error ? t('Error: {error}', { error: args.error }) : '',
  ].filter(Boolean);

  return {
    stateLabel,
    activeBackendLabel,
    requestedBackendLabel,
    modelSource,
    isFallback,
    reasonLabel,
    compactLabel: parts.join(' · '),
    title: titleLines.join('\n'),
    dotClass: args.error
      ? 'bg-red-500'
      : args.status === 'loading'
        ? 'bg-yellow-400'
        : isReady
          ? 'bg-green-400'
          : 'bg-slate-500',
    tone: args.error ? 'error' : 'default',
  };
}
