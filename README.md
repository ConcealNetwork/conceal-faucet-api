# 🛰️ CCX Faucet Backend Architecture

A secure, Dockerized backend designed for CCX (Conceal) rewards — ideal for integrating with small games or exchanges.  
It exposes a REST API that validates gameplay via HttpOnly cookie sessions and enforces strict anti‑abuse rules with Redis.

---

## ⚙️ Overview

| Layer | Component | Purpose |
|--------|------------|----------|
| **API** | Node.js + Express | REST endpoints (`/api/health`, `/api/start-game`, `/api/claim`) |
| **Process Manager** | PM2 (cluster mode) | Keeps Node processes alive and balanced |
| **Rate/Abuse Control** | Redis | Stores IP and address cooldowns |
| **Network** | Nginx (optional) | Handles HTTPS, reverse proxy, and HTTP→HTTPS |
| **Containerization** | Docker Compose | Orchestrates Redis, API, and Nginx containers |

---

## 🔐 How It Works

### Session Token System

1. **Start Game** (`/api/start-game?address=ccxXXX`)
   - Creates a unique session token linked to the CCX address
   - Token stored in Redis: `session:${token}` → `{ address: ccxXXX, createdAt: timestamp }`
   - Token delivered as HttpOnly cookie (secure, not accessible via JavaScript)

2. **Claim Reward** (`/api/claim`)
   - Validates token from HttpOnly cookie
   - Checks token's address matches claim request
   - Verifies minimum session time passed (MIN_SESSION_TIME_MS)
   - Checks IP and address cooldowns
   - Sends CCX transaction if all validations pass

### Anti-Abuse Protection

**IP Cooldown:**
- Tracks when each IP last claimed
- Prevents same IP from claiming multiple times (even with different addresses)

**Address Cooldown:**
- Tracks when each CCX address last claimed
- Prevents same address from claiming multiple times (even from different IPs)

**Session Validation:**
- Token must match the original CCX address
- Prevents token reuse or token stealing
- Enforces minimum play time before claim

---

## 🐳 Deployment 

# 0. Prerequisites

## Walletd (Conceal Wallet Daemon)

You need a running `walletd` instance with a funded wallet. See [WALLETD_SETUP.md](./WALLETD_SETUP.md) for detailed setup instructions including systemd service configuration.

## Docker and Docker Compose

Install Docker and Docker Compose:

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install docker.io docker-compose -y

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker

# Add your user to docker group (optional, to run without sudo)
sudo usermod -aG docker $USER

# Log out and back in for group changes to take effect
exit

# SSH back in and verify installation
docker --version
docker-compose --version
```

For other operating systems, see: https://docs.docker.com/engine/install/

# 1. Clone & install

```bash
git clone https://github.com/yourname/conceal-faucet-api.git
cd conceal-faucet-api

npm ci --only=production
# (same as npm ci --production)
```

# 2. Environment file

``` bash
cp .env.example .env
nano .env
```
Set at least:

```text
FRONTEND_DOMAIN=https://your-frontend.com

DAEMON_HOST=http://ip_address_of_daemon
DAEMON_RPC_PORT=16000

WALLET_HOST=http://host.docker.internal
WALLET_RPC_PORT=3333

REDIS_HOST=redis
REDIS_PORT=6379

PORT=3066
NODE_ENV=production

FAUCET_AMOUNT=1000000
MIN_SCORE=1000
MIN_SESSION_TIME_MS=30000
```


# 3. SSL certificates with certbot (on the VPS host)

### a. Point DNS your-domain.com → your VPS IP.

### b. Install certbot + nginx on host (one-time):

```bash
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx -y
```
### c. Obtain certs (nginx can be a dummy site just for issuance):

```bash
sudo certbot certonly --nginx -d your-domain.com
```

Certs will be at:

  * /etc/letsencrypt/live/your-domain.com/fullchain.pem

  * /etc/letsencrypt/live/your-domain.com/privkey.pem

### d. Copy them into your project:

```bash
mkdir -p ssl
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem ssl/
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem ssl/
sudo chown $(whoami):$(whoami) ssl/fullchain.pem ssl/privkey.pem
```

Now docker-compose.yml + nginx.conf will see them via ./ssl.

# 4. Configure firewall for Docker-to-host communication

**Important**: If your walletd runs on the host (not in Docker), you need to allow Docker containers to access it.

```bash
# Allow Docker network to access walletd port
sudo iptables -I INPUT -s 172.28.0.0/16 -p tcp --dport 3333 -j ACCEPT

# Save the rule permanently
sudo apt install iptables-persistent -y
sudo netfilter-persistent save

# Verify the rule
sudo iptables -L INPUT -n | grep 3333
```

**Why this is needed**: Docker containers run in an isolated network (172.28.0.0/16). This rule allows them to reach walletd running on the host. The fixed subnet ensures the rule survives Docker restarts.

# 5. Docker build & run

From ccx-faucet-api directory:

```bash
docker compose up -d --build
```

This starts:
* redis (internal)
* api (Node + PM2, internal)
* nginx (exposed on ports 80 and 443)

# 6. Check health

```bash
# HTTP (will redirect to HTTPS if nginx config does redirect)
curl http://your-domain.com/api/health

# HTTPS
curl https://your-domain.com/api/health
```
Expected JSON on success:

```json
{
  "status": "ok",
  "available": true
}
```

# 7. Usage examples (frontend / test)
### 7.1 Start session

Request:

```bash
curl -i "https://your-domain.com/api/start-game?address=ccxYourAddressHere"
```

**Response Header:**
```
X-Faucet-Token: f05e3f0a8e1b4c7a...<64-hex-chars>...
```

**Response Body:**
```json
{
  "success": true,
  "message": "Session started"
}
```

**Important**: Extract the token from the **`X-Faucet-Token` response header** and store it in your frontend (e.g. sessionStorage), associated with that CCX address.

### 7.2 Claim reward after win

**IMPORTANT**: The token MUST be sent in the **HTTP header** `X-Faucet-Token`, NOT in the request body!

**Required Headers:**
* `Content-Type: application/json`
* `X-Faucet-Token: <token-from-start-game>` ← **Token goes HERE in header!**

**Request Body (JSON):**
* `address`: CCX address (must match the one from start-game)
* `score`: Game score (must be >= MIN_SCORE from .env)

Example:

```bash
curl -X POST "https://your-domain.com/api/claim" \
  -H "Content-Type: application/json" \
  -H "X-Faucet-Token: f05e3f0a8e1b4c7a..." \
  -d '{
    "address": "ccxYourAddressHere",
    "score": 1500
  }'
```
Possible success response:

```json
{
  "success": true,
  "txHash": "abcdef1234...",
  "amount": 1
}
```
If IP or address is on cooldown:

```json
{
  "error": "IP cooldown active"
}
```
or

```json
{
  "error": "Address cooldown active"
}
```
If token missing/invalid:

```json
{
  "error": "Missing session token"
}
```
or

```json
{
  "error": "Invalid or expired session token"
}
```
