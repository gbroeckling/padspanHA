# Teams of lights that always have power

### New
- **A power team can have no power source (Settings → Atlas → Power teams: "None: these lights always have power").** For colour lights on their own supply, such as LED strings: they become one light that switches and changes colour together and can follow the day. One of them turned on by an automation is answered with the day's light on all of them; one turned off takes the rest with it. On and off are re-sent until each light shows it, so a light on weak Wi-Fi that drops a command still follows.

### Fixed
- **A team that follows the day puts a light back when it missed a command.** Each minute, a light that does not show what was last sent is sent it once more; the team's own re-send is never mistaken for someone choosing a colour by hand.
