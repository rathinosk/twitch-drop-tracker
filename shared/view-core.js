/**
 * Twitch Drop Tracker - Shared View Core
 * Data loading, filtering, and rendering logic shared by popup.js and fullpage.js.
 * Each host page calls configure() with its container IDs and layout quirks, then
 * wires its own page-specific UI (settings panel, stats bar, etc.) around these calls.
 */

const log = {
  info: (...args) => console.log('[TwitchDrops]', ...args),
  error: (...args) => console.error('[TwitchDrops]', ...args)
};

// =============================================================================
// Config & State
// =============================================================================
// Set once by each host page via configure(). campaignsContainerId/progressContainerId
// and filterAnimated exist because popup and fullpage use different element IDs and
// popup's filter sidebar relies on a delayed 'hidden' class for its CSS transition
// (see popup.css .filter-sidebar.hidden) that fullpage's always-mounted sidebar doesn't use.
const config = {
  campaignsContainerId: 'campaigns-list',
  progressContainerId: 'progress-list',
  filterAnimated: false,
  lastUpdated: {
    nowKey: 'last_updated_now',
    agoKey: 'last_updated_ago',
    elseFormat: (date) => `Updated: ${date.toLocaleTimeString()}`
  }
};

export function configure(overrides) {
  Object.assign(config, overrides);
  if (overrides.lastUpdated) Object.assign(config.lastUpdated, overrides.lastUpdated);
}

export const state = {
  gameFilter: { enabled: false, games: {}, hideFiltered: false, ramMode: false },
  allCampaigns: [],
  filterSearchQuery: '',
  campaignSearchQuery: '',
  collapsedSections: new Set(JSON.parse(localStorage.getItem('tdt_collapsed_sections') || '[]'))
};

// =============================================================================
// Initialization Helpers (shared, no-op if the host page lacks the element)
// =============================================================================
export function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
    });
  });
}

export function initLanguageSelector() {
  const select = document.getElementById('language-select');
  if (!select) return;
  LANGUAGES.forEach(lang => {
    const option = document.createElement('option');
    option.value = lang.code;
    option.textContent = lang.name;
    select.appendChild(option);
  });
  chrome.storage.local.get(['language'], ({ language = 'en' }) => {
    select.value = language;
  });
  select.addEventListener('change', () => i18n.setLanguage(select.value));
}

export function initRefreshAndScanButtons() {
  document.getElementById('refresh-btn')?.addEventListener('click', refreshData);
  document.getElementById('load-all-drops-btn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.twitch.tv/drops/campaigns?loadAllDrops=true' });
    const hint = document.getElementById('scan-hint');
    if (hint) {
      hint.classList.remove('hidden');
      setTimeout(() => hint.classList.add('hidden'), 12000);
    }
  });
}

export function initCampaignSearch() {
  const searchInput = document.getElementById('search-input');
  if (!searchInput) return;
  let debounceTimer;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.campaignSearchQuery = e.target.value.toLowerCase().trim();
      renderCampaigns(state.allCampaigns);
    }, 200);
  });
}

// =============================================================================
// Game Filter
// =============================================================================
export async function loadFilterState() {
  const data = await chrome.storage.local.get(['gameFilter']);
  if (data.gameFilter) state.gameFilter = data.gameFilter;

  // Initialize defaults for fields that may not exist in older stored data
  if (state.gameFilter.hideFiltered === undefined) state.gameFilter.hideFiltered = false;
  if (state.gameFilter.ramMode === undefined) state.gameFilter.ramMode = false;

  const hideFilteredCheckbox = document.getElementById('hide-filtered-checkbox');
  if (hideFilteredCheckbox) hideFilteredCheckbox.checked = state.gameFilter.hideFiltered;

  updateFilterButtonState();
  updateRamModeUI();
}

