# Power teams: lights found on after a restart

### Fixed
- **A team of lights that always have power goes on following the day after Home Assistant restarts.** When Home Assistant started with the team's lights already on, they stayed on but nothing led them until they were next switched: the team only ever answered a switch from off to on. It now takes the team up as on when its lights are first heard from, and the next minute puts the day's light back. A light that was unavailable and comes back is never read as someone's hand on it.
