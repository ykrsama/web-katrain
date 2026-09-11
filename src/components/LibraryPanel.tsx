import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MOBILE_TAB_PANEL_IDS, mobileTabId } from './layout/mobileTabs';
import {
  FaTimes,
  FaFolderOpen,
  FaSave,
  FaTrash,
  FaPen,
  FaSearch,
  FaChevronLeft,
  FaChevronRight,
  FaDownload,
  FaUpload,
  FaCheckSquare,
  FaSquare,
  FaPlus,
  FaArrowUp,
  FaFileAlt,
  FaFileArchive,
  FaCopy,
  FaPlay,
  FaCloudDownloadAlt,
  FaStar,
  FaRegStar,
  FaTag,
  FaEllipsisH,
} from 'react-icons/fa';
import {
  LIBRARY_CURRENT_FOLDER_STORAGE_KEY,
  createLibraryBackup,
  createLibraryFolder,
  createLibraryItem,
  deleteLibraryItem,
  duplicateLibraryItem,
  duplicateLibraryItems,
  formatLibrarySize,
  libraryNameRepeatsPlayers,
  getLibraryFileMoveSortCount,
  getLibraryFileMoveSummary,
  getLibraryFolderOptions,
  getLibraryStats,
  getUniqueLibraryItemName,
  libraryItemMatchesQuery,
  librarySgfDownloadFilename,
  loadLibrary,
  moveLibraryItems,
  restoreLibrary,
  saveLibrary,
  suggestLibraryItemNameFromSgf,
  updateLibraryFileSgf,
  updateLibraryItem,
  toggleLibraryFileFavorite,
  setLibraryFileTags,
  getAllLibraryTags,
  type LibraryItem,
  type LibraryFile,
  type LibraryFolder,
} from '../utils/library';
import { tagsFromResult } from '../utils/narrativeTags';
import { createLibraryZipBlob, importLibraryItemsFromZip } from '../utils/libraryZip';
import { assertValidLibrarySgfImport } from '../utils/libraryImportValidation';
import { stripUnsafeFilenameControls } from '../utils/filename';
import {
  PHOTO_BOARD_IMAGE_ACCEPT,
  PHOTO_BOARD_UNSUPPORTED_IMAGE_MESSAGE,
  isPhotoBoardImageFile,
  isUnsupportedPhotoBoardImageFile,
} from '../utils/photoBoard';
import { SectionHeader } from './layout/ui';
import { panelCardBase, panelCardClosed, panelCardOpen } from './layout/ui-utils';
import { useT } from '../i18n';
import { getIndexedDB, readLocalStorage, writeLocalStorage } from '../utils/storage';
import { isMobileLayoutViewport } from '../utils/responsiveLayout';
import { downloadBlob as downloadBlobFile } from '../utils/objectUrl';
import { getDroppedSgfOrOgsText, hasPotentialGameImportDrag } from '../utils/dragImport';
import { createLibraryItemFromSgfOrOgsText } from '../utils/libraryTextImport';
import { ogsSyncFileName, ogsSyncFolderName, type OgsSyncedGame } from '../utils/ogsSync';
import { OgsSyncModal } from './OgsSyncModal';
import {
  getLibraryMenuNavigationIndex,
  getLibraryRowKeyAction,
  isLibraryMenuCloseKey,
} from '../utils/libraryKeyboard';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { MAX_SEARCH_QUERY_LENGTH } from '../utils/searchTerms';
import { getSgfImportSizeError, MAX_SGF_IMPORT_LABEL } from '../utils/sgfImportLimits';

/** Library rows mounted before "Show more". Matches web-chess and web-xiangqi. */
const LIBRARY_PAGE_SIZE = 100;

const isFolder = (item: LibraryItem): item is LibraryFolder => item.type === 'folder';

const LIBRARY_FOLDERS_EXPANDED_STORAGE_KEY = 'web-katrain:library_folders_expanded:v1';
const isFile = (item: LibraryItem): item is LibraryFile => item.type === 'file';
const safeDownloadName = (name: string, fallback: string): string =>
  stripUnsafeFilenameControls(name)
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, '') || fallback;
const libraryImportAccept = [
  '.sgf',
  '.zip',
  'application/zip',
  'application/x-zip-compressed',
  PHOTO_BOARD_IMAGE_ACCEPT,
].join(',');

type LibraryTextDialogState = {
  title: string;
  label: string;
  initialValue: string;
  placeholder?: string;
  confirmLabel: string;
  folderSelect?: {
    label: string;
    rootLabel: string;
    initialFolderId: string | null;
    options: Array<{ id: string; name: string; depth: number }>;
  };
  onSubmit: (value: string, folderId?: string | null) => void;
};

type LibraryConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
};

type LibraryContextMenuState = {
  x: number;
  y: number;
  itemId: string | null;
};