export function initFilterSidebar() {
  const filterBtn = document.getElementById('filter-btn');
  const closeFilterBtn = document.getElementById('close-filter-btn');
  const filterSidebar = document.getElementById('filter-sidebar');
  const filterOverlay = document.getElementById('filter-overlay');
  const selectAllBtn = document.getElementById('select-all-btn');
  const deselectAllBtn = document.getElementById('deselect-all-btn');
  const filterSearchInput = document.getElementById('filter-search-input');
  const hideFilteredCheckbox = document.getElementById('hide-filtered-checkbox');

  filterBtn.addEventListener('click', () => {
    if (config.filterAnimated) {
      filterSidebar.classList.remove('hidden');
      filterOverlay.classList.remove('hidden');
      setTimeout(() => {
        filterSidebar.classList.add('visible');
        filterOverlay.classList.add('visible');
      }, 10);
    } else {
      filterSidebar.classList.add('visible');
      filterOverlay.classList.add('visible');
    }
  });

  const closeFilter = () => {
    filterSidebar.classList.remove('visible');
    filterOverlay.classList.remove('visible');
    if (config.filterAnimated) {
      setTimeout(() => {
        filterSidebar.classList.add('hidden');
        filterOverlay.classList.add('hidden');
      }, 250);
    }
  };

  // Select/Deselect all (checked = included in both modes; labels flip in RAM mode)
  selectAllBtn.addEventListener('click', () => {
    Object.keys(state.gameFilter.games).forEach(g => { state.gameFilter.games[g] = true; });
    if (!state.gameFilter.ramMode) state.gameFilter.enabled = false;
    saveAndApplyFilter();
    renderFilterList();
  });

  deselectAllBtn.addEventListener('click', () => {
    Object.keys(state.gameFilter.games).forEach(g => { state.gameFilter.games[g] = false; });
    if (!state.gameFilter.ramMode) state.gameFilter.enabled = true;
    saveAndApplyFilter();
    renderFilterList();
  });

  // Clear search when closing sidebar
  const closeFilterWithClear = () => {
    filterSearchInput.value = '';
    state.filterSearchQuery = '';
    closeFilter();
  };
  closeFilterBtn.addEventListener('click', closeFilterWithClear);
  filterOverlay.addEventListener('click', closeFilterWithClear);

  filterSearchInput.addEventListener('input', (e) => {
    state.filterSearchQuery = e.target.value.toLowerCase().trim();
    renderFilterList();
  });

  hideFilteredCheckbox.addEventListener('change', (e) => {
    state.gameFilter.hideFiltered = e.target.checked;
    saveAndApplyFilter();
  });
}

export function updateFilterButtonState() {
  const filterBtn = document.getElementById('filter-btn');
  const hasExclusions = Object.values(state.gameFilter.games).some(v => v === false);
  filterBtn.classList.toggle('filter-active', state.gameFilter.ramMode || hasExclusions);
}

export function updateRamModeUI() {
  const sidebar = document.getElementById('filter-sidebar');
  const banner = document.getElementById('ram-mode-banner');
  const selectAllBtn = document.getElementById('select-all-btn');
  const deselectAllBtn = document.getElementById('deselect-all-btn');
  const hideFilteredOption = document.querySelector('.filter-hide-option');
  const ramToggle = document.getElementById('ram-mode-toggle');

  if (ramToggle) ramToggle.checked = state.gameFilter.ramMode;

  if (state.gameFilter.ramMode) {
    sidebar?.classList.add('ram-mode');
    banner?.classList.remove('hidden');
    if (selectAllBtn) selectAllBtn.textContent = 'Include All';
    if (deselectAllBtn) deselectAllBtn.textContent = 'Exclude All';
    hideFilteredOption?.classList.add('hidden');
  } else {
    sidebar?.classList.remove('ram-mode');
    banner?.classList.add('hidden');
    if (selectAllBtn) selectAllBtn.textContent = 'Select All';
    if (deselectAllBtn) deselectAllBtn.textContent = 'Deselect All';
    hideFilteredOption?.classList.remove('hidden');
  }
}

export function populateFilterGames(campaigns) {
  const games = new Map();
  campaigns.forEach(c => {
    if (c.game && !games.has(c.game)) {
      games.set(c.game, c.imageUrl || '');
    }
  });

  // Checked (included) by default in normal mode so new drops are scanned
  // automatically; unchecked (excluded) in RAM mode so new games are never
  // auto-enabled and must be turned on manually.
  const defaultChecked = !state.gameFilter.ramMode;
  games.forEach((imageUrl, gameName) => {
    if (!(gameName in state.gameFilter.games)) {
      state.gameFilter.games[gameName] = defaultChecked;
    }
  });

  // Remove games that no longer exist
  Object.keys(state.gameFilter.games).forEach(gameName => {
    if (!games.has(gameName)) {
      delete state.gameFilter.games[gameName];
    }
  });

  // Check if any filter is active (only relevant in normal whitelist mode)
  if (!state.gameFilter.ramMode) {
    state.gameFilter.enabled = Object.values(state.gameFilter.games).some(v => v === false);
  }

  renderFilterList();
  saveFilter();
}

