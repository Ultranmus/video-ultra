# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub instead: open the repository's **Security** tab and choose
**Report a vulnerability**
([direct link](https://github.com/Ultranmus/video-ultra/security/advisories/new)).

Please include:

- which package and version (`@video-ultra/core`, `react`, `captions` or `ai`)
- what an attacker could do, and how to reproduce it
- the browser and device, if it matters

You'll get a reply within 7 days. Once a fix is released, the advisory is published and you are
credited, unless you'd rather not be.

## Supported versions

VideoUltra is pre-1.0. Security fixes go into the latest published minor version only.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Scope

In scope: the published `@video-ultra/*` packages. For example, a project file that runs code
when opened, media that escapes its worker, or data sent somewhere without the host app asking.

Out of scope: the demo site's AI features (they run on the demo's own keys and limits), and
problems that need a browser extension or a compromised device.

The editor never uploads the user's media by itself. Anything that makes it do so without the
host app's say is a vulnerability.
