/**
 * Twitch Drop Tracker - Full Page Script
 * Page-specific wiring (search input, stats bar) around the shared
 * rendering/filtering/data logic in shared/view-core.js.
 */
import * as view from '../shared/view-core.js';

view.configure({
  campaignsContainerId: 'campaigns-grid',
  progressContainerId: 'progress-grid',
  filterAnimated: false,
  lastUpdated: {
    nowKey: 'fullpage_now',
    agoKey: 'fullpage_ago',
    elseFormat: (date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
});

// =============================================================================
// Initialization
// =============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  await i18n.init();
  view.initLanguageSelector();
  view.initTabs();
  view.initRefreshAndScanButtons();
  view.initFilterSidebar();
  view.initCampaignSearch();
  view.loadFilterState().then(() => view.loadStoredData());
});
