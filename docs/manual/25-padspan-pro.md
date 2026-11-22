# 25. PadSpan Pro: trial, keys, homes, testers, invites

[Contents](README.md)

PadSpan HA is free, and the presence tracking stays free: rooms, floor plans, calibration, the
history, the Home Assistant sensors and the alerts. **PadSpan Pro** is an optional key that unlocks
the paid parts on the same install, with nothing to reinstall:

- exact placement on the Atlas: shapes, sizes, angles, WLED's Advanced controls, Automorph and
  Showcase ([chapter 15](15-the-atlas.md));
- Live Aboard, the 3D house, with Furnish ([chapter 16](16-live-aboard.md),
  [chapter 17](17-furnish.md));
- wall mode ([chapter 18](18-wall-screens-and-kiosks.md));
- Whole House Presets and Vacation Mode;
- Forensics, Busy Times and Locate ([chapter 12](12-the-screens.md));
- the AI features ([chapter 19](19-ai-features.md));
- anything gated later.

A PadSpan Pro key also unlocks PadSpan Bright's tools. Prices and where to buy a key:
[padspan.traks.ca](https://padspan.traks.ca).

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

## Get Pro free by testing it

**Become a tester** (on the licence card, or under **Settings → Tracking → Help improve PadSpan**)
gives you two years of PadSpan Pro free, for people happy to be contacted about trying new things
before they ship. The usage report stays on for those two years: it can't be turned off while the
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
