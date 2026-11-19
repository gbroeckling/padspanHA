# iPhone and Apple Watch keys from irk-capture, step by step

### New
- **"I have an IRK Capture ESP32" is now five steps.** In Bluetooth → IRK Manager → Track your phone (with the Phone Setup Wizard or iPhone Setup Path on):
  1. Type the device's name and pick whose it is.
  2. Pick iPhone or Apple Watch and pair it: an iPhone in Settings → Bluetooth, a watch in its own Settings → Bluetooth under Health Devices.
  3. Press Find the key, then Save. If the key can't be found, paste it from the ESP32's IRK sensor.
  4. Remove the pairing again.
  5. Before the next device, press the ESP32's Refresh BLE Identity in Home Assistant, so the device you just paired doesn't connect to it again.
- **The key is saved under the name you typed**, and the device gets that name in PadSpan straight away, with its Home Assistant entities. With a person picked, it counts as that person's in the people count and in Live Aboard's People & devices.
- **Android phones are told this isn't their way in**: they don't keep sending this key in the background. They use the Companion app's BLE Transmitter.

### Fixed
- **"Scan for IRK Capture devices" never read the ESP32.** It only looked at keys already paired with your Home Assistant computer, so a key from irk-capture had to be pasted by hand. PadSpan now reads the key the ESP32 shows in Home Assistant. It only reads: it never presses the ESP32's buttons or changes its settings.
- **Keys are no longer saved as "Auto-detected" or under the ESP32's name.** In the IRK Manager, Auto-detect IRKs puts a key from irk-capture in the Add an IRK box for you to name.
- **The IRK Capture tool card** on the ESPHome Configs tab no longer says it works for Android phones.
