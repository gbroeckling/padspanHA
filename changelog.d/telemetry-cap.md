# The usage report fits a big house again

### Fixed
- **A big house's usage report goes again.** The opt-in report had a hard cap of 8 KB, and a house that uses a lot of PadSpan outgrew it: first screen and tool counts were dropped to make it fit, then the whole report was refused, every day. The cap is now 32 KB, in PadSpan and on the server that receives it. Most reports are about 7 KB.
