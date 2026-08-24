# PLAN — EliaTopBar → Mobile (Elia Subworkers)

> Status: IN PROGRESS · Source of truth: MVP.md · Generated: 2026-08-23 · Revised: **React Native** per Wael

## 0. Objective

Transform this repo (a duplicate of the macOS **EliaTopBar** Swift menu-bar app) into a **normal mobile application** built with **React Native (TypeScript, Expo)** that connects to the **EliaAgent FastAPI subworker server** over the local network, plus **one new feature**: automatic **local-network server discovery** in Settings.

Rules inherited from MVP.md:
- Android is the ONLY product (React Native is the implementation stack). No TopBar concept, no desktop-style UI.
- Existing macOS app stays untouched (Swift sources remain under `Sources/`).
- Real functionality only — no placeholder/mock screens.
- Bottom tab navigation, mobile-native patterns, production quality.
- **UI quality bar**: inspired by the ChatGPT/OpenAI mobile app — clean, calm, professional agent-console aesthetic (generous whitespace, subtle surfaces, refined typography, restrained color accents for states).

---

## 1. Source Audit (Phase 1–3 of MVP — DONE)

### 1.1 Feature inventory (from `Sources/*.swift`)

| macOS feature | Carries to Android? | How |
|---|---|---|
| WebSocket live status (`ws://host/ws`) | ✅ | OkHttp WebSocket |
| HTTP polling fallback (5s down / 15s backup) | ✅ | Same logic |
| Active agents list w/ states (running/idle/disabled/error/done) | ✅ | Agents tab |
| Per-agent detail: status, next run, schedule, last error, last completed | ✅ | Detail screen |
| Live log viewer (`/logs/{name}?lines=50`) | ✅ | Detail screen log tab |
| Trigger now (`POST /trigger/{name}`) | ✅ | Row action + detail |
| Enable/disable (`POST /enable\|disable/{name}`) | ✅ | Switch |
| Manual Run dropdown | ✅ | Merged into Agents tab actions |
| Model selection per agent (`GET /models`, `PUT /status/{name}`) | ✅ | Searchable picker dialog |
| Main agent get/set (`GET/POST /main-agent`) | ✅ | Detail screen toggle |
| Server health (`/server/health`: state, pid, restarts) | ✅ | Home card |
| Change Server URL (persisted) | ✅ | Settings + **NEW: LAN scan** |
| Refresh interval (5/10/30/60s) | ✅ | Settings |
| Launch at Login | ❌ Dropped | macOS-only concept |
| Colima instance management | ❌ Dropped | macOS Docker CLI — meaningless on phone |
| Menu-bar dots + hover log popover | ❌ Replaced | Native list UI + notification-ready architecture |

### 1.2 API contract (verbatim from `SubworkerManager.swift`)

Base: `http://<host>:5656` (default). WS: same host `/ws`.

| Call | Method | Request | Response |
|---|---|---|---|
| `/status` | GET | — | `{"subworkers":[{name, enabled, running, next_run?, schedule_type?, model?, variant?}]}` |
| `/server/health` | GET | — | `{state, health_status, pid?, restart_count}` |
| `/trigger/{name}` | POST | — | 200 |
| `/enable/{name}` | POST | — | 200 |
| `/disable/{name}` | POST | — | 200 |
| `/logs/{name}?lines=50` | GET | — | `{"lines": ["...", ...]}` |
| `/models` | GET | — | `{"models":[{id, name, provider, variants:[...]}]}` (500+ entries) |
| `/status/{name}` | PUT | `{model, variant?}` | 200 |
| `/main-agent` | GET | — | `{name}` |
| `/main-agent` | POST | `{name}` | 200 |
| `/ws` | WS | send `{"type":"ping"}` every 30s | events below |

WS events (JSON, key `event`):
- `initial_status` → `{event, subworkers:[...]}` (also accepted without event key if `subworkers` present)
- `subworker_started` → `{event, name}`
- `subworker_completed` → `{event, name}`
- `subworker_error` → `{event, name, error}`
- `pong`

Connection behavior to replicate exactly:
- Ping every 30s. On failure/timeout → disconnect handling.
- Reconnect backoff: start 1s, double each attempt, cap 30s. Reset on success.
- While disconnected: poll `/status` every 5s. While connected: safety-net poll every 15s.
- First WS-connect check after 1s grace; treat as failed if not confirmed.

