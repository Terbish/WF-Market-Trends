# Warframe Market Trends

Keep an eye on Warframe Market prices from a compact Windows panel. Search items, follow your watchlist, explore price history, and see new listings without leaving a full browser window open.

The app lives in your system tray. Hover at the top edge of your screen to bring it into view.

## Features

- **Market highlights:** discover items picking up in price over 24 hours and items holding their value. Highlights cover 12 starter prime sets, your watched items, and the item you are viewing.
- **Historical price charts:** view 24-hour, 7-day, and 30-day price trends. Historical data loads automatically, so you do not need to leave the app running for a day.
- **Personal watchlist:** save up to 20 item and variant combinations. Your watchlist stays saved between sessions.
- **Current prices:** see the lowest sell price, highest buy price, median sell price, and online order book.
- **Live listings:** follow newly posted listings and pause the feed when you want to inspect it.
- **Platform and variant selection:** choose PC, PlayStation, Xbox, Switch, or Mobile, with crossplay for live orders where supported. Ranked mods and other item variants have separate prices.
- **Adjustable panel:** change its size, choose left, middle, or right placement, and optionally start it with Windows.

## Requirements

- Windows 10 version 2004 (build 19041) or newer, x64.
- [Microsoft Edge WebView2 Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).
- An internet connection to fetch market data.

To build the app from source, see [Build, validation, and distribution](doc/validation-and-distribution.md).

## Getting started

1. Launch `WFMarketTrends.exe` from the application folder. Keep the accompanying files in that folder.
2. Choose your platform and crossplay preference.
3. Search for an item, select its variant, and choose **Watch** to save it.
4. Explore the **Picking up · 24h** and **Holding value** tabs, or click an item to open its prices and chart.

Historical prices load in the background and refresh hourly. Current prices refresh every minute for the selected item and every five minutes for the watchlist. Loading status and update times are displayed in the panel.

## Showing and hiding the panel

- Hover briefly at the top edge, above the panel's position, to reveal it. Move away to hide a hover-only reveal.
- Click inside to keep it open until you click outside.
- Use the hide button or Alt+F4 to hide it. The app continues running in the tray.
- Double-click the tray icon to show it, or use its menu for settings and **Exit**.

Starting with Windows opens the app hidden. The default panel is 520 × 844 logical pixels and fits within the primary monitor. It works over ordinary and borderless windows; exclusive fullscreen games may prevent it from appearing.

## Understanding the prices

Prices are **asking prices from listings**, not proof of completed trades. Live order-book prices use visible listings from online or in-game users and show platinum per unit.

**Picking up · 24h** shows variants whose historical median sell price rose by at least 5%. **Holding value** shows variants within ±3% of their earlier price, with no more than 6% movement across the comparison period. Both compare the latest completed hourly statistic with approximately 24 hours earlier. Items with missing, sparse, or stale history are excluded, so either tab can be empty.

Historical statistics are platform-based; the crossplay setting applies to live orders. Some variants and bulk items do not have usable historical data. Their charts fall back to prices recorded locally while the app runs.

Historical data currently relies on a legacy Warframe Market endpoint. Changes or interruptions to that service can affect charts and highlights. The app displays loading errors and reconnects the live feed automatically.

## Your data

No Warframe Market login is required. The app reads public market data and does not place or modify orders.

Settings, watchlists, cached prices, and locally recorded history are stored on your computer under `%LOCALAPPDATA%\WFMarketTrends`. Removing the WebView2 profile resets your watchlist and local snapshots.

## Development and licensing

Build commands, automated checks, desktop smoke tests, and packaging instructions are in [Build, validation, and distribution](doc/validation-and-distribution.md).

This is an independent community tool, unaffiliated with Digital Extremes or Warframe Market. Market data comes from [warframe.market](https://warframe.market). The native panel is adapted from EdgeWeb using WinUI 3 and WebView2.

The repository is licensed under [GPL-3.0](LICENSE). EdgeWeb's original MIT notice is retained in [LICENSE.EdgeWeb](LICENSE.EdgeWeb) for the adapted native panel code.