const LibraryTextDialog: React.FC<{
  dialog: LibraryTextDialogState;
  onClose: () => void;
}> = ({ dialog, onClose }) => {
  const t = useT();
  const [value, setValue] = useState(dialog.initialValue);
  const [folderId, setFolderId] = useState<string | null>(dialog.folderSelect?.initialFolderId ?? null);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = value.trim();
  useEscapeToClose(onClose);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    if (!trimmed) return;
    dialog.onSubmit(trimmed, dialog.folderSelect ? folderId : undefined);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-text-dialog-title"
        className="ui-panel border rounded-lg shadow-xl w-full max-w-sm overflow-hidden"
      >
        <div className="ui-bar border-b border-[var(--ui-border)] px-4 py-3 flex items-center justify-between">
          <h2 id="library-text-dialog-title" className="text-base font-semibold text-[var(--ui-text)]">
            {dialog.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ui-control grid shrink-0 place-items-center rounded-lg text-[var(--ui-text-muted)] hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-text)]"
            aria-label={t('Close')}
          >
            <FaTimes aria-hidden="true" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-[var(--ui-text-muted)]">{dialog.label}</span>
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') onClose();
              }}
              placeholder={dialog.placeholder}
              className="min-h-11 w-full ui-input border rounded px-3 py-2 text-sm text-[var(--ui-text)] focus:border-[var(--ui-accent)] outline-none desktop-shell:min-h-0"
            />
          </label>
          {dialog.folderSelect && (
            <label className="block space-y-1">
              <span className="text-sm font-medium text-[var(--ui-text-muted)]">{dialog.folderSelect.label}</span>
              <select
                value={folderId ?? ''}
                onChange={(e) => setFolderId(e.target.value || null)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Escape') onClose();
                }}
                className="min-h-11 w-full ui-input border rounded px-3 py-2 text-sm text-[var(--ui-text)] focus:border-[var(--ui-accent)] outline-none desktop-shell:min-h-0"
              >
                <option value="">{dialog.folderSelect.rootLabel}</option>
                {dialog.folderSelect.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {`${'-- '.repeat(option.depth)}${option.name}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="panel-action-button" onClick={onClose}>
              {t('Cancel')}
            </button>
            <button
              type="button"
              className="panel-action-button active"
              onClick={submit}
              disabled={!trimmed}
            >
              {dialog.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const LibraryConfirmDialog: React.FC<{
  dialog: LibraryConfirmDialogState;
  onClose: () => void;
}> = ({ dialog, onClose }) => {
  const t = useT();
  useEscapeToClose(onClose);

  const confirm = () => {
    dialog.onConfirm();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-confirm-dialog-title"
        className="ui-panel border rounded-lg shadow-xl w-full max-w-sm overflow-hidden"
      >
        <div className="ui-bar border-b border-[var(--ui-border)] px-4 py-3 flex items-center justify-between">
          <h2 id="library-confirm-dialog-title" className="text-base font-semibold text-[var(--ui-text)]">
            {dialog.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ui-control grid shrink-0 place-items-center rounded-lg text-[var(--ui-text-muted)] hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-text)]"
            aria-label={t('Close')}
          >
            <FaTimes aria-hidden="true" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-sm text-[var(--ui-text-muted)]">{dialog.message}</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="panel-action-button" onClick={onClose} autoFocus>
              {t('Cancel')}
            </button>
            <button
              type="button"
              className={['panel-action-button', dialog.danger ? 'danger' : 'active'].join(' ')}
              onClick={confirm}
            >
              {dialog.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface LibraryPanelProps {
  open: boolean;
  docked?: boolean;
  width?: number;
  onClose: () => void;
  showCloseButtonOnDesktop?: boolean;
  isMobile?: boolean;
  getCurrentSgf: () => string;
  onLoadSgf: (sgf: string) => boolean | Promise<boolean>;
  onToast: (msg: string, type: 'info' | 'error' | 'success') => void;
  onOpenPhotoBoard?: (file: File) => void;
  onLibraryUpdated?: () => void;
  onCurrentSaved?: () => void;
  loadedFileId?: string | null;
  loadedFileDirty?: boolean;
  onLoadedFileChange?: (id: string | null, name?: string | null) => void;
  externalFileUpdate?: { id: string; sgf: string; updatedAt: number } | null;
  externalItemCreate?: { item: LibraryItem; updatedAt: number } | null;
}

export const LibraryPanel: React.FC<LibraryPanelProps> = ({
  open,
  docked = false,
  width,
  onClose,
  showCloseButtonOnDesktop = false,
  isMobile = false,
  getCurrentSgf,
  onLoadSgf,
  onToast,
  onOpenPhotoBoard,
  onLibraryUpdated,
  onCurrentSaved,
  loadedFileId = null,
  loadedFileDirty = false,
  onLoadedFileChange,
  externalFileUpdate = null,
  externalItemCreate = null,
}) => {
  const t = useT();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [libraryStatus, setLibraryStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const indexedDbAvailable = useMemo(() => getIndexedDB() !== null, []);
  const [query, setQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(() => {
    const raw = readLocalStorage(LIBRARY_CURRENT_FOLDER_STORAGE_KEY);
    return raw || null;
  });
  // A first-run library is one folder holding every shipped game, and nothing
  // expanded, so opening the panel showed a search box over 640px of nothing.
  // Only true until the reader collapses or expands something themselves.
  const [hadStoredFolderExpansion] = useState(
    () => readLocalStorage(LIBRARY_FOLDERS_EXPANDED_STORAGE_KEY) !== null
  );
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => {
    const raw = readLocalStorage(LIBRARY_FOLDERS_EXPANDED_STORAGE_KEY);
    if (!raw) return new Set();
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((id) => typeof id === 'string'));
    } catch {
      return new Set();
    }
  });
  const [bulkMoveTarget, setBulkMoveTarget] = useState<string>('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverRoot, setDragOverRoot] = useState(false);
  const [textDialog, setTextDialog] = useState<LibraryTextDialogState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<LibraryConfirmDialogState | null>(null);
  const [showOgsSync, setShowOgsSync] = useState(false);
  const [contextMenu, setContextMenu] = useState<LibraryContextMenuState | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const headerMenuButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const didLoadLibraryRef = useRef(false);
  const lastExternalFileUpdateRef = useRef<string | null>(null);
  const lastExternalItemCreateRef = useRef<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const headerActionClass = 'panel-icon-button';
  const bulkActionClass = 'panel-icon-button';
  const bulkDangerActionClass = 'panel-icon-button ui-danger-soft';
  const [sortKey, setSortKey] = useState(() => {
    return readLocalStorage('web-katrain:library_sort:v1') ?? 'recent';
  });
  useEffect(() => {
    let cancelled = false;
    setLibraryStatus('loading');
    setLibraryError(null);
    void loadLibrary()
      .then((loaded) => {
        if (cancelled) return;
        didLoadLibraryRef.current = true;
        setItems(loaded);
        // Nothing is expanded until someone expands it, so a library whose
        // files all live in folders opened on an empty-looking tree. Show what
        // it holds the first time, and only when collapsing hides everything.
        if (!hadStoredFolderExpansion) {
          const hasVisibleFile = loaded.some((item) => !isFolder(item) && item.parentId === null);
          if (!hasVisibleFile) {
            const topLevelFolderIds = loaded
              .filter((item) => isFolder(item) && item.parentId === null)
              .map((item) => item.id);
            if (topLevelFolderIds.length > 0) setExpandedFolderIds(new Set(topLevelFolderIds));
          }
        }
        setLibraryStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        setLibraryStatus('error');
        setLibraryError(error instanceof Error ? error.message : t('Failed to load library.'));
      });
    return () => {
      cancelled = true;
    };
  }, [hadStoredFolderExpansion]);

  useEffect(() => {
    if (!didLoadLibraryRef.current) return;
    let cancelled = false;
    setLibraryStatus('saving');
    setLibraryError(null);
    void saveLibrary(items)
      .then(() => {
        if (cancelled) return;
        setLibraryStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        setLibraryStatus('error');
        setLibraryError(error instanceof Error ? error.message : t('Failed to save library.'));
      });
    return () => {
      cancelled = true;
    };
  }, [items]);

  useEffect(() => {
    if (!didLoadLibraryRef.current || !externalFileUpdate) return;
    const key = `${externalFileUpdate.id}:${externalFileUpdate.updatedAt}`;
    if (lastExternalFileUpdateRef.current === key) return;
    lastExternalFileUpdateRef.current = key;
    setItems((prev) =>
      updateLibraryFileSgf(prev, externalFileUpdate.id, externalFileUpdate.sgf, externalFileUpdate.updatedAt)
    );
  }, [externalFileUpdate]);

  useEffect(() => {
    if (!didLoadLibraryRef.current || !externalItemCreate) return;
    const key = `${externalItemCreate.item.id}:${externalItemCreate.updatedAt}`;
    if (lastExternalItemCreateRef.current === key) return;
    lastExternalItemCreateRef.current = key;
    setItems((prev) =>
      prev.some((item) => item.id === externalItemCreate.item.id)
        ? prev.map((item) => (item.id === externalItemCreate.item.id ? externalItemCreate.item : item))
        : [externalItemCreate.item, ...prev]
    );
  }, [externalItemCreate]);

  const activeFolderId = useMemo(() => {
    if (!currentFolderId) return null;
    const exists = items.some((item) => isFolder(item) && item.id === currentFolderId);
    return exists ? currentFolderId : null;
  }, [currentFolderId, items]);

  const visibleSelectedIds = useMemo(() => {
    if (selectedIds.size === 0) return selectedIds;
    const next = new Set<string>();
    for (const item of items) {
      if (selectedIds.has(item.id)) next.add(item.id);
    }
    return next;
  }, [items, selectedIds]);

  const visibleExpandedFolderIds = useMemo(() => {
    if (expandedFolderIds.size === 0) return expandedFolderIds;
    const next = new Set<string>();
    for (const item of items) {
      if (isFolder(item) && expandedFolderIds.has(item.id)) next.add(item.id);
    }
    return next;
  }, [expandedFolderIds, items]);

  useEffect(() => {
    writeLocalStorage(LIBRARY_CURRENT_FOLDER_STORAGE_KEY, activeFolderId ?? '');
  }, [activeFolderId]);

  useEffect(() => {
    const arr = Array.from(visibleExpandedFolderIds.values());
    writeLocalStorage(LIBRARY_FOLDERS_EXPANDED_STORAGE_KEY, JSON.stringify(arr));
  }, [visibleExpandedFolderIds]);

  useEffect(() => {
    writeLocalStorage('web-katrain:library_sort:v1', String(sortKey));
  }, [sortKey]);

  useEffect(() => {
    onLibraryUpdated?.();
  }, [items, onLibraryUpdated]);

  useEffect(() => {
    if (!contextMenu) return;

    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!headerMenuOpen) return;

    const frame = window.requestAnimationFrame(() => {
      headerMenuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
        ?.focus({ preventScroll: true });
    });
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (headerMenuRef.current?.contains(target) || headerMenuButtonRef.current?.contains(target)) return;
      setHeaderMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (!isLibraryMenuCloseKey(event.key)) return;
      event.preventDefault();
      setHeaderMenuOpen(false);
      headerMenuButtonRef.current?.focus({ preventScroll: true });
    };

    window.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [headerMenuOpen]);

  useEffect(() => {
    if (!contextMenu) return;

    const frame = window.requestAnimationFrame(() => {
      contextMenuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
        ?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [contextMenu]);

  const availableTags = useMemo(() => getAllLibraryTags(items), [items]);

  // Drop a stale active tag once no file carries it anymore.
  useEffect(() => {
    if (activeTag && !availableTags.includes(activeTag)) setActiveTag(null);
  }, [activeTag, availableTags]);

  const filteredItems = useMemo(() => {
    const q = query.trim();
    if (!q && !favoritesOnly && !activeTag) return items;
    return items.filter((item) => {
      if (favoritesOnly || activeTag) {
        if (!isFile(item)) return false;
        if (favoritesOnly && !item.favorite) return false;
        if (activeTag && !(item.tags ?? []).includes(activeTag)) return false;
      }
      if (q && !libraryItemMatchesQuery(item, query)) return false;
      return true;
    });
  }, [items, query, favoritesOnly, activeTag]);

  const isSearching = query.trim().length > 0 || favoritesOnly || activeTag != null;

  const sortedItems = useMemo(() => {
    const arr = [...filteredItems];
    switch (sortKey) {
      case 'name':
        arr.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'moves':
        arr.sort(
          (a, b) =>
            (isFile(b) ? getLibraryFileMoveSortCount(b) : 0) -
            (isFile(a) ? getLibraryFileMoveSortCount(a) : 0)
        );
        break;
      case 'size':
        arr.sort((a, b) => (isFile(b) ? b.size : 0) - (isFile(a) ? a.size : 0));
        break;
      case 'recent':
      default:
        arr.sort((a, b) => b.updatedAt - a.updatedAt);
        break;
    }
    return arr;
  }, [filteredItems, sortKey]);

  /**
   * Rows mounted before "Show more". A library has no size cap and imports SGFs
   * in bulk from a ZIP, so "everything" is not a small number: a seeded library
   * of 1,200 games mounted 1,208 rows and about 35,000 DOM nodes at once, in
   * both the folder view and the search results. Both siblings already page
   * their libraries at 100.
   */
  // Keyed by folder id, with '' for the top level and for search results. A
  // single shared limit would make expanding one folder reveal more rows in
  // every other folder at once.
  const [visibleLimits, setVisibleLimits] = useState<Record<string, number>>({});
  // Only what changes the list itself. The current folder drives breadcrumbs
  // and where a save lands, not which rows are rendered, so moving between
  // folders must not collapse an expanded list back to one page.
  const viewKey = `${query.trim()}\u0000${sortKey}\u0000${favoritesOnly}\u0000${activeTag ?? ''}`;
  const [limitViewKey, setLimitViewKey] = useState(viewKey);
  // Adjusted during render rather than in an effect: an effect runs after paint,
  // so changing the search would paint every matching row before trimming it back.
  if (viewKey !== limitViewKey) {
    setLimitViewKey(viewKey);
    setVisibleLimits({});
  }

  const folderItems = useMemo(() => items.filter(isFolder), [items]);
  const folderOptions = useMemo(() => getLibraryFolderOptions(items), [items]);
  const currentFolder = folderItems.find((folder) => folder.id === activeFolderId) ?? null;
  const currentFolderName = currentFolder?.name ?? t('Root');
  const libraryStats = useMemo(() => getLibraryStats(items), [items]);
  const loadedLibraryFile = useMemo(() => {
    if (!loadedFileId) return null;
    const item = items.find((candidate) => candidate.id === loadedFileId);
    return item && isFile(item) ? item : null;
  }, [items, loadedFileId]);
  const canSaveCurrentToLibrary = libraryStatus !== 'loading' && libraryStatus !== 'error';
  const saveCurrentTitle = !canSaveCurrentToLibrary
    ? t('Library is not ready')
    : loadedLibraryFile
      ? t('Update "{name}" in Library', { name: loadedLibraryFile.name })
      : t('Save current game to Library');
  const libraryStorageBadge = libraryStatus === 'loading'
    ? t('Loading')
    : libraryStatus === 'saving'
      ? t('Saving')
      : libraryStatus === 'error'
        ? t('Error')
        : indexedDbAvailable
          ? t('IndexedDB')
          : t('Local');
  const libraryStorageTitle = libraryError
    ?? (indexedDbAvailable
      ? t('IndexedDB library storage')
      : t('Using local fallback storage because IndexedDB is unavailable'));
  const libraryStatsText = [
    t('{count} game{s}', { count: libraryStats.files, s: libraryStats.files === 1 ? '' : 's' }),
    t('{count} folder{s}', { count: libraryStats.folders, s: libraryStats.folders === 1 ? '' : 's' }),
    formatLibrarySize(libraryStats.size),
  ].join(' · ');
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const parentById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const item of items) map.set(item.id, item.parentId ?? null);
    return map;
  }, [items]);

  const breadcrumbs = useMemo(() => {
    if (!activeFolderId) return [];
    const trail: LibraryFolder[] = [];
    let current: LibraryItem | undefined = items.find((item) => item.id === activeFolderId);
    while (current && isFolder(current)) {
      trail.push(current);
      const parentId = current.parentId ?? null;
      current = parentId ? items.find((item) => item.id === parentId) : undefined;
    }
    return trail.reverse();
  }, [activeFolderId, items]);

  const activeAncestorIds = useMemo(() => {
    if (!loadedFileId) return new Set<string>();
    const ancestors = new Set<string>();
    let current = items.find((item) => item.id === loadedFileId);
    while (current?.parentId) {
      ancestors.add(current.parentId);
      current = items.find((item) => item.id === current?.parentId);
    }
    return ancestors;
  }, [loadedFileId, items]);

  const childrenMap = useMemo(() => {
    const map = new Map<string | null, LibraryItem[]>();
    for (const item of items) {
      const parent = item.parentId ?? null;
      const list = map.get(parent);
      if (list) list.push(item);
      else map.set(parent, [item]);
    }
    for (const [parent, list] of map.entries()) {
      list.sort((a, b) => {
        const aFolder = isFolder(a);
        const bFolder = isFolder(b);
        if (aFolder && !bFolder) return -1;
        if (!aFolder && bFolder) return 1;
        if (aFolder && bFolder) return a.name.localeCompare(b.name);
        switch (sortKey) {
          case 'name':
            return a.name.localeCompare(b.name);
          case 'moves':
            return (
              (isFile(b) ? getLibraryFileMoveSortCount(b) : 0) -
              (isFile(a) ? getLibraryFileMoveSortCount(a) : 0)
            );
          case 'size':
            return (isFile(b) ? b.size : 0) - (isFile(a) ? a.size : 0);
          case 'recent':
          default:
            return b.updatedAt - a.updatedAt;
        }
      });
      map.set(parent, list);
    }
    return map;
  }, [items, sortKey]);

  const isDescendantOf = (candidateId: string | null, ancestorId: string): boolean => {
    if (!candidateId) return false;
    let current = parentById.get(candidateId) ?? null;
    while (current) {
      if (current === ancestorId) return true;
      current = parentById.get(current) ?? null;
    }
    return false;
  };

  const contextMenuItem = contextMenu?.itemId ? (itemById.get(contextMenu.itemId) ?? null) : null;
  const contextMenuSelection = useMemo(() => {
    if (!contextMenuItem) return new Set<string>();
    if (visibleSelectedIds.has(contextMenuItem.id)) return visibleSelectedIds;
    return new Set([contextMenuItem.id]);
  }, [contextMenuItem, visibleSelectedIds]);

  const clampContextMenuPosition = (x: number, y: number): { x: number; y: number } => {
    if (typeof window === 'undefined') return { x, y };
    const menuWidth = 230;
    const menuHeight = 300;
    return {
      x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - menuWidth - 8)),
      y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - menuHeight - 8)),
    };
  };

  const openContextMenuAt = (x: number, y: number, item: LibraryItem | null) => {
    const position = clampContextMenuPosition(x, y);
    setContextMenu({ ...position, itemId: item?.id ?? null });
  };

  const openContextMenu = (event: React.MouseEvent, item: LibraryItem | null) => {
    event.preventDefault();
    event.stopPropagation();
    openContextMenuAt(event.clientX, event.clientY, item);
  };

  const openKeyboardContextMenu = (event: React.KeyboardEvent<HTMLElement>, item: LibraryItem | null) => {
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenuAt(
      rect.left + Math.min(32, rect.width / 2),
      rect.top + Math.min(32, rect.height / 2),
      item
    );
  };

  const openButtonContextMenu = (event: React.MouseEvent<HTMLButtonElement>, item: LibraryItem) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenuAt(rect.right - 230, rect.bottom + 4, item);
  };

  const closeContextMenu = () => setContextMenu(null);

  const handleContextMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isLibraryMenuCloseKey(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      closeContextMenu();
      return;
    }

    const menuItems = Array.from(
      contextMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []
    );
    const currentIndex = menuItems.findIndex((item) => item === document.activeElement);
    const nextIndex = getLibraryMenuNavigationIndex({
      key: event.key,
      currentIndex,
      itemCount: menuItems.length,
    });
    if (nextIndex === null) return;

    event.preventDefault();
    event.stopPropagation();
    menuItems[nextIndex]?.focus();
  };

  const runContextAction = (action: () => void) => {
    closeContextMenu();
    action();
  };

  const handleHeaderMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const menuItems = Array.from(
      headerMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []
    );
    const currentIndex = menuItems.findIndex((item) => item === document.activeElement);
    const nextIndex = getLibraryMenuNavigationIndex({
      key: event.key,
      currentIndex,
      itemCount: menuItems.length,
    });
    if (nextIndex === null) return;

    event.preventDefault();
    event.stopPropagation();
    menuItems[nextIndex]?.focus();
  };

  const runHeaderAction = (action: () => void) => {
    setHeaderMenuOpen(false);
    action();
  };

  const activateFolderRow = (item: LibraryFolder) => {
    setCurrentFolderId(item.id);
    setExpandedFolderIds((prev) => new Set(prev).add(item.id));
  };

  const handleFileRowKeyDown = (item: LibraryFile) => (event: React.KeyboardEvent<HTMLDivElement>) => {
    const action = getLibraryRowKeyAction({ key: event.key, shiftKey: event.shiftKey, kind: 'file' });
    if (action === 'none') return;
    event.preventDefault();
    event.stopPropagation();
    if (action === 'activate') void handleLoad(item);
    else if (action === 'context-menu') openKeyboardContextMenu(event, item);
  };

  const handleFolderRowKeyDown = (
    item: LibraryFolder,
    isExpanded: boolean,
    hasChildren: boolean,
    allowChildren: boolean
  ) => (event: React.KeyboardEvent<HTMLDivElement>) => {
    const action = getLibraryRowKeyAction({
      key: event.key,
      shiftKey: event.shiftKey,
      kind: 'folder',
      isExpanded,
      hasChildren,
      allowChildren,
    });
    if (action === 'none') return;
    event.preventDefault();
    event.stopPropagation();
    if (action === 'activate') activateFolderRow(item);
    else if (action === 'expand') setExpandedFolderIds((prev) => new Set(prev).add(item.id));
    else if (action === 'collapse') {
      setExpandedFolderIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    } else if (action === 'context-menu') {
      openKeyboardContextMenu(event, item);
    }
  };

  const handleSaveCurrent = () => {
    if (!canSaveCurrentToLibrary) {
      onToast(
        libraryStatus === 'loading' ? t('Library is still loading.') : t('Library storage is unavailable.'),
        libraryStatus === 'loading' ? 'info' : 'error'
      );
      return;
    }
    const sgf = getCurrentSgf();
    if (!sgf.trim()) {
      onToast(t('Nothing to save yet.'), 'info');
      return;
    }
    if (loadedLibraryFile) {
      setItems((prev) => updateLibraryFileSgf(prev, loadedLibraryFile.id, sgf));
      onCurrentSaved?.();
      onToast(t('Updated "{name}" in Library.', { name: loadedLibraryFile.name }), 'success');
      return;
    }
    setTextDialog({
      title: t('Save to Library'),
      label: t('Name'),
      initialValue: suggestLibraryItemNameFromSgf(sgf, t('Game {n}', { n: items.length + 1 })),
      placeholder: t('Game name'),
      confirmLabel: t('Save'),
      folderSelect: {
        label: t('Save to folder'),
        rootLabel: t('Root'),
        initialFolderId: currentFolder?.id ?? null,
        options: folderOptions,
      },
      onSubmit: (name, targetFolderId) => {
        const parentId = targetFolderId ?? null;
        const uniqueName = getUniqueLibraryItemName(name, items, parentId);
        const newItem = createLibraryItem(uniqueName, sgf, parentId);
        setItems((prev) => [newItem, ...prev]);
        onLoadedFileChange?.(newItem.id, newItem.name);
        onCurrentSaved?.();
        onToast(t('Saved "{name}" to Library.', { name: newItem.name }), 'success');
      },
    });
  };

  const handleRename = (item: LibraryItem) => {
    setTextDialog({
      title: t(isFolder(item) ? 'Rename Folder' : 'Rename File'),
      label: t('Name'),
      initialValue: item.name,
      placeholder: t(isFolder(item) ? 'Folder name' : 'Game name'),
      confirmLabel: t('Rename'),
      onSubmit: (next) => {
        const uniqueName = getUniqueLibraryItemName(next, items, item.parentId ?? null, item.id);
        setItems((prev) => updateLibraryItem(prev, item.id, { name: uniqueName }));
        if (item.id === loadedFileId) onLoadedFileChange?.(item.id, uniqueName);
      },
    });
  };

  const handleToggleFavorite = (item: LibraryFile) => {
    setItems((prev) => toggleLibraryFileFavorite(prev, item.id));
  };

  const handleEditTags = (item: LibraryFile) => {
    setTextDialog({
      title: t('Tags for {name}', { name: item.name }),
      label: t('Tags (comma-separated)'),
      initialValue: (item.tags ?? []).join(', '),
      placeholder: t('joseki, review, tsumego'),
      confirmLabel: t('Save tags'),
      onSubmit: (next) => {
        setItems((prev) => setLibraryFileTags(prev, item.id, next.split(',')));
      },
    });
  };

  const handleCreateFolder = (parentId: string | null = activeFolderId) => {
    setTextDialog({
      title: t('New Folder'),
      label: t('Name'),
      initialValue: t('New Folder'),
      placeholder: t('Folder name'),
      confirmLabel: t('Create'),
      onSubmit: (name) => {
        const uniqueName = getUniqueLibraryItemName(name, items, parentId);
        const folder = createLibraryFolder(uniqueName, parentId);
        setItems((prev) => [folder, ...prev]);
        setExpandedFolderIds((prev) => new Set(prev).add(folder.id));
        setCurrentFolderId(folder.id);
        onToast(t('Created folder "{name}".', { name: folder.name }), 'success');
      },
    });
  };

  const handleOgsSyncImport = (username: string, games: OgsSyncedGame[]) => {
    if (games.length === 0) return;
    const folderName = ogsSyncFolderName(username);
    let next = items;
    let folder = next.find(
      (item): item is LibraryFolder =>
        isFolder(item) && item.parentId === null && item.name === folderName
    );
    if (!folder) {
      folder = createLibraryFolder(folderName, null);
      next = [folder, ...next];
    }
    const folderId = folder.id;
    const files: LibraryItem[] = [];
    for (const game of games) {
      const name = getUniqueLibraryItemName(
        ogsSyncFileName(game.summary),
        [...next, ...files],
        folderId
      );
      files.push(createLibraryItem(name, game.sgf, folderId));
    }
    setItems([...files, ...next]);
    setExpandedFolderIds((prev) => new Set(prev).add(folderId));
    onToast(t('Synced {count} OGS game{s} into "{folder}".', {
      count: games.length,
      s: games.length === 1 ? '' : 's',
      folder: folderName,
    }), 'success');
  };

  const handleClearLibrary = () => {
    const itemLabel = t('{count} library item{s}', { count: items.length, s: items.length === 1 ? '' : 's' });
    setConfirmDialog({
      title: t('Clear Library'),
      message: t('Clear all {items}? This cannot be undone.', { items: itemLabel }),
      confirmLabel: t('Clear'),
      danger: true,
      onConfirm: () => {
        setItems([]);
        setSelectedIds(new Set());
        onLoadedFileChange?.(null);
        setCurrentFolderId(null);
        onToast(t('Library cleared.'), 'info');
      },
    });
  };

  const handleGoUp = () => {
    if (!activeFolderId) return;
    const parentId = parentById.get(activeFolderId) ?? null;
    setCurrentFolderId(parentId);
  };

  const handleDelete = (item: LibraryItem) => {
    const isFolderItem = isFolder(item);
    const descendantCount = isFolderItem
      ? items.filter((candidate) => isDescendantOf(candidate.id, item.id)).length
      : 0;
    const contentsLabel = descendantCount > 0
      ? t(' and its {count} item{s}', { count: descendantCount, s: descendantCount === 1 ? '' : 's' })
      : '';
    const message = isFolderItem
      ? t('Delete folder "{name}"{contents}? This cannot be undone.', { name: item.name, contents: contentsLabel })
      : t('Delete "{name}" from Library? This cannot be undone.', { name: item.name });
    setConfirmDialog({
      title: t(isFolderItem ? 'Delete Folder' : 'Delete Game'),
      message,
      confirmLabel: t('Delete'),
      danger: true,
      onConfirm: () => {
        setItems((prev) => deleteLibraryItem(prev, item.id));
        if (loadedFileId === item.id || (isFolderItem && loadedFileId && isDescendantOf(loadedFileId, item.id))) {
          onLoadedFileChange?.(null);
        }
      },
    });
  };

  const handleDuplicate = (item: LibraryItem) => {
    const result = duplicateLibraryItem(items, item.id);
    if (!result.duplicated) {
      onToast(t('Failed to duplicate library item.'), 'error');
      return;
    }
    const duplicated = result.duplicated;
    setItems(result.items);
    setSelectedIds(new Set([duplicated.id]));
    if (isFolder(duplicated)) {
      setExpandedFolderIds((prev) => new Set(prev).add(duplicated.id));
    }
    onToast(t('Duplicated "{name}".', { name: item.name }), 'success');
  };

  const handleDownload = (item: LibraryFile) => {
    const blob = new Blob([item.sgf], { type: 'application/x-go-sgf' });
    if (!downloadBlobFile(blob, librarySgfDownloadFilename(item.name))) {
      onToast(t('Failed to start SGF download.'), 'error');
      return;
    }
    onToast(t('Exported "{name}".', { name: item.name }), 'success');
  };

  const handleBackupLibrary = () => {
    try {
      const blob = new Blob([createLibraryBackup(items)], { type: 'application/json' });
      if (!downloadBlobFile(blob, `webkatrain-library-${new Date().toISOString().slice(0, 10)}.json`)) {
        onToast(t('Failed to start library backup download.'), 'error');
        return;
      }
      onToast(t('Library backup downloaded.'), 'success');
    } catch {
      onToast(t('Failed to create library backup.'), 'error');
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    if (!downloadBlobFile(blob, filename)) {
      throw new Error(t('Download unavailable'));
    }
  };

  const handleExportLibraryZip = async () => {
    try {
      const { blob, fileCount } = await createLibraryZipBlob(items);
      if (fileCount === 0) {
        onToast(t('No SGF files to export.'), 'info');
        return;
      }
      downloadBlob(blob, `webkatrain-library-${new Date().toISOString().slice(0, 10)}.zip`);
      onToast(t('Exported {count} SGF file{s} as ZIP.', { count: fileCount, s: fileCount === 1 ? '' : 's' }), 'success');
    } catch {
      onToast(t('Failed to create library ZIP.'), 'error');
    }
  };

  const handleExportFolderZip = async (item: LibraryFolder) => {
    try {
      const { blob, fileCount } = await createLibraryZipBlob(items, new Set([item.id]));
      if (fileCount === 0) {
        onToast(t('Folder "{name}" has no SGF files to export.', { name: item.name }), 'info');
        return;
      }
      downloadBlob(blob, `${safeDownloadName(item.name, 'folder')}.zip`);
      onToast(t('Exported "{name}" with {count} SGF file{s}.', { name: item.name, count: fileCount, s: fileCount === 1 ? '' : 's' }), 'success');
    } catch {
      onToast(t('Failed to export folder ZIP.'), 'error');
    }
  };

  const handleRestoreBackup = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const restored = await restoreLibrary(text);
      didLoadLibraryRef.current = true;
      setItems(restored);
      setSelectedIds(new Set());
      onLoadedFileChange?.(null);
      setCurrentFolderId(null);
      onToast(t('Restored {count} library item{s}.', { count: restored.length, s: restored.length === 1 ? '' : 's' }), 'success');
    } catch {
      onToast(t('Failed to restore library backup.'), 'error');
    } finally {
      if (backupInputRef.current) backupInputRef.current.value = '';
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(sortedItems.map((item) => item.id)));
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
    setBulkMoveTarget('');
  };

  const handleBulkDelete = () => {
    if (visibleSelectedIds.size === 0) return;
    const affectedCount = items.filter((item) => (
      visibleSelectedIds.has(item.id)
      || Array.from(visibleSelectedIds).some((selectedId) => isDescendantOf(item.id, selectedId))
    )).length;
    setConfirmDialog({
      title: t('Delete Selected'),
      message: t('Delete {count} library item{s}? This cannot be undone.', { count: affectedCount, s: affectedCount === 1 ? '' : 's' }),
      confirmLabel: t('Delete'),
      danger: true,
      onConfirm: () => {
        setItems((prev) => {
          let next = prev;
          for (const id of visibleSelectedIds) {
            next = deleteLibraryItem(next, id);
          }
          return next;
        });
        if (
          loadedFileId &&
          Array.from(visibleSelectedIds).some((id) => loadedFileId === id || isDescendantOf(loadedFileId, id))
        ) {
          onLoadedFileChange?.(null);
        }
        setSelectedIds(new Set());
      },
    });
  };

  const handleBulkDuplicate = () => {
    if (visibleSelectedIds.size === 0) return;
    const selected = Array.from(visibleSelectedIds);
    const result = duplicateLibraryItems(items, selected);
    if (result.duplicatedIds.length === 0) {
      onToast(t('No selected items were duplicated.'), 'info');
      return;
    }
    setItems(result.items);
    setSelectedIds(result.duplicated ? new Set([result.duplicated.id]) : new Set());
    onToast(t('Duplicated {count} selected item{s}.', { count: selected.length, s: selected.length === 1 ? '' : 's' }), 'success');
  };

  const handleBulkExport = async () => {
    if (visibleSelectedIds.size === 0) return;
    try {
      const { blob, fileCount } = await createLibraryZipBlob(items, visibleSelectedIds);
      if (fileCount === 0) {
        onToast(t('No files selected to export.'), 'info');
        return;
      }
      downloadBlob(blob, `webkatrain-selection-${new Date().toISOString().slice(0, 10)}.zip`);
      onToast(t('Exported {count} selected SGF file{s} as ZIP.', { count: fileCount, s: fileCount === 1 ? '' : 's' }), 'success');
    } catch {
      onToast(t('Failed to export selected items.'), 'error');
      return;
    }
  };

  const handleBulkMove = () => {
    if (visibleSelectedIds.size === 0) return;
    if (!bulkMoveTarget) return;
    const targetId = bulkMoveTarget === 'root' ? null : bulkMoveTarget;
    const result = moveLibraryItems(items, visibleSelectedIds, targetId);
    setItems(result.items);
    setBulkMoveTarget('');
    if (result.movedIds.length === 0) {
      onToast(t('No selected items were moved.'), 'info');
      return;
    }
    if (result.skippedIds.length > 0) {
      onToast(t('Moved {moved} item(s); skipped {skipped} invalid move(s).', {
        moved: result.movedIds.length,
        skipped: result.skippedIds.length,
      }), 'info');
      return;
    }
    onToast(t('Moved {count} selected item{s}.', { count: result.movedIds.length, s: result.movedIds.length === 1 ? '' : 's' }), 'success');
  };

  const handleMoveToRoot = (item: LibraryItem) => {
    if (!item.parentId) return;
    setItems((prev) => prev.map((candidate) => (
      candidate.id === item.id ? { ...candidate, parentId: null, updatedAt: Date.now() } : candidate
    )));
    onToast(t('Moved "{name}" to Root.', { name: item.name }), 'success');
  };

  const handleLoad = async (item: LibraryItem) => {
    if (!isFile(item)) return;
    try {
      const loaded = await onLoadSgf(item.sgf);
      if (!loaded) return;
      onLoadedFileChange?.(item.id, item.name);
      setCurrentFolderId(item.parentId ?? null);
      onToast(t('Loaded "{name}".', { name: item.name }), 'success');
      if (isMobileLayoutViewport()) {
        onClose();
      }
    } catch {
      onToast(t('Failed to load SGF from Library.'), 'error');
    }
  };

  const handleImportFilesToFolder = async (files: FileList | null, folderId: string | null) => {
    if (!files || files.length === 0) return;
    const imported: LibraryItem[] = [];
    let openedPhotoBoard = false;
    let skippedUnsupportedPhotoImages = 0;
    let skippedInvalidSgfFiles = 0;
    let skippedOversizedSgfFiles = 0;
    const pushImportedItem = (item: LibraryItem) => {
      const uniqueName = getUniqueLibraryItemName(item.name, [...items, ...imported], item.parentId ?? null);
      imported.push(uniqueName === item.name ? item : { ...item, name: uniqueName });
    };
    for (const file of Array.from(files)) {
      const name = file.name.toLowerCase();
      try {
        if (isPhotoBoardImageFile(file)) {
          if (!openedPhotoBoard && onOpenPhotoBoard) {
            onOpenPhotoBoard(file);
            openedPhotoBoard = true;
          }
          continue;
        }
        if (isUnsupportedPhotoBoardImageFile(file)) {
          skippedUnsupportedPhotoImages += 1;
          continue;
        }
        if (name.endsWith('.zip')) {
          for (const item of await importLibraryItemsFromZip(file, folderId)) pushImportedItem(item);
          continue;
        }
        if (!name.endsWith('.sgf')) continue;
        if (getSgfImportSizeError(file.size)) {
          skippedOversizedSgfFiles += 1;
          continue;
        }
        const text = await file.text();
        try {
          assertValidLibrarySgfImport(text);
        } catch {
          skippedInvalidSgfFiles += 1;
          continue;
        }
        pushImportedItem(createLibraryItem(file.name.replace(/\.sgf$/i, ''), text, folderId));
      } catch {
        // ignore per-file failures
      }
    }
    if (imported.length === 0) {
      onToast(
        openedPhotoBoard
          ? t('Opened photo board from image.')
          : skippedUnsupportedPhotoImages > 0
            ? PHOTO_BOARD_UNSUPPORTED_IMAGE_MESSAGE
            : skippedOversizedSgfFiles > 0
              ? t('SGF files are limited to {limit}. {count} file{s} skipped.', {
                  limit: MAX_SGF_IMPORT_LABEL,
                  count: skippedOversizedSgfFiles,
                  s: skippedOversizedSgfFiles === 1 ? '' : 's',
                })
            : skippedInvalidSgfFiles > 0
              ? t('No valid SGF games were imported.')
              : t('No SGF, ZIP, or board image files were imported.'),
        (skippedUnsupportedPhotoImages > 0 || skippedOversizedSgfFiles > 0 || skippedInvalidSgfFiles > 0) && !openedPhotoBoard ? 'error' : 'info'
      );
      return;
    }
    setItems((prev) => [...imported, ...prev]);
    const importedFiles = imported.filter(isFile).length;
    const skippedUnsupportedSummary = skippedUnsupportedPhotoImages > 0
      ? t(' Skipped {count} unsupported board image{s}.', { count: skippedUnsupportedPhotoImages, s: skippedUnsupportedPhotoImages === 1 ? '' : 's' })
      : '';
    const skippedInvalidSgfSummary = skippedInvalidSgfFiles > 0
      ? t(' Skipped {count} invalid SGF file{s}.', { count: skippedInvalidSgfFiles, s: skippedInvalidSgfFiles === 1 ? '' : 's' })
      : '';
    onToast(
      `${t('Imported {count} file{s}', { count: importedFiles, s: importedFiles === 1 ? '' : 's' })}${openedPhotoBoard ? t(' and opened photo board image') : ''}.${skippedUnsupportedSummary}${skippedInvalidSgfSummary}`,
      'success'
    );
  };

  const handleImportFiles = async (files: FileList | null) =>
    handleImportFilesToFolder(files, activeFolderId);

  const handleImportDroppedTextToFolder = async (
    dataTransfer: DataTransfer,
    folderId: string | null
  ): Promise<boolean> => {
    const droppedText = getDroppedSgfOrOgsText(dataTransfer);
    if (!droppedText) return false;
    try {
      const result = await createLibraryItemFromSgfOrOgsText(
        droppedText,
        folderId,
        t('Game {n}', { n: items.length + 1 })
      );
      const uniqueName = getUniqueLibraryItemName(result.item.name, items, result.item.parentId ?? null);
      const item = uniqueName === result.item.name ? result.item : { ...result.item, name: uniqueName };
      setItems((prev) => [item, ...prev]);
      onToast(
        result.source === 'ogs' && result.gameId
          ? t('Imported OGS game {id} to Library.', { id: result.gameId })
          : t('Imported "{name}" to Library.', { name: item.name }),
        'success'
      );
    } catch {
      onToast(t('Failed to import dropped SGF or OGS URL.'), 'error');
    }
    return true;
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      await handleImportFiles(event.dataTransfer.files);
      return;
    }
    if (await handleImportDroppedTextToFolder(event.dataTransfer, activeFolderId)) return;
    if (draggingId) {
      setItems((prev) =>
        prev.map((item) => (item.id === draggingId ? { ...item, parentId: null, updatedAt: Date.now() } : item))
      );
      setDraggingId(null);
      setDragOverRoot(false);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!draggingId && (event.dataTransfer.types.includes('Files') || hasPotentialGameImportDrag(event.dataTransfer))) {
      setIsDragging(true);
    } else {
      setIsDragging(false);
    }
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleItemDragStart = (id: string) => (event: React.DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData('text/plain', id);
    event.dataTransfer.effectAllowed = 'move';
    setDraggingId(id);
  };

  const handleItemDragEnd = () => {
    setDraggingId(null);
    setDragOverId(null);
    setDragOverRoot(false);
  };

  const handleDropOnFolder = (folderId: string) => async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      await handleImportFilesToFolder(event.dataTransfer.files, folderId);
      setDragOverId(null);
      return;
    }
    if (await handleImportDroppedTextToFolder(event.dataTransfer, folderId)) {
      setDragOverId(null);
      return;
    }
    const id = draggingId || event.dataTransfer.getData('text/plain');
    if (!id || id === folderId) return;
    if (isDescendantOf(folderId, id)) return;
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, parentId: folderId, updatedAt: Date.now() } : item))
    );
    setDraggingId(null);
    setDragOverId(null);
  };

  const handleRootDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    setDragOverRoot(true);
  };

  const handleRootDragLeave = () => setDragOverRoot(false);

  const handleRootDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    if (await handleImportDroppedTextToFolder(event.dataTransfer, null)) {
      setDragOverRoot(false);
      return;
    }
    if (!draggingId) return;
    setItems((prev) =>
      prev.map((item) => (item.id === draggingId ? { ...item, parentId: null, updatedAt: Date.now() } : item))
    );
    setDraggingId(null);
    setDragOverRoot(false);
  };

  const limitFor = (key: string) => visibleLimits[key] ?? LIBRARY_PAGE_SIZE;

  /**
   * Reveals another page of one list. Selection deliberately still spans every
   * match rather than only the mounted rows, which is what it did before paging
   * and what the "Select all" label says.
   */
  const renderShowMore = (key: string, total: number, depth = 0) => {
    const hidden = total - limitFor(key);
    if (hidden <= 0) return null;
    return (
      <button
        type="button"
        className="library-show-more"
        style={depth > 0 ? { marginLeft: 12 + depth * 16 } : undefined}
        onClick={() =>
          setVisibleLimits((limits) => ({
            ...limits,
            [key]: limitFor(key) + LIBRARY_PAGE_SIZE,
          }))
        }
      >
        {t('Show {shown} more of {total}', {
          shown: Math.min(hidden, LIBRARY_PAGE_SIZE),
          total,
        })}
      </button>
    );
  };

  const renderFileRow = (item: LibraryFile, depth: number) => {
    const isSelected = visibleSelectedIds.has(item.id);
    const isLoaded = loadedFileId === item.id;
    const isLoadedDirty = isLoaded && loadedFileDirty;
    const selectFileLabel = t(isSelected ? 'Deselect {name}' : 'Select {name}', { name: item.name });
    const duplicateFileLabel = t('Duplicate {name}', { name: item.name });
    const downloadFileLabel = t('Download {name} as SGF', { name: item.name });
    const renameFileLabel = t('Rename {name}', { name: item.name });
    const deleteFileLabel = t('Delete {name}', { name: item.name });
    const moveSummary = getLibraryFileMoveSummary(item);
    return (
      <div
        key={item.id}
        className={[
          'library-tree-node',
          isSelected ? 'selected' : '',
          isLoaded ? 'loaded' : '',
          isLoadedDirty ? 'dirty' : '',
        ].join(' ')}
        style={{ paddingLeft: 12 + depth * 16 }}
        role="treeitem"
        tabIndex={0}
        aria-selected={isSelected}
        aria-current={isLoaded ? 'true' : undefined}
        aria-label={`${item.name}, ${t('game file')}, ${moveSummary}${isLoadedDirty ? `, ${t('unsaved changes')}` : ''}`}
        data-library-row="file"
        data-library-row-name={item.name}
        data-library-loaded-dirty={isLoadedDirty ? 'true' : undefined}
        onClick={() => void handleLoad(item)}
        onKeyDown={handleFileRowKeyDown(item)}
        onContextMenu={(event) => openContextMenu(event, item)}
        draggable
        onDragStart={handleItemDragStart(item.id)}
        onDragEnd={handleItemDragEnd}
      >
        <button
          type="button"
          className={[
            'library-tree-node-select',
            isSelected ? 'is-visible' : '',
          ].join(' ')}
          onClick={(e) => {
            e.stopPropagation();
            handleToggleSelect(item.id);
          }}
          title={selectFileLabel}
          aria-label={selectFileLabel}
        >
          {isSelected ? <FaCheckSquare size={12} /> : <FaSquare size={12} />}
        </button>
        <span className="library-tree-node-icon">
          {item.favorite ? <FaStar size={12} className="text-amber-400" /> : <FaFileAlt size={12} />}
        </span>
        <div className="library-tree-node-name">{item.name}</div>
        <div className="library-tree-node-meta">
          {(item.metadata.black || item.metadata.white) &&
          !libraryNameRepeatsPlayers(item.name, item.metadata.black, item.metadata.white)
            ? `${t('{black} vs {white}', { black: item.metadata.black ?? t('Black'), white: item.metadata.white ?? t('White') })} · `
            : ''}
          {item.metadata.date ? `${item.metadata.date} · ` : ''}
          {moveSummary} · {(item.size / 1024).toFixed(1)} KB
          {tagsFromResult(item.metadata.result).map((tag) => (
            <span key={tag.id} className="ml-1 opacity-80" title={tag.title}>· {tag.label}</span>
          ))}
          {(item.tags ?? []).length > 0 && (
            <span className="ml-1 text-[var(--ui-accent)]">
              {' · '}
              {(item.tags ?? []).map((tag) => `#${tag}`).join(' ')}
            </span>
          )}
        </div>
        {isLoadedDirty && (
          <span
            className="library-dirty-indicator"
            title={t('Unsaved changes')}
            aria-label={t('Unsaved changes')}
            data-library-dirty-indicator="true"
          >
            {t('Unsaved')}
          </span>
        )}
        <div className="library-tree-node-actions">
          <button
            type="button"
            className="library-tree-node-action"
            onClick={(e) => {
              e.stopPropagation();
              handleToggleFavorite(item);
            }}
            title={item.favorite ? t('Unstar {name}', { name: item.name }) : t('Star {name}', { name: item.name })}
            aria-label={item.favorite ? t('Unstar {name}', { name: item.name }) : t('Star {name}', { name: item.name })}
            aria-pressed={!!item.favorite}
          >
            {item.favorite ? <FaStar size={12} className="text-amber-400" /> : <FaRegStar size={12} />}
          </button>
          <button
            type="button"
            className="library-tree-node-action"
            onClick={(e) => {
              e.stopPropagation();
              handleEditTags(item);
            }}
            title={t('Edit tags for {name}', { name: item.name })}
            aria-label={t('Edit tags for {name}', { name: item.name })}
          >
            <FaTag size={12} />
          </button>
          <button
            type="button"
            className="library-tree-node-action"
            onClick={(e) => {
              e.stopPropagation();
              handleDuplicate(item);
            }}
            title={duplicateFileLabel}
            aria-label={duplicateFileLabel}
          >
            <FaCopy size={12} />
          </button>
          <button
            type="button"
            className="library-tree-node-action"
            onClick={(e) => {
              e.stopPropagation();
              handleDownload(item);
            }}
            title={downloadFileLabel}
            aria-label={downloadFileLabel}
          >
            <FaDownload size={12} />
          </button>
          <button
            type="button"
            className="library-tree-node-action"
            onClick={(e) => {
              e.stopPropagation();
              handleRename(item);
            }}
            title={renameFileLabel}
            aria-label={renameFileLabel}
          >
            <FaPen size={12} />
          </button>
          <button
            type="button"
            className="library-tree-node-action danger"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(item);
            }}
            title={deleteFileLabel}
            aria-label={deleteFileLabel}
          >
            <FaTrash size={12} />
          </button>
        </div>
      </div>
    );
  };

  const renderFolderRow = (item: LibraryFolder, depth: number, allowChildren = true) => {
    const isExpanded = visibleExpandedFolderIds.has(item.id);
    const children = childrenMap.get(item.id) ?? [];
    const isSelected = visibleSelectedIds.has(item.id);
    const hasLoaded = activeAncestorIds.has(item.id);
    const hasDirtyLoaded = hasLoaded && loadedFileDirty;
    const toggleFolderLabel = t(isExpanded ? 'Collapse {name}' : 'Expand {name}', { name: item.name });
    const selectFolderLabel = t(isSelected ? 'Deselect {name}' : 'Select {name}', { name: item.name });
    const duplicateFolderLabel = t('Duplicate {name}', { name: item.name });
    const exportFolderLabel = t('Export {name} as ZIP', { name: item.name });
    const renameFolderLabel = t('Rename {name}', { name: item.name });
    const deleteFolderLabel = t('Delete {name}', { name: item.name });
    const moreFolderActionsLabel = t('More actions for {name}', { name: item.name });
    return (
      <div key={item.id}>
        <div
          className={[
            'library-tree-node',
            isSelected ? 'selected' : '',
            activeFolderId === item.id ? 'selected' : '',
            hasLoaded ? 'has-loaded' : '',
            hasDirtyLoaded ? 'has-loaded-dirty' : '',
            dragOverId === item.id ? 'drop-target' : '',
          ].join(' ')}
          style={{ paddingLeft: 12 + depth * 16 }}
          role="treeitem"
          tabIndex={0}
          aria-selected={isSelected || activeFolderId === item.id}
          aria-expanded={allowChildren && children.length > 0 ? isExpanded : undefined}
          aria-label={`${item.name}, ${t('folder')}, ${t('{count} item{s}', { count: children.length, s: children.length === 1 ? '' : 's' })}${hasDirtyLoaded ? `, ${t('contains loaded game with unsaved changes')}` : ''}`}
          data-library-row="folder"
          data-library-row-name={item.name}
          data-library-folder-loaded-dirty={hasDirtyLoaded ? 'true' : undefined}
          onClick={() => activateFolderRow(item)}
          onKeyDown={handleFolderRowKeyDown(item, isExpanded, children.length > 0, allowChildren)}
          onContextMenu={(event) => openContextMenu(event, item)}
          draggable
          onDragStart={handleItemDragStart(item.id)}
          onDragEnd={handleItemDragEnd}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            setDragOverId(item.id);
          }}
          onDragLeave={() => setDragOverId(null)}
          onDrop={handleDropOnFolder(item.id)}
        >
          <button
            type="button"
            className={['library-tree-node-arrow', isExpanded ? 'expanded' : ''].join(' ')}
            onClick={(e) => {
              e.stopPropagation();
              setExpandedFolderIds((prev) => {
                const next = new Set(prev);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
              });
            }}
            title={toggleFolderLabel}
            aria-label={toggleFolderLabel}
          >
            <FaChevronRight size={12} />
          </button>
          <button
            type="button"
            className={[
              'library-tree-node-select',
              isSelected ? 'is-visible' : '',
            ].join(' ')}
            onClick={(e) => {
              e.stopPropagation();
              handleToggleSelect(item.id);
            }}
            title={selectFolderLabel}
            aria-label={selectFolderLabel}
          >
            {isSelected ? <FaCheckSquare size={12} /> : <FaSquare size={12} />}
          </button>
          <span className="library-tree-node-icon">
            <FaFolderOpen size={12} />
          </span>
          <div className="library-tree-node-name">{item.name}</div>
          <div className="library-tree-node-meta">{children.length}</div>
          <div className="library-tree-node-actions">
            <button
              type="button"
              className="library-tree-node-action"
              onClick={(e) => {
                e.stopPropagation();
                handleDuplicate(item);
              }}
              title={duplicateFolderLabel}
              aria-label={duplicateFolderLabel}
            >
              <FaCopy size={12} />
            </button>
            <button
              type="button"
              className="library-tree-node-action"
              onClick={(e) => {
                e.stopPropagation();
                void handleExportFolderZip(item);
              }}
              title={exportFolderLabel}
              aria-label={exportFolderLabel}
            >
              <FaDownload size={12} />
            </button>
            <button
              type="button"
              className="library-tree-node-action"
              onClick={(e) => {
                e.stopPropagation();
                handleRename(item);
              }}
              title={renameFolderLabel}
              aria-label={renameFolderLabel}
            >
              <FaPen size={12} />
            </button>
            <button
              type="button"
              className="library-tree-node-action danger"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(item);
              }}
              title={deleteFolderLabel}
              aria-label={deleteFolderLabel}
            >
              <FaTrash size={12} />
            </button>
          </div>
          <button
            type="button"
            className="library-tree-node-more"
            onClick={(event) => openButtonContextMenu(event, item)}
            title={moreFolderActionsLabel}
            aria-label={moreFolderActionsLabel}
            aria-haspopup="menu"
            aria-expanded={contextMenu?.itemId === item.id}
          >
            <FaEllipsisH size={14} />
          </button>
        </div>
        {allowChildren && isExpanded && children.length > 0 && (
          <div>
            {children.slice(0, limitFor(item.id)).map((child) =>
              isFolder(child) ? renderFolderRow(child, depth + 1, allowChildren) : renderFileRow(child, depth + 1)
            )}
            {renderShowMore(item.id, children.length, depth + 1)}
          </div>
        )}
      </div>
    );
  };

  const renderContextMenu = () => {
    if (!contextMenu) return null;
    const menuButtonClass = 'library-context-menu-item';
    const dangerMenuButtonClass = 'library-context-menu-item danger';

    return (
      <div
        ref={contextMenuRef}
        className="library-context-menu"
        style={{
          left: contextMenu.x,
          top: contextMenu.y,
          maxHeight: isMobile
            ? `calc(100dvh - ${contextMenu.y + 8}px - var(--mobile-tabbar-height) - env(safe-area-inset-bottom))`
            : `calc(100dvh - ${contextMenu.y + 8}px)`,
        }}
        role="menu"
        aria-label={t('Library actions')}
        onKeyDown={handleContextMenuKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {!contextMenuItem ? (
          <button
            type="button"
            role="menuitem"
            className={menuButtonClass}
            onClick={() => runContextAction(() => handleCreateFolder())}
          >
            <FaPlus size={12} /> {t('New folder')}
          </button>
        ) : contextMenuSelection.size > 1 && contextMenuSelection.has(contextMenuItem.id) ? (
          <>
            <div className="library-context-menu-header">{t('{count} selected', { count: contextMenuSelection.size })}</div>
            <button
              type="button"
              role="menuitem"
              className={menuButtonClass}
              onClick={() => runContextAction(handleBulkDuplicate)}
            >
              <FaCopy size={12} /> {t('Duplicate selected')}
            </button>
            <button
              type="button"
              role="menuitem"
              className={menuButtonClass}
              onClick={() => runContextAction(() => void handleBulkExport())}
            >
              <FaDownload size={12} /> {t('Export selected as ZIP')}
            </button>
            <div className="library-context-menu-separator" />
            <button
              type="button"
              role="menuitem"
              className={dangerMenuButtonClass}
              onClick={() => runContextAction(handleBulkDelete)}
            >
              <FaTrash size={12} /> {t('Delete selected')}
            </button>
          </>
        ) : (
          <>
            {isFile(contextMenuItem) && (
              <button
                type="button"
                role="menuitem"
                className={menuButtonClass}
                onClick={() => runContextAction(() => void handleLoad(contextMenuItem))}
              >
                <FaPlay size={12} /> {t('Load')}
              </button>
            )}
            {isFolder(contextMenuItem) && (
              <button
                type="button"
                role="menuitem"
                className={menuButtonClass}
                onClick={() => runContextAction(() => handleCreateFolder(contextMenuItem.id))}
              >
                <FaPlus size={12} /> {t('New folder inside')}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className={menuButtonClass}
              onClick={() => runContextAction(() => handleRename(contextMenuItem))}
            >
              <FaPen size={12} /> {t('Rename')}
            </button>
            <button
              type="button"
              role="menuitem"
              className={menuButtonClass}
              onClick={() => runContextAction(() => handleDuplicate(contextMenuItem))}
            >
              <FaCopy size={12} /> {t('Duplicate')}
            </button>
            <button
              type="button"
              role="menuitem"
              className={menuButtonClass}
              onClick={() => runContextAction(() => {
                if (isFile(contextMenuItem)) handleDownload(contextMenuItem);
                else void handleExportFolderZip(contextMenuItem);
              })}
            >
              <FaDownload size={12} /> {t(isFile(contextMenuItem) ? 'Download SGF' : 'Export folder as ZIP')}
            </button>
            {contextMenuItem.parentId && (
              <button
                type="button"
                role="menuitem"
                className={menuButtonClass}
                onClick={() => runContextAction(() => handleMoveToRoot(contextMenuItem))}
              >
                <FaArrowUp size={12} /> {t('Move to Root')}
              </button>
            )}
            <div className="library-context-menu-separator" />
            <button
              type="button"
              role="menuitem"
              className={dangerMenuButtonClass}
              onClick={() => runContextAction(() => handleDelete(contextMenuItem))}
            >
              <FaTrash size={12} /> {t('Delete')}
            </button>
          </>
        )}
      </div>
    );
  };

  if (!open) return null;

  const renderSection = (args: {
    title: string;
    open: boolean;
    onToggle: () => void;
    actions?: React.ReactNode;
    hideHeader?: boolean;
    wrapperClassName?: string;
    contentClassName?: string;
    children: React.ReactNode;
  }) => {
    const wrapperTone = args.open ? panelCardOpen : panelCardClosed;
    return (
      <div
        className={[
          panelCardBase,
          wrapperTone,
          args.wrapperClassName ?? '',
        ].join(' ')}
      >
        {!args.hideHeader && (
          <SectionHeader
            title={args.title}
            open={args.open}
            onToggle={args.onToggle}
            actions={args.actions}
          />
        )}
        {args.open ? (
          <div className={args.contentClassName ?? 'panel-section-content'}>
            {args.children}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <>
      {textDialog && <LibraryTextDialog dialog={textDialog} onClose={() => setTextDialog(null)} />}
      {confirmDialog && <LibraryConfirmDialog dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />}
      {showOgsSync && (
        <OgsSyncModal items={items} onClose={() => setShowOgsSync(false)} onImport={handleOgsSyncImport} />
      )}
      <div className="fixed inset-0 bg-black/60 z-30 lg:hidden" onClick={onClose} />
      <div
        ref={panelRef}
        data-dropzone="library"
        data-layout-panel="library"
        {...(isMobile
          ? { role: 'tabpanel', id: MOBILE_TAB_PANEL_IDS.library, 'aria-labelledby': mobileTabId('library') }
          : {})}
        className={[
          'library-panel ui-panel border-r flex flex-col overflow-x-hidden relative',
          'fixed inset-y-0 left-0 z-40 w-full max-w-none sm:max-w-sm',
          'lg:static lg:z-auto',
          docked ? 'lg:max-w-none' : 'lg:w-80',
          isMobile ? 'mobile-safe-bottom mobile-safe-inset' : '',
        ].join(' ')}
        style={docked && width ? { width } : undefined}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="ui-bar ui-bar-height ui-bar-pad relative border-b border-[var(--ui-border)] flex items-center gap-2">
          {/* Library is a tab in the mobile shell, reached and left the same way
              as Tree and Review, so it uses their back affordance rather than a
              dismiss cross — three sibling tabs should not need three different
              ways out. Docked on desktop it is a panel being closed, so the
              cross stays there. Shares RightPanel's classes so the two headers
              cannot drift; the tree-tab overrides on them are scoped to
              .mobile-panel-header, which this is not. */}
          {isMobile ? (
            <button
              type="button"
              className="mobile-panel-back h-11 min-h-11 min-w-11 shrink-0 px-3 flex items-center gap-2 rounded-md hover:bg-[var(--ui-surface-2)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)] transition-colors"
              onClick={onClose}
              title={t('Back to board')}
              aria-label={t('Back to board')}
            >
              <FaChevronLeft size={12} aria-hidden="true" />
              <span className="mobile-panel-back-label text-sm font-medium">{t('Board')}</span>
            </button>
          ) : (
            <button
              type="button"
              className={[
                showCloseButtonOnDesktop ? '' : 'lg:hidden',
                'h-9 w-9',
                'shrink-0 flex items-center justify-center rounded-lg hover:bg-[var(--ui-surface-2)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)] transition-colors',
              ].join(' ')}
              onClick={onClose}
              title={t('Close library')}
              aria-label={t('Close library')}
            >
              <FaTimes />
            </button>
          )}
          <div className="text-sm font-semibold text-[var(--ui-text)]">{t('Library')}</div>
          <div
            className={[
              'hidden sm:inline-flex px-2 py-0.5 rounded border text-[0.625rem] font-semibold uppercase tracking-wider',
              libraryStatus === 'error'
                ? 'ui-danger-soft text-[var(--ui-danger)] border-[var(--ui-danger)]'
                : libraryStatus === 'saving'
                  ? 'bg-[var(--ui-warning-soft)] text-[var(--ui-warning)] border-[var(--ui-warning)]'
                  : !indexedDbAvailable
                    ? 'bg-[var(--ui-warning-soft)] text-[var(--ui-warning)] border-[var(--ui-warning)]'
                    : 'ui-success-soft text-[var(--ui-success)] border-[var(--ui-success)]',
            ].join(' ')}
            title={libraryStorageTitle}
            data-library-storage-badge="true"
          >
            {libraryStorageBadge}
          </div>
          <div className="flex flex-wrap items-center gap-1 ml-auto">
            <button
              type="button"
              className={`${headerActionClass} library-header-collapsible-action`}
              onClick={() => handleCreateFolder()}
              title={t('Create new folder')}
              aria-label={t('Create new folder')}
            >
              <FaPlus />
            </button>
            <button
              type="button"
              className={headerActionClass}
              onClick={handleSaveCurrent}
              disabled={!canSaveCurrentToLibrary}
              title={saveCurrentTitle}
              aria-label={loadedLibraryFile ? t('Update loaded library game') : t('Save current game to Library')}
            >
              <FaSave />
            </button>
            <button
              type="button"
              className={`${headerActionClass} library-header-collapsible-action`}
              onClick={() => fileInputRef.current?.click()}
              title={t('Import SGF, ZIP, or board image files')}
              aria-label={t('Import SGF, ZIP, or board image files')}
            >
              <FaFolderOpen />
            </button>
            <button
              type="button"
              ref={headerMenuButtonRef}
              className={headerActionClass}
              onClick={() => setHeaderMenuOpen((prev) => !prev)}
              title={t('More library actions')}
              aria-label={t('More library actions')}
              aria-haspopup="menu"
              aria-expanded={headerMenuOpen}
            >
              <FaEllipsisH />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={libraryImportAccept}
              multiple
              onChange={(e) => void handleImportFiles(e.target.files)}
              className="hidden"
            />
            <input
              ref={backupInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => void handleRestoreBackup(e.target.files)}
              className="hidden"
            />
          </div>

          {headerMenuOpen && (
            <div
              ref={headerMenuRef}
              className="library-context-menu"
              style={{
                position: 'absolute',
                right: 8,
                top: 'calc(100% - 4px)',
                left: 'auto',
                maxHeight: isMobile
                  ? 'calc(100dvh - var(--ui-bar-height) - var(--mobile-tabbar-height) - env(safe-area-inset-bottom) - 8px)'
                  : 'calc(100dvh - var(--ui-bar-height) - 8px)',
              }}
            role="menu"
            aria-label={t('More library actions')}
            onKeyDown={handleHeaderMenuKeyDown}
            onPointerDown={(event) => event.stopPropagation()}
          >
              <button
                type="button"
                role="menuitem"
                className="library-context-menu-item"
                onClick={() => runHeaderAction(() => handleCreateFolder())}
              >
                <FaPlus size={12} /> {t('Create new folder')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="library-context-menu-item"
                onClick={() => runHeaderAction(() => fileInputRef.current?.click())}
              >
                <FaFolderOpen size={12} /> {t('Import files')}
              </button>
              <div className="library-context-menu-separator" />
              <button
                type="button"
                role="menuitem"
                className="library-context-menu-item"
                onClick={() => runHeaderAction(() => void handleExportLibraryZip())}
              >
                <FaFileArchive size={12} /> {t('Export library as ZIP')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="library-context-menu-item"
                onClick={() => runHeaderAction(() => setShowOgsSync(true))}
              >
                <FaCloudDownloadAlt size={12} /> {t('Sync from OGS')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="library-context-menu-item"
                onClick={() => runHeaderAction(handleBackupLibrary)}
              >
                <FaDownload size={12} /> {t('Download backup')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="library-context-menu-item"
                onClick={() => runHeaderAction(() => backupInputRef.current?.click())}
              >
                <FaUpload size={12} /> {t('Restore backup')}
              </button>
              <div className="library-context-menu-separator" />
              <button
                type="button"
                role="menuitem"
                className="library-context-menu-item danger"
                onClick={() => runHeaderAction(handleClearLibrary)}
              >
                <FaTrash size={12} /> {t('Clear library')}
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <div className="flex flex-col min-h-0">
            {renderSection({
              title: t('Library'),
              open: true,
              onToggle: () => {},
              // The panel's own bar already says Library, and this is its only
              // section — collapsing it just blanked the panel, which the close
              // control does better. Both shells hide the repeated title.
              hideHeader: true,
              contentClassName: 'panel-section-content flex flex-col min-h-0 p-0',
              children: (
                <>
              <div className="panel-toolbar" data-library-toolbar="true">
                <div className="relative flex-1 min-w-[160px]">
                  <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 ui-text-faint text-xs" />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label={t('Search library')}
                    placeholder={t('Search library…')}
                    // Matching truncates past this anyway; stopping it at the
                    // input keeps a pasted record out of React state as well.
                    maxLength={MAX_SEARCH_QUERY_LENGTH}
                    data-library-search="true"
                    className="w-full ui-input border rounded pl-8 pr-9 py-1 text-sm text-[var(--ui-text)] focus:border-[var(--ui-accent)]"
                  />
                  {query && (
                    <button
                      type="button"
                      className="library-search-clear absolute right-0 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded text-[var(--ui-text-muted)] hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-text)]"
                      onClick={() => setQuery('')}
                      aria-label={t('Clear library search')}
                    >
                      <FaTimes aria-hidden="true" size={11} />
                    </button>
                  )}
                </div>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value)}
                  className="ui-input border rounded px-2 py-1 text-xs text-[var(--ui-text)]"
                  aria-label={t('Sort library')}
                  title={t('Sort')}
                >
                  <option value="recent">{t('Recent')}</option>
                  <option value="name">{t('Name')}</option>
                  <option value="moves">{t('Moves')}</option>
                  <option value="size">{t('Size')}</option>
                </select>
                <button
                  type="button"
                  className="panel-icon-button"
                  onClick={() => setFavoritesOnly((prev) => !prev)}
                  aria-pressed={favoritesOnly}
                  title={favoritesOnly ? t('Show all games') : t('Show favorites only')}
                  aria-label={favoritesOnly ? t('Show all games') : t('Show favorites only')}
                  style={favoritesOnly ? { color: 'var(--ui-accent)' } : undefined}
                >
                  {favoritesOnly ? <FaStar size={12} className="text-amber-400" /> : <FaRegStar size={12} />}
                </button>
                {availableTags.length > 0 && (
                  <select
                    value={activeTag ?? ''}
                    onChange={(e) => setActiveTag(e.target.value || null)}
                    className="ui-input border rounded px-2 py-1 text-xs text-[var(--ui-text)]"
                    aria-label={t('Filter by tag')}
                    title={t('Filter by tag')}
                  >
                    <option value="">{t('All tags')}</option>
                    {availableTags.map((tag) => (
                      <option key={tag} value={tag}>#{tag}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  className="panel-icon-button"
                  onClick={handleGoUp}
                  disabled={!activeFolderId}
                  title={t('Go to parent folder')}
                  aria-label={t('Go to parent folder')}
                >
                  <FaArrowUp size={12} />
                </button>
                <button
                  type="button"
                  className="panel-icon-button"
                  onClick={() => setCurrentFolderId(null)}
                  disabled={!activeFolderId}
                  title={activeFolderId ? t('Go to library root') : t('Already at library root')}
                  aria-label={t('Go to library root')}
                >
                  <FaFolderOpen size={12} />
                </button>
                {/* The trail sat in a band of its own under a toolbar row that
                    was empty between the root button and the item count. It
                    reads as the same thing, so it shares the row. */}
                <div className="library-breadcrumbs flex min-w-0 flex-wrap items-center gap-1 text-[0.6875rem] ui-text-faint">
                  {/* The trail already ends at the current folder, so naming it
                      in the label too printed it twice ("Folder: X  X"). */}
                  <span>{t('Folder')}:</span>
                  {isSearching || breadcrumbs.length === 0 ? (
                    <span>{currentFolderName}</span>
                  ) : (
                    breadcrumbs.map((crumb, index) => (
                      <button
                        key={crumb.id}
                        type="button"
                        className="library-breadcrumb-button px-1.5 py-0.5 rounded hover:bg-[var(--ui-surface-2)] ui-text-faint"
                        onClick={() => setCurrentFolderId(crumb.id)}
                        aria-label={t('Open folder {name}', { name: crumb.name })}
                      >
                        {index === 0 ? crumb.name : `/${crumb.name}`}
                      </button>
                    ))
                  )}
                  {isDragging && (
                    <span className="ui-accent-soft border rounded px-2 py-0.5">
                      {t('Drop SGF, OGS URL, ZIP, or board images to import')}
                    </span>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-2 text-[0.6875rem] ui-text-faint">
                  <div>
                    {t('{count} item{s}', { count: sortedItems.length, s: sortedItems.length === 1 ? '' : 's' })}{visibleSelectedIds.size > 0 ? ` · ${t('{count} selected', { count: visibleSelectedIds.size })}` : ''}
                  </div>
                  {visibleSelectedIds.size > 0 ? (
                    <button
                      type="button"
                      className="library-select-all h-6 w-6 rounded hover:bg-[var(--ui-surface-2)] flex items-center justify-center"
                      onClick={handleClearSelection}
                      title={t('Clear selection')}
                      aria-label={t('Clear selection')}
                    >
                      <FaTimes size={12} />
                    </button>
                  ) : sortedItems.length > 0 ? (
                    <button
                      type="button"
                      className="library-select-all h-6 w-6 rounded hover:bg-[var(--ui-surface-2)] flex items-center justify-center"
                      onClick={handleSelectAll}
                      title={t('Select all')}
                      aria-label={t('Select all')}
                    >
                      <FaCheckSquare size={12} />
                    </button>
                  ) : null}
                </div>
              </div>
              {visibleSelectedIds.size > 0 && (
                <div className="panel-toolbar border-b border-[var(--ui-border)] bg-[var(--ui-accent-soft)] text-[var(--ui-accent)]">
                  <button
                    type="button"
                    className={bulkActionClass}
                    onClick={handleBulkDuplicate}
                    title={t('Duplicate selected')}
                    aria-label={t('Duplicate selected')}
                  >
                    <FaCopy size={12} />
                  </button>
                  <button
                    type="button"
                    className={bulkActionClass}
                    onClick={() => void handleBulkExport()}
                    title={t('Export selected as ZIP')}
                    aria-label={t('Export selected as ZIP')}
                  >
                    <FaDownload size={12} />
                  </button>
                  <button
                    type="button"
                    className={bulkDangerActionClass}
                    onClick={handleBulkDelete}
                    title={t('Delete selected')}
                    aria-label={t('Delete selected')}
                  >
                    <FaTrash size={12} />
                  </button>
                  <select
                    value={bulkMoveTarget}
                    onChange={(e) => setBulkMoveTarget(e.target.value)}
                    aria-label={t('Move selected to folder')}
                    className="ml-1 ui-input border rounded px-2 py-1 text-xs text-[var(--ui-text)]"
                  >
                    <option value="">{t('Move to...')}</option>
                    <option value="root">{t('Root')}</option>
                    {folderItems.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="panel-action-button"
                    onClick={handleBulkMove}
                    disabled={!bulkMoveTarget}
                    title={t('Move selected items')}
                    aria-label={t('Move selected items')}
                  >
                    {t('Move')}
                  </button>
                </div>
              )}
              <div
                className={[
                  'library-tree panel-scroll-region',
                  isMobile ? 'max-h-[calc(100dvh-220px)]' : 'panel-compact-list',
                  dragOverRoot ? 'bg-[var(--ui-accent-soft)]' : '',
                ].join(' ')}
                role="tree"
                aria-label={t('Library games')}
                onDragOver={handleRootDragOver}
                onDragLeave={handleRootDragLeave}
                onDrop={handleRootDrop}
                onContextMenu={(event) => {
                  if ((event.target as HTMLElement | null)?.closest?.('.library-tree-node')) return;
                  openContextMenu(event, null);
                }}
              >
                {isSearching ? (
                  sortedItems.length === 0 ? (
                    <div className="p-6 text-sm ui-text-faint">
                      <div className="font-semibold text-[var(--ui-text-muted)] mb-2">{t('No matches')}</div>
                      <div>{t('Try a different search term.')}</div>
                    </div>
                  ) : (
                    <div>
                      {sortedItems.slice(0, limitFor('')).map((item) =>
                        isFolder(item) ? renderFolderRow(item, 0, false) : renderFileRow(item, 0)
                      )}
                      {renderShowMore('', sortedItems.length)}
                    </div>
                  )
                ) : libraryStatus === 'loading' ? (
                  <div className="p-6 text-sm ui-text-faint">
                    <div className="font-semibold text-[var(--ui-text-muted)] mb-2">{t('Loading library')}</div>
                    <div>{t('Opening IndexedDB storage and migrating saved SGFs if needed.')}</div>
                  </div>
                ) : libraryStatus === 'error' ? (
                  <div className="p-6 text-sm ui-text-faint">
                    <div className="font-semibold text-[var(--ui-danger)] mb-2">{t('Library storage error')}</div>
                    <div>{libraryError ?? t('The library could not be read or saved.')}</div>
                  </div>
                ) : items.length === 0 ? (
                  <div className="p-6 text-sm ui-text-faint">
                    <div className="font-semibold text-[var(--ui-text-muted)] mb-2">{t('Library is empty')}</div>
                    <div>{t('Save the current game, or use the import button for SGF, ZIP, and board image files. On a desktop you can drop them here too.')}</div>
                  </div>
                ) : (
                  <div>
                    {(childrenMap.get(null) ?? []).slice(0, limitFor('')).map((item) =>
                      isFolder(item) ? renderFolderRow(item, 0) : renderFileRow(item, 0)
                    )}
                    {renderShowMore('', (childrenMap.get(null) ?? []).length)}
                  </div>
                )}
              </div>
              {items.length > 0 && (
                <div className="library-stats" aria-label={t('Library totals')}>
                  {libraryStatsText}
                </div>
              )}
                </>
              ),
            })}

          </div>
        </div>
      </div>
      {renderContextMenu()}
    </>
  );
};