---

## 2. Target Architecture

Expo project lives in **`mobile/`** (repo root keeps Swift sources intact; `android/` name reserved for future prebuild output).

```
mobile/
├── package.json / app.json / tsconfig.json / babel.config.js
├── app/                              # expo-router
│   ├── _layout.tsx                   # root providers + theme
│   ├── (tabs)/
│   │   ├── _layout.tsx               # bottom tabs: Home | Agents | Settings
│   │   ├── index.tsx                 # Home dashboard
│   │   ├── agents.tsx                # Agents list
│   │   └── settings.tsx              # Settings (+ LAN scan)
│   └── agent/[name].tsx              # Agent detail (stack push)
└── src/
    ├── theme.ts                      # design tokens: colors, spacing, type scale,
    │                                 # dark mode — ChatGPT-app-inspired palette
    ├── lib/
    │   ├── types.ts                  # SubworkerInfo, ServerHealth, ModelOption,
    │   │                             # DiscoveredServer, ConnectionState
    │   ├── config.ts                 # constants: default URL, port 5656, intervals
    │   ├── api.ts                    # REST client — every endpoint §1.2
    │   ├── socket.ts                 # WS manager: backoff, ping, event parse
    │   ├── store.ts                  # zustand store = port of SubworkerManager.swift
    │   ├── settings.ts               # zustand+AsyncStorage: serverUrl, refreshIntervalSec
    │   └── discovery.ts              # NEW: LAN scanner (§4)
    └── components/
        ├── StatusCard.tsx  ErrorBanner.tsx  StateBadge.tsx
        ├── AgentRow.tsx    ModelPickerModal.tsx  LogsPanel.tsx
        └── ScanResults.tsx
```

State flow: one Application-scoped zustand store holds connection state, subworkers, health, errors — mirrors `SubworkerManager`'s `@Published` properties 1:1. Store starts on app launch and survives tab switches.

### Tech stack (pinned)

| Item | Value |
|---|---|
| Runtime | Expo SDK latest stable (54+), React Native 0.81+, React 19 |
| Language | TypeScript strict |
| Navigation | expo-router (bottom tabs + stack) |
| State | zustand (+ persist middleware) |
| Persistence | @react-native-async-storage/async-storage |
| Networking | fetch (REST) + global WebSocket — zero native modules |
| Network info | expo-network (device IPv4 for scan) |
| UI | StyleSheet-based custom theme (no UI kit), useColorScheme dark mode |

No custom native modules → runs in Expo Go AND exports to APK via prebuild. If a pinned version fails to resolve, adjust to nearest available and note it in the task report.

### Config requirements

- `app.json`: name "Elia Subworkers", slug `elia-subworkers`, android plugin config with `usesCleartextTraffic: true` (plain-HTTP LAN server — deliberate), INTERNET permission (default).
- No auth, no secrets in code.

---

## 3. Screens Spec

### Home (dashboard)
- Connection card: WS state badge (Connected/Connecting/Disconnected/Error), server URL, reconnect button.
- Server health card: state, PID, restart count, health status.
- Counters row: N running / N enabled.
- Last error banner (dismissable) when `subworker_error` seen.
- Quick actions: running agents listed with Stop-view shortcut; idle agents quick-trigger chips (max ~6, then "See all").

### Agents (list + detail)
- List: running first, then idle, then disabled. Row = monogram avatar, name, state badge, next-run caption. Pull-to-refresh. Swipe/action: trigger.
- Detail screen (tap row): full fields grid, Enable/Disable switch, **Trigger Now** button, **Main agent** toggle (set/unset), **Model** row → searchable dialog over `/models` catalog (500+ items, filter by id/name/provider) + variant chips (low/medium/high/max…), **Logs** section: fetches `/logs/{name}?lines=50`, auto-refresh toggle (2s), monospace view, copy button.

### Settings
- **Server section**: current URL display; Edit → dialog with URL field (validation: scheme http/https, host required, default port 5656 appended if absent); **Scan network** button → discovery UI (§4); "Test connection" action hitting `/server/health`.
- **Polling section**: refresh interval selector (5/10/15/30/60 s).
- **About**: app version, source repo note.

---

## 4. NEW FEATURE — Local Network Server Discovery

Goal: in Settings, one tap finds the EliaAgent server IP automatically on the phone's Wi-Fi.

