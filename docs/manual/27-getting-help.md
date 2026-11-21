# 27. Getting help

[Contents](README.md)

Before asking, [chapter 26](26-troubleshooting.md) has the common problems by symptom. When you do
ask, a report from PadSpan saves a round of questions. There are three, and they hold different
things.

## The three reports

| Report | Where | Holds |
|---|---|---|
| **Diagnostics** (PadSpan's) | QA → **Go to Diagnostics** (QA is under More tools) | Versions, the panel's timings, PadSpan's status, your floor plans' names, and **your own devices**: the ones you named, linked to Home Assistant, or phones known by their key, heard in the last 24 hours. **Download Report** saves it as a file; **Copy** copies it. |
| **Export for support** | Monitor → **Export for support** (Monitor is under More tools) | The same, plus the live view as PadSpan sees it now: devices and advertisements, cut to 200 of each (all of your own devices are kept), and the receivers. **Build export**, then **Copy**. |
| **Download diagnostics** (Home Assistant's) | Settings → Devices & services → PadSpan HA → ⋮ → **Download diagnostics** | Little: PadSpan's version, its config entry, its status and the saved room list (`room_tag_map`). Not your devices, rooms or receivers. |

For most problems, PadSpan's **Diagnostics** is the one to send. For a device in the wrong room or not
showing at all, **Export for support** shows what the receivers hear.

### What they leave out, and what they don't

- **Phones' identity keys (IRKs) are never in them.** Each one is replaced by `irk:hidden-1`,
  `irk:hidden-2` and so on, the same number for the same phone throughout, so the report still makes
  sense.
- **They do name your rooms, floor plans and devices, with their Bluetooth addresses.** That is what
  makes them useful, and it is why you should look a report over before you send it anywhere public.
- **Errors PadSpan handled quietly** (on the Diagnostics screen, for administrators) are not in the
  report: an error's text can name your rooms and devices. If support asks for them, copy the lines
  you are happy to share.
- **Nothing is sent by any of them.** They only make text for you to copy or save.

### Logs

PadSpan's own log is in **Manage → Logs**. For Home Assistant's log with more detail from PadSpan,
turn on **Enable debug logging** on PadSpan HA's page in Settings → Devices & services, reproduce the
problem, then turn it off: Home Assistant offers the log as a file when you do.

## Where to ask

- **A bug**: open an issue at
  [github.com/gbroeckling/padspanHA/issues](https://github.com/gbroeckling/padspanHA/issues) and
  choose **Bug Report**. Issues are public, so remove what you'd rather not show (names, addresses)
  from anything you attach.
- **By email**: hello@traks.ca. An email is not public, so a report can go as it is.
- **A security problem**: not in a public issue. See [SECURITY.md](../../SECURITY.md).
- **An idea**: the **Feature request** form in the same issues list.

## What to include

1. **PadSpan's version and Home Assistant's.** PadSpan's is under its name at the top of the panel's
   menu, and in every report. Home Assistant's is in Settings → About.
2. **How PadSpan was installed**: the Marketplace, HACS or by hand.
3. **Your receivers**: what kind (ESPHome Bluetooth proxy, Shelly, Home Assistant's own Bluetooth,
   ESPresense, Tasmota) and how many.
4. **What happened, and what you expected.** For a room problem: which device, which room it showed,
   and which room it was really in, with the time.
5. **The steps** that make it happen again, if you know them.
6. **A report** (above), and a screenshot of the screen in question.
7. **Anything that changed** just before: an update, a new receiver, a moved receiver, new
   calibration.

A wrong-room report is most useful taken while it is wrong: build **Export for support** then, before
the device moves on.
