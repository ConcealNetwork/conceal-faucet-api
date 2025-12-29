const crypto = require("crypto");
const { createClient } = require("redis");
const { logSecurityEvent } = require("../utils/logger");

const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
  },
});

// Initialize Redis connection (called from server.js)
async function initRedis() {
  redisClient.on("error", (err) => console.error("Redis error:", err));
  await redisClient.connect();
}

async function deleteSessionsForAddress(address) {
  // Use indexed approach: O(1) lookup instead of O(n) scan
  const addressKey = `session:addr:${address}`;
  const oldToken = await redisClient.get(addressKey);
  
  if (oldToken) {
    // Delete both the session data and the address index
    await Promise.all([
      redisClient.del(`session:${oldToken}`),
      redisClient.del(addressKey),
    ]);
  }
}

const getClientIP = require("../utils/getClientIP");

async function createSession(ip, address, origin) {
  // Delete any existing sessions for this address to prevent multiple active sessions
  await deleteSessionsForAddress(address);

  const token = crypto.randomBytes(32).toString("hex"); // Session ID
  const csrfToken = crypto.randomBytes(32).toString("hex"); // Per-session CSRF token
  const key = `session:${token}`;
  const addressKey = `session:addr:${address}`;

  const data = JSON.stringify({
    ip,
    address,
    origin, // Store origin to bind session to the frontend that created it
    startedAt: Date.now(),
    csrfToken, // Per-session CSRF token
  });

  // Session TTL (how long the session token is valid)
  const sessionTtlMs = parseInt(process.env.SESSION_TTL_MS || "600000", 10); // 10 minutes default
  const ttlSeconds = Math.floor(sessionTtlMs / 1000); // Convert ms to seconds for Redis
  
  // Store session data and maintain address index (both with same TTL)
  await Promise.all([
    redisClient.setEx(key, ttlSeconds, data),
    redisClient.setEx(addressKey, ttlSeconds, token),
  ]);

  return { token, csrfToken };
}

async function verifySessionToken(req, res, next) {
  try {
    const token = req.cookies["faucet-token"];
    if (!token) {
      return res.status(401).json({ error: "Missing session token" });
    }

    const key = `session:${token}`;
    const raw = await redisClient.get(key);

    if (!raw) {
      return res.status(403).json({ error: "Invalid or expired session token" });
    }

    let session;
    try {
      session = JSON.parse(raw);
    } catch (e) {
      return res.status(500).json({ error: "Invalid session data" });
    }

    // CSRF token validation (per-session CSRF protection)
    // Only enforce in production (allows testing without CSRF token)
    if (process.env.NODE_ENV === "production") {
      const csrfHeader = req.get("x-faucet-csrf") || req.get("X-FAUCET-CSRF");
      if (!csrfHeader || !session.csrfToken || csrfHeader !== session.csrfToken) {
        const ip = getClientIP(req);
        logSecurityEvent("ABUSE", {
          IP: ip,
          PATH: req.originalUrl,
          REASON: "CSRF",
        });
        return res.status(403).json({ error: "Invalid request" });
      }
    }

    const minGameTimeMs = parseInt(process.env.MIN_SESSION_TIME_MS || "5000", 10);
    const elapsed = Date.now() - session.startedAt;
    if (elapsed < minGameTimeMs) {
      return res.status(400).json({ error: "Session completed too quickly" });
    }

    // Get real client IP (handles proxy headers from nginx)
    const clientIP = getClientIP(req);
    
    if (session.ip !== clientIP) {
      return res.status(403).json({ error: "IP mismatch" });
    }

    // Validate origin matches the session's origin (prevents cross-frontend session reuse)
    // In production, origin is always required and must match
    // In development, if session has origin, validate it matches (allows testing without origin)
    const requestOrigin = req.headers.origin || req.headers.Origin;
    if (process.env.NODE_ENV === "production") {
      // In production, session must have origin and it must match request
      if (!session.origin || !requestOrigin || requestOrigin !== session.origin) {
        const ip = getClientIP(req);
        logSecurityEvent("ABUSE", {
          IP: ip,
          PATH: req.originalUrl,
          REASON: "Origin Mismatch",
          SESSION_ORIGIN: session.origin || "missing",
          REQUEST_ORIGIN: requestOrigin || "missing",
        });
        return res.status(403).json({ error: "Invalid request" });
      }
    } else {
      // In development, if session has origin, validate it matches (but allow if session has no origin)
      if (session.origin && requestOrigin && requestOrigin !== session.origin) {
        const ip = getClientIP(req);
        logSecurityEvent("ABUSE", {
          IP: ip,
          PATH: req.originalUrl,
          REASON: "Origin Mismatch",
          SESSION_ORIGIN: session.origin,
          REQUEST_ORIGIN: requestOrigin,
        });
        return res.status(403).json({ error: "Invalid request" });
      }
    }

    req.sessionToken = token;
    req.sessionData = session;
    next();
  } catch (error) {
    // Handle Redis connection errors or any other backend failures
    console.error("Session verification error:", error.message || error);
    return res.status(503).json({ error: "Service temporarily unavailable" });
  }
}

async function deleteSession(token) {
  const key = `session:${token}`;
  const raw = await redisClient.get(key);
  
  if (raw) {
    try {
      const session = JSON.parse(raw);
      const addressKey = `session:addr:${session.address}`;
      // Delete both session data and address index
      await Promise.all([
        redisClient.del(key),
        redisClient.del(addressKey),
      ]);
    } catch (e) {
      // If parsing fails, just delete the session key
      await redisClient.del(key);
    }
  }
}

module.exports = {
  redisClient,
  initRedis,
  createSession,
  verifySessionToken,
  deleteSession,
};
