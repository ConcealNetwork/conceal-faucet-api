const crypto = require("crypto");
const { createClient } = require("redis");

const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
  },
});

redisClient.on("error", (err) => console.error("Redis error:", err));
redisClient.connect();

async function deleteSessionsForAddress(address) {
  // Find all session keys and delete ones matching this address
  // Note: This is a simple approach. For production with many sessions,
  // consider using a separate index (e.g., `session:addr:${address}` -> token)
  const keys = await redisClient.keys("session:*");
  for (const key of keys) {
    const raw = await redisClient.get(key);
    if (raw) {
      try {
        const session = JSON.parse(raw);
        if (session.address === address) {
          await redisClient.del(key);
        }
      } catch (e) {
        // Invalid session data, skip
      }
    }
  }
}

async function createSession(ip, address) {
  // Delete any existing sessions for this address to prevent multiple active sessions
  await deleteSessionsForAddress(address);

  const token = crypto.randomBytes(32).toString("hex");
  const key = `session:${token}`;

  const data = JSON.stringify({
    ip,
    address,
    startedAt: Date.now(),
  });

  const ttlSeconds = 10 * 60; // 10 minutes
  await redisClient.setEx(key, ttlSeconds, data);

  return token;
}

async function verifySessionToken(req, res, next) {
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

  const minGameTimeMs = parseInt(process.env.MIN_SESSION_TIME_MS || "5000", 10);
  const elapsed = Date.now() - session.startedAt;
  if (elapsed < minGameTimeMs) {
    return res.status(400).json({ error: "Session completed too quickly" });
  }

  if (session.ip !== req.ip) {
    return res.status(403).json({ error: "IP mismatch" });
  }

  req.sessionToken = token;
  req.sessionData = session;
  next();
}

async function deleteSession(token) {
  const key = `session:${token}`;
  await redisClient.del(key);
}

module.exports = {
  redisClient,
  createSession,
  verifySessionToken,
  deleteSession,
};
