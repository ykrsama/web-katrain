import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Release smoke tests cover playable/importable/savable games, engine inputs,
// offline assets and the deployed Fox API. Full regression and browser suites
// run separately in CI; keep CPU search and large stress fixtures out of the
// publishing path. npm test / npm run verify still run the complete suite.
export default defineConfig(env => mergeConfig(viteConfig(env), {
  test: {
    include: [
      'test/gameLogic.test.ts',
      'test/goRules.test.ts',
      'test/sgf.test.ts',
      'test/loadGame.test.ts',
      'test/gameRecordImport.test.ts',
      'test/sgfIllegalMoveWarning.test.ts',
      'test/sgfHandicapLoad.test.ts',
      'test/library.test.ts',
      'test/libraryZipPaths.test.ts',
      'test/libraryOutageRecovery.test.ts',
      'test/autoSave.test.ts',
      'test/autoSaveOnPageHide.test.ts',
      'test/engineBasicInputsGolden.test.ts',
      'test/engineRulesGolden.test.ts',
      'test/engineSuperkoHistory.test.ts',
      'test/remoteQueryPosition.test.ts',
      'test/serviceWorker.test.ts',
      'test/pwaAssets.test.ts',
      'test/publicUrl.test.ts',
      'test/foxWorker.test.ts',
      'test/foxLive.test.ts',
      'test/foxImportOptions.test.ts',
      'test/foxSearchHistory.test.ts',
      'test/foxApi.test.ts',
    ],
  },
}));