Algorithm (`src/lib/discovery.ts`) — pure JS, no native modules:
1. Get device IPv4 via `expo-network.getIpAddressAsync()`. Unavailable / not private range → emit `ScanError.NotOnWifi`.
2. Derive owning /24 from the IP (e.g. `192.168.1.x` → probe `.1`–`.254`). Cap at 254 candidates.
3. Port selection: port parsed from currently-saved URL, else **5656**.
4. Parallel probes with `fetch(url, {signal})`, AbortController timeout 700ms, concurrency pool of 32. Skip own IP, probe gateway (.1) early.
5. Verified iff response JSON contains `state` (from `/server/health`) or `subworkers` (fallback `/status`).
6. Emit results **progressively** (callback per find): `DiscoveredServer(ip, port, baseUrl, latencyMs, verified)`. Final list sorted by latency.
7. Cancellation-safe: new scan aborts previous via AbortController registry.

UX (Settings → Scan):
- Button "Scan network" → progress bar + live count ("Probing… 2 found").
- Result rows: IP, latency, ✓ verified badge → tap = save URL + reconnect + toast confirmation.
- States: scanning / none-found (hint: check server running & same Wi-Fi) / not-on-wifi error.

Note: fetch-based probing trades raw speed for zero native deps; worst case ≈ 254 hosts ÷ 32 pool × 700ms ≈ 6s. Acceptable. Optional future upgrade: react-native-tcp-socket for true TCP probes (requires dev-client build).

---

## 5. Execution Units (parallel, conflict-free)

File ownership is exclusive per unit — no two units touch the same file.
**All UI units (D/E/F) are dispatched to the `picasso` subagent** — design bar: ChatGPT/OpenAI mobile app aesthetic (see §0).

| Unit | Scope (files owned) | Agent | Depends on |
|---|---|---|---|
| **A — Foundation** (sync, first) | `mobile/*` scaffold: package.json, app.json, tsconfig, babel, expo-router skeleton (`app/_layout.tsx`, `(tabs)/*` stubs, `agent/[name].tsx` stub), `src/theme.ts` (full design tokens), `src/lib/types.ts`, `src/lib/config.ts`, `src/lib/settings.ts` (full impl), zustand store **interface** stubs with exact signatures | ultrabrain | — |
| **B — Connection core** | `src/lib/api.ts`, `src/lib/socket.ts`, `src/lib/store.ts` (full impl — port of SubworkerManager.swift) | deep | A |
| **C — Discovery engine** | `src/lib/discovery.ts` (full impl + exported pure helpers for testing) | deep | A |
| **D — Home UI** | `app/(tabs)/index.tsx`, `src/components/StatusCard.tsx`, `ErrorBanner.tsx` | **picasso** | A |
| **E — Agents UI** | `app/(tabs)/agents.tsx`, `app/agent/[name].tsx`, `src/components/AgentRow.tsx`, `StateBadge.tsx`, `ModelPickerModal.tsx`, `LogsPanel.tsx` | **picasso** | A |
| **F — Settings UI** | `app/(tabs)/settings.tsx`, `src/components/ScanResults.tsx` | **picasso** | A |
| **G — Integration gate** (sync, last) | typecheck fixes anywhere, `tsc --noEmit` green, `expo export --platform android` green, README section | deep | B–F |

Interfaces frozen in Unit A are the contract; B/C fill implementations, D/E/F consume store only.

## 6. Verification Gates

1. After A: `npm install` succeeds, `npx tsc --noEmit` clean (skeleton).
2. After B–F: `npx tsc --noEmit` clean across the whole project.
3. G: `npx expo export --platform android` bundles successfully (Metro proof); APK instructions written (`npx expo prebuild -p android && cd android && ./gradlew assembleDebug`).
4. Functional spot-check vs §1.2 contract (endpoint paths, JSON keys, backoff constants 1s→30s cap, ping 30s, polls 5s/15s) — grep-level audit by G.

## 7. Out of scope (explicit)

- iOS anything. Colima. Launch-at-login. Background service/notifications (future). Auth (server has none). Play packaging/signing.

---

## 8. PHASE 2 — Chat IA, Photos de profil, Calendrier (added per Wael)

