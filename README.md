# Weather & rain radar

A small, personal front end on Bureau of Meteorology data: rain radar, current
warnings and a short forecast for wherever you are, or wherever you search for.

## What good means (first version)

This isn't trying to be the BOM website, or a weather app for everyone. It's
closer to the brief's "tool built for one workshop": something that answers
one question fast — *is it raining near me, or about to* — without an account,
a feed, or a settings page to get through first.

A good version of this app:

- **gets out of the way on load.** It should already show your own location's
  radar and any live warnings before you've touched anything. If you denied
  location once, it shouldn't ask again and again — it should just show you
  where you were last time.
- **treats warnings as the most important thing on the page**, not something
  buried under a forecast. A severe weather warning should be impossible to
  miss.
- **doesn't pretend to be more certain than BOM's own data is.** If the radar
  image, forecast or warnings can't be fetched, the app says so plainly rather
  than showing stale or fake data.
- **is honest about scope.** This first version only shows the nearest major
  radar station to a location, not a hyper-local composite; it's a rough
  proof that the core idea works, not a finished product.

What I read while deciding this: the final project brief's notes on "good"
(the small web, games for a handful of friends, tools built for one
workshop), and BOM's own site, which I used as the baseline for what
"warnings first" and "radar near me" should look like, while deliberately not
trying to match its scope.

This is a first pass and it's expected to change as the app grows — logins,
a pinned dashboard of favourite locations, and a proper radar loop are next.
