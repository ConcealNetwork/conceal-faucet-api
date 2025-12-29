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

### Session Token System (HttpOnly Cookies)

The API uses **HttpOnly cookies** for secure session management. The token is never exposed to JavaScript, preventing XSS attacks.

1. **Start Game** (`/api/start-game?address=ccxXXX`)
   - Creates a unique session token linked to the CCX address and IP
   - Token stored in Redis: `session:${token}` → `{ ip, address, startedAt: timestamp }`
   - Token set as **HttpOnly cookie** (`faucet-token`) - **not accessible via JavaScript**
   - Cookie is automatically sent by the browser on subsequent requests
   - Cookie expires after session TTL (default: 10 minutes, configurable via `SESSION_TTL_MS`) or after successful claim

2. **Claim Reward** (`/api/claim`)
   - Browser automatically sends the HttpOnly cookie (no manual token handling needed)
   - Requires `X-FAUCET-CSRF` header matching the per-session CSRF token from `/start-game` (CSRF protection)
   - Validates Origin header matches one of the allowed `FRONTEND_DOMAIN`(s) (server-side CORS enforcement)
   - Validates token from cookie
   - Checks token's address matches claim request
   - Verifies IP matches the session (prevents cookie theft)
   - Verifies minimum session time passed (MIN_SESSION_TIME_MS)
   - Checks IP and address cooldowns
   - Sends CCX transaction if all validations pass
   - Cookie is cleared after successful claim

### Anti-Abuse Protection

**Rate Limiting (Burst Protection):**
- Limits claim attempts per IP (default: 5 attempts per 10 minutes)
- Uses Redis store (shared across PM2 workers)
- Logs rate limit hits in Fail2Ban-friendly format
- Configurable via `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX`

**IP Cooldown (Long-term):**
- Tracks when each IP last claimed
- Prevents same IP from claiming multiple times (even with different addresses)
- Default: 24 hours (configurable via `COOLDOWN_SECONDS`)

**Address Cooldown (Long-term):**
- Tracks when each CCX address last claimed
- Prevents same address from claiming multiple times (even from different IPs)
- Default: 24 hours (configurable via `COOLDOWN_SECONDS`)

**Session Validation:**
- Token must match the original CCX address
- Prevents token reuse or token stealing
- Enforces minimum play time before claim (configurable via `MIN_SESSION_TIME_MS`)

**Fail2Ban Integration:**
- All abuse events are logged in Fail2Ban-friendly format
- See `fail2ban/` directory for configuration examples

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
git clone https://github.com/concealnetwork/conceal-faucet-api.git
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
# Or multiple domains (comma-separated):
# FRONTEND_DOMAIN=https://frontend1.com,https://frontend2.com,https://frontend3.com

DAEMON_HOST=http://ip_address_of_daemon
DAEMON_RPC_PORT=16000

WALLET_HOST=http://host.docker.internal
WALLET_RPC_PORT=3333

REDIS_HOST=redis
REDIS_PORT=6379

PORT=3066
NODE_ENV=production

FAUCET_ADDRESS=ccx7...
FAUCET_MIN_BALANCE=10000000     # e.g. 10CCX min to be functional 
FAUCET_AMOUNT=1000000
MIN_SCORE=1000
MIN_SESSION_TIME_MS=30000
SESSION_TTL_MS=600000        # 10 minutes (how long session token is valid)

# Rate limiting (optional, defaults shown)
RATE_LIMIT_WINDOW_MS=600000  # 10 minutes
RATE_LIMIT_MAX=5             # 5 claim attempts per IP per window

# Cooldown (optional, defaults shown)
COOLDOWN_SECONDS=86400        # 24 hours
```


# 3. SSL certificates with certbot

### a. Point DNS your-domain.com → your VPS IP.

### b. Install certbot:

```bash
sudo apt update
sudo apt install certbot -y
```

### c. Obtain certificates (make sure port 80 is free):

```bash
sudo certbot certonly --standalone -d your-domain.com
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

From conceal-faucet-api directory:

