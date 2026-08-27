# CLOUDFLARE SETUP — exposer Elia Subworkers via votre domaine

> Objectif : accéder au serveur subworkers **partout** (4G, autre Wi-Fi) via
> `https://elia.example.com` — 100% gratuit (Cloudflare Tunnel, pas de VPS, pas de ports ouverts).

Ta situation :
- Domaine `example.com` chez votre registrar
- DNS délégué à **Cloudflare** (le domaine est géré sur https://dash.cloudflare.com)

Il reste **3 étapes** : créer le tunnel, router le sous-domaine, lancer cloudflared.

---

## Étape 0 — Prérequis (5 min)

1. Le serveur subworkers tourne : `curl http://localhost:5656/server/health` → 200.
2. Docker tourne (Colima ou Docker Desktop).
3. **Créer un API Token Cloudflare** (une seule fois) :
   - Va sur https://dash.cloudflare.com/profile/api-tokens → **Create Token**
   - Template **"Edit zone DNS"**, puis AJOUTE une 2e permission :
     - `Zone → DNS → Edit`
     - `Account → Cloudflare Tunnel → Edit`
   - Zone Resources : `Include → Specific zone → example.com`
   - Create → **copie le token** (il ne se réaffiche plus).

---

## Étape 1 — Depuis l'app Android (recommandé)

1. App → **Settings → Remote access → Set up domain**
2. Domaine : `elia.example.com` (remplacez par votre sous-domaine)
3. Coller l'API Token → **Start setup**
4. Le serveur enchaîne tout seul :
   - ✅ Vérifie le token + la zone example.com
   - ✅ Crée le tunnel (named tunnel dans ton account CF)
   - ✅ Crée l'enregistrement DNS `elia → <tunnel-id>.cfargotunnel.com` (proxied)
   - ✅ Configure l'ingress `elia.example.com → http://<service>:5656`
   - ✅ Écrit `docker-compose.override.tunnel.yml` + démarre le conteneur `cloudflared`
   - ✅ Vérifie `https://elia.example.com/server/health` → 200
5. Bouton **"Use https://elia.example.com everywhere"** → l'app est connectée partout.

---

## Étape 1 bis — Manuel (si tu veux comprendre / le faire à la main)

### A. Créer le tunnel

```bash
CF_TOKEN="ton-api-token"
ACCOUNT="YOUR_ACCOUNT_ID"

# 1. Tunnel ID
curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/cfd_tunnel" \
  -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"elia-subworkers","config_src":"cloudflare"}' | python3 -m json.tool
# → récupère "id" (= TUNNEL_ID) dans result

# 2. Le token du tunnel (pour le conteneur cloudflared)
curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/cfd_tunnel/$TUNNEL_ID/token" \
  -H "Authorization: Bearer $CF_TOKEN" | python3 -c "import json,sys; print(json.load(sys.stdin)['result'])"
# → TUNNEL_TOKEN (long string base64)
```

### B. Router elia.example.com vers le tunnel

```bash
ZONE=$(curl -s "https://api.cloudflare.com/client/v4/zones?name=example.com" \
  -H "Authorization: Bearer $CF_TOKEN" | python3 -c "import json,sys; print(json.load(sys.stdin)['result'][0]['id'])")

curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records" \
  -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
  -d "{\"type\":\"CNAME\",\"name\":\"elia\",\"content\":\"$TUNNEL_ID.cfargotunnel.com\",\"proxied\":true}" | python3 -m json.tool
```

### C. Configurer l'ingress (hostname → service docker)

```bash
curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/cfd_tunnel/$TUNNEL_ID/configurations" \
  -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
  -d '{"config":{"ingress":[
        {"hostname":"elia.example.com","service":"http://subworkers-server:5656"},
        {"service":"http_status:404"}]}}' | python3 -m json.tool
```

> ⚠️ `subworkers-server` = le **nom du service** dans
> `/Users/vakandi/EliaAI/subworkers/server/docker-compose.yml` (vérifie le nom exact ;
> si le service s'appelle autrement, adapte — le conteneur cloudflared doit être sur le
> **même réseau docker** pour joindre `http://<service>:5656`).

### D. Lancer cloudflared (conteneur, même compose)

Créer `/Users/vakandi/EliaAI/subworkers/server/docker-compose.override.tunnel.yml` :

```yaml
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${TUNNEL_TOKEN}
    environment:
      - TUNNEL_TOKEN=${TUNNEL_TOKEN}
```

Puis :

```bash
cd /Users/vakandi/EliaAI/subworkers/server
echo "TUNNEL_TOKEN=<le-token-de-l'étape-A2>" >> .env
docker compose -f docker-compose.yml -f docker-compose.override.tunnel.yml up -d cloudflared
```

### E. Vérifier

```bash
curl -s https://elia.example.com/server/health        # → {"state": ...} ✅
# WS marche aussi automatiquement :
#   wss://elia.example.com/ws?token=<ELIA_AUTH_TOKEN>
```

**Sur ton téléphone en 4G (Wi-Fi coupé)** : Settings → Server URL = `https://elia.example.com`
→ Connected ✅ — c'est le test final.

---

## Dépannage

| Symptôme | Cause probable | Fix |
|---|---|---|
| 530 / 1033 Cloudflare | cloudflared pas connecté | `docker logs cloudflared` — vérifie TUNNEL_TOKEN |
| 404 du tunnel | ingress mal configuré | Re-joue l'étape C (service name exact) |
| DNS ne résout pas | record pas proxied ou propagation | Vérifie CNAME `elia` proxifié (nuage orange) dans le dashboard CF |
| 401 sur l'app | auth serveur activée | Mets le même token dans l'app (voir `AUTHENTIFICATION.md`) |
| Tunnel "down" dans CF | Mac éteint / docker stoppé | Normal — le tunnel revient au redémarrage (`restart: unless-stopped`) |

## Sécurité recommandée (après que ça marche)

1. **Active l'auth token** (`AUTHENTIFICATION.md`) — sinon n'importe qui peut trigger tes agents.
2. Optionnel (encore plus dur) : Cloudflare Access sur `elia.example.com` (Zero Trust → Access →
   Applications → Self-hosted, policy email OTP) — gratuit, et l'app devra alors utiliser un
   **Service Token** CF (header `CF-Access-Client-Id/Secret`) — évolution v2.
