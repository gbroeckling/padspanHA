# The maker lookup asks only about devices heard right now

### Fixed
- **0.38.208 could still send the first three bytes of a random address for rows no longer heard live.** The Objects list also shows devices from its history (kept for days, tagged ones for good, and across restarts), and PadSpan forgets what the radios said about an address when it stops hearing it for a while, or restarts. For those rows only the address's own bits were left to decide. This version sends nothing for them: only devices heard in the last 5 minutes are asked about. Any other row shows the answer already kept for its first three bytes, if there is one, or "not heard recently".
