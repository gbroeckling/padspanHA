# The Atlas keeps its lights list between updates

### Changed
- **The sidebar Atlas no longer rebuilds its lights list every 5 seconds.** The list under the map stays on screen, and only the rows whose light, sensor or reading changed are redrawn. Changing the filter, the sort, hiding a light, a setting or a new map still redraws the list whole. It looks and works exactly as before, and each update takes about a third of the time it did on a desk screen (a wall screen gains less, as it does not show the list). Scrolling the list sideways is no longer reset by an update.

### Fixed
- **Holding a light to dim it is no longer cut short by an update.** If the 5-second update landed while you were holding a light on the map and sliding to dim it, the dim stopped. Updates now wait until you let go, as they already did for sliders.
