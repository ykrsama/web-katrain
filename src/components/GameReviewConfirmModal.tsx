import React from 'react';
import { useGameStore } from '../store/gameStore';
import { useT } from '../i18n';
import { useInitialDialogFocus } from '../hooks/useInitialDialogFocus';
import { useBackGestureToClose } from '../hooks/useEscapeToClose';

export const GameReviewConfirmModal: React.FC = () => {
  const request = useGameStore(state => state.pendingGameReview);
  const rootId = useGameStore(state => state.rootNode.id);
  const chooseMode = useGameStore(state => state.chooseGameReviewMode);
  const t = useT();
  const open = request !== null && request.rootId === rootId;
  const cancel = React.useCallback(() => chooseMode(null), [chooseMode]);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();
  const dialogRef = useInitialDialogFocus<HTMLDivElement>(open, {
    focusContainer: false,
    initialFocusRef: cancelRef,
  });
  useBackGestureToClose(cancel, open);
  React.useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [cancel, open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-3 mobile-safe-inset">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
        className="ui-panel w-full max-w-md space-y-4 rounded-lg border p-4 shadow-xl">
        <h2 id={titleId} className="text-lg font-semibold">{t('Recalculate existing analysis?')}</h2>
        <p id={descriptionId} className="text-sm ui-text-muted">
          {t('Recalculate all positions to refresh results after a model change, or reuse existing analysis and fill positions that need more depth.')}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" className="panel-action-button min-h-11" onClick={cancel}>{t('Cancel')}</button>
          <button type="button" className="panel-action-button min-h-11" onClick={() => chooseMode(false)}>{t('Reuse existing analysis')}</button>
          <button type="button" className="panel-action-button min-h-11" onClick={() => chooseMode(true)}>{t('Recalculate all positions')}</button>
        </div>
      </div>
    </div>
  );
};
