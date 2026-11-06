import { useT } from '../i18n';
import type { FoxImportOptions } from '../utils/foxImportOptions';
import { rulesOf } from '../utils/goRules';

export function FoxImportSettings({ value, onChange }: { value: FoxImportOptions; onChange(value: FoxImportOptions): void }) {
  const t = useT();
  if (!value.needsConfirmation) return null;
  const choices = [...new Set([value.rules, 'chinese', 'japanese', 'korean'] as const)];
  return <div className="fox-import-settings">
    <label>{t('Rules')}<select aria-label={t('Rules')} value={value.rules} onChange={event => onChange({ ...value, rules: event.target.value as FoxImportOptions['rules'] })}>
      {choices.map(rule => <option key={rule} value={rule}>{t(rulesOf(rule).label)}</option>)}
    </select></label>
    <label>{t('Komi')}<input aria-label={t('Komi')} type="number" step="0.5" min="-99.5" max="99.5" required value={value.komi} onChange={event => onChange({ ...value, komi: event.target.value })} /></label>
  </div>;
}
