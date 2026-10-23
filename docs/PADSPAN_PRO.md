# PadSpan Pro: trial, keys, testers and invites

PadSpan HA is free, and the presence tracking stays free. **PadSpan Pro** unlocks the paid parts on
the same install: placing lights and devices exactly on the Atlas (shapes, sizes, WLED, Automorph,
Showcase), the 3D house (Live Aboard), Forensics, Busy Times and Locate. See
[Editions](../README.md#editions) for exactly what each tier unlocks.

Everything below is in **Settings → Features → PadSpan licence** unless it says otherwise. Starting
a trial, entering a key and signing up as a tester all need a Home Assistant administrator.

## Try it free for 90 days

The **Start 90-day free trial** button (on the licence card, and on the trial card PadSpan shows
on Overview once it's working in your house) gives you the full Pro product for 90 days. No card,
one trial per home, and your email is only used to send your key. Nothing you made is taken away
when it ends: you go back to free and your placements stay.

## Enter a key

Bought a key, or got one by email? Press **Enter licence key** and paste it
(`PSPAN-XXXX-XXXX-XXXX-XXXX`). You'll see **Licence activated**. **Replace licence key** swaps it;
**Show licence key** shows it (administrators only). A PadSpan Pro key also unlocks
[PadSpan Bright](https://github.com/gbroeckling/padspanBright)'s tools.

Keys and pricing: [padspan.traks.ca](https://padspan.traks.ca). PadSpan Pro is $45 CAD a year.
**PadSpan Pro for life** is $89 CAD, once, at the launch price until November 30, 2026, and
$168 CAD from December 1, 2026.

## One key, five homes

One key covers up to five Home Assistants (a cabin, a parent's house, a test install):

- **Homes 1 and 2** always count.
- **With more than two homes**, every home on the key must keep its opt-in usage report on
  (**Settings → Presence → Help improve PadSpan**), the first two included. A third home can join
  only when every home, the new one too, has the report on.
- If one of them turns the report off, the key drops back to its first two homes after 14 days:
  the first two keep Pro, and the others pick up again at their next check once the report is back
  on. The 14 days add up: turning the report back on briefly doesn't start them again, and they
  start again only after every home has had the report on for 30 days. The licence card says which
  home has it off and by when, and turning the report off on such a key asks first.
- A home on PadSpan before 0.38.160 can't send the report, so it counts as off until it's updated;
  the licence card names it as needing an update.
- A home that hasn't checked in for 45 days frees its place.
- A new or reinstalled Home Assistant can take the place of a home not seen for 14 days.

**Show this key's homes** on the licence card lists them, lets you name this one and remove one you
no longer use. If a home isn't counted, the licence card says why.

## Get Pro free by testing it

**Become a tester** (on the licence card, or under **Settings → Presence → Help improve PadSpan**)
gives you two years of PadSpan Pro free, for as long as the anonymous usage report stays on. You're
asked for an email and can add what you'd like to test. Before anything is sent you can see exactly
what goes, and **Stop being a tester** withdraws your sign-up at any time. The README's
[Become a tester](../README.md#become-a-tester-separate-from-the-usage-report) section explains
exactly what is sent and kept.

## Invites

Now and then, an install that sends the usage report gets an invite to **a free year of PadSpan
Pro**. It shows on Overview and on the licence card, to administrators only:

- **Claim my free year:** enter an email and your key arrives there. No card, nothing renews.
- **Later:** asks again in a week.
- **No thanks:** final; it won't come back.

Nothing is sent unless you press one of those buttons.

## Kiosk screens

A screen opened in kiosk mode (`?kiosk=1`, see the [Wall Screen Guide](WALL_SCREEN_GUIDE.md))
never shows trial or invite offers.