export function renderFilterList() {
  const container = document.getElementById('filter-games-list');
  let sortedGames = Object.entries(state.gameFilter.games)
    .sort((a, b) => a[0].localeCompare(b[0]));

  if (state.filterSearchQuery) {
    sortedGames = sortedGames.filter(([gameName]) =>
      gameName.toLowerCase().includes(state.filterSearchQuery)
    );
  }

  if (sortedGames.length === 0 && state.filterSearchQuery) {
    container.innerHTML = `
      <div class="filter-no-match">
        No games match "${escapeHtml(state.filterSearchQuery)}"
      </div>
    `;
    return;
  }

  container.innerHTML = sortedGames.map(([gameName, isChecked]) => {
    const campaign = state.allCampaigns.find(c => c.game === gameName);
    const imageUrl = campaign?.imageUrl || '';
    return `
      <div class="filter-game-item ${isChecked ? 'checked' : ''}" data-game="${escapeHtml(gameName)}">
        <div class="filter-game-checkbox">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        ${imageUrl ? `<img class="filter-game-image" src="${imageUrl}" alt="" onerror="this.style.display='none'">` : ''}
        <span class="filter-game-name">${escapeHtml(gameName)}</span>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.filter-game-item').forEach(item => {
    item.addEventListener('click', () => {
      const gameName = item.dataset.game;
      state.gameFilter.games[gameName] = !state.gameFilter.games[gameName];
      item.classList.toggle('checked', state.gameFilter.games[gameName]);
      if (!state.gameFilter.ramMode) {
        state.gameFilter.enabled = Object.values(state.gameFilter.games).some(v => v === false);
      }
      saveAndApplyFilter();
    });
  });

  updateFilterButtonState();
}

export async function saveFilter() {
  await chrome.storage.local.set({ gameFilter: state.gameFilter });
  updateFilterButtonState();
}

export async function saveAndApplyFilter() {
  await saveFilter();
  renderCampaigns(state.allCampaigns);
}

export function isGameFiltered(gameName) {
  if (state.gameFilter.ramMode) {
    // RAM mode: checked (true) = included, same as normal mode.
    // This is an always-on allowlist, so anything not explicitly checked
    // (including newly-discovered games) is filtered out.
    return state.gameFilter.games[gameName] !== true;
  }
  if (!state.gameFilter.enabled) return false;
  return state.gameFilter.games[gameName] === false;
}

// =============================================================================
// Data Loading
// =============================================================================
export async function loadStoredData() {
  try {
    const data = await chrome.storage.local.get(['campaigns', 'inventory', 'lastUpdated', 'gameFilter']);
    if (data.gameFilter) {
      state.gameFilter = data.gameFilter;
    }
    if (data.campaigns) {
      state.allCampaigns = data.campaigns;
      populateFilterGames(state.allCampaigns);
      renderCampaigns(state.allCampaigns);
    }
    if (data.inventory) renderMyProgress(data.inventory);
    if (data.lastUpdated) updateLastUpdated(data.lastUpdated);
    updateStats(data.campaigns || [], data.inventory || {});
  } catch (error) {
    log.error('Error loading stored data:', error.message);
  }
}

export async function refreshData() {
  const refreshBtn = document.getElementById('refresh-btn');
  refreshBtn?.classList.add('loading');

  try {
    const response = await chrome.runtime.sendMessage({ action: 'fetchData' });
    if (response.success) {
      state.allCampaigns = response.campaigns || [];
      populateFilterGames(state.allCampaigns);
      renderCampaigns(state.allCampaigns);
      renderMyProgress(response.inventory || {});
      updateLastUpdated(new Date().toISOString());
      updateStats(state.allCampaigns, response.inventory || {});
    } else {
      showError(response.error || t('error_not_logged_in'));
    }
  } catch (error) {
    log.error('Error fetching data:', error.message);
    showError(t('error_connection'));
  } finally {
    refreshBtn?.classList.remove('loading');
  }
}

// Stats bar only exists on fullpage; each call is a no-op elsewhere.
function updateStats(campaigns, inventory) {
  const { inProgress = [], claimable = [], claimed = [] } = inventory;
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  set('stat-campaigns', campaigns.length);
  set('stat-in-progress', inProgress.length);
  set('stat-claimable', claimable.length);
  set('stat-claimed', claimed.length);
}

// =============================================================================
// Campaigns Tab Rendering
// =============================================================================
export function renderCampaigns(campaigns) {
  const container = document.getElementById(config.campaignsContainerId);

  if (!campaigns?.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <p>${t('empty_no_campaigns')}</p>
        <p class="empty-state-hint">${t('loading_campaigns')}</p>
      </div>
    `;
    return;
  }

  // Apply search filter (campaign-search-input only exists on fullpage)
  let filtered = campaigns;
  if (state.campaignSearchQuery) {
    filtered = campaigns.filter(c =>
      c.game?.toLowerCase().includes(state.campaignSearchQuery) ||
      c.publisher?.toLowerCase().includes(state.campaignSearchQuery)
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <p>${t('empty_no_results')}</p>
        <p class="empty-state-hint">${t('empty_no_results_hint')}</p>
      </div>
    `;
    return;
  }

  let sorted = [...filtered].sort((a, b) => new Date(a.endDate) - new Date(b.endDate));

  // In RAM mode always hide excluded games; otherwise only when hideFiltered is on
  if (state.gameFilter.ramMode || state.gameFilter.hideFiltered) {
    sorted = sorted.filter(c => !isGameFiltered(c.game));
  }

  // Use calendar day boundaries (end of each day at 23:59:59)
  const today = new Date();
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
  const tomorrowEnd = new Date(todayEnd.getTime() + 24 * 60 * 60 * 1000);
  const threeDaysEnd = new Date(todayEnd.getTime() + 3 * 24 * 60 * 60 * 1000);
  const weekEnd = new Date(todayEnd.getTime() + 7 * 24 * 60 * 60 * 1000);

  const groups = {
    today: sorted.filter(c => new Date(c.endDate) <= todayEnd),
    tomorrow: sorted.filter(c => { const d = new Date(c.endDate); return d > todayEnd && d <= tomorrowEnd; }),
    soon: sorted.filter(c => { const d = new Date(c.endDate); return d > tomorrowEnd && d <= threeDaysEnd; }),
    week: sorted.filter(c => { const d = new Date(c.endDate); return d > threeDaysEnd && d <= weekEnd; }),
    later: sorted.filter(c => new Date(c.endDate) > weekEnd)
  };

  // Sort each group: non-filtered first, then filtered
  const sortWithFilter = (arr) => {
    return arr.sort((a, b) => {
      const aFiltered = isGameFiltered(a.game);
      const bFiltered = isGameFiltered(b.game);
      if (aFiltered !== bFiltered) return aFiltered ? 1 : -1;
      return new Date(a.endDate) - new Date(b.endDate);
    });
  };

  let html = '';
  html += renderSection('today',    t('section_expiring_today'), sortWithFilter(groups.today).map(c => renderCampaignCard(c, 'today')).join(''),    'danger');
  html += renderSection('tomorrow', t('section_tomorrow'),       sortWithFilter(groups.tomorrow).map(c => renderCampaignCard(c, 'tomorrow')).join(''), 'orange');
  html += renderSection('soon',     t('section_2_3_days'),       sortWithFilter(groups.soon).map(c => renderCampaignCard(c, 'soon')).join(''),       'warning');
  html += renderSection('week',     t('section_this_week'),      sortWithFilter(groups.week).map(c => renderCampaignCard(c, 'week')).join(''),       'soon');
  html += renderSection('later',    t('section_later'),          sortWithFilter(groups.later).map(c => renderCampaignCard(c, 'later')).join(''));

  container.innerHTML = html;
  attachCardListeners(container);

  container.querySelectorAll('.section-group').forEach(group => {
    group.querySelector('.section-header').addEventListener('click', () => {
      const key = group.dataset.section;
      group.classList.toggle('collapsed');
      state.collapsedSections[group.classList.contains('collapsed') ? 'add' : 'delete'](key);
      localStorage.setItem('tdt_collapsed_sections', JSON.stringify([...state.collapsedSections]));
    });
  });
}

const SECTION_CHEVRON = `<svg class="section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

function renderSection(key, label, cardsHtml, colorClass = '') {
  if (!cardsHtml) return '';
  const collapsed = state.collapsedSections.has(key);
  return `<div class="section-group${collapsed ? ' collapsed' : ''}" data-section="${key}"><div class="section-header ${colorClass} collapsible">${label}${SECTION_CHEVRON}</div><div class="section-body">${cardsHtml}</div></div>`;
}

function renderCampaignCard(campaign, urgency) {
  const drops = campaign.drops || [];
  const claimedCount = drops.filter(d => d.status === 'claimed').length;
  const hasProgress = drops.some(d => ['claimed', 'in_progress', 'claimable'].includes(d.status));
  // Override isCompleted only if drops are actively in progress (not just locked)
  const hasActiveProgress = drops.some(d => d.status === 'in_progress' || d.status === 'claimable');
  const isCompleted = hasActiveProgress ? false : (campaign.isCompleted || (claimedCount === drops.length && drops.length > 0));
  const isFiltered = isGameFiltered(campaign.game);

  const urgencyClassMap = {
    today: 'expiring-today',
    tomorrow: 'expiring-tomorrow',
    soon: 'expiring-soon',
    week: 'expiring-week'
  };
  const urgencyClass = urgencyClassMap[urgency] || '';
  const expiryClass = urgency !== 'later' ? urgency : '';
  const filteredClass = isFiltered ? 'filtered-out' : '';

  const statusBadge = isCompleted
    ? `<span class="campaign-status claimed">${t('status_complete')}</span>`
    : hasProgress ? `<span class="campaign-status in-progress">${claimedCount}/${drops.length}</span>` : '';

  const updatesOffBadge = isFiltered ? `<span class="updates-off-badge">${t('updates_off')}</span>` : '';

  const dropsHtml = drops.length
    ? drops.map(renderDropItem).join('')
    : `<div class="campaign-drops-empty">${t('drops_not_loaded_1')}<br>${t('drops_not_loaded_2')}</div>`;

  const gameSlug = campaign.gameSlug || gameNameToSlug(campaign.game);

  return `
    <div class="campaign-card ${urgencyClass} ${isCompleted ? 'completed' : ''} ${filteredClass}" data-id="${campaign.id || ''}">
      <div class="campaign-header">
        <img class="campaign-image clickable" src="${campaign.imageUrl || ''}" alt="" onerror="this.style.display='none'" data-game-slug="${gameSlug}" title="Open ${escapeHtml(campaign.game)} drops on Twitch">
        <div class="campaign-info">
          <div class="campaign-name">${escapeHtml(campaign.game)} ${statusBadge}${updatesOffBadge}</div>
          <div class="campaign-publisher">${escapeHtml(campaign.publisher || '')}</div>
          <div class="campaign-expiry ${expiryClass}">${t('expiry_prefix')}${formatExpiry(new Date(campaign.endDate))}</div>
        </div>
        <svg class="expand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div class="campaign-drops">${dropsHtml}</div>
    </div>
  `;
}

const DROP_ICON_EYE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const DROP_ICON_STAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
const DROP_ICON_STAR_REQ = DROP_ICON_STAR;

function dropImageHtml(drop) {
  if (!drop.imageUrl) return '';
  const img = `<img class="drop-image" src="${drop.imageUrl}" alt="" onerror="this.style.display='none'">`;
  if (!drop.dropType) return img;
  const isSub = drop.dropType === 'sub';
  return `<div class="drop-image-wrap">${img}<div class="drop-type-overlay ${isSub ? 'sub' : 'watch'}" title="${isSub ? 'Subscribe to Redeem' : 'Watch to Redeem'}">${isSub ? DROP_ICON_STAR : DROP_ICON_EYE}</div></div>`;
}

function renderDropItem(drop) {
  const isSub = drop.dropType === 'sub';
  const progress = drop.progressMinutes || 0;
  const required = drop.requiredMinutes || 60;
  // Force 100% for claimed/claimable drops to handle cases where progress data hasn't updated
  const percentage = (drop.status === 'claimed' || drop.status === 'claimable')
    ? 100
    : Math.min(100, Math.round((progress / required) * 100));

  const statusMap = {
    claimed: { class: 'claimed', text: t('status_claimed') },
    claimable: { class: 'claimable', text: t('status_ready') },
    in_progress: { class: 'in-progress', text: t('status_time', {progress, required}) }
  };

  const lockedText = isSub ? t('status_sub_locked') : t('status_locked', {required});
  const status = statusMap[drop.status] || { class: 'locked', text: lockedText };
  const showProgress = !isSub && (drop.status === 'in_progress' || drop.status === 'claimable' || progress > 0);
  const showSubReq = isSub && drop.status !== 'claimed' && drop.requiredSubs;

  return `
    <div class="drop-item">
      <div class="drop-header">
        ${dropImageHtml(drop)}
        <span class="drop-name">${escapeHtml(drop.name || t('unknown_drop'))}</span>
        <span class="drop-status ${status.class}">${status.text}</span>
      </div>
      ${showProgress ? `
        <div class="progress-container">
          <div class="progress-bar">
            <div class="progress-fill ${percentage >= 100 ? 'complete' : ''}" style="width: ${percentage}%"></div>
          </div>
          <span class="progress-text">${percentage}%</span>
        </div>
      ` : ''}
      ${showSubReq ? `
        <div class="sub-req">${DROP_ICON_STAR_REQ}${t('sub_drop_req', {count: drop.requiredSubs})}</div>
      ` : ''}
    </div>
  `;
}

// =============================================================================
// My Progress Tab Rendering
// =============================================================================
async function renderMyProgress(inventory) {
  const container = document.getElementById(config.progressContainerId);
  const { inProgress = [], claimable = [], claimed = [] } = inventory;

  if (!inProgress.length && !claimable.length && !claimed.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🎯</div>
        <p>${t('empty_no_drops')}</p>
        <p class="empty-state-hint">${t('empty_no_drops_hint')}</p>
      </div>
    `;
    return;
  }

  // Get full campaign data from storage to show all drops
  const { campaigns = [] } = await chrome.storage.local.get(['campaigns']);

  // Find campaigns that have any progress (in_progress, claimable, or claimed drops)
  const activeCampaignIds = new Set([
    ...inProgress.map(d => d.campaignId),
    ...claimable.map(d => d.campaignId),
    ...claimed.map(d => d.campaignId)
  ].filter(Boolean));

  const activeCampaigns = campaigns
    .filter(c => activeCampaignIds.has(c.id) ||
      c.drops?.some(d => ['in_progress', 'claimable', 'claimed'].includes(d.status)))
    .sort((a, b) => new Date(a.endDate) - new Date(b.endDate));

  let html = '';

  if (claimable.length) {
    html += `<div class="section-header" style="color: var(--accent-purple);">${t('section_ready_to_claim', {count: claimable.length})}</div>`;
    html += claimable.map(d => renderProgressCard(d, 'claimable')).join('');
  }

  const inProgressCampaigns = activeCampaigns.filter(c =>
    c.drops?.some(d => d.status === 'in_progress' || d.status === 'claimable'));

  if (inProgressCampaigns.length) {
    html += `<div class="section-header">${t('section_in_progress')}</div>`;
    html += inProgressCampaigns.map(renderProgressCampaignCard).join('');
  }

  if (claimed.length) {
    html += `
      <div class="collapsible-header section-header" id="claimed-header">
        <span>${t('section_recently_claimed', {count: claimed.length})}</span>
        <svg class="expand-icon expand-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div id="claimed-section" class="collapsible-content">
        ${claimed.map(d => renderProgressCard(d, 'claimed')).join('')}
      </div>
    `;
  }

  container.innerHTML = html;
  attachCardListeners(container);

  const claimedHeader = document.getElementById('claimed-header');
  if (claimedHeader) {
    claimedHeader.addEventListener('click', () => {
      document.getElementById('claimed-section')?.classList.toggle('expanded');
    });
  }

  container.querySelectorAll('.claim-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://www.twitch.tv/drops/inventory' });
    });
  });
}

function renderProgressCampaignCard(campaign) {
  const drops = campaign.drops || [];
  if (!drops.length) return '';

  const claimedCount = drops.filter(d => d.status === 'claimed').length;
  const inProgressCount = drops.filter(d => d.status === 'in_progress').length;
  const endDate = new Date(campaign.endDate);
  const now = Date.now();
  const urgencyClass = endDate <= new Date(now).setHours(23, 59, 59, 999) ? 'expiring-today' :
                       endDate <= new Date(now + 7 * 24 * 60 * 60 * 1000) ? 'expiring-soon' : '';

  // Check if we likely have incomplete data (only in-progress drops, no locked drops)
  const hasLockedDrops = drops.some(d => d.status === 'locked');
  const likelyIncomplete = drops.length <= inProgressCount + claimedCount && !hasLockedDrops && drops.length < 3;

  // Calculate overall progress across watch drops only
  const watchDrops = drops.filter(d => d.dropType !== 'sub');
  const totalProgress = watchDrops.reduce((sum, d) => {
    const progress = d.progressMinutes || 0;
    const required = d.requiredMinutes || 60;
    return sum + Math.min(progress, required);
  }, 0);
  const totalRequired = watchDrops.reduce((sum, d) => sum + (d.requiredMinutes || 60), 0);
  const overallPercent = totalRequired > 0 ? Math.min(100, Math.round((totalProgress / totalRequired) * 100)) : 0;

  const dropsHtml = drops.map(drop => {
    const isSub = drop.dropType === 'sub';
    const progress = drop.progressMinutes || 0;
    const required = drop.requiredMinutes || 60;
    const percentage = (drop.status === 'claimed' || drop.status === 'claimable')
      ? 100
      : Math.min(100, Math.round((progress / required) * 100));

    const statusMap = {
      claimed: { class: 'claimed', text: t('status_claimed') },
      claimable: { class: 'claimable', text: t('status_ready') },
      in_progress: { class: 'in-progress', text: t('status_time', {progress, required}) }
    };
    const lockedText = isSub ? t('status_sub_locked') : t('status_locked', {required});
    const status = statusMap[drop.status] || { class: 'locked', text: lockedText };
    const showProgress = !isSub && (drop.status === 'in_progress' || drop.status === 'claimable' || (progress > 0 && drop.status !== 'claimed'));
    const showSubReq = isSub && drop.status !== 'claimed' && drop.requiredSubs;

    return `
      <div class="drop-item">
        <div class="drop-header">
          ${dropImageHtml(drop)}
          <span class="drop-name">${escapeHtml(drop.name || t('unknown_drop'))}</span>
          <span class="drop-status ${status.class}">${status.text}</span>
        </div>
        ${showProgress ? `
          <div class="progress-container">
            <div class="progress-bar"><div class="progress-fill ${percentage >= 100 ? 'complete' : ''}" style="width: ${percentage}%"></div></div>
            <span class="progress-text">${drop.status === 'in_progress' ? t('time_min_left', {minutes: Math.max(0, required - progress)}) : `${percentage}%`}</span>
          </div>
        ` : ''}
        ${showSubReq ? `
          <div class="sub-req">${DROP_ICON_STAR_REQ}${t('sub_drop_req', {count: drop.requiredSubs})}</div>
        ` : ''}
      </div>
    `;
  }).join('');

  const incompleteNote = likelyIncomplete
    ? `<div class="campaign-drops-note">${t('drops_incomplete')}</div>`
    : '';

  const gameSlug = campaign.gameSlug || gameNameToSlug(campaign.game);

  return `
    <div class="campaign-card ${urgencyClass}">
      <div class="campaign-header">
        <img class="campaign-image clickable" src="${campaign.imageUrl || ''}" alt="" onerror="this.style.display='none'" data-game-slug="${gameSlug}" title="Open ${escapeHtml(campaign.game)} drops on Twitch">
        <div class="campaign-info">
          <div class="campaign-name">${escapeHtml(campaign.game)} <span class="campaign-status in-progress">${claimedCount}/${drops.length}${likelyIncomplete ? '+' : ''}</span></div>
          <div class="campaign-expiry">${t('expiry_prefix')}${formatExpiry(endDate)}</div>
          <div class="progress-container campaign-overall-progress">
            <div class="progress-bar"><div class="progress-fill ${overallPercent >= 100 ? 'complete' : ''}" style="width: ${Math.min(100, overallPercent)}%"></div></div>
            <span class="progress-text">${overallPercent}%</span>
          </div>
        </div>
        <svg class="expand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div class="campaign-drops">${dropsHtml}${incompleteNote}</div>
    </div>
  `;
}

function renderProgressCard(drop, type) {
  return `
    <div class="progress-card">
      <div class="progress-card-header">
        <img class="progress-card-image" src="${drop.imageUrl || ''}" alt="" onerror="this.style.display='none'">
        <div class="progress-card-info">
          <div class="progress-card-game">${escapeHtml(drop.game || '')}</div>
          <div class="progress-card-drop">${escapeHtml(drop.name || t('unknown_drop'))}</div>
        </div>
      </div>
      ${type === 'claimable' ? `<button class="claim-btn">${t('btn_claim')}</button>` : ''}
    </div>
  `;
}

// =============================================================================
// Utilities
// =============================================================================
function attachCardListeners(container) {
  container.querySelectorAll('.campaign-header').forEach(header => {
    header.addEventListener('click', (e) => {
      // Don't toggle if clicking on the game image
      if (e.target.classList.contains('campaign-image')) return;
      header.closest('.campaign-card').classList.toggle('expanded');
    });
  });

  container.querySelectorAll('.campaign-image.clickable').forEach(img => {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      const slug = img.dataset.gameSlug;
      if (slug) {
        chrome.tabs.create({ url: `https://www.twitch.tv/directory/category/${slug}?filter=drops` });
      }
    });
  });
}

