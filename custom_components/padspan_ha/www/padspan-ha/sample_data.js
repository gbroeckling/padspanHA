// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * PadSpan HA — Sample / Demo Data
 *
 * When the panel is in "Sample" mode this snapshot is used instead of calling
 * the backend. It represents a fully-configured demo house ("The Smith Residence")
 * so new users can see exactly what the system looks like when everything is set up.
 *
 * To see real data from your Home Assistant installation, switch to Live mode.
 */

export const SAMPLE_SNAPSHOT = {
  source: "sample",
  generated_at: "2026-02-20T12:00:00Z",

  rooms_discovered: ["Living Room", "Kitchen", "Master Bedroom", "Office", "Guest Room"],
  rooms: [
    { name: "Living Room" },
    { name: "Kitchen" },
    { name: "Master Bedroom" },
    { name: "Office" },
    { name: "Guest Room" },
  ],

  receivers: [
    { id: "r1", name: "Living Room Hub", manufacturer: "Espressif", model: "ESP32 BT Proxy", sw_version: "2024.11.0", area_name: "Living Room" },
    { id: "r2", name: "Bedroom Hub",     manufacturer: "Espressif", model: "ESP32 BT Proxy", sw_version: "2024.11.0", area_name: "Master Bedroom" },
    { id: "r3", name: "Kitchen Hub",     manufacturer: "Espressif", model: "ESP32 BT Proxy", sw_version: "2024.11.0", area_name: "Kitchen" },
  ],
  bermuda_devices: [
    { id: "r1", name: "Living Room Hub", manufacturer: "Espressif" },
    { id: "r2", name: "Bedroom Hub",     manufacturer: "Espressif" },
    { id: "r3", name: "Kitchen Hub",     manufacturer: "Espressif" },
  ],

  ble: {
    radios: [
      { source: "living_room_hub", name: "Living Room Hub", scanning: true,  connectable: true,  scan_mode: "active",  adapter: "hci0", area_name: "Living Room",    ip: "192.168.1.40", ssid: "HomeNetwork", wifi_signal: -42, connection_type: "wireless" },
      { source: "bedroom_hub",     name: "Bedroom Hub",     scanning: true,  connectable: true,  scan_mode: "passive", adapter: "hci0", area_name: "Master Bedroom", ip: "192.168.1.41", ssid: "HomeNetwork", wifi_signal: -58, connection_type: "wireless" },
      { source: "kitchen_hub",     name: "Kitchen Hub",     scanning: true,  connectable: false, scan_mode: null,      adapter: "hci0", area_name: "Kitchen",        ip: "192.168.1.42", connection_type: "wired" },
    ],
    advertisements: [
      { address: "AA:BB:CC:11:22:33", name: "Alice's Phone",  source: "living_room_hub", rssi: -58, age_s: 3,  connectable: true, service_uuids: ["0x180F","0x180A"], manufacturer_data: {"76":"0x10 0x07 0x38 0x1F"}, company_name: "Apple", device_type: "Nearby Info", service_names: ["Battery","Device Information"], service_uuid_map: {"0x180F":"Battery","0x180A":"Device Information"}, _xref: { key: "irk:aabbccddeeff00112233445566778899", kind: "private_ble", label: "Alice's iPhone", identified: true, room: "Living Room", canonical_id: "irk:aabbccddeeff00112233445566778899", all_addresses: ["AA:BB:CC:11:22:33","47:A2:1C:88:F3:D0","5E:C1:3A:92:D7:B4"] } },
      { address: "AA:BB:CC:11:22:33", name: "Alice's Phone",  source: "bedroom_hub",     rssi: -84, age_s: 3,  connectable: true, company_name: "Apple", device_type: null, service_names: [], service_uuid_map: {}, _xref: { key: "irk:aabbccddeeff00112233445566778899", kind: "private_ble", label: "Alice's iPhone", identified: true, room: "Living Room", canonical_id: "irk:aabbccddeeff00112233445566778899", all_addresses: ["AA:BB:CC:11:22:33","47:A2:1C:88:F3:D0","5E:C1:3A:92:D7:B4"] } },
      { address: "BB:CC:DD:22:33:44", name: "Bob's Phone",    source: "bedroom_hub",     rssi: -61, age_s: 7,  connectable: true, service_uuids: ["0x180F","FE2C"], manufacturer_data: {"224":"0x22 0x01"}, company_name: "Google", device_type: null, service_names: ["Battery","Google Fast Pair"], service_uuid_map: {"0x180F":"Battery","FE2C":"Google Fast Pair"}, _xref: { key: "irk:ffeeddccbbaa99887766554433221100", kind: "private_ble", label: "Bob's Pixel", identified: true, room: "Master Bedroom", canonical_id: "irk:ffeeddccbbaa99887766554433221100", all_addresses: ["BB:CC:DD:22:33:44","52:B3:7D:C1:04:E9"] } },
      { address: "BB:CC:DD:22:33:44", name: "Bob's Phone",    source: "living_room_hub", rssi: -88, age_s: 7,  connectable: true, company_name: "Google", device_type: null, service_names: [], service_uuid_map: {}, _xref: { key: "irk:ffeeddccbbaa99887766554433221100", kind: "private_ble", label: "Bob's Pixel", identified: true, room: "Master Bedroom", canonical_id: "irk:ffeeddccbbaa99887766554433221100" } },
      { address: "CC:DD:EE:33:44:55", name: "",               source: "living_room_hub", rssi: -64, age_s: 5,  connectable: false, company_name: null, device_type: null, service_names: [], service_uuid_map: {}, _xref: { key: "ble:CC:DD:EE:33:44:55", kind: "ble", label: "Car Keys", identified: true, room: null } },
      { address: "CC:DD:EE:33:44:55", name: "",               source: "bedroom_hub",     rssi: -89, age_s: 5,  connectable: false, company_name: null, device_type: null, service_names: [], service_uuid_map: {}, _xref: { key: "ble:CC:DD:EE:33:44:55", kind: "ble", label: "Car Keys", identified: true, room: null } },
      { address: "DD:EE:FF:44:55:66", name: "AirTag",         source: "living_room_hub", rssi: -71, age_s: 12, connectable: false, manufacturer_data: { "76": "0x12 0x19" }, company_name: "Apple", device_type: "Find My", service_names: [], service_uuid_map: {}, _xref: { key: "ble:DD:EE:FF:44:55:66", kind: "ble", label: "Wallet (AirTag)", identified: true, room: null } },
      { address: "EE:FF:00:55:66:77", name: "Tile",           source: "kitchen_hub",     rssi: -68, age_s: 8,  connectable: true, service_uuids: ["FEED"], company_name: null, device_type: null, service_names: ["Tile"], service_uuid_map: {"FEED":"Tile"}, _xref: { key: "ble:EE:FF:00:55:66:77", kind: "ble", label: "Backpack (Tile)", identified: true, room: null } },
      { address: "FF:00:11:66:77:88", name: "",               source: "bedroom_hub",     rssi: -76, age_s: 22, connectable: false, service_uuids: ["181A"], manufacturer_data: {"310":"0x01 0x02"}, company_name: "Xiaomi", device_type: null, service_names: ["Environmental Sensing"], service_uuid_map: {"181A":"Environmental Sensing"}, _xref: null },
      { address: "00:11:22:77:88:99", name: "",               source: "living_room_hub", rssi: -82, age_s: 45, connectable: false, company_name: null, device_type: null, service_names: [], service_uuid_map: {}, _xref: null },
    ],
    diag: { ok: true, errors: [] },
  },

  tags: [
    { entity_id: "device_tracker.alice_phone", name: "Alice's Phone",  room: "Living Room",    state: "Living Room" },
    { entity_id: "device_tracker.bob_phone",   name: "Bob's Phone",    room: "Master Bedroom", state: "Master Bedroom" },
  ],

  room_tag_map: {
    "Living Room":    ["device_tracker.alice_phone"],
    "Master Bedroom": ["device_tracker.bob_phone"],
    "Kitchen":    [],
    "Office":     [],
    "Guest Room": [],
  },
  room_tag_map_live: {
    "Living Room":    ["device_tracker.alice_phone"],
    "Master Bedroom": ["device_tracker.bob_phone"],
    "Kitchen":    [],
    "Office":     [],
    "Guest Room": [],
  },
  room_tag_map_missing:  { "Living Room": [], "Master Bedroom": [], "Kitchen": [], "Office": [], "Guest Room": [] },
  room_tag_map_saved:    { "Living Room": ["device_tracker.alice_phone"], "Master Bedroom": ["device_tracker.bob_phone"] },

  objects: {
    list: [
      // --- Entity-tracked ---
      { key: "entity:device_tracker.alice_phone", kind: "entity", entity_id: "device_tracker.alice_phone", name: "Alice's Phone",  room: "Living Room",    state: "Living Room",    identified: true,  address: "AA:BB:CC:11:22:33" },
      { key: "entity:device_tracker.bob_phone",   kind: "entity", entity_id: "device_tracker.bob_phone",   name: "Bob's Phone",    room: "Master Bedroom", state: "Master Bedroom", identified: true,  address: "BB:CC:DD:22:33:44" },
      // --- Tagged BLE ---
      { key: "ble:CC:DD:EE:33:44:55", kind: "ble", address: "CC:DD:EE:33:44:55", name: "CC:DD:EE:33:44:55", user_label: "Car Keys",       identified: true,  rssi: -64, age_s: 5,  sources: ["living_room_hub"], connectable: false, company_name: null, device_type: null, service_names: [], service_uuid_map: {}, prefix: "CC:DD:EE", prefix_count: 1 },
      { key: "ble:DD:EE:FF:44:55:66", kind: "ble", address: "DD:EE:FF:44:55:66", name: "AirTag",             user_label: "Wallet (AirTag)", identified: true,  rssi: -71, age_s: 12, sources: ["living_room_hub"], manufacturer_data: {"76":"0x12 0x19"}, connectable: false, company_name: "Apple", device_type: "Find My", service_names: [], service_uuid_map: {}, prefix: "DD:EE:FF", prefix_count: 1 },
      { key: "ble:EE:FF:00:55:66:77", kind: "ble", address: "EE:FF:00:55:66:77", name: "Tile",               user_label: "Backpack (Tile)", identified: true,  rssi: -68, age_s: 8,  sources: ["kitchen_hub"],     service_uuids: ["FEED"], connectable: true, company_name: null, device_type: null, service_names: ["Tile"], service_uuid_map: {"FEED":"Tile"}, prefix: "EE:FF:00", prefix_count: 1 },
      // --- Private BLE (rotating MAC resolved via IRK) ---
      { key: "irk:aabbccddeeff00112233445566778899", kind: "private_ble", address: "47:A2:1C:88:F3:D0", all_addresses: ["47:A2:1C:88:F3:D0", "5E:C1:3A:92:D7:B4"], name: "Alice's iPhone", private_ble_name: "Alice's iPhone", canonical_id: "irk:aabbccddeeff00112233445566778899", user_label: "Alice's iPhone", identified: true, rssi: -58, age_s: 3, room: "Living Room", sources: ["living_room_hub"], manufacturer_data: {"76":"0x10 0x07 0x38 0x1F"}, connectable: true, company_name: "Apple", device_type: "Nearby Info", service_names: ["Battery", "Device Information"], service_uuid_map: {"0x180F":"Battery","0x180A":"Device Information"}, service_uuids: ["0x180F","0x180A"], prefix: "47:A2:1C", prefix_count: 1 },
      { key: "irk:ffeeddccbbaa99887766554433221100", kind: "private_ble", address: "52:B3:7D:C1:04:E9", all_addresses: ["52:B3:7D:C1:04:E9"], name: "Bob's Pixel",    private_ble_name: "Bob's Pixel",    canonical_id: "irk:ffeeddccbbaa99887766554433221100", identified: true, rssi: -62, age_s: 7, room: "Master Bedroom", sources: ["bedroom_hub"], manufacturer_data: {"224":"0x22 0x01"}, connectable: true, company_name: "Google", device_type: null, service_names: ["Google Fast Pair"], service_uuid_map: {"FE2C":"Google Fast Pair"}, service_uuids: ["FE2C"], prefix: "52:B3:7D", prefix_count: 1 },
      // --- iBeacon (stable UUID survives MAC rotation — AirTag, Tile, HA Companion App) ---
      { key: "ibeacon:f7826da6-4fa2-4e98-8024-bc5b71e0893e:1:2", kind: "ibeacon", address: "ibeacon:f7826da6-4fa2-4e98-8024-bc5b71e0893e:1:2", all_addresses: ["61:A3:FC:22:D1:88", "72:B4:ED:33:C2:99"], name: "AirTag (Bag)", user_label: "AirTag (Bag)", identified: true, rssi: -67, age_s: 6, room: "Kitchen", sources: ["kitchen_hub"], company_name: "Apple", device_type: "iBeacon", service_names: [], service_uuid_map: {}, ibeacon_uuid: "f7826da6-4fa2-4e98-8024-bc5b71e0893e", ibeacon_major: 1, ibeacon_minor: 2 },
      // --- Away (not seen for longer than the 5-min default away timeout) ---
      { key: "ble:AA:11:22:33:BB:CC", kind: "ble", address: "AA:11:22:33:BB:CC", name: "AA:11:22:33:BB:CC", user_label: "Dog Tracker", identified: true, rssi: -88, age_s: 483, room: "Hallway", sources: ["living_room_hub"], connectable: true, company_name: "Nordic Semiconductor", device_type: null, service_names: [], service_uuid_map: {}, prefix: "AA:11:22", prefix_count: 1 },
      // --- Unidentified BLE ---
      { key: "ble:FF:00:11:66:77:88", kind: "ble", address: "FF:00:11:66:77:88", name: "", identified: false, rssi: -76, age_s: 22, sources: ["bedroom_hub"],     connectable: false, company_name: "Xiaomi", device_type: null, service_names: ["Environmental Sensing"], service_uuid_map: {"181A":"Environmental Sensing"}, service_uuids: ["181A"], prefix: "FF:00:11", prefix_count: 1 },
      { key: "ble:00:11:22:77:88:99", kind: "ble", address: "00:11:22:77:88:99", name: "", identified: false, rssi: -82, age_s: 45, sources: ["living_room_hub"], connectable: false, company_name: null, device_type: null, service_names: [], service_uuid_map: {}, prefix: "00:11:22", prefix_count: 1 },
    ],
    summary: { total: 11, identified: 9, unidentified: 2, entities: 2, ble: 8, private_ble: 2, ibeacon: 1, common_prefixes: {} },
  },

  raw_counts: { areas: 5, receivers: 3, candidate_entities: 2, mapped_entities: 2, saved_entities_total: 2, saved_entities_found: 2, saved_entities_missing: 0 },

  // Floor plan data used by overview sample visualization
  floor_plan: {
    name: "Smith Residence (Demo)",
    vw: 800, vh: 440,
    rooms: [
      { id: "living_room",    name: "Living Room",    x: 10,  y: 10,  w: 370, h: 200, color: "#52b788" },
      { id: "kitchen",        name: "Kitchen",        x: 390, y: 10,  w: 400, h: 200, color: "#4caf50" },
      { id: "hallway",        name: "Hallway",        x: 10,  y: 220, w: 780, h: 40,  color: "#388e3c" },
      { id: "office",         name: "Office",         x: 10,  y: 270, w: 230, h: 160, color: "#43a047" },
      { id: "master_bedroom", name: "Master Bedroom", x: 250, y: 270, w: 540, h: 160, color: "#66bb6a" },
    ],
    radios: [
      { id: "r1", name: "Living Room Hub", x: 185, y: 95,  room: "Living Room" },
      { id: "r2", name: "Bedroom Hub",     x: 520, y: 345, room: "Master Bedroom" },
      { id: "r3", name: "Kitchen Hub",     x: 590, y: 95,  room: "Kitchen" },
    ],
    objects: [
      { name: "Alice's Phone",  x: 140, y: 155, type: "entity",       color: "#52b788" },
      { name: "Bob's Phone",    x: 360, y: 380, type: "entity",       color: "#52b788" },
      { name: "Car Keys",       x: 280, y: 75,  type: "tagged_ble",   color: "#5eead4" },
      { name: "Wallet",         x: 90,  y: 175, type: "tagged_ble",   color: "#5eead4" },
      { name: "Backpack",       x: 555, y: 155, type: "tagged_ble",   color: "#5eead4" },
      { name: "?? Unknown",     x: 400, y: 370, type: "unidentified", color: "#f59e0b" },
      { name: "?? Unknown",     x: 210, y: 45,  type: "unidentified", color: "#f59e0b" },
    ],
  },
};
