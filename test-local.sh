#!/usr/bin/env bash
# Local testing script for the faucet API
# Usage: ./test-local.sh [destination_address]

API_BASE="http://localhost:3066/api"
CCX_ADDRESS="${1:-ccx7Zbm7PjafXKvb3naqpGXzhLtAXesKiR5UXUbfwD9MCf77XdvXf1TX64KdDjcTDb3E7dS6MGE2GKT3w4DuCb8H9dwvWWGuof}"
SCORE=1500  # Score is just for validation (MIN_SCORE check). Amount sent is FAUCET_AMOUNT from .env

echo "======================================"
echo "   CCX Faucet API - Local Test"
echo "======================================"
echo

echo "== 1) Health check =="
HEALTH=$(curl -s "$API_BASE/health")
echo "$HEALTH"
echo

if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo "✓ Health check passed"
else
  echo "✗ Health check failed - is the API running?"
  exit 1
fi

echo
echo "== 2) Start game (session token set as HttpOnly cookie) =="
# Save cookies to a temp file
COOKIE_FILE=$(mktemp)
START_RESPONSE=$(curl -si -c "$COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  "$API_BASE/start-game?address=$CCX_ADDRESS")
echo "$START_RESPONSE" | grep -E "^HTTP|^Set-Cookie|^\{"
echo

if ! grep -q "faucet-token" "$COOKIE_FILE"; then
  echo "✗ Failed to get cookie from start-game response."
  rm -f "$COOKIE_FILE"
  exit 1
fi

# Extract CSRF token from JSON response body
CSRF_TOKEN=$(echo "$START_RESPONSE" | grep -o '"csrfToken":"[^"]*' | cut -d'"' -f4)

if [ -z "$CSRF_TOKEN" ]; then
  echo "✗ Failed to extract CSRF token from start-game response."
  rm -f "$COOKIE_FILE"
  exit 1
fi

echo "✓ Got session cookie (HttpOnly cookie saved to file)"
echo "  Cookie file: $COOKIE_FILE"
echo "  Cookie will be sent automatically with -b flag"
echo "✓ Got CSRF token: ${CSRF_TOKEN:0:16}... (truncated for display)"
echo

echo "== 3) Waiting 6 seconds (MIN_SESSION_TIME_MS) =="
for i in {6..1}; do
  echo -n "$i... "
  sleep 1
done
echo
echo

echo "== 4) Claim reward (cookie and CSRF token sent) =="
CLAIM_RESPONSE=$(curl -s -X POST "$API_BASE/claim" \
  -b "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -H "X-FAUCET-CSRF: $CSRF_TOKEN" \
  -H "Origin: http://localhost:3000" \
  -d "{
    \"address\": \"$CCX_ADDRESS\",
    \"score\": $SCORE
  }")
rm -f "$COOKIE_FILE"
echo "$CLAIM_RESPONSE"
echo

if echo "$CLAIM_RESPONSE" | grep -q '"success":true'; then
  echo "✓ Claim successful!"
else
  echo "✗ Claim failed"
fi
echo