Server capabilities verified live (OpenAPI): `/sessions/{name}` returns `{name, session_id, messages:[{info:{role,agent,model,time_created}, parts:[{type:'step-start'|'reasoning'|'text'|..., text, tool, input, output}]}]}` ; `/sessions/{name}/list` returns `{name, sessions:[{session_id, title, agent, model, time_created, message_count}]}`. Profile photos are LOCAL-only on macOS (Application Support + JSON map) → same pattern on Android.

### H — Sessions API layer (gilfoyle-core)
Extend `src/lib/api.ts`: `getSessionsList(name)`, `getSessionMessages(name)`. New `src/lib/session-types.ts`: `SessionSummary`, `ChatMessage {info:{role,agent,model,time_created}, parts: MessagePart[]}`, `MessagePart {type, text?, tool?, input?, output?}`. `npm i expo-image-picker expo-file-system` (needed by unit K).

### I — Chat / Sessions UI (picasso-agents)
Per-agent "Chats" entry in detail screen → SessionsModal (list from `/list`: title, relative time) → ChatViewer: bubbles by role (user right/accent, assistant left/surface), **reasoning blocks collapsible** ("Thinking…" style, ChatGPT-like), tool-call rows (icon + tool name + collapsed input/output), timestamps; auto-refresh toggle 2s = streaming feel (new parts appear live); session switcher via modal. Files: `src/components/SessionsModal.tsx`, `src/components/ChatViewer.tsx`, integration into existing detail screen.

### J — Calendar tab (picasso-home)
New 4th bottom tab "Calendar" (`app/(tabs)/calendar.tsx` + update `(tabs)/_layout.tsx`). Week view (Google Calendar-style): 7-day columns × hours grid, today highlighted; each enabled agent's `next_run` plotted as colored chip (state color, monogram) at its hour; tap chip → agent detail. Day summary header (N runs scheduled). Data from store.subworkers (next_run ISO). Honest scope: server exposes only next_run per agent — recurring projection beyond next_run is out unless server adds a schedule config endpoint.

### K — Profile photos (picasso-settings)
`src/lib/profilePhotos.ts`: local persistence mirroring ProfilePhotos.swift — copy picked image into FileSystem.documentDirectory`/agent_photos/{name}.jpg`, JSON map `{agentName: filename}` in AsyncStorage. `src/components/Avatar.tsx`: renders photo if exists else monogram fallback. `src/components/AvatarPickerModal.tsx`: expo-image-picker launch, square crop, remove-photo option. Settings section "Profiles": list agents → tap → picker.

Integration order: H first (types+deps), then I/J/K parallel; picasso-agents swaps monograms → `<Avatar>` after K lands.

---

## 9. PHASE 3 — Remote Access Everywhere via Cloudflare Tunnel (custom domain, 100% free)

### 9.0 Problème & solution

Aujourd'hui l'app ne marche qu'en LAN (`http://192.168.x.x:5656`). Objectif : accéder au serveur **partout** (4G/5G, autre Wi-Fi) via un **domaine personnalisé** gratuit — sans VPS, sans ngrok payant.

**Mécanisme : Cloudflare Tunnel (cloudflared)** — gratuit illimité, domaine custom inclus si le domaine est sur Cloudflare (plan free OK) :

```
Téléphone (partout) ──► https://subworkers.tondomaine.com  (Cloudflare edge, TLS auto)
                              │ Cloudflare Tunnel (connexion sortante)
                              ▼
        Mac Wael : conteneur docker "cloudflared" (TUNNEL_TOKEN)
                              │ réseau docker interne
                              ▼
        conteneur subworkers-server :5656  (FastAPI existant, /ws inclus)
```

Contrainte assumée : l'installation se déclenche **depuis l'app en LAN** (le téléphone ne peut pas piloter le Mac autrement). Une fois le tunnel actif, l'app marche partout — plus besoin du LAN.

### 9.1 Server-side — Unit L (repo `/Users/vakandi/EliaAI/subworkers/server/`, gilfoyle-scan)

