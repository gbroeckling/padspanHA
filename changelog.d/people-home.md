# People who are home stay in the house

### Fixed
- **People who are home no longer vanish from the 3D house or the people count.** PadSpan counted a Home Assistant person as home only when their state was exactly "home", so three kinds of people who were plainly in dropped out. Each now counts as home in Live Aboard and the flat Atlas, in the Occupancy count, in Vacation Mode's "pause while someone is home", and for Live Aboard's "Arrived home" card:
  - **Someone linked to PadSpan's own phone tracker**, as the phone guide says to do. That tracker reports the room, so the person reads "Kitchen", not "home".
  - **Someone with no tracker of their own** (their state is "unknown") whose phone or tag PadSpan hears in the house right now.
  - **Someone in a zone that lies inside your home zone**, such as a Garden zone in the yard, or whose state names the home zone itself.
- **Someone away still never counts as home:** "not_home", a zone anywhere else, or "unknown" with nothing of theirs heard. If a zone and a room share a name (an "Office" zone at work and an Office at home), the zone wins, so someone at work is never put in your office.
