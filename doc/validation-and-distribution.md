# Build, validation, and distribution

This document covers building, checking, and packaging Warframe Market Trends. For app features and everyday usage, see the [README](../README.md).

## Build and run

Use Windows 10 build 19041 or newer (x64), the .NET 10 SDK, and Microsoft Edge WebView2 Evergreen Runtime. Node.js is required for the JavaScript tests. Run the commands below in PowerShell from the repository root. The first build requires internet access to restore NuGet packages.

```powershell
dotnet build WFMarketTrends/WFMarketTrends.csproj -c Release -p:Platform=x64
& .\WFMarketTrends\bin\x64\Release\net10.0-windows10.0.19041.0\win-x64\WFMarketTrends.exe
```

The project uses WinUI 3 and WebView2 with a bundled local dashboard. The native host owns window geometry, top-edge activation, animation, tray controls, settings, and API networking. The dashboard has no address bar or website setup. A second normal instance exits to avoid browser-profile conflicts.

## Automated checks

```powershell
node --test Checks/analytics.test.cjs
node --check WFMarketTrends/Web/app.js
```

The test suite covers online and visible order filtering, price-per-unit normalization, median calculation, variant and market separation, snapshot retention, 24-hour highlight qualification, and historical statistics parsing. The public statistics fixtures include standard items and ranked mods. Historical tests verify completed-hour comparisons without locally recorded history and exclusion of stale, ambiguous, or unsupported data.

These checks do not verify native window behavior or live API availability. Use the desktop smoke test and manual checks below for those.

## Desktop smoke test

Build and run the diagnostic app:

```powershell
dotnet build WFMarketTrends/WFMarketTrends.csproj -c Release -p:Platform=x64 -p:SmokeTest=true -o .\smoke\
& .\smoke\WFMarketTrends.exe
```

This build uses a separate profile and mutex. It loads the live catalog, an item order book, and historical prices; checks both highlight tabs using temporary in-memory test data; verifies watchlist storage and state retained across hide/reveal; and writes `smoke/smoke-test.json`. The diagnostic window is selectable by desktop test tools and exits 30 seconds after writing its result.

Inspect the result for `historicalPrices`, `highlightsTabs`, and `retainedOnHide` set to `true`, a populated catalog and order book, and an empty dashboard error. Check the feed connection status and horizontal-overflow result as well. A top-level `error` indicates a diagnostic failure.

Live API availability is required. Do not distribute the smoke build or its profile. Run a normal build or publish without `SmokeTest=true` for everyday use.

## Manual acceptance checks

1. Launch with no local price history. Confirm historical prices load and eligible items appear in the highlight tabs without a 24-hour recording period. An empty tab is valid if no loaded items meet its criteria.
2. Search for an item, select it, and switch variants. Confirm current prices, historical charts, and order-book entries use the selected variant. Add and remove watchlist entries, then restart to check persistence.
3. Switch platforms and crossplay preferences. Confirm live orders follow those settings and historical statistics follow the selected platform. Verify Switch disables crossplay.
4. Restart within an hour and check that historical cache files are reused. Confirm the history status, price timestamps, and Update history control behave correctly.
5. Pause and resume the live listing display. Disconnect and reconnect the network; confirm request errors appear and the feed reconnects.
6. Reveal from the top edge, hover without clicking, and move away: the panel should hide. Reveal again, click inside, and move away: it should remain open until an outside click. Verify that outside click reaches its target.
7. Hide and reveal from the toolbar and tray. Confirm the page retains its state. Alt+F4 should hide; the tray's Exit command should terminate the app.
8. Change dimensions and left/middle/right placement, then restart. Check the panel and activation area at different monitor resolutions and DPI scales.
9. Enable Windows startup, verify it opens hidden, then disable it. Test with an ordinary maximized window and a borderless game window.

## Publish and distribute

```powershell
dotnet publish WFMarketTrends/WFMarketTrends.csproj -c Release -p:Platform=x64 -o publish
& .\publish\WFMarketTrends.exe
```

Distribute the **entire publish folder**, including `Web/`, the WinUI resources, and runtime dependencies. Copying only the EXE is insufficient. .NET and Windows App SDK are self-contained; the recipient still needs supported Windows x64 and WebView2 Runtime. Single-file distribution is not configured for the dashboard assets.

Keep the repository license and EdgeWeb notice with the distribution:

```powershell
Copy-Item LICENSE, LICENSE.EdgeWeb -Destination .\publish\
```

Move the application folder to its permanent location before enabling Windows startup. Disable startup before moving or deleting that folder, or save the startup setting again from the new location.

Build output, publish output, and smoke-test profiles are excluded from Git. The repository contains source, documentation, and test fixtures.

## Data sources and caching

All networking runs in the native host with `User-Agent: WFMarketTrends/0.1.0`. Catalog and orders use the [v2 HTTP API](https://docs.warframe.market/docs/api/overview/).

Historical prices use `GET https://api.warframe.market/v1/items/{slug}/statistics`, specifically sell rows in `payload.statistics_live`. The legacy API is deprecated and unsupported; loading errors are displayed if it becomes unavailable. Hourly data covers the last 48 hours, and daily data supports longer chart views. Historical statistics are kept separate from locally recorded snapshots and crossplay-filtered live orders.

Historical loading covers 12 starter prime sets, watched items, and the selected item rather than scanning the entire catalog. Cache files are stored under `%LOCALAPPDATA%\WFMarketTrends\history-cache\{platform}` and expire after an hour. The dashboard refreshes history hourly; Update history also reuses fresh cache entries. Current-order responses are reused for 30 seconds. All HTTP calls share a two-requests-per-second limit and respect rate-limit cooldowns.

The [WebSocket connection](https://docs.warframe.market/docs/websockets/overview/) uses `wss://ws.warframe.market/socket` with the required `wfm` subprotocol. The [new-order subscription](https://docs.warframe.market/docs/websockets/subscriptions/) provides listings, not transactions. Reconnection uses increasing delays. Pausing the feed freezes its display while other tracking continues.

## Local storage and host behavior

Settings are saved in `%LOCALAPPDATA%\WFMarketTrends\settings.json`. The dedicated WebView2 profile stores watchlists and local snapshots in browser local storage. Storage failures display a warning.

Local snapshots retain up to 30 days, with older samples reduced to five-minute and hourly points. A total storage cap removes the least recently updated histories first. Historical variants with missing identifying fields and bulk items without verified historical unit-price normalization are excluded from highlights; their charts use local snapshots when available.

The host accepts fixed read commands only from the local dashboard, blocks external navigation and popup windows, and makes no authenticated trading requests. Panel geometry is capped to the primary monitor. Exclusive fullscreen behavior remains controlled by Windows.
