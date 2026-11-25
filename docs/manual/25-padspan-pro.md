# 25. PadSpan Pro: trial, keys, homes, testers, invites

[Contents](README.md)

PadSpan HA is free, and the presence tracking stays free: rooms, floor plans, calibration, the
history, the Home Assistant sensors and the alerts. So are power teams
([chapter 15](15-the-atlas.md)). **PadSpan Pro** is an optional key that unlocks
the paid parts on the same install, with nothing to reinstall:

- exact placement on the Atlas: shapes, sizes, angles, WLED's Advanced controls, Automorph and
  Showcase ([chapter 15](15-the-atlas.md));
- Live Aboard, the 3D house, with Furnish ([chapter 16](16-live-aboard.md),
  [chapter 17](17-furnish.md));
- wall mode ([chapter 18](18-wall-screens-and-kiosks.md));
- Whole house presets and Vacation Mode;
- Forensics, Busy Times and Locate ([chapter 12](12-the-screens.md));
- the AI features ([chapter 19](19-ai-features.md));
- anything gated later.

A PadSpan Pro key also unlocks PadSpan Bright's tools. Prices and where to buy a key:
[padspan.traks.ca](https://padspan.traks.ca). Without Pro, an add-on unlocks one feature
([Add-ons](#add-ons)).

Everything below is in **Settings → Features → PadSpan licence** unless it says otherwise. Starting
a trial, entering a key and signing up as a tester need a Home Assistant administrator.

## Try it free for 90 days

**Start 90-day free trial** (on the licence card, and on the trial card the Overview shows once
PadSpan is working in your house) gives you all of Pro for 90 days. No card, one trial per home, and
your email is used only to send your key.

The trial needs the **usage report** on (**Settings → Tracking → Help improve PadSpan**: anonymous
counts of what is used and what breaks, [chapter 24](24-privacy.md)). With it off, the trial card
asks you to turn it on in the same step. **The usage report stays on for the whole trial**, and can't
be turned off until the trial ends or you enter a bought key.

When the trial ends, nothing you set up is deleted. It all comes back as you left it when you buy.

## Enter a key

Choose **Enter licence key** and paste it (`PSPAN-XXXX-XXXX-XXXX-XXXX`). The card says
**Licence activated**. **Replace licence key** swaps it; **Show licence key** shows it
(administrators only). Once a day PadSpan checks the key, so a refunded or revoked key stops
working; what that check sends is in [chapter 24](24-privacy.md#the-licence-check).

## One key, five homes

One key covers up to five Home Assistants (a cabin, a parent's house, a test install):

- **Homes 1 and 2** always count.
- **With more than two homes**, every home on the key must keep its usage report on, the first two
  included. A third home can join only when every home, the new one too, has the report on.
- If one of them turns the report off, the key drops back to its first two homes after 14 days. The
  first two keep Pro; the others pick up again at their next check once the report is back on. The
  14 days add up: turning the report back on briefly doesn't restart them, and they start again only
  after every home has had the report on for 30 days. The licence card says which home has it off and
  by when, and turning the report off on such a key asks first.
- A home on PadSpan before 0.38.160 can't send the report, so it counts as off until it is updated;
  the licence card names it.
- A home that hasn't checked in for 45 days frees its place, and a new or reinstalled Home Assistant
  can take the place of a home not seen for 14 days.

**Show this key's homes** lists them, lets you name this one and remove one you no longer use. If a
home isn't counted, the licence card says why.

## Add-ons

Without Pro, one feature at a time: each add-on is one payment that covers 2 years, no subscription,
on up to three homes. **PadSpan Pro includes them all.** Prices, and where to buy one:
[padspan.traks.ca/#addons](https://padspan.traks.ca/#addons).

| Add-on | What it unlocks |
| --- | --- |
| Audio | Volume, mute and off for each room's players: the **⋯** list's Audio line on the new layout, **Settings → Atlas → Audio** on the classic one ([chapter 15](15-the-atlas.md#audio)) |
| Alarm & security | Arm and Disarm in the emergency button, the emergency lights test, a door's card with its opener and lock, **Devices → Door Openers**, and openers and locks built from relays |
| Wi-Fi coverage | The Wi-Fi coverage tab |
| Climate map | The ♨ Heatmap on the Atlas |
| Time travel | Full house activity: the day replayed on the Atlas (Traceback → Playback) |
| Vacation Mode & presets | Vacation Mode and the Whole house presets |
| Looks pack | The Graphite, Ocean, Dusk and Day themes; on the Atlas, Showcase with its themes, the West Coast Forest and the presets bar |
| Forensics | Forensics recording |
| Presence insights | Busy Times and Locate |

Free on every install, with or without them: an alarm going off (in the emergency button, with
nothing to press, and in the red banner), locking and unlocking on the map and in a room's card,
Alert pulse, the Insights tab and a device's 📍 Locate flash.

- Your add-ons share one key: buy another with the same email and it joins that key. Enter it here
  like any key; the licence card lists each add-on with its date. An add-on key is not a Pro key.
- Each add-on gets the same 14 days past its date that a key does.
- The 90-day trial is still yours: it keeps the add-on key aside and puts it back when it ends.
- Where a feature is locked, it says what unlocks it: "PadSpan Pro or the … add-on", with the price.

## Control4 OS 2 Local

A specialty add-on of its own, for homes with a Control4 controller on OS 2. Control4 ended its
cloud services for OS 2 on November 1, 2026, and Home Assistant's built-in Control4 integration
logs in through that cloud, so it stopped working with OS 2 controllers. **Control4 OS 2 Local** is
a separate Home Assistant integration that takes the built-in one's place: it logs in to the
controller itself with the controller's system password, no Control4 account or cloud, and makes
each room a media player with volume, mute and off. It is one payment, good for life, and
**PadSpan Pro includes it**. Its own page:
[github.com/gbroeckling/control4-os2-local](https://github.com/gbroeckling/control4-os2-local).

### Install it from PadSpan

1. Open **Settings → Tracking → Home Assistant and integrations → Control4 OS 2 Local**. It is
   there for an administrator once Home Assistant has Control4 (an entry, or a controller it
   found) or the key holds the add-on. The Overview offers it too when a Control4 entry failed to
   set up or the controller runs OS 2.
2. Press **Install Control4 OS 2 Local** and confirm. PadSpan downloads the newest release from the
   product's GitHub page (that one file, nothing else), checks that it is Control4 OS 2 Local,
   moves any `custom_components/control4` that is already there into
   `padspan_ha/control4_backups/` in your configuration folder, and puts the new one in its place.
3. Press **Restart Home Assistant** and confirm. PadSpan never restarts Home Assistant by itself.
4. Open **Settings → Devices & services → Control4 → Configure**, enter the controller's system
   password and your key (a Control4 OS 2 Local key, or your PadSpan Pro key), and press
   **Submit**. Adding Control4 for the first time: **Add integration → Control4 OS 2 Local**, with
   the controller's IP address, its system password and the key.

**Check for an update** on the same card asks GitHub for the newest release; **Update to …** installs
it, the version before going into the backups.

### Undo

**Undo** on the card puts back the folder that was there before (after an update, the version
before), or, when there was none, removes Control4 OS 2 Local so that Home Assistant's built-in
Control4 integration comes back. Restart Home Assistant afterwards. Undo works without a key, and it
never touches a `custom_components/control4` that isn't Control4 OS 2 Local. Your Control4 entry
and its entities stay; on an OS 2 controller the built-in integration can't connect.

You can also install it with HACS instead: add the product's GitHub page as a custom repository of
the type Integration.

Control4 is a trademark of Snap One, LLC. Control4 OS 2 Local is not affiliated with or endorsed by
Snap One or Control4.

## Get Pro free by testing it

**Become a tester** (on the licence card, or under **Settings → Tracking → Help improve PadSpan**)
gives you two years of PadSpan Pro free (one year if you join from December 16, 2026), for people happy to be contacted about trying new things
before they ship. The usage report stays on for that time: it can't be turned off while the
key runs. You give an email and can say what you'd like to test; you see exactly what goes before
anything is sent, and **Stop being a tester** withdraws your sign-up at any time. What is sent and
kept: [chapter 24](24-privacy.md#becoming-a-tester).

## Invites

Now and then, an install that sends the usage report is invited to **a free year of PadSpan Pro**. It
shows on the Overview and on the licence card, to administrators only. The report stays on for the
free year.

- **Claim my free year**: type an email and the key arrives there. No card, nothing renews.
- **Later**: asks again in a week.
- **No thanks**: final; it won't come back.

Nothing is sent unless you press one of those.

## Wall screens

A screen opened with `?kiosk=1` never shows trial or invite offers
([chapter 18](18-wall-screens-and-kiosks.md)).
