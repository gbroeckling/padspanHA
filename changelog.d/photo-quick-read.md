# Quicker photo reads

### Changed
- **Photo reads are quicker.** A furniture photo with no kind picked now gets a quick look first (only "what is it?"), then that kind's own questions. When the quick look isn't sure (no answer, "other", or words that name no kind), or that kind's answer can't be used, the full read runs as before. In testing with a local vision model, a furniture photo took about 21-24 s instead of 32-35 s, and the quick look named the same kind as the full read on all 9 test photos.
- **A photo read has one time limit as a whole: 8 minutes,** the most two reads could take before. Each read still gets at most 4 minutes. A later read gets only the time that's left, and with too little left the answer so far stands. A normal read takes well under a minute.
- **Photos are sent at 1024 px instead of 1280.** The AI reads them faster, and nothing it is asked (what it is, colours, rough sizes, a figure for a person) needs the finer detail.

### Opt-in report
- `photo_quick:ok` and `photo_quick:fallback`: whether the quick look was enough or the full read had to run, once per furniture photo with no kind picked. Neither is counted when the read fails. Never the photo or the answer.
