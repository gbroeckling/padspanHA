# Quicker photo reads

### Changed
- **Photo reads are quicker.** A furniture photo with no kind picked now gets a quick look first (only "what is it?"), then that kind's own questions. When the quick look isn't sure (no answer, "other", or words that name no kind), the full read runs as before, so the answer is never weaker, only sometimes slower. On a local vision model through Home Assistant this took a furniture photo from about 32-35 s to about 21-24 s in testing.
- **Photos are sent at 1024 px instead of 1280.** The AI reads them faster, and nothing it is asked (what it is, colours, rough sizes, a figure for a person) needs the finer detail.

### Opt-in report
- `photo_quick:ok` and `photo_quick:fallback`: whether the quick look was enough or the full read had to run, once per furniture photo with no kind picked. Never the photo or the answer.
