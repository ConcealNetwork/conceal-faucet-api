/**
 * Origin header validation middleware
 * Complements CORS by enforcing allowed origin server-side
 * Works even for tools that ignore CORS (curl, Postman, etc.)
 */

const getClientIP = require("../utils/getClientIP");
const { logSecurityEvent } = require("../utils/logger");

// Parse FRONTEND_DOMAIN as comma-separated list
function getAllowedOrigins() {
  const frontendDomain = process.env.FRONTEND_DOMAIN;
  if (!frontendDomain) {
    return [];
  }
  return frontendDomain
    .split(",")
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0);
}

const allowedOrigins = getAllowedOrigins();

function requireTrustedOrigin(req, res, next) {
  // In production, enforce origin on all routes (including GET /start-game)
  // In development, only enforce on state-changing routes (POST, PUT, DELETE, PATCH)
  const isProduction = process.env.NODE_ENV === "production";
  const isStateChanging = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  
  if (!isProduction && !isStateChanging) {
    return next();
  }

  if (allowedOrigins.length === 0) {
    return res.status(500).json({ error: "Service temporarily unavailable" });
  }

  const origin = req.headers.origin || req.headers.Origin;

  // Require Origin header (in production for all routes, in development only for state-changing)
  if (!origin) {
    const ip = getClientIP(req);
    logSecurityEvent("ABUSE", {
      IP: ip,
      PATH: req.originalUrl,
      REASON: "Missing Origin",
    });
    return res.status(400).json({ error: "Invalid request" });
  }

  // Validate origin matches one of the allowed frontend domains
  if (!allowedOrigins.includes(origin)) {
    const ip = getClientIP(req);
    logSecurityEvent("ABUSE", {
      IP: ip,
      ORIGIN: origin,
      PATH: req.originalUrl,
      REASON: "Bad Origin",
    });
    return res.status(403).json({ error: "Invalid request" });
  }

  next();
}

module.exports = { requireTrustedOrigin };