Nouveaux fichiers (zéro conflit avec mobile/) :
- `app/services/tunnel_manager.py` — toute la logique :
  - `verify_token(api_token)` → CF API `GET /user/tokens/verify` + récupérer `account_id`
  - `check_zone(domain, token)` → CF `GET /zones?name={root_domain}` (le domaine doit être hébergé sur CF)
  - `create_tunnel(domain, token)` → CF `POST /accounts/{id}/cfd_tunnel` (named tunnel) → `{tunnel_id, tunnel_token}`
  - `create_dns_route(domain, tunnel_id, token)` → CF `POST /zones/{zone_id}/dns_records` : CNAME `{sub}` → `{tunnel_id}.cfargotunnel.com`, `proxied: true`
  - `write_compose_service(tunnel_token)` → écrit `docker-compose.override.tunnel.yml` : service `cloudflared` (image `cloudflare/cloudflared:latest`, command `tunnel --no-autoupdate run --token <TOKEN>`), réseau du server
  - `start()/stop()/remove()` → `docker compose -f docker-compose.yml -f docker-compose.override.tunnel.yml up -d cloudflared` (subprocess)
  - `verify_public(domain)` → GET `https://{domain}/server/health` jusqu'à 200 (timeout 90s)
  - Persistance `app/config/tunnel.json` (`{domain, tunnel_id, created_at}`, chmod 600, token JAMAIS retourné par l'API — seulement masqué `tok_…abc`)
- `app/routes/tunnel.py` — router :
  - `GET  /tunnel/status` → `{configured, domain, tunnel_id, cloudflared_running, public_ok, last_error, step}` (step = progression pour le wizard)
  - `POST /tunnel/check` `{domain, api_token}` → valide token + zone + DNS existant (rapide, sans rien créer)
  - `POST /tunnel/setup` `{domain, api_token}` → orchestration complète async ; progression lisible via `GET /tunnel/status` (`step`: verifying_token → checking_zone → creating_tunnel → routing_dns → starting_cloudflared → verifying_public → done/error)
  - `POST /tunnel/stop`, `POST /tunnel/remove`
- Enregistrer le router dans `app/main.py`.

### 9.2 App-side — Unit M (picasso-settings)

- `src/lib/tunnel.ts` : `getTunnelStatus()`, `checkTunnel(domain, token)`, `startTunnelSetup(domain, token)` + polling du `step` (2s) jusqu'à `done|error`.
- Settings → nouvelle section **"Remote access"** sous Server :
  - Row : domaine actuel ou "Not configured — LAN only" ; tap → **DomainSetupWizard** (modal stepper, style ChatGPT) :
    1. Intro : ce que ça fait, gratuit, prérequis = domaine sur Cloudflare
    2. Formulaire : `subworkers.tondomaine.com` + **API Token** (lien how-to : permissions `Zone:DNS:Edit` + `Account:Cloudflare Tunnel:Edit`)
    3. Étapes live avec checkmarks/spinners driven par `step` du serveur ; erreur → message clair + retry
    4. Succès → bouton **"Use https://domain everywhere"** → `setServerUrl(https://domain)` + reconnect
- `src/lib/settings.ts` : nouveau champ `lanUrl` (mémoire du dernier URL LAN détecté/saisi).

### 9.3 Smart URL fallback — Unit N (gilfoyle-core, `src/lib/store.ts` + `settings.ts`)

Ordre de connexion automatique : 1) URL courante → 2) si échec et `lanUrl` sauvegardé et on est en Wi-Fi privé → bascule LAN → 3) sinon si domaine configuré → bascule `https://domain`. Log dans `wsError` la bascule effectuée ("Switched to remote domain"). WS passe en `wss://domain/ws` automatiquement (computeWsUrl gère déjà https→wss).

### 9.4 Sécurité (notes)

- Token CF : transit une seule fois sur HTTP LAN (réseau local de confiance), stocké côté serveur uniquement, jamais renvoyé par l'API.
- Le tunnel expose le serveur publiquement → hardening recommandé (v1.x, non bloquant) : Cloudflare Access policy (free) sur le hostname, ou token d'auth simple côté server.
- TLS bout-à-bout jusqu'à l'edge CF ; origine reste HTTP interne docker (standard cloudflared).

### 9.5 Exécution & vérification

| Unit | Owner | Bloqué par |
|---|---|---|
| L — Server tunnel API | gilfoyle-scan (repo séparé, démarre tout de suite) | — |
| M — Wizard UI | picasso-settings | H (deps) puis L pour test réel |
| N — Smart fallback | gilfoyle-core | — |

Gates : 1) `curl -X POST /tunnel/check` avec vrai token → zone trouvée ; 2) setup complet sur un vrai domaine → `https://{domain}/server/health` = 200 ; 3) **test final** : app connectée au domaine, Wi-Fi du téléphone DÉSACTIVÉ (4G seule) → statut Connected.
