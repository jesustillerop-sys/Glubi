# GLUBI V4 - Adaptive Trading Intelligence

GLUBI is a market-analysis, model-evaluation, and paper-trading application that can run locally or as a hosted Node.js service. It does not submit live orders to Binance and does not guarantee profitability.

## Requirements and startup

- Node.js 22.13 or newer (`node:sqlite` is used for persistence).
- npm.

```powershell
npm install
npm start
```

Open `http://localhost:8765`. By default the server binds to `127.0.0.1` and is reachable only from this PC.

### Open GLUBI on your phone over Wi-Fi

1. Connect the phone and PC to the same trusted Wi-Fi network.
2. In `.env`, set `HOST=0.0.0.0`, then restart GLUBI. This makes the dashboard reachable to devices on the PC's network; the default remains local-only.
3. On Windows, run `ipconfig` and find the PC's IPv4 address under the active Wi-Fi adapter (for example, `192.168.1.25`).
4. On the phone, open `http://192.168.1.25:8765`, replacing the example address with the PC's IPv4 address.
5. If Windows Firewall prompts, allow Node.js only on private networks. If it does not prompt and the page cannot load, add a private-network inbound rule for the GLUBI port `8765`.

GLUBI does not currently authenticate dashboard/API requests. Use this only on a trusted private network: do not create a router port-forward, expose port `8765` to the Internet, or use public Wi-Fi. Setting `HOST=0.0.0.0` lets any device that can reach the PC's port access the app.

Telegram notifications are sent only after a simulated paper buy or sell has actually been committed. No preparation, unconfirmed signal, or cancelled signal is sent to Telegram. Copy `.env.example` to `.env` and set your bot credentials there. `.env` is ignored by Git.

```powershell
Copy-Item .env.example .env
# Edit .env and set TELEGRAM_TOKEN and TELEGRAM_CHAT_ID
npm start
```

## Modules

| Folder/file | Responsibility |
| --- | --- |
| `core/server.js` | HTTP API, scanner, monitoring, and application orchestration |
| `core/analysis.js` | Indicator confluence, technical analysis, and baseline signal construction |
| `core/indicators.js` | EMA, RSI, ATR, ADX, MACD, swings, and support/resistance helpers |
| `core/signals.js` | Shared signal rules used by technical and qualified model decisions |
| `ai/features.js` | Historical feature extraction and chronological training samples |
| `ai/trainer.js` | TensorFlow.js training, validation, inference, model persistence, and cleanup |
| `ai/decision.js` | Allows a qualified TensorFlow model to contribute at most one score point |
| `trading/paper_engine.js` | Independent virtual portfolio with fees, slippage, stops, targets, and automatic confirmed-signal execution enabled by default |
| `trading/risk_manager.js` | Existing capital, position-risk, PNL, and learning-from-outcomes logic |
| `exchanges/` | Separate Binance Spot, USDⓈ-M, and experimental Alpha data adapters |
| `alerts/` | Signal scheduling and Telegram notifications |
| `dashboard/` | Dashboard HTML, CSS, application client, and equity-chart renderer |
| `database/` | SQLite schema migrations, JSON-compatible document store, and backups |
| `trading/adaptive_risk.js` | ATR trailing stops and bounded learning from closed stop outcomes |
| `tests/` | Paper trading, alert scheduling, TensorFlow persistence, and database tests |

Root entry points (`glubi_server.js`, `glubi_paper.js`, `glubi_scheduler.js`, and `glubi_capital.js`) preserve compatibility with existing launch commands and imports. Account, position, watchlist, and learning records remain mirrored in their existing JSON files. The old `parchear.js` installer exits without changes on this modular layout.

## Learning and validation

TensorFlow.js is an auxiliary signal, not an autonomous trading strategy. Samples are ordered in time, the latest block is held out for validation, and a six-candle embargo prevents training labels from overlapping the validation period. A model affects a signal only when it has at least 80 validation cases, at least 55% accuracy, and exceeds the majority-class baseline by more than two percentage points. The existing confluence, trend, ADX, and risk/reward checks remain in force.

Paper auto-trading is enabled by default and can be turned off in the Virtual Portfolio settings. Entries occur only after a signal was prepared before candle close and confirmed after close. A confirmed opposite signal closes an open paper position; stops and targets are also monitored. Position size uses the configured paper-risk percentage and available virtual balance. Old paper settings are migrated to this default once, after which an explicit opt-out is retained.

Open positions use a trailing stop based on ATR and the most favorable observed price. The stop only moves in the protective direction and is never moved beyond its original loss stop. After five paper stop exits, the ATR multiplier adjusts by 0.1 based on the latest five stop outcomes; it is bounded between 1.5× and 4× and persisted with the paper portfolio. This is a transparent heuristic, not machine-learning certainty or a guarantee of better results. Monitoring uses the app's periodic market scan (about every 20 seconds); it is not an exchange-hosted stop order and cannot guarantee execution at the stop price.

Automatic paper trading uses virtual funds only. It does not submit orders to Binance, and past or simulated returns do not establish or guarantee profitability. Real Binance trading remains disabled and would require separate implementation, explicit opt-in, exchange testnet validation, strict exposure/daily-loss limits, withdrawal-disabled API keys, and an emergency stop.

## Persistence

SQLite is the primary document store. On first read, existing JSON files are imported without replacing their contents; writes update SQLite and keep the JSON files as compatibility copies. A dated SQLite backup is created at most once per 24 hours when the server starts. Backups and personal trading/model data are excluded from source control.

## Deploying from GitHub to Render

GitHub stores the source; it does not run this Node.js server. The included `render.yaml` configures a Render web service, a persistent data disk, the Node runtime, and a health check. Connect the GitHub repository to Render and deploy the Blueprint. Render's Starter service and persistent disk may incur charges.

Set a unique, strong `APP_PASSWORD` when Render prompts for it. The dashboard and API require HTTP Basic authentication (`glubi` as the username); `/healthz` is the only unauthenticated endpoint. Production startup fails if the password is missing. SQLite, paper trades, account data, watchlists, and trained models are stored on `/var/data`, not in the temporary application filesystem. Never commit `.env`, passwords, or personal JSON/database files.

GitHub Actions runs syntax checks and the test suite for pushes and pull requests. The hosted app still uses virtual/paper trading only; it does not place Binance orders.

## Market coverage

| Market | Status |
| --- | --- |
| Spot | Public market data and analysis |
| USDⓈ-M perpetual futures | Public market data and analysis; paper shorts supported |
| Binance Alpha | Experimental; isolated adapter uses non-official endpoints |
| COIN-M futures | Not integrated |
| Options | Not integrated |
| bStocks | Disabled; eligibility and regional restrictions are not verified |
| New listings | No dedicated detector |
| Margin | No independent margin-risk module |

Market-data availability does not imply account eligibility or permission to trade. No module places live orders.

## Validation commands

```powershell
npm run check
npm test
```
