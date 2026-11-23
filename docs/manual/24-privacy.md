# 24. Privacy: what leaves the house

[Contents](README.md)

PadSpan works inside your Home Assistant. Where your phones, tags and people are, your rooms, your
floor plans, your devices' names and their Bluetooth addresses stay there. This chapter lists every
time something leaves, what it carries, and how to stop it. The full field-by-field list is in the
README's [Updates & Privacy](../../README.md#updates--privacy).

## At a glance

| What | Goes to | When | Carries | Off |
|---|---|---|---|---|
| **Update check** | `padspan.traks.ca` | Once a day | Your PadSpan version only | **Settings → Tracking → Privacy, updates and feedback → Update Check → Disabled** |
| **Licence check** | `traks.ca` | Once a day, only with a licence key entered | The key, Home Assistant's instance ID, this home's token, the version, the home's name, whether the usage report is on | Remove the key |
| **Usage report** | `padspan.traks.ca` | At most once a day, only if you opt in | Counts, versions and flags | Off unless you turn it on |
| **Tester sign-up** | `padspan.traks.ca` | Only when you press **Send sign-up** | What you type, and the setup lines you leave ticked | Never sent unless you sign up |
| **An invite you claim** | `traks.ca` | Only when you press **Claim** or **No thanks** | The invite's token, and for Claim the email you type | Do nothing |
| **Shared furniture library** | `padspan.traks.ca` | Only while it is on, when someone uses it | Searches, a piece's ID, a shared piece's recipe | Off by default |
| **AI reads** | The AI behind your own AI Task | Only when someone starts one | One picture and PadSpan's instructions | No AI Task picked (the default) |
| **Alerts** | Your own notify services (phone app, email) | When an alert fires | The alert's words | Don't set up alerts |

Like any web request, each server sees your IP address.

## The update check

Once a day PadSpan asks `padspan.traks.ca` whether there is a newer version, and shows a Home
Assistant notification when there is ([chapter 3](03-install-update-uninstall.md)). The request
carries only your installed version number. No identifier is stored on your system, and the check
alone counts requests, not installs. The answer can also switch PadSpan's free-Pro offers (becoming
a tester, invites) off or on, so an offer that ended disappears without an update; it carries only
those two switches and can add nothing to the panel.

## The licence check

Only with a licence key (a trial or a purchase): once a day, whether or not the update check is on,
PadSpan checks the key with `traks.ca`, so a refunded or revoked key stops working. It sends, in the
body of the request, the key, Home Assistant's instance ID (the server keeps only a one-way hash of
it), this home's current token (a random code the server gave it), the PadSpan version, the name you
gave this home (if any), and whether this home's usage report is on. With no key, there is no
licence check. Keys and homes: [chapter 25](25-padspan-pro.md).

## The usage report (opt-in)

**Settings → Tracking → Help improve PadSpan**, off by default. The panel asks once, with the Preview
beside the question; either answer ends the asking. Turning it on or off needs an administrator.

When it is on, PadSpan sends at most once a day a small report (a hard cap of 8 KB) of **counts,
versions and flags**: how many receivers, floors, rooms and placed devices; which feature switches are
on; how many times each screen and tool was used; how hard the machine works; the class of machine
(memory band, processor kind, board family); errors by PadSpan file name. It carries a random install
ID so installs are counted, not requests.

**Never**: Bluetooth addresses, phone keys or licence keys, any device, room, floor or entity name or
ID, IP addresses, coordinates, or times finer than the day. Before every send, PadSpan checks every
value and refuses the whole report if one looks like an address, a key, an email or an entity ID, or
any text is over 64 characters.

- **Preview what would be sent** shows the report exactly as it stands, before or after opting in.
- **New anonymous ID** replaces the install ID at any time.
- **If you delete PadSpan** while the report is on, it sends one last report saying so (the ID, the
  day, the version), with nothing about the house.
- One optional question, where you heard about PadSpan, is asked once, with **Skip**.

The free trial needs the report on until the trial ends, and a licence used on more than two homes
needs it on in each of them ([chapter 25](25-padspan-pro.md)).

## Becoming a tester

While the report is on, its card offers **Become a tester**: PadSpan Pro free for two years for
people happy to be contacted about trying new things. It is the one place PadSpan asks for contact
details, so it is kept apart from the anonymous report in every way: its own consent box, its own
**Send sign-up** button, its own address and its own random ID. What goes is what you type (an email
address, and optionally a GitHub username, a name, notes, a time zone) plus the
**About your setup** lines you leave ticked. **Preview what will be sent** shows it first. Your
anonymous reports are tied to it only if you tick **Link my anonymous usage reports**.
**Stop being a tester** deletes your sign-up from the server. Signing up needs an administrator.

## Invites

Now and then the developer invites some installs that send the report to try something, such as a
free year of Pro. The invite arrives in the reply to that install's report and shows as a card.
Nothing is sent unless you press a button: **Claim** sends the token and the email you type, so the
key can be emailed to you; **No thanks** sends the token alone.

## The shared furniture library

Live Aboard (Pro) can swap furniture with other PadSpan homes. It is off by default and only an
administrator can turn it on (**Settings → Atlas → Live Aboard → Shared library**). While it is on,
Home Assistant sends a request only when someone uses it: a search (the words and filters), a look at
one piece (its library ID), a report (the piece and a reason), a share (the piece's shape, sizes,
colours and details sheet), or withdrawing a share. Never a photo, a floor plan, where a piece
stands, its name in your house or the usage report's ID. Text that looks like an email, an address,
a phone number or a key is refused before anything is sent.

## AI reads

PadSpan has no AI of its own. A few Pro features can ask the AI Task you picked in **Settings → AI**
to read one picture: a photo of a piece of furniture, or a floor plan. None is picked by default. A
local AI keeps the picture in your home; a cloud AI sends it to that company. PadSpan adds no names,
addresses or positions, but a plan goes as it is, with whatever is printed on it. Everything about
it: [chapter 19](19-ai-features.md).

## What never leaves

- **Phone keys (IRKs)**: in your Home Assistant only.
- **Positions, rooms, history, floor plans**: in your Home Assistant only.
- **Device makers**: PadSpan names a device's maker from what the device broadcasts and from lists
  built into PadSpan. Nothing is sent anywhere for it.
- **Guests' names**: not in the usage report or in a PadSpan backup.
- **People's figures** in Live Aboard: only in this house's 3D file, never shared.
- **Diagnostics and Export for support**: made on your machine, and go only where you send them
  ([chapter 27](27-getting-help.md)).

## Where PadSpan keeps your data

In your Home Assistant's `.storage` folder (`padspan_ha.*` files) and in `<config>/padspan_ha/` (the
floor plan pictures, kept out of the folder Home Assistant serves without a login). Moving it and
removing it: [chapter 22](22-backup-restore-moving.md) and
[chapter 3](03-install-update-uninstall.md).
