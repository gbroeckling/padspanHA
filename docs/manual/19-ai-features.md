# 19. AI features

[Contents](README.md)

PadSpan has no AI of its own and sends nothing to an AI service itself. A few features can ask an AI
**you** have set up in Home Assistant, an **AI Task**, to read a picture for you: a photo of a sofa,
or a floor plan. Room presence, calibration and everything else work without one.

## What it can do

All of these need PadSpan Pro or, from December 1, 2026, the Advanced map creation add-on
([chapter 25](25-padspan-pro.md#add-ons)); Furnish and Live Aboard's **Edit** stay PadSpan Pro's.
Each read happens only when someone starts it, never on a schedule.

| Feature | What is read | Where | Switch in Settings → AI |
|---|---|---|---|
| **Furniture from a photo** (also a tag, a receiver or a person's figure) | The photo you chose | Live Aboard's Furnish ([chapter 17](17-furnish.md)) | On unless you switch it off |
| **Stairs from your floor plans** | One placed floor plan, resized | Furnish → **Build ▾ → House → Read stairs off the plans (AI)** | Off by default, under **AI map-building research (experimental)** |
| **Add data via plans** (the **Plans** tool) | Your placed floor plans, whole and in pieces | Live Aboard's **Edit → Plans** ([chapter 16](16-live-aboard.md#building-from-your-plans-with-an-ai-experimental)) | **AI map-building research (experimental)**, off by default |
| **Build from plans** (**Line up plans**, **Rooms from plans**) | Your placed floor plans | Live Aboard's **Edit → Plans** | **Build from plans**, off for everyone until offered; needs Claude |
| **Let Claude draw your rooms** | The floor plans of the floor you chose | Setup's Draw the rooms step ([chapter 9](09-setup-the-map.md#step-3-draw-the-rooms)) | None: nothing is read until you start it there; needs Claude |

The experimental ones are research: the AI suggests, you check every item, and nothing is saved
until you accept it. They never change your calibration or signal walls. What they can save (a
plan's picture lined up, rooms) takes a backup first and has an undo. Turning a switch off hides the
feature; it doesn't undo what you kept.

**Ask your voice assistant where someone is** is the one row of **What it does for you** marked
**COMING SOON**: it can't be switched on yet. Assist's own "where is" sentences work today without an
AI: [chapter 14](14-home-assistant-reference.md).

## Connecting an AI

**Settings → AI → Your AI**:

- **AI Task**: pick one whose model can read pictures (a vision model). It needs Home Assistant
  2025.8 or newer. If Home Assistant has none yet, add an AI integration with a vision model first:
  one that runs in your home, such as Ollama, or a cloud one.
- **Backup AI task**: used when the main one can't be reached (a computer that's away, say). Before
  each read, PadSpan opens and closes one connection to the main one's server to see whether it is
  there; nothing is sent on it.

None is picked by default, and with none picked nothing is read. Only an administrator picks one.

### Connecting Claude

**Build from plans** and **Let Claude draw your rooms** need Claude, through Home Assistant's own
Anthropic integration and your own Anthropic account. Anthropic charges that account for each read;
PadSpan sells no credit and never asks for a card. It takes about 15 minutes, once.

1. **In the Anthropic Console**: sign up or sign in, and add credit on the **Billing** page. If your
   Claude plan includes monthly API credit, link your Console organisation to it instead. A Claude
   subscription on its own doesn't pay for these reads.
2. Open **API keys**, choose **Create Key**, name it ("Home Assistant") and copy it. The Console shows
   it only once.
3. **In Home Assistant**: **Settings → Devices & services → Add integration → Anthropic**, paste the
   key and finish.
4. In the Anthropic integration, open its AI Task (or add one), choose **Claude Opus 5.5 or newer**
   as its model by its full name, and save. Sonnet and Haiku aren't accepted: the plan reading was
   tested on Opus 5.5.
5. **In PadSpan**: the helper's **Connect Claude** screen checks again by itself when you come back
   (or choose **Check again**). If Home Assistant has a usable Claude that isn't PadSpan's AI yet, it
   offers **Use it for PadSpan**, and your earlier AI Task stays as the backup. Or pick it yourself in
   **Settings → AI → Your AI**.

Before anything is read, the helper sends one tiny read with no plan in it (a blank one-pixel picture
and the words "This is a connection check. Reply with the single word OK."), so an account with no
credit is found then, not after you measured your plan.

| The helper says | What to do |
|---|---|
| Claude isn't connected to Home Assistant yet | Steps 1 to 4. |
| Anthropic says this account is out of credit | Add credit (step 1), then come back. |
| Your AI Task uses an older Claude | Change its model to Claude Opus 5.5 or newer. |
| PadSpan can't tell which Claude model this AI Task uses | Choose the model again by its full name. |
| Home Assistant has Claude ready | Choose **Use it for PadSpan**. Photo and stair reading use it too. |

**When a read fails**: out of credit, add credit and choose **Try again** (what was read is kept).
Claude couldn't be reached: check the Anthropic integration in **Settings → Devices & services** and
Home Assistant's log. The media folder couldn't take the plan: Home Assistant's media folder must be
writable, because PadSpan hands the picture to the AI Task through it.

## What is read, and where it goes

Every read is a call to Home Assistant's own `ai_task.generate_data` on the AI Task you picked,
carrying:

- **one picture**: the photo, or a floor plan (whole, or a crop of it). It goes as it is, so whatever
  is printed on a plan goes with it;
- **instructions written into PadSpan**, which add only the picture's size in pixels and, for a
  photo, the kind of piece you picked;
- for a photo, the list of fields to fill in.

PadSpan adds no names, addresses, people, devices or positions from your house. Home Assistant hands
the read to the AI behind the AI Task: one that runs in your home keeps the picture there, and a
cloud one sends it to that company, under its own terms. For the length of the call the picture is a
file in a hidden folder in Home Assistant's media folder, removed when the call ends. PadSpan keeps no
copy of a photo. One photo or plan can take several reads.

A person's figure from a photo asks first that the person agrees, sends nothing until that is ticked,
and recommends a local AI Task.

## What it costs

PadSpan costs nothing extra here: you pay the AI's maker, if anyone. A local AI (Ollama on your own
machine) costs only its electricity. A cloud AI charges its own account.

For Claude, **Settings → AI** keeps a count: **Every read PadSpan sent to your AI this month**, with
an estimated cost for Claude only.

- It is an estimate from each picture's size and each question's length: Home Assistant doesn't pass
  on what Claude counted. The exact numbers are in the **Anthropic Console → Usage**, filtered by the
  key Home Assistant uses.
- Type **Your monthly credit, US$** and pick a share (50, 75 or 90%), and PadSpan sends one Home
  Assistant notification a month when the estimate passes it (**PadSpan: AI credit**).
- The count stays on this Home Assistant: it isn't in backups, a factory reset empties it, and the
  usage report gets only counts and rough bands from it.

What leaves the house in general: [chapter 24](24-privacy.md).
