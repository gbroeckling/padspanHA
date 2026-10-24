# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest stable release (marked Latest on GitHub) | Yes |
| Latest beta (the newest pre-release) | Yes |
| Older releases | No — please update to the latest release first |

Fixes go into the next release. HACS shows it as an update.

## Reporting a Vulnerability

If you find a security issue in PadSpan HA, **please do not open a public GitHub issue.**

Instead, report it privately:

1. Go to the [Security Advisories](https://github.com/gbroeckling/padspanHA/security/advisories) page
2. Click **"Report a vulnerability"**
3. Describe the issue, the PadSpan and Home Assistant versions, and how to reproduce it

If you'd rather use email, write to hello@traks.ca with the same details.

You should receive a response within 7 days. If the issue is confirmed, a fix will be released as soon as practical and you will be credited in the changelog (unless you prefer to remain anonymous).

## What Counts as a Security Issue

- Script or markup injection in the frontend panel (for example through a device, scanner or room name)
- Path traversal in file operations (map uploads, imports, etc.)
- A WebSocket command doing something its caller's Home Assistant account should not be able to do
- Exposure of sensitive data (licence keys, credentials, private BLE IRKs)

## What Doesn't Count

- Issues that require physical access to the Home Assistant instance
- Denial of service against a local-only integration
- Bugs that don't have a security impact

## Security Measures Already in Place

- Names and other text from devices, scanners, rooms, users and the backend are escaped before they go into the panel's HTML and SVG (`tests/test_hostile_names.py` renders a name that is markup and checks it shows as text)
- Destructive and data-leaving WebSocket commands (backup and restore, factory reset, IRKs, map uploads, the usage report, the 3D library's switches) require a Home Assistant administrator
- **Enhanced security** (Settings → Presence, off by default, only an administrator can turn it on or off): while it is on, changes to the home's shared PadSpan setup need an administrator too. Household members can still view and use PadSpan, change the theme and the choices kept in their own browser, and assign a Bluetooth radio to a room (Overview → Bluetooth radios → Assign stays open to everyone by design). Further protections will be added to the same switch.
- Follow alerts and Follow's Test button only send to notification targets (a notify service or entity, or another integration's `send_message`), and the Test button sends as the person who pressed it
- Map uploads and imports are size-limited, files are looked up by ID, and the floor-plan importer refuses unsafe XML
- BLE IRK data stays local — never sent to external services
- The licence key never goes to the browser with the settings
