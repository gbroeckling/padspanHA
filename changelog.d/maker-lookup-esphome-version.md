# The maker lookup trusts ESPHome only from 2022.12; Factory Reset erases what it learned

### Fixed
- **0.38.211 could send the first three bytes of random addresses heard by an ESPHome proxy older than 2022.12**, never a whole address. Those proxies send no address type, and the missing value reads as "fixed", so every address they heard was taken as confirmed. PadSpan now trusts an ESPHome proxy only when its firmware is 2022.12 or newer, and drops the list 0.38.211 kept. The rule: It sends only the first three bytes of an address, and only after a Bluetooth receiver has confirmed that the device has a fixed, maker-assigned address (ESPHome proxies on version 2022.12 or newer and Home Assistant's own Bluetooth say so, and PadSpan remembers it; Shelly, ESPresense and Tasmota don't, so a device only they have heard isn't looked up).
- **Factory Reset now erases what the maker lookup learned:** the addresses confirmed as fixed and the makers kept for 30 days. They outlived a reset, though the help says it erases all of PadSpan's data.
- When a receiver reports a confirmed address as random, that is saved at once, so a power cut can't bring the old confirmation back.
