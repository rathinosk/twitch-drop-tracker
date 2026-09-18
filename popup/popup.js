/**
 * Twitch Drop Tracker - Popup Script
 * Page-specific wiring (settings panel, diagnostic log, clear cache) around the
 * shared rendering/filtering/data logic in shared/view-core.js.
 */
import * as view from '../shared/view-core.js';

const log = {
  info: (...args) => console.log('[TwitchDrops]', ...args),
  error: (...args) => console.error('[TwitchDrops]', ...args)
};

view.configure({
  campaignsContainerId: 'campaigns-list',
  progressContainerId: 'progress-list',
  filterAnimated: true,
  lastUpdated: {
    nowKey: 'last_updated_now',
    agoKey: 'last_updated_ago',
    elseFormat: (date) => `Updated: ${date.toLocaleTimeString()}`
  }
});

// =============================================================================
// Initialization
// =============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  await i18n.init();
  view.initTabs();
  initButtons();
  initSettings();
  view.initFilterSidebar();
  view.loadFilterState().then(() => view.loadStoredData());
  displayVersion();
});

function initButtons() {
  view.initRefreshAndScanButtons();
  document.getElementById('clear-cache-btn').addEventListener('click', clearCache);
  document.getElementById('open-campaigns-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.twitch.tv/drops/campaigns' });
  });
  document.getElementById('open-inventory-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.twitch.tv/drops/inventory' });
  });
  document.getElementById('fullview-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('fullpage/fullpage.html') });
  });
  document.getElementById('copy-diag-btn').addEventListener('click', copyDiagLog);
}

function displayVersion() {
  const label = document.getElementById('version-label');
  if (label) label.textContent = `Version ${chrome.runtime.getManifest().version}`;
}

async function copyDiagLog() {
  const btn = document.getElementById('copy-diag-btn');
  const feedback = document.getElementById('diag-copy-feedback');

  try {
    const response = await chrome.runtime.sendMessage({ action: 'getDiagLog' });
    if (!response?.log) {
      feedback.textContent = 'No log yet — run a scan first.';
      feedback.className = 'diag-feedback diag-feedback-warn';
      setTimeout(() => { feedback.className = 'diag-feedback hidden'; }, 3000);
      return;
    }

    await navigator.clipboard.writeText(response.log);
    btn.textContent = 'Copied!';
    const date = response.date ? new Date(response.date).toLocaleString() : '';
    feedback.textContent = date ? `Last scan: ${date}` : 'Copied to clipboard';
    feedback.className = 'diag-feedback diag-feedback-ok';
    setTimeout(() => {
      btn.textContent = 'Copy Log';
      feedback.className = 'diag-feedback hidden';
    }, 3000);
  } catch (e) {
    feedback.textContent = 'Copy failed — try again.';
    feedback.className = 'diag-feedback diag-feedback-warn';
    setTimeout(() => { feedback.className = 'diag-feedback hidden'; }, 3000);
  }
}

// =============================================================================
// Settings
// =============================================================================
function initSettings() {
  const settingsBtn = document.getElementById('settings-btn');
  const closeSettingsBtn = document.getElementById('close-settings-btn');
  const settingsPanel = document.getElementById('settings-panel');

  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
  });

  closeSettingsBtn.addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
  });

  view.initLanguageSelector();

  const ramToggle = document.getElementById('ram-mode-toggle');
  if (ramToggle) {
    ramToggle.addEventListener('change', () => {
      view.state.gameFilter.ramMode = ramToggle.checked;
      // Reset all games to the new default when toggling mode
      const defaultValue = view.state.gameFilter.ramMode ? false : true;
      Object.keys(view.state.gameFilter.games).forEach(g => { view.state.gameFilter.games[g] = defaultValue; });
      if (!view.state.gameFilter.ramMode) view.state.gameFilter.enabled = false;
      view.saveAndApplyFilter();
      view.updateRamModeUI();
      view.renderFilterList();
    });
  }
}

// =============================================================================
// Data Loading
// =============================================================================
async function clearCache() {
  try {
    await chrome.storage.local.clear();
    const emptyState = `
      <div class="empty-state">
        <div class="empty-state-icon">🗑️</div>
        <p>${t('cache_cleared')}</p>
        <p class="empty-state-hint">${t('cache_cleared_hint')}</p>
      </div>
    `;
    document.getElementById('campaigns-list').innerHTML = emptyState;
    document.getElementById('progress-list').innerHTML = emptyState;
    document.getElementById('last-updated').textContent = t('cache_cleared');
  } catch (error) {
    log.error('Error clearing cache:', error.message);
  }
}
