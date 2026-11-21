# No leftover setup wording

### Fixed
- **Home Assistant's setup screens no longer carry wording for steps PadSpan doesn't have.** The integration's texts, in every language, still had a "Reconfigure PadSpan HA: Update scan interval" step, an options form and an "Update interval" field, all three gone from the setup long ago (how often PadSpan updates is set in the panel). They are removed, and a test now holds the texts to the steps the setup really shows.
