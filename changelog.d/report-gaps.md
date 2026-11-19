# The usage report: its one question reaches every opt-in, and three things it could not say

### New
- **The usage report says which store keeps PadSpan up to date, and whether your automations use it.** Two new lines in the opt-in report: `store`, one word for Home Assistant's Marketplace, HACS, or neither when PadSpan was copied in by hand; and `used_in`, how many automations and how many scripts use one of PadSpan's entities or devices. Two counts, never which ones. The Preview shows both, and the README's list of what the report sends has them.
- **Deleting PadSpan with the report on sends one last report that says so.** It carries the anonymous ID, the day, the version and that one flag, and nothing about the house, so a removed install can be told from a machine that is switched off. With the report off, nothing is sent.

### Changed
- **The optional question, where you heard about PadSpan, now reaches every way of opting in.** It was asked only after a yes on the opt-in card. It is now asked once per install whichever way the report comes on (the card, Settings, the tick box on the free trial) and when a free trial, a tester sign-up or a free year starts: a card on the Overview with one-tap answers and Skip. An answer or Skip ends it for good, it is never shown on a wall screen, and a house whose report was already on is still not asked: the choice stays under Settings → Tracking → Help improve PadSpan.
