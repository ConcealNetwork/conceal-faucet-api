/**
 * Environment variable validation at startup
 * Fails fast if critical configuration is missing or invalid
 * Only runs in production mode (NODE_ENV=production)
 */

function assertEnv() {
  // Skip validation in non-production environments
  if (process.env.NODE_ENV !== "production") {
    console.log("⚠ Skipping configuration validation (NODE_ENV is not 'production')");
    return;
  }

  const errors = [];

  // FAUCET_ADDRESS: Must start with "ccx7" and be 98 characters long
  const faucetAddress = process.env.FAUCET_ADDRESS;
  if (!faucetAddress) {
    errors.push("FAUCET_ADDRESS is required");
  } else {
    if (!faucetAddress.startsWith("ccx7")) {
      errors.push(`FAUCET_ADDRESS must start with "ccx7" (got: ${faucetAddress.substring(0, 10)}...)`);
    }
    if (faucetAddress.length !== 98) {
      errors.push(`FAUCET_ADDRESS must be 98 characters long (got: ${faucetAddress.length})`);
    }
  }

  // FAUCET_AMOUNT: Must be a positive integer
  const faucetAmount = process.env.FAUCET_AMOUNT;
  if (!faucetAmount) {
    errors.push("FAUCET_AMOUNT is required");
  } else {
    const amount = parseInt(faucetAmount, 10);
    if (isNaN(amount) || amount <= 0) {
      errors.push(`FAUCET_AMOUNT must be a positive integer (got: ${faucetAmount})`);
    }
  }

  // DAEMON_HOST: Required
  if (!process.env.DAEMON_HOST) {
    errors.push("DAEMON_HOST is required");
  }

  // WALLET_HOST: Required
  if (!process.env.WALLET_HOST) {
    errors.push("WALLET_HOST is required");
  }

  // DAEMON_RPC_PORT: Required (even if default exists, we want explicit config in production)
  if (!process.env.DAEMON_RPC_PORT) {
    errors.push("DAEMON_RPC_PORT is required");
  } else {
    const port = parseInt(process.env.DAEMON_RPC_PORT, 10);
    if (isNaN(port) || port <= 0 || port > 65535) {
      errors.push(`DAEMON_RPC_PORT must be a valid port number (1-65535, got: ${process.env.DAEMON_RPC_PORT})`);
    }
  }

  // WALLET_RPC_PORT: Required
  if (!process.env.WALLET_RPC_PORT) {
    errors.push("WALLET_RPC_PORT is required");
  } else {
    const port = parseInt(process.env.WALLET_RPC_PORT, 10);
    if (isNaN(port) || port <= 0 || port > 65535) {
      errors.push(`WALLET_RPC_PORT must be a valid port number (1-65535, got: ${process.env.WALLET_RPC_PORT})`);
    }
  }

  // FRONTEND_DOMAIN: Required, must be valid HTTPS URL(s)
  // Supports comma-separated list: https://frontend1.com,https://frontend2.com
  if (!process.env.FRONTEND_DOMAIN) {
    errors.push("FRONTEND_DOMAIN is required");
  } else {
    const domains = process.env.FRONTEND_DOMAIN.split(",").map((d) => d.trim()).filter((d) => d.length > 0);
    if (domains.length === 0) {
      errors.push("FRONTEND_DOMAIN must contain at least one valid domain");
    }
    domains.forEach((domain, index) => {
      if (!domain.startsWith("https://")) {
        errors.push(`FRONTEND_DOMAIN[${index}] must start with "https://" (got: ${domain})`);
      }
      try {
        new URL(domain);
      } catch (e) {
        errors.push(`FRONTEND_DOMAIN[${index}] must be a valid URL (got: ${domain})`);
      }
    });
  }

  // If any errors, throw with clear message
  if (errors.length > 0) {
    const errorMsg = `Configuration validation failed:\n${errors.map((e, i) => `  ${i + 1}. ${e}`).join("\n")}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  console.log("✓ Configuration validation passed");
}

module.exports = { assertEnv };