```bash
docker-compose -p ccx-faucet up -d --build
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
  "available": true,
  "balance": 1234567
}
```

# 7. Usage examples (frontend / test)

## Frontend Integration

**Important**: The API uses **HttpOnly cookies**. You don't need to manually read or send tokens - the browser handles this automatically.

### 7.1 Start session

**Request:**
```javascript
// Frontend (JavaScript/TypeScript)
const response = await fetch(
  `https://your-domain.com/api/start-game?address=${encodeURIComponent(ccxAddress)}`,
  {
    credentials: 'include', // CRITICAL: Required to send/receive cookies
  }
);

const data = await response.json();
// { success: true, message: "Session started", csrfToken: "abc123..." }

// CRITICAL: Store the CSRF token in memory (React state, Vue data, etc.)
// You'll need it for the /claim request
const csrfToken = data.csrfToken;
// Example: setCsrfToken(data.csrfToken) in React

// Cookie is set automatically by browser (HttpOnly, can't be read by JavaScript)
```

**Using curl (for testing):**
```bash
# Save cookie to file
curl -i -c cookies.txt "https://your-domain.com/api/start-game?address=ccxYourAddressHere"
```

**Response:**
- **Set-Cookie header**: `faucet-token=<token>; HttpOnly; Secure; SameSite=None`
- **Response Body:**
```json
{
  "success": true,
  "message": "Session started",
  "csrfToken": "abc123..."  // Per-session CSRF token - store this in memory
}
```

**Note**: 
- The session token is in the HttpOnly cookie and cannot be accessed via JavaScript. This prevents XSS attacks.
- The `csrfToken` must be stored in memory (React state, etc.) and sent in the `X-FAUCET-CSRF` header for `/api/claim` requests.

### 7.2 Claim reward after win

**Frontend (JavaScript/TypeScript):**
```javascript
// 1. Start game and get CSRF token
const startResponse = await fetch(
  `https://your-domain.com/api/start-game?address=${encodeURIComponent(ccxAddress)}`,
  { credentials: 'include' }
);
const startData = await startResponse.json();
// startData.csrfToken - store this in memory (React state, etc.)

// 2. Later, when claiming (after game is won)
const response = await fetch('https://your-domain.com/api/claim', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-FAUCET-CSRF': startData.csrfToken, // Per-session CSRF token from /start-game
    // NO token header needed - cookie is sent automatically!
  },
  credentials: 'include', // CRITICAL: Required to send cookies
  body: JSON.stringify({
    address: ccxAddress, // Must match address from start-game
    score: 1500, // Must be >= MIN_SCORE from .env
  }),
});

const data = await response.json();
```

**Security Note**: The CSRF token is generated per-session and returned from `/start-game`. It's never baked into your frontend bundle, never stored in `.env`, and only exists in memory on the legitimate client plus Redis on the server. This provides strong CSRF protection without exposing secrets.

**Using curl (for testing):**
```bash
# 1. Start game and save cookie + extract CSRF token from response
START_RESPONSE=$(curl -si -c cookies.txt "https://your-domain.com/api/start-game?address=ccxYourAddressHere")
CSRF_TOKEN=$(echo "$START_RESPONSE" | grep -o '"csrfToken":"[^"]*' | cut -d'"' -f4)

# 2. Claim (use CSRF token from start-game response)
curl -X POST "https://your-domain.com/api/claim" \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -H "X-FAUCET-CSRF: $CSRF_TOKEN" \
  -H "Origin: https://your-frontend-domain.com" \
  -d '{
    "address": "ccxYourAddressHere",
    "score": 1500
  }'
```

**Request Requirements:**
- Cookie must be sent (automatically handled by browser with `credentials: 'include'`)
- Request body must include:
  - `address`: CCX address (must match the one from start-game)
  - `score`: Game score (must be >= MIN_SCORE from .env)
Possible success response:

```json
{
  "success": true,
  "txHash": "abcdef1234...",
  "amount": 1
}
```
If rate limit or cooldown is active:

```json
{
  "error": "Request not available at this time"
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
