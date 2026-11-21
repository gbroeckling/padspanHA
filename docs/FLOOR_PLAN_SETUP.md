# Floor Plan Setup Guide

A floor plan is optional. Without one, **Who's where now** on the Overview already puts each device in a room, from each scanner's Home Assistant area. A plan adds the map of your house, calibration, and, with three or more scanners placed on it, positions between scanners.

This page is the short version. [From the Marketplace to your first room](https://padspan.traks.ca/guides/get-started/) has the same steps with pictures (its part 5), and every screen in PadSpan has a **?** that explains it.

## Where to start

Select **Make it a map** on the Overview's **Who's where now** card, or **Open Setup** on its **Make it a map** / **Getting started** card. That opens **Setup**: a list of the steps in order, each opening the tool for it and leading back:

1. **Upload a floor plan**
2. **Set the scale**
3. **Draw the rooms**
4. **Floors and their heights** (only with two indoor floors or more)
5. **Place receivers and set their heights**
6. **Calibrate**

Any step after the upload can be skipped and done later; Setup remembers where you were. Steps 1 to 5 run in the **Setup Wizard** on the **Mapping** screen, one floor plan at a time, and the wizard ends with **Finish**. **Mapping → Library → Start Setup Wizard** (or **+ Add a floor**) opens the same wizard.

Only a Home Assistant administrator can upload or change a floor plan.

## 1. Upload a floor plan

Pick the plan's **Floor (from HA)**, give it a name if you like, choose the picture and select **Upload & Convert**. Any picture works, even a photo of a hand sketch: PNG, JPG, GIF, BMP, WebP or SVG, up to 20 MB. You can crop it on the preview first.

No floor plan? **No floor plan? Ways to get one**, on the same step, offers a room scan with an iPhone or iPad (a Pro model with LiDAR), a sketch you draw and photograph, or a blank floor of the size you type.

## 2. Set the scale

Click both ends of something you know, a doorway or a wall, type its length and save. A second length at a different angle is optional; it shows whether the picture is stretched. A plan that already has a scale is measured with two lengths: **Add 1st Measurement**, **Add 2nd Measurement**, then **Save Scale**.

Lengths are in metres, or in feet with **Settings → Appearance → Show lengths in feet and inches** on. Don't skip this step: without a scale nothing can go on the map of your house, and calibration can't start.

## 3. Draw the rooms

The rooms are your Home Assistant areas on this plan's floor. Press a room's name (or pick it under **Choose room…** and select **Start drawing**), click each corner on the plan, then double-click or select **Finish outline**. In the wizard each room is saved as you finish it. A room missing from the list? Check in Home Assistant, under **Settings → Areas, labels & zones**, that its area is on this floor.

With an AI Task set up, **Let Claude draw your rooms** (Pro, experimental) can propose the outlines for you to check.

## 4. Floors and their heights

Only for a house with two indoor floors or more: how tall each floor is, so PadSpan can tell the floors apart. Until you set them, PadSpan uses an ordinary storey height (2.8 m). The same card is **Floor Heights** on **Mapping → 3D Stack**.

## 5. Place receivers and set their heights

In the **Live BLE Receivers** list beside the plan, select **Add** next to each scanner on this floor, drag it to where it is mounted, pick its room, and set **Height above floor**. Use **Add** in this list, not a double-click on the plan or **Add Receiver**: only a marker added from the list is linked to a real scanner.

Or select **Put my receivers in their rooms**: each scanner whose Home Assistant area has an outline goes in the middle of that room, to drag into place later in Calibration's first step, **Check receiver positions**.

## Finish: Put it on the map

This is the step that's easy to miss. Until you select **Put it on the map**, your rooms and scanners are only on the picture: the Overview, the Atlas and positioning don't use them, and **Done** doesn't move them. **Put it on the map** adds the rooms and scanners the map of your house doesn't have yet, and changes nothing already on it. Once a room is on, the map takes the place of **Who's where now** on the Overview, so draw every room your scanners cover.

**Finish** also offers the next step (often **Go to Calibration →**), **+ Set up another floor** and **Done**.

## More than one floor

Upload one plan per floor and set each one's scale. There is no master map: each plan has its own place in metres, and lining one up moves only that plan. In **Mapping → 3D Stack**, choose a **Reference** and a **Target**, drag the Target until the stairs and outside walls line up (or use **Point Align**), then select **Save Alignment**. **Compare Maps** in the Library rates how well the floors line up.

## The Mapping tabs

In Basic mode Mapping has **Library** and **Upload**. Advanced and Development mode add **Edit**, **3D Stack**, **Layout**, **Atlas builder**, **Export** and **Help**, plus **Furnish** while Live Aboard is on.

- **Edit**: the plan's own tools (Measure, Rooms, Receivers and Signal walls) outside the wizard. There, rooms and receivers are drafts until you press **Save Layout**.
- **Layout**: the rooms and receivers in metres, the way positioning sees them, with no picture behind them. Rooms can be added there with no plan at all (**+ Add room**), and a Sweet Home 3D file imported (**Import floorplan (.sh3d)**). With **Settings → Features → Robot Vacuum Import** on (experimental), a robot vacuum's map can give you a plan and its rooms. If the Overview says "Room and receiver layout not built yet", **Commit this layout** here writes it.
- **2D Map Mode** (experimental, **Settings → Appearance**) draws the Overview as a flat map instead of the 3D stack.

## Checking your scanners

The **Receivers** page lists every scanner with its room, height and health. The **Live BLE Receivers** list in the wizard and in **Edit** shows each scanner's room, IP address and Wi-Fi network. **QA → Radio Analysis** (QA is under More tools) shows how many devices each scanner hears, how strongly, which other scanners hear the same devices, and a health verdict: a scanner that hears far fewer devices than its neighbours may need moving.
