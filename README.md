# Warframe Market Trends

A Windows tray panel for watching Warframe Market asking prices. Built with WinUI 3 and WebView2, using EdgeWeb's native top-edge reveal, click-to-keep-open behavior, animation, geometry and tray approach. The embedded page is a bundled dashboard; there is no address bar or website setup.

## Build and run

Requires Windows 10 build 19041 or newer (x64), .NET 10 SDK, and Microsoft Edge WebView2 Evergreen Runtime.

```powershell
dotnet build WFMarketTrends/WFMarketTrends.csproj -c Release -p:Platform=x64
& .\WFMarketTrends\bin\x64\Release\net10.0-windows10.0.19041.0\win-x64\WFMarketTrends.exe
```

On normal launch the panel opens. Hover for 150 ms at the top edge within its horizontal span to reveal it again. Hover-only reveals hide on leaving; click inside to keep it visible until an outside click. The dashboard and feed stay alive while hidden. Alt+F4 hides the panel. Use the tray menu to exit. A second instance exits to avoid WebView profile conflicts.

Panel settings control dimensions, Left/Middle/Right placement and optional Windows startup. Startup launches hidden. Default dimensions are 520 × 844 logical pixels, capped to the primary monitor. Topmost behavior works with ordinary and borderless windows; exclusive fullscreen is controlled by Windows.

## Tracking

- Search the English item catalog, select a variant, and watch up to 20 item/variant pairs.
- Home-screen Market highlights loads historical prices for 12 starter prime sets, your watchlist and the selected item. **Picking up · 24h** ranks variants gaining at least 5%; **Holding value** shows variants within ±3% and a daily price range of at most 6%. They compare the latest completed hourly statistic with 24 hours earlier. No 24-hour local recording period is required. Data must cover the comparison period with at least 12 samples, no gaps over three hours, and a latest statistic within three hours. Click a row to open its item and variant. Missing, thin or stale history is excluded.
- Select PC, PlayStation, Xbox, Switch or Mobile and crossplay. Switch disables crossplay.
- Lowest sell, highest buy and median sell use visible online/in-game listings. Bulk listings are normalized to platinum per unit. Median is unweighted across listings.
- Rank, charges, sculpture stars and subtype separate item variants. Histories also separate platform and crossplay.
- The selected item refreshes every minute; the watchlist refreshes every five minutes. Responses are reused for 30 seconds. All HTTP calls pass through a shared limit of two requests per second and respect rate-limit cooldowns.
- The live feed uses the documented new-order subscription and reconnects with increasing delays. Pause freezes feed display; it does not stop snapshot collection.
- Historical charts use hourly sell-listing statistics from the last 48 hours and daily statistics for longer views, without mixing buy listings or completed-trade statistics. Historical platform data is separate from crossplay-filtered live orders. Unsupported or ambiguous variants (including bulk items without verified unit-price normalization) fall back to local chart recording and do not appear in historical highlights.
- Local snapshots remain available as a chart fallback, at most once per minute, retaining up to 30 days with reduced detail for older samples. They are kept separate from imported historical statistics. No completed sales are inferred from listings. Cached watchlist prices carry their snapshot time.

Networking runs in the native host with `User-Agent: WFMarketTrends/0.1.0`. Catalog and orders use the [v2 HTTP API](https://docs.warframe.market/docs/api/overview/). Historical prices use the still-serving legacy route `GET https://api.warframe.market/v1/items/{slug}/statistics`, specifically `payload.statistics_live` sell rows. The legacy API is deprecated and unsupported; historical loading displays errors if it becomes unavailable. Cache files live under `%LOCALAPPDATA%\WFMarketTrends\history-cache\{platform}` and expire after an hour. The UI refreshes history hourly and offers Update history; both reuse fresh cache entries. All calls share the native two-requests-per-second limit. It does not scan all thousands of catalog items.

The [WebSocket connection](https://docs.warframe.market/docs/websockets/overview/) uses `wss://ws.warframe.market/socket` and the required `wfm` subprotocol. The [public new-order subscription](https://docs.warframe.market/docs/websockets/subscriptions/) provides listings, not transactions. No login is required and no orders are posted or modified.

Settings live in `%LOCALAPPDATA%\WFMarketTrends\settings.json`. The dedicated WebView2 profile stores the watchlist and snapshots in local storage. Removing this profile resets tracking data. Storage failures display a warning. The host accepts fixed read commands only from the local dashboard and blocks external navigation and popup windows.

## Validation and distribution

```powershell
node --test Checks/analytics.test.cjs
dotnet publish WFMarketTrends/WFMarketTrends.csproj -c Release -p:Platform=x64 -o publish
```

Distribute the entire publish folder, including `Web/`. .NET and Windows App SDK are self-contained; WebView2 Runtime is still required. Single-file distribution is not configured for the dashboard assets.

Manual checks: open the app with no local history and verify historical highlights load, select an item and switch ranks/platforms, restart and verify disk cache reuse, watch/unwatch, pause/resume the feed, disconnect/reconnect the network, reveal/hide from the top edge and tray, and check settings at different DPI scales. Network restrictions may interrupt service; the app displays request errors and feed reconnect status.

An isolated desktop test can be built with `dotnet build WFMarketTrends/WFMarketTrends.csproj -c Release -p:Platform=x64 -p:SmokeTest=true -o smoke`. Run `smoke/WFMarketTrends.exe`; it uses a separate profile and mutex, loads the catalog and an item order book, checks saved watchlist and state retained across hide/reveal, and writes `smoke/smoke-test.json`. The diagnostic window is selectable by desktop test tools and exits 30 seconds after writing its result. Do not distribute this build. Live API availability is required.

Native panel services are adapted from the adjacent EdgeWeb project. Warframe Market is an independent data source; this app is not affiliated with Digital Extremes or Warframe Market.

The repository's GPL-3.0 license is in `LICENSE`. EdgeWeb's original MIT copyright and permission notice is retained in `LICENSE.EdgeWeb` for the adapted native panel code.
