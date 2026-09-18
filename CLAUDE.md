# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome extension (plain JS, no framework, no bundler) that tracks Twitch drop campaigns and a user's claim progress, sorted by expiration date. See [README.md](README.md) for the user-facing feature list.

## Development workflow

There is no build step, package.json, linter, or test suite — the extension runs directly from source.

- **Load/reload the extension**: `chrome://extensions/` → enable Developer mode → "Load unpacked" → select the repo root. After editing any file, click the reload icon on the extension card in `chrome://extensions/`.
- **Reload content scripts**: `content-main.js` / `content-isolated.js` only re-inject after both an extension reload *and* a refresh of the `twitch.tv/drops/*` tab.
- **Reload the service worker**: editing `background.js` requires clicking "service worker" → refresh, or just reloading the extension card.
- `extension-name-config.yaml` lists the files included when packaging a distributable zip (manifest, background, content scripts, i18n, `fullpage/`, `icons/`, `locales/`, `popup/`).

## Architecture

### Component map (per `manifest.json`)

- **`background.js`** — the service worker. Owns all Twitch GraphQL calls, `chrome.storage.local` reads/writes, and campaign/inventory merging. All cross-context communication funnels through its single `chrome.runtime.onMessage` listener (see actions below).
- **`content-main.js`** — injected into the **MAIN world** of `twitch.tv/drops/*` at `document_start`. Monkey-patches `window.fetch` to intercept Twitch's own GraphQL traffic (this is the primary source of rich drop data — see "Two data sources" below). Also implements the "Load All Drop Details" scan automation.
- **`content-isolated.js`** — injected into the **isolated world** of the same pages. Bridges `window` CustomEvents dispatched by `content-main.js` (`twitch-drops-campaigns`, `twitch-drops-claimed`, `twitch-drops-diaglog`) to `chrome.runtime.sendMessage` calls, since the MAIN-world script has no access to extension APIs. Also injects the active locale and game filter into a `data-*` attribute on `<html>` so the MAIN-world script can read them synchronously.
- **`popup/popup.js`** and **`fullpage/fullpage.js`** — **two independent, largely duplicated UI implementations** of the same campaign/progress views (same function names: `renderCampaigns`, `renderCampaignCard`, `renderDropItem`, `renderMyProgress`, `gameNameToSlug`, filter logic, etc.). The popup is the toolbar popup window; the full page (opened via the "Full View" button, `fullpage/fullpage.html`) is a standalone tab with the same feature set plus a stats bar and search. **There is no shared module — a fix or feature to rendering/filtering logic must be ported to both files by hand**, or a genuine bug will only be fixed in the file that was edited.
- **`i18n.js`** — small custom i18n loader shared (via `<script>` include) by both popup and fullpage. Loads `locales/<lang>.json` plus `locales/en.json` as a fallback, applies `data-i18n*` attributes, exposes `window.t()`.

### Two data sources for campaign data, merged in `background.js`

1. **GraphQL query** (`dataFetcher.fetchCampaigns` / `backgroundScraper.fetchCampaignsList`) — fetched directly by the service worker using the user's `auth-token` cookie. Fast, but Twitch's `dropCampaigns`/`currentUser.dropCampaigns` queries don't always return full `timeBasedDrops` detail for every campaign.
2. **Fetch interception** (`content-main.js`) — while the user has a `twitch.tv/drops/*` tab open, every GraphQL response is inspected for drop-related keys (`DROP_MARKERS`) and mined recursively (`extractors.collectAllDrops`) for campaign/drop data, including data that only appears once a campaign card is expanded in the UI. This is the only way to get complete drop details for campaigns with complex/nested structures.

`background.js`'s `campaignMerger.merge()` reconciles whichever campaign list is available with the current inventory (progress/claimed state) and with `completedCampaigns`/`completedGames` history, so a drop already claimed in a past session is still shown as claimed even if Twitch stops returning it. `dataFetcher.getCachedCampaigns()` prefers previously-intercepted campaigns (with real drop data) over a fresh bare GraphQL fetch. Message handler `campaignsIntercepted` in `background.js` additionally guards against overwriting a richer stored campaign with a thinner incoming one (e.g. a scan that failed partway through).

