# Floating stairs

### New
- **Floating stairs.** A staircase in the 3D house (Furnish → Build ▾ → House → Stairs) has a fourth **Style**, **Floating**: open treads on one steel spine down the middle, fixed to the floor at the bottom and to the floor or landing at the top, and nowhere on a wall. **Treads only** is still the style fixed into a wall.
  - It works with every shape (straight, L, U, two or three landings), with a few steps within a floor and with split levels. Each landing sits on the spine too.
  - **Auto** gives a floating stair a handrail on both sides, since there's no wall beside it. Both, Inside, Outside and None work as before.

### Changed
- **Imported stairs:** a staircase whose name says floating, suspended, spine or mono-stringer comes in as Floating. Cantilevered or wall-hung ones still come in as Treads only.
- **The opt-in usage report** counts floating stairs with the other styles (a count, nothing else), and the Install Base page names them.
- **A stair style from a newer version is kept.** If a later version adds another style, this one keeps it, draws it as Closed and still saves your other changes.
- **Going back to 0.38.194 or older after using Floating:** those versions refuse any save that holds a floating stair, your other changes in that save included, and their stair sheet turns a floating stair Closed. Set your floating stairs to another style before you go back.