/**
 * Convert game name to Twitch directory slug
 * e.g., "Vampire: The Masquerade - Bloodhunt" -> "vampire-the-masquerade-bloodhunt"
 */
function gameNameToSlug(gameName) {
  if (!gameName) return '';

  const specialCases = {
    'overwatch 2': 'overwatch-2',
    'overwatch': 'overwatch-2',
    'counter-strike 2': 'counter-strike-2',
    'counter-strike': 'counter-strike-2',
    'pubg: battlegrounds': 'pubg-battlegrounds',
    'playerunknowns battlegrounds': 'pubg-battlegrounds',
    'bitcraft online': 'bitcraft',
    'rainbow six siege': 'tom-clancys-rainbow-six-siege',
    'tom clancy\'s rainbow six siege': 'tom-clancys-rainbow-six-siege'
  };

  const normalized = gameName.toLowerCase().trim();
  if (specialCases[normalized]) {
    return specialCases[normalized];
  }

  return gameName
    .toLowerCase()
    .replace(/[:']/g, '')           // Remove colons and apostrophes
    .replace(/&/g, 'and')           // Replace & with 'and'
    .replace(/[^a-z0-9\s-]/g, '')   // Remove special characters except spaces and hyphens
    .replace(/\s+/g, '-')           // Replace spaces with hyphens
    .replace(/-+/g, '-')            // Replace multiple hyphens with single
    .replace(/^-|-$/g, '');         // Remove leading/trailing hyphens
}

export function updateLastUpdated(isoString) {
  const el = document.getElementById('last-updated');
  if (!el) return;
  const diffMins = Math.floor((Date.now() - new Date(isoString)) / 60000);
  const text = diffMins < 1 ? t(config.lastUpdated.nowKey) :
               diffMins < 60 ? t(config.lastUpdated.agoKey, {minutes: diffMins}) :
               config.lastUpdated.elseFormat(new Date(isoString));
  el.textContent = text;
}

function formatExpiry(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);

  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  if (dateOnly.getTime() === today.getTime()) return t('expiry_today', {time: timeStr});
  if (dateOnly.getTime() === tomorrow.getTime()) return t('expiry_tomorrow', {time: timeStr});
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function showError(message) {
  const container = document.getElementById(config.campaignsContainerId);
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">⚠️</div>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

window.toggleClaimed = () => document.getElementById('claimed-section')?.classList.toggle('expanded');
window.openInventory = () => chrome.tabs.create({ url: 'https://www.twitch.tv/drops/inventory' });
