# How PadSpan is built and checked


I built PadSpan with the assistance of AI coding tools, mostly Claude, and I've said so in the README from the start. Someone on Reddit called PadSpan "AI-coded and paid". I get why, but it leaves out the part that matters to you: who's in charge of it, and how changes get checked before they land in your Home Assistant.

**Who does what.** PadSpan is my design. I decide what it does and how it works, I test it in my own house, and I sign off on every release. The AI assistants help me write code, write tests and review changes, the way a good team would. Nothing ships because a tool said it was done. Before a batch of fixes goes out, it gets a separate regression review looking for what the fix might have broken somewhere else.

**Tests.** There are over 5,500 automated tests right now, in a little over 300 test files. They cover the positioning maths, the panel's drawing code, the WebSocket commands and the things that are easy to get wrong quietly: names from devices and rooms are always shown as text and never run as markup, PadSpan is tested not to change other integrations' devices or entities on its own, and the usage report never contains a MAC, a key or a name. The release script runs the whole suite and won't publish if a single test fails. GitHub also runs the tests and a lint pass on every push, plus Home Assistant's own hassfest and HACS checks every push and every night.

**Screens that shouldn't change don't.** When a change isn't meant to alter what you see, it's checked that the screen draws exactly the same as before, down to the pixel. New features start switched off, and there are tests that the screen with a feature off is identical to the screen without it.

**Beta and stable.** This is the part that looks odd from outside. Betas go out often, sometimes several a day, so testers get a fix the same day it's made. They're GitHub pre-releases, and HACS doesn't offer them unless you ask for betas. Stable is what HACS installs by default, and it has come out roughly once a week lately. Most people should stay on stable. If you see "a release every 14 minutes", those are betas.

**What leaves your house.** By default, one daily version check that sends only your version number, and you can turn it off. There's an opt-in usage report with no names, MAC addresses or keys in it. It's off until an administrator turns it on, and Preview shows exactly what would be sent before you decide. If you enter a licence key, it's checked once a day. If my server can't be reached, nothing changes and your house keeps working. A key that really has lapsed gets a 14-day grace period, and what you already made in Pro stays readable and exportable. With no key entered there's no licence check at all, and the free part never needs one.

**The source is open.** PadSpan is GPL-3.0. All of PadSpan's code is on GitHub to read. If you'd rather not trust me, you can check.

**Found something?** Bugs go in GitHub issues. Security problems go through the private "Report a vulnerability" form described in SECURITY.md, not a public issue. I aim to answer within 7 days and I'll credit you in the changelog if you want.

That's the deal. I use good tools, and I'm the one who answers for what ships.

-- Garry
