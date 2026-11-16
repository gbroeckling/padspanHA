# Setup Wizard: a placed receiver is kept on Back to Setup

### Fixed
- **A receiver placed in the Setup Wizard is saved when you press Back to Setup.** In 0.38.249 that only worked if the rooms step had been shown first in the same visit; opening the wizard straight at its receivers step (Setup's "Place receivers" does exactly that), placing a receiver and pressing Back to Setup lost it. Next, Finish, the step buttons and Exit setup already saved it.