### "Load All Drop Details" scan (`content-main.js` → `campaignExpander`)

Triggered by opening `https://www.twitch.tv/drops/campaigns?loadAllDrops=true` (see `popup.js`/`fullpage.js` `loadAllDrops()`). Sequentially:
1. Zooms the page out to 25% to fit more campaign cards on screen.
2. Iterates `[aria-expanded="false"]` buttons, clicking each to expand it (which triggers a Twitch GQL request that `window.fetch` interception captures), then re-collapses it immediately to keep memory bounded (this is the main RAM cost of a scan — hundreds of MB if left expanded).
3. Skips campaigns for games excluded by the game filter (see below) before clicking, via best-effort DOM text matching (`findGameNameForButton`).
4. Waits adaptively per click (`waitForApiResponse`) — short wait for an Apollo cache hit, longer wait if a real network request is pending.
5. Writes a diagnostic log (`diagLog`) throughout, sent to `background.js` via the `saveDiagLog` message and retrievable from the popup's "Copy Log" button (`getDiagLog`) — useful for debugging failed/partial scans without needing devtools.
6. Auto-closes the tab on success.

### Game filter / "RAM mode"

Filter state lives in `chrome.storage.local.gameFilter = { enabled, games: { [gameName]: boolean }, hideFiltered, ramMode }` and has **two different semantics** depending on `ramMode`, checked in both `popup.js`/`fullpage.js` (`isGameFiltered`) and `content-main.js` (`isGameAllowed`) — keep these three implementations consistent when changing filter behavior:

- **Normal mode** (denylist): a game is included unless explicitly unchecked. New games default to checked/included. `enabled` is only true if at least one game has been excluded.
- **RAM mode** (allowlist, `ramMode: true`): a game is included only if explicitly checked. New/unknown games default to **excluded**, so scans don't balloon in scope automatically as new campaigns appear. Intended for keeping "Load All Drop Details" scans cheap by scoping them to a small set of games.

### Message actions (`background.js` `chrome.runtime.onMessage`)

- `fetchData` — full refresh via GraphQL (popup's Refresh button).
- `backgroundScrape` — single-call refresh using `currentUser.dropCampaigns` (includes progress, no per-campaign detail fetches needed).
- `campaignsIntercepted` — campaigns captured by `content-main.js` during normal browsing or a scan.
- `claimedDropsIntercepted` — claimed drops captured by interception; recorded into `completedCampaigns`/`completedGames` history for permanence.
- `saveDiagLog` / `getDiagLog` — diagnostic log round-trip for the scan feature.

### Storage schema (`chrome.storage.local`)

`campaigns`, `inventory`, `lastUpdated`, `gameFilter`, `completedCampaigns` (by campaign ID), `completedGames` (by lowercased game name — used to detect a claimed drop by name when the campaign ID it belonged to disappears from the API), `claimedDropsHistory`, `diagLog`/`diagLogDate`, `language`.

### Version number — single source of truth

`manifest.json`'s `version` field is the only place the version number is set. It reaches the two places that display it via `chrome.runtime.getManifest().version`:
- `popup/popup.js` (`displayVersion()`) sets the `#version-label` text in `popup.html` directly, since the popup has extension API access.
- `content-main.js` runs in the page's MAIN world and has no extension APIs, so it can't call `getManifest()` itself. `content-isolated.js` (`injectVersion()`) reads the manifest and writes it to a `data-twitch-drops-version` attribute on `<html>`, the same relay pattern used for locale and game-filter data; `content-main.js`'s `getVersion()` reads that attribute when building the diagnostic log.

The changelog list in `popup.html` (`⚙️ NEW IN vX.Y.Z:` entries) is a manually-maintained history of past releases, not a version display — add a new entry when bumping the version, but it isn't derived from the manifest.
