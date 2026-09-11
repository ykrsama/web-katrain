import React from 'react';
import { shallow } from 'zustand/shallow';
import { useGameStore } from '../store/gameStore';
import { useT } from '../i18n';

/**
 * One disclosure control shared by both shells. Coach keeps the review focused
 * on decisions and move quality; Pro reveals the engine's comparative data.
 */
export const AnalysisExperienceToggle: React.FC = () => {
  const t = useT();
  const { experience, updateSettings } = useGameStore(
    (state) => ({
      experience: state.settings.analysisExperience,
      updateSettings: state.updateSettings,
    }),
    shallow,
  );

  return (
    <div
      className="analysis-experience-toggle"
      role="group"
      aria-label={t('Analysis detail')}
      data-analysis-experience={experience}
    >
      <button
        type="button"
        className={experience === 'coach' ? 'active' : ''}
        aria-pressed={experience === 'coach'}
        title={t('Coach: plain-language guidance and move quality')}
        onClick={() => updateSettings({ analysisExperience: 'coach' })}
      >
        {t('Coach')}
      </button>
      <button
        type="button"
        className={experience === 'pro' ? 'active' : ''}
        aria-pressed={experience === 'pro'}
        title={t('Pro: full win rate, score, visits, policy, and engine detail')}
        onClick={() => updateSettings({ analysisExperience: 'pro' })}
      >
        {t('Pro')}
      </button>
    </div>
  );
};
