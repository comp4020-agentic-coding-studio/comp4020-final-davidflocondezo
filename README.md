# Weather & rain radar

A weather, rain and warning app using Bureau of Meteorology data: rain radar, current
warnings, temperature forecast for wherever you are, or wherever you search for. With a shared layer where people can report on what they are actually seeing.

# Who it's for

The people who rely on BOM most are not checking the weather out of curiosity. They are a farmer deciding whether to move stock, a family in a storm's path, or someone in a regional town on a weak connection. Their questions are urgent and narrow: is rain coming, and am I in danger? BOM's own site answers them, but only after layers of navigation, a search, a page load and a scroll. This app is built for the moment that question is asked.

## What good means

This isn't trying to be the BOM website, or a weather app for everyone. It's closer to the brief's "tool built for one workshop": something that answers one question fast — *is it raining near me?, or about to, is there a weather warning near me?, whats the temperature in this place?* — without an account, a feed, or a settings page to get through first.

- The answer arrives before any action. The app opens on your location with radar, the nearest warning and current conditions already on screen. There is no account and no setup. This follows Case's (2015) principle of calm technology: a tool should ask for as little attention as possible and inform without demanding.
- It never overstates what it knows. Warning circles are labelled approximate and drawn only around places the alert actually names. A place that cannot be located stays in the text list rather than becoming a confident, wrong shape. Severity is written as text, not shown by colour alone.
- Other people make it better, without being mistaken for the Bureau. Anyone can tap the map to report what they see, and everyone viewing that area sees it within about a second. Reports look nothing like official warnings, are labelled "not verified", and fade after two hours. This draws on crowdsourced weather reporting such as NOAA's mPING project, where public observations fill the gap between radar and what is happening on the ground. In a room full of people, the map gets more useful the more of them use it.
- What you did is still there when you come back. The selected place lives in the URL, so a shared link shows what it promised, and reports survive restarts and redeploys.

What I chose not to build
- Accounts. An anonymous visitor cookie is enough to tell people apart, and a login screen is a barrier at exactly the moment this app is for.
- Comments, threads or a feed. A report is an observation, not a conversation.
- Exact warning boundaries. I tried rebuilding BOM's district polygons and abandoned it after 65–80 km errors, rather than ship a shape I could not verify.
Moderation and rate limiting. This is a known gap, softened by expiry and labelling.