# A status dot in the top bar

### New
- **A status dot in the top bar says when something is wrong.** When all is well there is nothing there. A red dot with a round "!" means something is broken: PadSpan isn't answering, positioning's last update failed, or no Bluetooth receiver is reporting. An amber dot with a triangle means something needs attention: a receiver not heard from in over 10 minutes, one hearing far fewer devices than usual, a receiver on a floor plan that no live receiver matches, or learning suspended. The number beside it is how many issues there are, and hovering (or a screen reader) says what they are in plain words. Click it to open Health.
- **It doesn't blink or nag.** A problem has to be there on two polls in a row before the dot shows, and gone for two before it goes. No pop-ups, no sounds, and nothing in sample mode.
- **On a wall screen, red only.** With `?kiosk=1` the top bars are hidden, so a red problem shows in the top-right corner instead; amber stays off the wall. Setup tips and scanner reliability scores aren't counted: they are advice, and stay on the Overview and in Health.

### Opt-in report
- **Whether the dot gets looked at:** a count of clicks from the status dot through to Health (`status_dot_open`). Never what the dot said.
