const express = require("express");
const CCX = require("conceal-api");
const { createSession, verifySessionToken, deleteSession } = require("../middleware/sessionToken");
const { checkCooldown, setCooldownOnSuccess } = require("../middleware/antiAbuse");
const { claimLimiter } = require("../middleware/rateLimit");
const { requireTrustedOrigin } = require("../middleware/originValidation");
const getClientIP = require("../utils/getClientIP");
const { logSecurityEvent } = require("../utils/logger");

const router = express.Router();

// Session TTL (how long the session token is valid)
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || "600000", 10); // 10 minutes default

const ccx = new CCX({
  daemonHost: process.env.DAEMON_HOST || "http://host.docker.internal",
  walletHost: process.env.WALLET_HOST || "http://host.docker.internal",
  daemonRpcPort: parseInt(process.env.DAEMON_RPC_PORT || "16000", 10),
  walletRpcPort: parseInt(process.env.WALLET_RPC_PORT || "3333", 10),
  walletRpcUser: process.env.WALLET_RPC_USER,
  walletRpcPass: process.env.WALLET_RPC_PASSWORD,
  timeout: parseInt(process.env.RPC_TIMEOUT || "5000", 10),
});

// GET /api/health
router.get("/health", async (req, res) => {
  try {
    const address = process.env.FAUCET_ADDRESS;
    if (!address) {
      throw new Error("FAUCET_ADDRESS not configured");
    }
    const balance = await ccx.getBalance(address);
    const needed = parseInt(process.env.FAUCET_AMOUNT || "100000", 10);
    const minBalance = parseInt(process.env.FAUCET_MIN_BALANCE || "0", 10);
    
    // Check if balance is below minimum required
    if (balance.availableBalance < minBalance) {
      return res.status(503).json({
        status: "error",
        error: "Not enough funds in Faucet",
      });
    }
    
    res.json({
      status: "ok",
      available: balance.availableBalance >= needed,
      balance: balance.availableBalance,
    });
  } catch (e) {
    console.error("Health error:", e.message || e);
    res.status(500).json({ status: "error", error: e.message || "Wallet unavailable" });
  }
});

// GET /api/start-game?address=ccx...
// Origin validation in production to bind session to frontend domain
router.get("/start-game", requireTrustedOrigin, async (req, res) => {
  const address = req.query.address;

  // Validate CCX address format: must start with "ccx7" and be 98 characters
  if (!address) {
    return res.status(400).json({ error: "Invalid CCX address" });
  }
  
  if (!address.startsWith("ccx7")) {
    return res.status(400).json({ error: "Invalid CCX address" });
  }
  
  if (address.length !== 98) {
    return res.status(400).json({ error: "Invalid CCX address" });
  }

  try {
    // Get real client IP (handles proxy headers from nginx)
    const clientIP = getClientIP(req);
    // Get origin to bind session to the frontend that created it
    const origin = req.headers.origin || req.headers.Origin || null;
    const { token, csrfToken } = await createSession(clientIP, address, origin);

    // Set HttpOnly cookie for security (cross-domain)
    res.cookie("faucet-token", token, {
      httpOnly: true, // JavaScript cannot access
      secure: true, // Only sent over HTTPS
      sameSite: "none", // Required for cross-domain
      path: "/api", // Only send cookie to /api/* routes
      maxAge: SESSION_TTL_MS, // Uses SESSION_TTL_MS from env
    });

    res.json({
      success: true,
      message: "Session started",
      csrfToken, // Frontend must store and send this in X-FAUCET-CSRF header
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create session" });
  }
});

// POST /api/claim  (cookie: faucet-token; header: X-FAUCET-CSRF; body: { address, score })
// Origin validation first (server-side enforcement, works even for tools that ignore CORS)
// Rate limiter second (before session validation) to catch brute force attempts
// Session verification includes per-session CSRF token validation
router.post("/claim", requireTrustedOrigin, claimLimiter, verifySessionToken, checkCooldown, setCooldownOnSuccess, async (req, res) => {
  const { address, score } = req.body;
  const { address: sessionAddr } = req.sessionData;
  const token = req.sessionToken;

  // Address format was already validated at /start-game and stored in session
  // We only need to verify it matches the session address
  if (!address || address !== sessionAddr) {
    const ip = getClientIP(req);
    // Log to file (Fail2Ban-friendly format, no console output)
    logSecurityEvent("ABUSE", {
      IP: ip,
      ADDR: address,
      REASON: "Validation",
    });
    return res.status(400).json({ error: "Invalid request" });
  }

  const minScore = parseInt(process.env.MIN_SCORE || "1000", 10);
  if (!score || score < minScore) {
    const ip = getClientIP(req);
    // Log to file (Fail2Ban-friendly format, no console output)
    logSecurityEvent("ABUSE", {
      IP: ip,
      ADDR: address,
      REASON: "Validation",
    });
    return res.status(400).json({ error: "Invalid request" });
  }

  const amount = parseInt(process.env.FAUCET_AMOUNT || "1123456", 10);
  const sourceAddress = process.env.FAUCET_ADDRESS;
  const minBalance = parseInt(process.env.FAUCET_MIN_BALANCE || "0", 10);

  try {
    // Check if faucet has enough balance before processing
    const balance = await ccx.getBalance(sourceAddress);
    if (balance.availableBalance < minBalance) {
      return res.status(503).json({
        error: "Not enough funds in Faucet",
      });
    }

    const opts = {
      transfers: [{ address, amount }],
      addresses: [sourceAddress],
      changeAddress: sourceAddress,
      anonymity: 5,
      fee: 10,
    };

    const result = await ccx.sendTransaction(opts);

    await deleteSession(token);

    // Clear the cookie after successful claim
    res.clearCookie("faucet-token", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/api", // Must match the path used when setting the cookie
    });

    res.json({
      success: true,
      txHash: result.transactionHash,
      amount: amount / 1000000,
    });
  } catch (e) {
    console.error("Payment error:", e.message || e);
    res.status(500).json({ error: e.message || "Payment failed" });
  }
});

module.exports = router;
