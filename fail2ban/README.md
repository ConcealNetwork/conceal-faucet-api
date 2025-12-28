# Fail2Ban Configuration for CCX Faucet API

This directory contains Fail2Ban configuration files to automatically ban IPs that abuse the faucet API.

## Setup Instructions

### 1. Install Fail2Ban

```bash
sudo apt update
sudo apt install fail2ban -y
```

### 2. Copy Configuration Files

```bash
# Copy filter
sudo cp fail2ban/filter.d/ccx-faucet.conf /etc/fail2ban/filter.d/

# Copy jail
sudo cp fail2ban/jail.d/ccx-faucet.conf /etc/fail2ban/jail.d/
```

### 3. Configure Log Path

The `docker-compose.yml` already mounts `faucet.log` as a volume, so the log file is accessible from the host.

**Important**: Ensure `faucet.log` exists as a **file** (not a directory) before starting Docker. If Docker creates it as a directory, fix it with:
```bash
sudo rm -rf faucet.log
touch faucet.log
```

Update `/etc/fail2ban/jail.d/ccx-faucet.conf` with the path to your project directory:

```ini
logpath = /path/to/conceal-faucet-api/faucet.log
```

### 4. Test the Filter

```bash
# Create a test log entry
echo "2025-12-28T12:34:56.789Z RATE_LIMIT IP=1.2.3.4 PATH=/api/claim" >> /path/to/conceal-faucet-api/faucet.log

# Test the filter (replace with your actual log path)
sudo fail2ban-regex /path/to/conceal-faucet-api/faucet.log /etc/fail2ban/filter.d/ccx-faucet.conf
```

### 5. Restart Fail2Ban

```bash
sudo systemctl restart fail2ban
sudo systemctl status fail2ban
```

### 6. Monitor Fail2Ban

```bash
# Check jail status
sudo fail2ban-client status ccx-faucet

# View banned IPs
sudo fail2ban-client status ccx-faucet

# Manually ban an IP (for testing)
sudo fail2ban-client set ccx-faucet banip 1.2.3.4

# Unban an IP
sudo fail2ban-client set ccx-faucet unbanip 1.2.3.4
```

## Log Format

The API logs abuse events to `faucet.log` in Fail2Ban-friendly format:

- `TIMESTAMP RATE_LIMIT IP=<ip> PATH=<path> ...` - Rate limit exceeded
- `TIMESTAMP ABUSE IP=<ip> ADDR=<address> REASON=<reason> ...` - Cooldown or validation failure

Example log entries:
```
2025-12-28T12:34:56.789Z RATE_LIMIT IP=93.114.61.46 PATH=/api/claim
2025-12-28T12:35:10.123Z ABUSE IP=93.114.61.46 ADDR=ccx7... REASON=Cooldown
```

## Configuration

Adjust these values in `/etc/fail2ban/jail.d/ccx-faucet.conf`:

- `maxretry`: Number of violations before ban (default: 3)
- `findtime`: Time window to count violations (default: 600 seconds = 10 minutes)
- `bantime`: Duration of ban (default: 3600 seconds = 1 hour)

## Notes

- The log file is mounted as a Docker volume, so it's directly accessible from the host
- The filter extracts IP addresses from log messages
- Bans are applied at the firewall level (iptables)
- Banned IPs cannot access any service on the server (not just the API)
- Logs are written directly to `faucet.log` (not via console, to avoid exposing information)

