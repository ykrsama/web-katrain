import type { GameNode, GameRules } from '../types';
import { t } from '../i18n';
import { rulesLabel } from './goRules';



const formatInfoKomi = (komi: number): string =>
  Number.isInteger(komi) ? String(komi) : String(Number(komi.toFixed(2)));

export function formatRootInfoText(opts: {
  rootNode: Pick<GameNode, 'properties'>;
  currentNode: Pick<GameNode, 'gameState' | 'properties'>;
  gameRules: GameRules;
}): string {
  const rulesRaw = opts.rootNode.properties?.RU?.[0] ?? opts.currentNode.properties?.RU?.[0];
  const rules = typeof rulesRaw === 'string' && rulesRaw.trim() ? rulesRaw.trim() : rulesLabel(opts.gameRules);
  const komiLabel = t('Komi: {value}', { value: formatInfoKomi(opts.currentNode.gameState.komi) });
  const rulesetLabel = t('Ruleset: {value}', { value: rules });
  return `${komiLabel}\n${rulesetLabel}\n`;
}
