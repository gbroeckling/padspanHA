# Floor Plan Setup Guide

This guide covers uploading floor plans, setting scale, drawing room boundaries, and placing scanner markers for accurate room-level tracking.

## Uploading a Floor Plan

1. Go to **Maps** → **Upload** tab
2. Click **Choose file** and select a PNG or JPG image (max 20MB)
3. Give your map a name (e.g., "Ground Floor", "Upstairs")
4. Click **Upload**

### Tips for good floor plans
- Architectural blueprints work best — straight walls, clear room labels
- Even a hand-drawn sketch on paper, photographed, works fine
- Higher resolution = more precise room boundaries
- One map per floor if you have multiple levels

## Setting the Scale (Measure Tool)

The measure tool lets you calibrate real-world distances on your floor plan:

1. Click **Measure** in the map tools
2. Click two points on the map where you know the real distance (e.g., the length of a wall)
3. Enter the real-world distance in metres
4. Click **Add Measurement**
5. Repeat with a second measurement at a different angle (e.g., one horizontal wall, one vertical wall)
6. PadSpan checks for aspect ratio consistency — if the two measurements differ by more than 10%, the image may be stretched

After two measurements, the **Save Scale** button appears with the calculated pixels-per-metre and real-world map dimensions. Click it to save.

### Why two measurements?
A single measurement gives the scale but can't detect if the image is stretched in one direction. Two measurements at different angles verify the aspect ratio.

## Drawing Room Boundaries

1. Go to **Maps** → select your uploaded map → **Edit**
2. Select a room from the **room list** on the right (rooms come from your HA Area Registry)
3. Click points on the map to draw a polygon around that room
4. Close the polygon by clicking near the first point
5. Repeat for each room

### Why this matters
PadSpan uses these boundaries to visualize which room a device is in on the floor plan. The boundaries also inform the 3D isometric multi-floor view and the room shapes in PadSpan's room and receiver layout.

## Placing Scanner Markers

1. In the map edit view, find the **scanner placement** section
2. Drag each scanner marker to its physical location on the floor plan
3. PadSpan shows a 3-digit short ID on each marker for quick identification

### Placement tips
- Place scanners **inside the rooms** you want to track, not in hallways
- **3+ scanners** gives reliable room discrimination
- Spread scanners so their coverage areas overlap slightly
- Avoid placing scanners behind large metal objects or thick walls

## Multi-Floor Setup

If you have multiple floors:
1. Upload one map per floor
2. Assign rooms to the correct floor in HA's Area Registry
3. Set one map as the **Master Map** — this establishes the coordinate origin for the room and receiver layout
4. Align other maps to the master using the **alignment tool** (offsets and rotation)
5. Use the **3D Stack** view (Maps → 3D tab) to see all floors stacked with live object positions

### Master Map

The master map is the coordinate reference for all other floors. Choose your largest or most-used floor. All spatial calculations (scanner positions, room geometry, signal walls) are stored in real-world metres relative to the master map's origin.

### 2D Flat Map Mode

Enable in **Settings → Appearance → 2D Map Mode** (experimental). This replaces the 3D isometric view with a flat overhead view that supports:
- Mouse wheel zoom (0.5× to 8×)
- Click-drag panning
- Toggle filters: Map image, Rooms, Scanners, Tagged devices, Unknown devices
- Auto-hides multi-floor controls when only one map is uploaded

## Scanner Network Info

In the **QA** → **Radio Analysis** card, you can verify each scanner's:
- IP address and WiFi SSID
- Connection type (wired vs wireless)
- Signal quality and device count
- Health status relative to other scanners

This helps diagnose placement issues — if one scanner sees significantly fewer devices than its neighbors, it may need to be repositioned.
