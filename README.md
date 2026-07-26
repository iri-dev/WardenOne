# WebWarden

A privacy and security extension for Chromium browsers (Manifest V3). It blocks
ads and trackers, resists fingerprinting, rejects cookie-consent nags, guards
downloads, and adds a few quality-of-life tools for YouTube and Twitch.

## Features

**Ad blocking**
- **YouTube** — removes video ads (pre-roll and mid-roll) by pruning the ad
  schedule out of the player data before playback, so there's no black screen or
  skip button.
- **Twitch** — blocks stream ads by swapping to a clean playlist when Twitch
  stitches ads into the stream, with a silent-segment fallback so playback keeps
  going instead of breaking.
- **General** — network-level ad and tracker blocking via Declarative Net
  Request rules.

**Privacy**
- Anti-fingerprinting: per-session randomised noise on canvas / WebGL / navigator
  surfaces, with carve-outs so logins and SSO still work.
- Tracker and third-party-cookie blocking, WebRTC leak protection, and Global
  Privacy Control.
- Automatic "reject non-essential" on cookie / consent banners.

**Safety**
- Download Guard: hash- and reputation-based checks on downloads, with
  hard-blocking of known-bad files.
- Phishing and malicious-redirect warnings.

**Extras**
- Twitch local DVR / rewind — scrub back through a live stream, or jump straight
  to the point you joined via the in-progress VOD.
- EyeShield — an eye-comfort colour/contrast filter with per-site handling.

## Install (from source)

1. Clone or download this repository.
2. Open `chrome://extensions` and enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the project folder.

## Privacy

WebWarden does its ad-blocking and fingerprint defence locally in your browser.
It uses no remote proxy to fetch media.

## License

Licensed under the **GNU General Public License v3** — see [LICENSE](LICENSE).

The filter rules and ad-blocking techniques build on the open-source community.
Sources are credited in [CREDITS.md](CREDITS.md): AdGuard (YouTube rules),
EasyList / EasyPrivacy (tracker rules), and TwitchAdSolutions (Twitch strategy).
