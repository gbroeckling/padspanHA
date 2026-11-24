# Installation / Update (IMPORTANT)

The Home Assistant Marketplace or HACS is the easy way: see the [README](./README.md#installation).
This page is for installing or updating by hand.

## Option A — the release zip (`padspan_ha.zip`)
1. Download `padspan_ha.zip` from the [latest release](https://github.com/gbroeckling/padspanHA/releases/latest)
2. In your Home Assistant `/config` folder, make the folder `custom_components/padspan_ha`
3. Unzip `padspan_ha.zip` **into that folder** (NOT into `/config`)
   - The zip's files have no folder of their own: when you are done, `manifest.json` is at
     `/config/custom_components/padspan_ha/manifest.json`
4. Restart Home Assistant
5. Hard-refresh the browser (Ctrl+Shift+R)

## Option B — Manual copy from the repository
Copy this folder:
`custom_components/padspan_ha`
to:
`/config/custom_components/padspan_ha`

### Common mistakes
Do **NOT** end up with:
`/config/custom_components/custom_components/padspan_ha`
If you see that, move `padspan_ha` up one level.

Do **NOT** unzip `padspan_ha.zip` straight into `/config` or `/config/custom_components`: its files
would land loose in that folder. Move them into `/config/custom_components/padspan_ha`.
