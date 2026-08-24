# AUTHENTIFICATION — Elia Subworkers System

> Auth simple à **un seul token partagé** (admin token). Pas de login, pas d'users, pas de refresh.
> Un token = une clé que tu poses à 3 endroits : serveur, app Android, TopBar macOS.

---

## 1. Comment ça marche

```
ELIA_AUTH_TOKEN="un-secret-long-ici"   ← défini UNE fois dans le .env du serveur

Client (app / TopBar)                    Serveur FastAPI (Docker :5656)
─────────────────────                    ─────────────────────────────
HTTP  →  Authorization: Bearer <token>   ──► middleware vérifie ──► 200
         X-Elia-Token: <token>  (backup)      (l'un OU l'autre suffit)
WS    →  ws://host/ws?token=<token>      ──► vérifié au handshake
```

- **Token vide / variable absente dans le .env = auth DÉSACTIVÉE** (comportement actuel, rétro-compatible).
- Un seul header suffit : `Authorization: Bearer` (standard) ou `X-Elia-Token` (fallback simple).
- WebSocket : token en **query param** `?token=` (les headers WS ne passent pas partout).

---

## 2. Côté SERVEUR (`/Users/vakandi/EliaAI/subworkers/server/`)

### 2.1 Générer un token

```bash
openssl rand -hex 32
# ex: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
```

### 2.2 Le poser dans le .env du docker

```bash
# /Users/vakandi/EliaAI/subworkers/server/.env
ELIA_AUTH_TOKEN=9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
```

Puis restart du container : `docker compose restart` (depuis `server/`).

### 2.3 Implémentation (livrée)

- `app/core/auth.py` :
  ```python
  import os
  from fastapi import HTTPException, Request, WebSocket, status

  TOKEN = os.getenv("ELIA_AUTH_TOKEN", "").strip()
  EXEMPT_PATHS = {"/health"}
  WS_POLICY_VIOLATION = 1008

  def _enabled() -> bool:
      return bool(TOKEN)

  def _supplied_token(*candidates: str | None) -> str | None:
      supplied: str | None = None
      for value in candidates:
          if not value:
              continue
          if value.lower().startswith("bearer "):
              value = value[7:].strip()
          supplied = value.strip() or supplied
          if supplied:
              break
      return supplied

  async def require_token(request: Request) -> None:
      """HTTP dependency — raises 401 when the token check fails."""
      if not _enabled() or request.url.path in EXEMPT_PATHS:
          return
      supplied = _supplied_token(
          request.headers.get("authorization"),
          request.headers.get("x-elia-token"),
      )
      if supplied != TOKEN:
          raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                              detail="Invalid or missing token")

  async def ws_require_token(websocket: WebSocket) -> bool:
      """WS handshake : ?token= OU headers d'upgrade. Close 1008 si KO."""
      if not _enabled():
          return True
      supplied = _supplied_token(
          websocket.query_params.get("token"),
          websocket.headers.get("authorization"),
          websocket.headers.get("x-elia-token"),
      )
      if supplied == TOKEN:
          return True
      await websocket.close(code=WS_POLICY_VIOLATION)
      return False
  ```
- `app/main.py` : `dependencies=[Depends(require_token)]` sur chaque router HTTP
  (`include_router(...)`), **PAS en global** — une dépendance globale s'applique
  aussi aux routes WebSocket et fait planter le handshake (500).
- `app/routes/websocket.py` : au handshake, `if not await ws_require_token(ws): return`.
- **Endpoints exemptés** : `/health` (healthcheck docker) — tout le reste est protégé, y compris `/tunnel/*`.
- Réponse 401 standard : `{"detail": "Invalid or missing token"}`.
- WS accepte `?token=` (React Native ne peut pas mettre de headers) ET les headers
  `Authorization`/`X-Elia-Token` sur la requête d'upgrade (clients natifs Swift).
- ⚠️ Ne PAS utiliser `APIKeyHeader`/`Security()` ici : sa résolution de dépendance
  crashe en scope WebSocket (`TypeError: missing 1 required positional argument`).

### 2.4 Vérifier

```bash
curl -s http://localhost:5656/status                      # → 401 si activé
curl -s http://localhost:5656/status -H "Authorization: Bearer $ELIA_AUTH_TOKEN"   # → 200
curl -s http://localhost:5656/status -H "X-Elia-Token: $ELIA_AUTH_TOKEN"           # → 200
```

---

## 3. Côté APP ANDROID (ce repo, `mobile/`)

1. Ouvrir **Settings → Server → Auth token**.
2. Coller le token → Save. L'app le stocke dans AsyncStorage (local au téléphone).
3. Toutes les requêtes HTTP partent désormais avec `Authorization: Bearer` + `X-Elia-Token`, et le WS avec `?token=`.
4. Champ vide = aucun header envoyé (serveur sans auth → marche pareil).

> Le token n'est JAMAIS loggé ni envoyé ailleurs qu'au serveur configuré.

---

## 4. Côté ELIATOPBAR macOS (repo `Elia-Topbar`, pour plus tard)

Le Swift n'a pas de .env à l'exécution — deux options simples :

**Option A (recommandée) — UserDefaults via Menu :**
- Ajouter un menu "Set Auth Token…" qui stocke dans `UserDefaults.standard` (clé `eliaAuthToken`).
- `SubworkerManager` : lire le token, l'attacher aux requêtes :
  ```swift
  request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
  request.setValue(token, forHTTPHeaderField: "X-Elia-Token")
  ```
  et pour le WS : `wsURL + "?token=\(token)"` (URLQueryItem).

**Option B — fichier .env lu au lancement :**
- `~/.elia/topbar.env` contenant `ELIA_AUTH_TOKEN=...`, lu au démarrage de l'app.

---

## 5. Rotation / révoquer

1. Générer un nouveau token (`openssl rand -hex 32`).
2. Update `.env` serveur → `docker compose restart`.
3. Update le token dans l'app Android + TopBar.
4. L'ancien token est mort immédiatement (valeur unique en mémoire côté serveur).

---

## 6. Limites (assumées — outil personnel/LAN)

- Token unique partagé = pas de révocation par device, pas d'audit par user.
- Sur HTTP LAN le token circule en clair → dès que le tunnel Cloudflare est actif (voir `CLOUDFLARE_SETUP.md`), le trafic est chiffré TLS bout-à-bout jusqu'à l'edge CF.
- Pour du multi-user réel plus tard : Cloudflare Access (free) devant le hostname = Zéro Trust sans changer ce code.
