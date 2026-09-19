# Twitch Drop Tracker

A Chrome extension to track your Twitch drops campaigns and progress, sorted by expiration date.

## Features

- **Campaign Tracking**: View all active Twitch drop campaigns sorted by expiration date
- **Progress Monitoring**: Track your watch time progress for each drop
- **Completion Status**: See which campaigns you've completed with checkmark badges
- **Expiration Alerts**: Campaigns are grouped by urgency (Expiring Today, This Week, Later)
- **Claimable Drops**: Quick access to drops that are ready to claim
- **Game Filter**: Search and select which games to track, with an option to hide filtered games and to hide subscription-based drops from the list
- **RAM Efficiency Mode**: Scope "Load All Drop Details" scans to an allowlist of checked games so new campaigns don't silently balloon scan scope
- **Full-Page View**: A dedicated tab with search, a stats bar (campaign/progress/claimable/claimed counts), and the same campaign/progress data as the popup
- **Diagnostic Log**: Copy the log from the last drop-detail scan for troubleshooting
- **20-Language UI**: Switchable interface language, including RTL support
- **Dark Theme**: Native dark theme matching Twitch's aesthetic

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the extension folder
5. The extension icon will appear in your toolbar

### From Chrome Web Store

This fork is not published on the Chrome Web Store and there are no plans to submit it — install from source instead.

The original project this was forked from is available on the Chrome Web Store as [Twitch Drops Tracker](https://chromewebstore.google.com/detail/twitch-drops-tracker/hhkbghkcichjongmpfgjoefdlcofdejl), but it does not include the changes made in this fork.

## Usage

1. **Log into Twitch** in your browser
2. Click the extension icon to open the popup
3. Click the **Refresh** button to fetch your current drops data
4. Use **Load All Drop Details** to scan all available campaigns (opens Twitch and auto-expands campaigns)
5. Click the 🖼️ button to open the full-page view for a larger layout with search and stats

### Tabs

- **Campaigns**: All available drop campaigns, sorted by expiration date
- **My Progress**: Your active drops, claimable rewards, and recently claimed items

### Game Filter

Click the filter icon to open the game filter sidebar. By default, unchecking a game excludes it from view (denylist). Enabling **RAM Efficiency Mode** in Settings flips this to an allowlist — only checked games are included, and newly-seen games start unchecked — which keeps "Load All Drop Details" scans cheap when scoped to a handful of games. The sidebar also lets you hide filtered games from the list and hide subscription-based (gift-sub) drops entirely.

### Status Indicators

- 🔴 **Red border**: Expiring today
- 🟡 **Yellow border**: Expiring this week
- 🟢 **Green border**: Completed campaign
- **✓ Complete**: All drops claimed for this campaign
- **X/Y**: Progress indicator (X drops engaged out of Y total)

## How It Works

The extension uses Twitch's GraphQL API to fetch:
- Available drop campaigns
- Your inventory and progress
- Claimed drops history

For full campaign details, it intercepts network requests when you visit the Twitch drops page, capturing drop information as campaigns are expanded. The two sources are merged and reconciled with your claim history, so a drop you've already claimed still shows as claimed even if Twitch stops returning it later.

## Permissions

- `storage`: Store campaign and progress data locally
- `cookies`: Read Twitch authentication token
- `tabs`: Open Twitch pages for data loading
- `scripting`: Inject scripts to intercept campaign data
- `host_permissions` for `twitch.tv` and `gql.twitch.tv`

## Privacy

- All data is stored locally in your browser
- No data is sent to external servers
- Only communicates with Twitch's official API

## Development

### Project Structure

```
├── manifest.json          # Extension manifest (single source of truth for version)
├── background.js          # Service worker: GraphQL calls, storage, campaign merging
├── content-main.js        # MAIN-world script: fetch interception, "Load All Drop Details" scan
├── content-isolated.js    # Isolated-world script: bridges page events to extension messaging
├── i18n.js                # Shared translation loader
├── shared/
│   └── view-core.js       # Shared rendering/filtering/data logic for popup + full page
├── popup/
│   ├── popup.html         # Popup UI structure
│   ├── popup.css          # Popup styles
│   └── popup.js           # Popup-specific wiring (settings, RAM mode, diagnostics, cache clear)
├── fullpage/
│   ├── fullpage.html      # Full-page UI structure
│   ├── fullpage.css       # Full-page styles
│   └── fullpage.js        # Full-page-specific wiring
├── locales/                # Per-language translation JSON files (20 languages)
└── icons/                  # Extension icons
```

See [CLAUDE.md](CLAUDE.md) for a deeper architecture walkthrough.

### Building

No build step required - the extension runs directly from source. See [CLAUDE.md](CLAUDE.md) for the reload workflow.

## License

MIT License

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.
