# Radio Reset clears a receiver's signal readings

### Fixed
- **Resetting a receiver no longer leaves its signal readings behind.** Radio Reset forgot what the receiver had heard but kept its recent signal readings of each device, and a device only that receiver had heard kept them for as long as Home Assistant ran. They now go with the rest.
