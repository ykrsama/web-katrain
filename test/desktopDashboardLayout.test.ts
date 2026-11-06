import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('desktop dashboard layout', () => {

  it('does not reopen persisted panel choices while reacting to viewport changes', () => {
    const source = readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');
    const responsiveStart = source.indexOf('// ---- responsive mode ----');
    const responsiveEnd = source.indexOf('const libDrawer', responsiveStart);
    const responsiveBlock = source.slice(responsiveStart, responsiveEnd);

    expect(responsiveBlock).toContain('const nextMode = getDashboardLayoutMode(window.innerWidth)');
    expect(responsiveBlock).toContain('setLayoutMode(nextMode)');
    expect(responsiveBlock).not.toContain('setLibraryOpen(true');
    expect(responsiveBlock).not.toContain('setSidebarOpen(true');
  });

  it('draws Resign from the theme, like every other button on the rail', () => {
    // It carried `borderColor: '#f0c4c4'` inline -- a pale pink picked against
    // a light mock, brighter on the three dark themes than the --line-strong
    // every neighbour uses, and a wash on the light one. The file already had
    // the shape for this one rule above, on .pbtn.danger.
    const dashboardSource = readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');
    const css = readFileSync('src/components/dashboard/dashboard.css', 'utf8');

    expect(dashboardSource).toContain("<button type=\"button\" className=\"tbtn danger\" title={t('Resign')}");
    expect(dashboardSource).not.toContain('#f0c4c4');
    expect(css).toContain(
      '.wk-dashboard .tbtn.danger { color: var(--red); border-color: color-mix(in srgb, var(--red) 35%, var(--panel)); }'
    );

    // Colours may still be set from a style prop -- several are, all reading
    // var(--muted), var(--faint), var(--ink). What may not is a literal. The
    // hexes left in the stylesheet are stones and goban wood, which are not
    // theme colours in the first place.
    expect(dashboardSource).not.toMatch(/style=\{\{[^}]*:\s*'#[0-9a-fA-F]{3,8}'/);
    expect(dashboardSource).not.toMatch(/style=\{\{[^}]*:\s*'rgba?\(/);
  });

  it('keeps the board-first Library affordance visibly discoverable', () => {
    const dashboardSource = readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');
    const css = readFileSync('src/components/dashboard/dashboard.css', 'utf8');

    expect(dashboardSource).toContain("!libraryOpen && <span className=\"edge-toggle-label\">{t('Library')}</span>");
    expect(css).toContain('.wk-dashboard .edge-toggle.left:not(.open):has(.edge-toggle-label)');
    expect(css).toContain('writing-mode: vertical-rl;');
  });

  it('names every collapsed panel on its own handle, not just the library', () => {
    // A collapsed panel leaves a 24px sliver on the edge. Library carried a
    // word on it; analysis, game info and metrics carried only a chevron and a
    // tooltip, so what they brought back was a guess.
    const dashboardSource = readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');
    const css = readFileSync('src/components/dashboard/dashboard.css', 'utf8');

    expect(dashboardSource).toContain("!sidebarOpen && <span className=\"edge-toggle-label\">{t('Analysis')}</span>");
    expect(dashboardSource).toContain("!gamestripOpen && <span className=\"edge-toggle-label\">{t('Game info')}</span>");
    expect(dashboardSource).toContain("!commandbarOpen && <span className=\"edge-toggle-label\">{t('Metrics')}</span>");
    expect(css).toContain('.wk-dashboard .edge-toggle.right:not(.open):has(.edge-toggle-label)');
    expect(css).toContain('.wk-dashboard .edge-toggle.top:not(.open):has(.edge-toggle-label)');
    expect(css).toContain('.wk-dashboard .edge-toggle.bottom:not(.open):has(.edge-toggle-label)');
    // The horizontal handles set their label on the baseline instead of
    // inheriting the vertical rail's writing mode.
    expect(css).toMatch(
      /\.wk-dashboard \.edge-toggle\.top \.edge-toggle-label,\n\.wk-dashboard \.edge-toggle\.bottom \.edge-toggle-label \{[\s\S]*writing-mode: horizontal-tb/
    );
  });

  it('keeps desktop focus mode board-only, visible, and clear of its move ticker', () => {
    const css = readFileSync('src/components/dashboard/dashboard.css', 'utf8');

    expect(css).toMatch(/\.wk-dashboard \.header \{[\s\S]*grid-row: 1;/);
    expect(css).toMatch(/\.wk-dashboard \.body \{[\s\S]*grid-row: 2;/);
    for (const surface of ['gamestrip', 'hero-card', 'navbar', 'library', 'sidebar']) {
      expect(css).toContain(`.wk-dashboard[data-focus="on"] .${surface}`);
    }
    expect(css).toMatch(/\.wk-dashboard\[data-focus="on"\] \.board-stage \{\s*padding-bottom: 68px;/);
  });

  it('surfaces build metadata from the dashboard view menu', () => {
    const source = readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');
    const menuStart = source.indexOf('const ViewMenu');
    const viewMenu = source.slice(menuStart);

    expect(viewMenu).toContain("item(t('Coordinates')");
    expect(viewMenu).toContain("item(t('Library panel')");
    expect(viewMenu).toContain("item(t('Analysis panel')");
    // Settings and About each already have a dedicated home (the header icon
    // cluster and the Help popover), so the menu does not repeat them.
    expect(viewMenu).not.toContain("item('Settings'");
    expect(viewMenu).not.toContain("item('About'");
    // The build link does belong here: it is the only place build metadata
    // lives now that the header no longer carries a version chip.
    expect(viewMenu).toContain('data-dashboard-build-link');
  });

  it('keeps build identity out of the primary header and in the dashboard menu', () => {
    const dashboardSource = readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');
    const css = readFileSync('src/components/dashboard/dashboard.css', 'utf8');

    expect(dashboardSource).not.toContain('data-dashboard-build-chip="true"');
    expect(dashboardSource).toContain('data-dashboard-build-link="true"');
    expect(css).not.toContain('.wk-dashboard .build-chip');
  });

  it('mounts the full library manager inside the desktop dashboard library column', () => {
    const dashboardSource = readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');
    const layoutSource = readFileSync('src/components/Layout.tsx', 'utf8');
    const librarySource = readFileSync('src/components/LibraryPanel.tsx', 'utf8');

    expect(dashboardSource).toContain('libraryPanel?: React.ReactNode');
    expect(dashboardSource).toContain("libraryPanel ? ' full-library' : ''");
    // The column renders the supplied panel and nothing else. This used to
    // assert on a `libraryPanel ?? (...)` fallback, but Layout gates the panel
    // and `libraryOpen` on the same condition, so that fallback could never be
    // on screen -- pinning it kept dead markup alive.
    expect(dashboardSource).toContain('{libraryPanel}');
    expect(layoutSource).toContain('libraryPanel={');
    expect(layoutSource).toContain('showCloseButtonOnDesktop');
    expect(librarySource).toContain("aria-label={t('Import SGF, ZIP, or board image files')}");
  });

  it('lets the dashboard library container own embedded panel width', () => {
    const layoutSource = readFileSync('src/components/Layout.tsx', 'utf8');
    const dashboardLibraryStart = layoutSource.indexOf('libraryPanel={');
    const dashboardLibraryEnd = layoutSource.indexOf('sidebarOpen={showSidebar', dashboardLibraryStart);
    const dashboardLibraryBlock = layoutSource.slice(dashboardLibraryStart, dashboardLibraryEnd);

    expect(layoutSource).toContain('libraryWidth={leftPanelWidth}');
    expect(dashboardLibraryBlock).toContain('<LibraryPanel');
    expect(dashboardLibraryBlock).not.toContain('width={leftPanelWidth}');
  });

  it('keeps Copy SGF access in the desktop dashboard File menu', () => {
    const dashboardSource = readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');
    const layoutSource = readFileSync('src/components/Layout.tsx', 'utf8');

    expect(dashboardSource).toContain('onCopySgf: () => void');
    expect(dashboardSource).toContain("aria-label={t('More file actions')}");
    expect(dashboardSource).toContain("<span className=\"mi-label\">{t('Copy SGF')}</span>");
    expect(dashboardSource).toContain('onClick={() => { closePop(); onCopySgf(); }}');
    expect(layoutSource).toContain('onCopySgf={handleCopySgf}');
  });

  it('does not mount the analysis button bar inside the desktop goban frame', () => {
    const layoutSource = readFileSync('src/components/Layout.tsx', 'utf8');
    const dashboardBoardStart = layoutSource.indexOf('board={');
    const dashboardBoardEnd = layoutSource.indexOf('boardControls={', dashboardBoardStart);
    const dashboardBoardSlot = layoutSource.slice(dashboardBoardStart, dashboardBoardEnd);
    const dashboardControlsEnd = layoutSource.indexOf('blackName={blackName}', dashboardBoardEnd);
    const dashboardControlsSlot = layoutSource.slice(dashboardBoardEnd, dashboardControlsEnd);

    expect(dashboardBoardSlot).toContain('<GoBoard');
    expect(dashboardBoardSlot).not.toContain('<AnalysisCommandBar');
    expect(dashboardBoardSlot).not.toContain('<EditToolbar');
    expect(dashboardBoardSlot).not.toContain('<ManualScorePanel');
    expect(dashboardBoardSlot).not.toContain('<NotificationToast');
    expect(dashboardControlsSlot).toContain('<EditToolbar');
    expect(dashboardControlsSlot).toContain('<ManualScorePanel');
    expect(dashboardControlsSlot).toContain('docked');
  });

  it('keeps the empty metric rail quiet until analysis has content', () => {
    const source = readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');

    expect(source).toContain('const commandbarHasContent = hasAnalysisMetrics || isContinuousAnalysis || isGameAnalysisRunning');
    expect(source).toContain('const commandbarVisible = commandbarOpen && showAnalysis && commandbarHasContent');
    expect(source).toContain('{showAnalysis && commandbarHasContent && (');
  });

  it('keeps desktop move-number editing keyboard-local and bounded', () => {
    const dashboardSource = readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');
    const moveCounterStart = dashboardSource.indexOf('<div className="move-counter">');
    const moveCounterEnd = dashboardSource.indexOf('<div className="navgroup">', moveCounterStart);
    const moveCounterBlock = dashboardSource.slice(moveCounterStart, moveCounterEnd);

    expect(moveCounterBlock).toContain('type="number"');
    expect(moveCounterBlock).toContain("aria-label={t('Move number')}");
    expect(moveCounterBlock).toContain('inputMode="numeric"');
    expect(moveCounterBlock).toContain('min={0}');
    expect(moveCounterBlock).toContain('max={totalMoves}');
    expect(moveCounterBlock).toContain("e.key === 'Escape'");
    expect(moveCounterBlock).toContain('e.stopPropagation()');
    expect(moveCounterBlock).toContain('e.preventDefault()');
    expect(moveCounterBlock).toContain('Number.isInteger(n)');
    expect(moveCounterBlock).toContain('e.currentTarget.blur()');
  });

  it('renders desktop branch indices with the shared one-based branch model', () => {
    const dashboardSource = readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');
    const gameTreeStart = dashboardSource.indexOf('{/* Game tree */}');
    const gameTreeEnd = dashboardSource.indexOf('{/* Analysis */}', gameTreeStart);
    const gameTreeBlock = dashboardSource.slice(gameTreeStart, gameTreeEnd);

    expect(gameTreeBlock).toContain('{branchInfo.currentIndex}/{branchInfo.totalBranches}');
    expect(gameTreeBlock).not.toContain('branchInfo.currentIndex + 1');
  });

  it('labels visible dashboard tree and analysis toolbar controls', () => {
    const dashboardSource = readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');
    const gameTreeStart = dashboardSource.indexOf('{/* Game tree */}');
    const analysisStart = dashboardSource.indexOf('{/* Analysis */}', gameTreeStart);
    const notesStart = dashboardSource.indexOf('{/* Comment / notes */}', analysisStart);
    const gameTreeBlock = dashboardSource.slice(gameTreeStart, analysisStart);
    const analysisBlock = dashboardSource.slice(analysisStart, notesStart);

    expect(gameTreeBlock).toContain("aria-label={t('Previous branch')}");
    expect(gameTreeBlock).toContain("aria-label={t('Next branch')}");
    expect(gameTreeBlock).toContain("aria-label={t('Back to branch point')}");
    expect(gameTreeBlock).toContain("aria-label={t('Make current move the main branch')}");
    // Every control in the strip is branch-only, so the strip itself is gated
    // too — otherwise a straight-line game showed an empty 30px band with a
    // rule under it above the tree.
    expect(gameTreeBlock).toContain('{branchInfo.hasBranches && (\n                  <div className="panel-toolbar">');
    expect(gameTreeBlock).toContain('!isOnMainLine(currentNode) ? (');
    expect(gameTreeBlock).not.toContain("className={branchInfo.hasBranches ? 'pbtn pico' : 'hidden'}");
    // Graph toggles are named by their visible text ("Win rate", "Score") and
    // carry their state in aria-pressed; a "Hide …" name said it twice.
    expect(analysisBlock).toContain('aria-pressed={legend.winrate}');
    expect(analysisBlock).toContain('aria-pressed={legend.score}');
    expect(analysisBlock).not.toContain("aria-label={legend.winrate ?");
    expect(analysisBlock).toContain("aria-label={legendOpen ? t('Hide move-quality legend') : t('Show move-quality legend')}");
    // Gated on legendOpen: the legend only renders while open, so an
    // unconditional aria-controls left a dangling IDREF when it was closed.
    expect(analysisBlock).toContain("aria-controls={legendOpen ? 'dashboard-analysis-quality-legend' : undefined}");
    expect(analysisBlock).toContain("overlayBtn('analysisShowHints', t('Top moves'), 'layers', settings.analysisShowPolicy)");
    expect(analysisBlock).toContain("aria-label={t('Run quick graph analysis')}");
    expect(analysisBlock).toContain('aria-label={dashboardFastMctsLabel}');
    expect(analysisBlock).toContain("aria-label={t('Open game report')}");
  });

  it('keeps section actions outside the disclosure button', () => {
    const dashboardSource = readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');
    const helperStart = dashboardSource.indexOf('const sectionHead =');
    const helperEnd = dashboardSource.indexOf('// ---- overlay toggle helper ----', helperStart);
    const helper = dashboardSource.slice(helperStart, helperEnd);

    expect(helper).toContain('className="section-head-toggle"');
    expect(helper).toContain('aria-expanded={sections[key]}');
    expect(helper).toContain('<div className="saction">{actions}</div>');
    expect(helper).not.toContain('role="button"');
  });

  it('exposes View menu toggle state without adding visual clutter', () => {
    const dashboardSource = readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');
    const viewMenuStart = dashboardSource.indexOf('const ViewMenu:');
    const viewMenu = dashboardSource.slice(viewMenuStart);

    expect(viewMenu).toContain("aria-pressed={typeof on === 'boolean' ? on : undefined}");
  });


  it('names every icon-only nav button for more than a hover tooltip', () => {
    const source = readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');
    const timer = readFileSync('src/components/Timer.tsx', 'utf8');

    // These buttons carry only an icon, so a bare `title` was their whole
    // accessible name — and a tooltip never appears on a touchscreen laptop.
    // Guard the class, not the seven instances: every navbtn must be labelled.
    const navButtons = source.match(/<button[^>]*className="navbtn[^"]*"[^>]*>/g) ?? [];
    expect(navButtons.length).toBeGreaterThanOrEqual(9);
    for (const button of navButtons) {
      expect(button).toMatch(/aria-label=/);
    }

    // Both timer layouts render a bare play/pause icon.
    const timerButtons = timer.match(/title=\{timerPaused \? t\('Resume timer'\) : t\('Pause timer'\)\}/g) ?? [];
    expect(timerButtons).toHaveLength(2);
    expect(timer.match(/aria-label=\{timerPaused \? t\('Resume timer'\) : t\('Pause timer'\)\}/g)).toHaveLength(2);
  });


  it('gates the side panel on the real desktop shell, not viewport width alone', () => {
    const panel = readFileSync('src/components/layout/RightPanel.tsx', 'utf8');
    const css = readFileSync('src/index.css', 'utf8');
    const breakpoints = readFileSync('src/utils/layoutBreakpoints.ts', 'utf8');

    // Tailwind's `lg:` is width-only. The app enters its desktop shell only
    // when the viewport is wide AND tall enough, so at 1280x460 the mobile
    // shell rendered while `lg:static` still fired: the panel left the fixed
    // overlay, its `w-full` took the whole row, and the board collapsed to 0px.
    expect(panel).not.toContain('lg:');
    expect(panel).toContain('desktop-shell:static');
    expect(panel).toContain("showOnDesktop ? 'desktop-shell:flex' : 'desktop-shell:hidden'");

    // The variant must track the same thresholds the shell logic uses, and it
    // must be declared as a media variant: Tailwind v4 only treats the
    // parentheses as a media query when they start with `@media`. Written
    // without it the variant still parses, emits no CSS at all, and every
    // `desktop-shell:` class across the app silently does nothing — which is
    // how ~50 usages in 16 files sat inert while this assertion passed.
    //
    // The numbers are read out of layoutBreakpoints.ts rather than written
    // here as well: the point is that the stylesheet and the shell logic
    // agree, not that they are forever 1024x500. Pinning the literals in the
    // test only meant a deliberate breakpoint change had to be made in three
    // places instead of two, with the test failing for the wrong reason.
    const minWidth = /DESKTOP_LAYOUT_MIN_WIDTH = (\d+)/.exec(breakpoints)?.[1];
    const minHeight = /DESKTOP_LAYOUT_MIN_HEIGHT = (\d+)/.exec(breakpoints)?.[1];
    expect(minWidth, 'DESKTOP_LAYOUT_MIN_WIDTH not found in layoutBreakpoints.ts').toBeDefined();
    expect(minHeight, 'DESKTOP_LAYOUT_MIN_HEIGHT not found in layoutBreakpoints.ts').toBeDefined();
    expect(css).toContain(
      `@custom-variant desktop-shell (@media (min-width: ${minWidth}px) and (min-height: ${minHeight}px));`
    );
  });


  it('holds the review actions in the same columns as the overlay toggles', () => {
    const source = readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');
    const css = readFileSync('src/components/dashboard/dashboard.css', 'utf8');

    // Quick graph / Fast review / Report sit directly under the 3-column
    // overlay matrix. Natural widths read as an accident there, and the middle
    // button becomes "Stop" while a review runs — which slid Report left, under
    // a pointer that had just clicked the button beside it.
    expect(source).toContain('className="overlay-row overlay-row--actions"');
    expect(css).toMatch(
      /\.wk-dashboard \.overlay-row--actions \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/,
    );
  });

  it('says when a board mode is engaged, not just colours the chip', () => {
    const source = readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');

    // Region and Insert switch the board into a different interaction mode and
    // signalled it with a CSS class alone, so nothing but sight could tell the
    // mode was on. Guard the pattern: every chip that toggles an `on` class
    // must also carry its state.
    // Split on the chip class rather than matching template-literal JSX with a
    // regex: the escaping is easy to get subtly wrong, and a pattern that never
    // matches passes vacuously.
    const chips = source.split('className={`board-chip${').slice(1);
    expect(chips.length).toBeGreaterThanOrEqual(2);
    for (const chip of chips) {
      const button = chip.slice(0, chip.indexOf('onClick='));
      expect(button.length).toBeGreaterThan(20);
      expect(button).toContain('aria-pressed={');
    }

    expect(source).toContain('aria-pressed={isSelectingRegionOfInterest}');
    expect(source).toContain('aria-pressed={isInsertMode}');
  });
});

describe('colour swatches do not speak', () => {
  /**
   * Every colour in this dashboard has its meaning in adjacent text -- the
   * quality dot sits before the points-lost figure, the legend swatches before
   * their labels -- so the swatches themselves are decoration and should be
   * skipped rather than announced as empty elements mid-label. The candidate
   * list already marks its `cl-dot` that way, and the `lg-check` icon
   * immediately beside these swatches does too; they were the exception.
   */
  it('marks the decorative colour spans aria-hidden', () => {
    const source = readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');
    const swatches = [...source.matchAll(/<span className="(cb-quality-dot|sw|qd)"[^>]*>/g)];
    expect(swatches.length, 'the dashboard swatches moved').toBeGreaterThanOrEqual(5);
    for (const [tag, name] of swatches) {
      expect(tag, `${name} swatch is announced`).toContain('aria-hidden="true"');
    }
  });
});
