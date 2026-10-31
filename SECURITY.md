# Security

## Supported versions

Only the latest release gets fixes. Older versions are not patched: update from the releases page.

## Reporting a vulnerability

Please report it privately: the repository's **Security** tab → **Report a vulnerability**
(GitHub private vulnerability reporting). Don't open a public issue for it.

Include what you found, how to reproduce it, and which version you used. Mapper is a volunteer
project: expect a first answer within about a week. A confirmed issue gets a fixed release, and
the advisory credits you unless you'd rather not be named.

## What counts

Anything that breaks one of Mapper's promises (README, "What Mapper does and doesn't do"):

- Mapper touching another process, window, file or the screen beyond its own windows;
- input sent on the player's behalf, or hotkeys taken any other way than `RegisterHotKey`;
- network traffic other than the request to GitHub Releases (once a day, or when the player
  clicks "Check now"), or data about the player in it;
- a way for a web page, a config file or an update answer to run code or reach a command the
  window is not allowed to use;
- the release pipeline: a build that ships something other than the tagged sources, or a guard
  check that passes code it should catch.

Bugs without such an effect (a wrong distance, a window in the wrong place) are ordinary issues.
