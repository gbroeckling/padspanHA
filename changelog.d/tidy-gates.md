# Housekeeping: more checks before a release

### Changed
- **More mistakes are caught before a release reaches you.** Every release now checks the Python for names that are used but never defined (the kind of slip that made "Suggest a fit" always say there was no fit in 0.38.256), and checks the panel's code against 42 more rules for plain mistakes. Three small slips these turned up are fixed; none of them changed what you see.
- **Each of the panel's files loads once, and fresh after an update.** A few helper files were loaded without the stamp that tells your browser a new version is out, and with the PadSpan page and the Atlas page open in the same browser many files were downloaded and run twice. Every file now has one address.
- **The download zip is no longer stored in the repository.** Each release still builds it and attaches it to the GitHub release, which is where HACS gets it.
