/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * WardenOne Download Guard runtime
 * =================================
 * Owns download scoring, review storage/UI, hash-reputation hooks, trusted
 * download sites, Chrome downloads listeners, and critical hard-block handling.
 * Shared reputation providers and storage/browser wrappers stay in background.js.
 */

// ---- Download Guard -------------------------------------------------------
// Download review. A/B downloads continue quietly; C-F downloads are paused and
// reviewed in a WardenOne window before the user chooses continue or cancel.
// External reputation is opt-in. Chrome extensions cannot read arbitrary saved
// download bytes from disk, so hash checks use a fresh URL re-fetch fingerprint.
// VirusTotal receives only that SHA-256; WardenOne never uploads file contents.
const DANGEROUS_EXT = /\.(exe|scr|msi|msix|bat|cmd|com|pif|cpl|jar|vbs|vbe|vbscript|js|jse|wsf|wsh|ws|ps1|ps2|psc1|ps1xml|hta|reg|dll|sys|apk|dmg|pkg|app|deb|rpm|gadget|inf|lnk|msc|msp|msu|diagcab|ade|adp|chm|mht|mhtml|url|scf|application|appref-ms|jnlp|xll|settingcontent-ms|library-ms|iqy|slk|desktop|crx|xpi|scptd|terminal)$/i;
const ARCHIVE_EXT = /\.(zip|rar|7z|gz|tar|cab|ace|arj|tgz|bz2|xz|lzh)$/i;
// disk-image / container formats increasingly used to smuggle executables past
// mail/AV filters (Qakbot, IcedID, etc. ship malware inside .iso/.img/.vhd).
const CONTAINER_EXT = /\.(iso|img|vhd|vhdx|udf)$/i;
const MACRO_DOC_EXT = /\.(docm|xlsm|pptm|dotm|xlam|xltm|xlsb)$/i;
// These used to be one regex, so `setup` scored exactly the same as `keygen`. That is the most
// common legitimate installer filename on Windows, and it pushed an ordinary installer from an
// unlisted-but-honest vendor two whole grades -- executable (+3) plus installer (+3) = 6, which
// is grade E, "Dangerous". Meanwhile the words that genuinely mean trouble were diluted by
// sharing a bucket with them. Splitting helps both directions at once: fewer scares on safe
// installers, and a cleaner signal when a name really is a crack.
const BENIGN_INSTALLER_HINT = /(setup|install(er)?|update(r)?|full[-_. ]?installer)/i;
// Anchored to a non-letter boundary. Unanchored, these matched any word CONTAINING them, so
// firecracker.exe and nutcracker-setup.exe graded E "Dangerous" -- and so did SerialMonitor.exe and
// every serial-port utility, because bare `serial` is an ordinary English word. Narrowed to the
// piracy form (serial-key / serialnum / serial code) so it still catches what it is meant to.
const LURE_HINT = /(^|[^a-z])(crack|keygen|activator|nulled|warez|serial[-_ ]?(key|num|no|code)|cracked|repack|pre-?activated|free-?download|activador|kmspico|autokms)/i;
// Kept for the places that only care "does this name look like SOME kind of installer", such as
// the raw-IP check, where either flavour is equally interesting.
const INSTALLER_HINT = new RegExp(BENIGN_INSTALLER_HINT.source + '|' + LURE_HINT.source, 'i');
const DOWNLOAD_PENDING_KEY = 'wardenone_pending_downloads';
const DOWNLOAD_HANDLED_KEY = 'wardenone_download_handled';
const DOWNLOAD_TRUSTED_KEY = 'wardenone_download_trusted_sites';
try { globalThis.DOWNLOAD_TRUSTED_KEY = DOWNLOAD_TRUSTED_KEY; } catch (_) {}

/* Download reviews contain the source URL and filename. storage.local is shared
 * with the regular profile, so the private split worker keeps its review/decision
 * state and site trust in storage.session instead. Mixed reads (config + trust)
 * merge the two areas without moving ordinary settings out of durable storage. */
const PRIVATE_DOWNLOAD_STORE_KEYS = new Set([
  DOWNLOAD_PENDING_KEY, DOWNLOAD_HANDLED_KEY, DOWNLOAD_TRUSTED_KEY, 'wardenone_session_started_at',
]);
function privateDownloadContext() {
  try { return typeof INCOGNITO_CONTEXT !== 'undefined' && INCOGNITO_CONTEXT; } catch (_) { return false; }
}
function downloadStateGet(keys) {
  if (!privateDownloadContext()) return localGet(keys);
  const list = Array.isArray(keys) ? keys : [keys];
  const sessionKeys = list.filter((key) => PRIVATE_DOWNLOAD_STORE_KEYS.has(key));
  const localKeys = list.filter((key) => !PRIVATE_DOWNLOAD_STORE_KEYS.has(key));
  return Promise.all([
    localKeys.length ? localGet(localKeys) : Promise.resolve({}),
    sessionKeys.length ? chrome.storage.session.get(sessionKeys) : Promise.resolve({}),
  ]).then(([durable, transient]) => Object.assign({}, durable || {}, transient || {}));
}
function downloadStateSet(obj) {
  if (!privateDownloadContext()) return localSet(obj);
  return chrome.storage.session.set(obj);
}

const DOWNLOAD_HASH_TIMEOUT_MS = 15000;
const DOWNLOAD_HASH_MAX_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_HASH_SOURCE = Object.freeze({
  URL_REFETCH: 'url-refetch',
  SERVER_HEADER: 'server-header',
  NOT_AVAILABLE: 'not-available',
  NATIVE_FILE_HASH: 'native-file-hash',
});
const DOWNLOAD_HASH_SOURCE_KIND = DOWNLOAD_HASH_SOURCE.URL_REFETCH;
const DOWNLOAD_HASH_SOURCE_NOTE = 'Chrome extensions cannot read arbitrary saved download files; this hash is computed from a fresh fetch of the download URL.';
const DOWNLOAD_HASH_SOURCE_META = Object.freeze({
  'url-refetch': {
    label: 'URL re-fetch',
    available: true,
    exactFile: false,
    verified: true,
    caveat: DOWNLOAD_HASH_SOURCE_NOTE,
  },
  'server-header': {
    label: 'Server-provided hash',
    available: true,
    exactFile: false,
    verified: false,
    caveat: 'Hash was advertised by the download server, not computed from the saved file.',
  },
  'not-available': {
    label: 'Hash not available',
    available: false,
    exactFile: false,
    verified: false,
    caveat: 'No usable hash source was available for this download.',
  },
  'native-file-hash': {
    label: 'Native file hash',
    available: true,
    exactFile: true,
    verified: true,
    caveat: 'Hash computed from the saved file by a trusted native helper.',
  },
});
const DOWNLOAD_REVIEW_TTL_MS = 2 * 60 * 60 * 1000;
const DOWNLOAD_HANDLED_TTL_MS = 24 * 60 * 60 * 1000;
const CHROME_DANGER_STRONG = new Set(['url', 'content', 'host', 'unwanted', 'deepscannedopeneddangerous', 'sensitivecontentblock', 'accountcompromise']);
const CHROME_DANGER_MEDIUM = new Set(['file', 'uncommon', 'passwordprotected', 'blockedtoolarge', 'sensitivecontentwarning', 'deepscannedfailed', 'blockedscanfailed']);
// These describe prevalence or an incomplete scan, not a positive dangerous-file finding. Keep
// them as corroboration, but never let one of them cross the review threshold on its own.
const CHROME_DANGER_WEAK = new Set(['uncommon', 'blockedtoolarge', 'deepscannedfailed', 'blockedscanfailed']);
const CHROME_DANGER_PENDING = new Set(['asyncscanning', 'asynclocalpasswordscanning', 'promptforscanning', 'promptforlocalpasswordscanning']);
const DOWNLOAD_GRADE_META = {
  A: { grade: 'A', status: 'Trusted', color: '#2e9e5b', action: 'allow' },
  B: { grade: 'B', status: 'Good', color: '#2e9e5b', action: 'allow' },
  C: { grade: 'C', status: 'Review Recommended', color: '#8b3fb0', action: 'review' },
  // "High Risk" is a claim about the file. D's actual occupants are mostly files WardenOne could
  // not place -- an unlisted vendor, a community mirror, a CDN. Saying High Risk for those is what
  // wears out the word, so that E's "Dangerous" -- which really does mean it -- gets clicked past.
  D: { grade: 'D', status: 'Unverified Source', color: '#bd7a2a', action: 'review' },
  E: { grade: 'E', status: 'Dangerous', color: '#c0392b', action: 'review' },
  F: { grade: 'F', status: 'Critical Threat', color: '#7f1d1d', action: 'review' },
};
const PENDING_DOWNLOADS = {};
const DOWNLOAD_SCAN_TIMERS = {};
const DOWNLOAD_SCANNING = {};
// Downloads we paused IMMEDIATELY in onCreated (before the async scan) because their
// name/URL looked dangerous. The scan resumes them if they grade clean. Tracked so the
// clean path knows to undo an early-pause even when it didn't issue the pause itself.
const EARLY_PAUSED = new Set();
// Cheap, synchronous risk sniff for the onCreated early-pause: does the name or URL end in
// a dangerous executable/script or disk-image extension? (Double-extension lures like
// invoice.pdf.exe end in .exe, so DANGEROUS_EXT already covers them.)
function downloadLooksRisky(item) {
  try {
    const fn = item && item.filename;
    if (fn) { const n = downloadNameFromItemish(fn); if (n && (DANGEROUS_EXT.test(n) || CONTAINER_EXT.test(n))) return true; }
  } catch (_) {}
  for (const u of [item && item.finalUrl, item && item.url]) {
    if (!u) continue;
    try { const n = downloadNameFromItemish(u); if (n && (DANGEROUS_EXT.test(n) || CONTAINER_EXT.test(n))) return true; } catch (_) {}
  }
  return false;
}
const DOWNLOAD_SAFE_LOGGED = new Set();

// Browser-session boundary. Set on browser launch (onStartup) and on FIRST INSTALL only. Chrome
// restores paused/interrupted downloads when it reopens, which used to re-pop a
// Download Guard review for every leftover risky download ("it comes back after
// the browser reopens and shows all of them"). We stamp the session start so a
// scan can tell a download began in THIS session vs a previous one.
//
// Deliberately NOT on extension update (M25). Chrome updates extensions in the background while
// the browser stays open, so stamping there declared a new session the user never started: a
// download from minutes earlier became "previous session", lost its pending record, was marked
// handled, and had its review panel closed -- left paused with nothing to explain it.
let SESSION_STARTED_AT = 0;
downloadStateGet('wardenone_session_started_at').then((x) => {
  SESSION_STARTED_AT = (x && x.wardenone_session_started_at) || 0;
}).catch(() => {});
async function markBrowserSessionStart() {
  SESSION_STARTED_AT = Date.now();
  try { await downloadStateSet({ wardenone_session_started_at: SESSION_STARTED_AT }); } catch (_) {}
}
function downloadStartedBeforeSession(item) {
  if (!SESSION_STARTED_AT) return false;               // unknown (first run) -> don't suppress
  const t = Date.parse((item && item.startTime) || '');
  if (!t) return false;                                // no/invalid start time -> don't suppress
  return t < (SESSION_STARTED_AT - 5000);              // 5s margin for clock skew
}

function normalizeDownloadTrustHost(host) {
  let h = String(host || '').trim().toLowerCase();
  if (!h) return '';
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(h)) h = new URL(h).hostname;
  } catch (_) {}
  h = h.replace(/^www\./, '').replace(/^\.+|\.+$/g, '');
  if (!/^[a-z0-9.-]+$/i.test(h)) return '';
  return h;
}

// Well-known, vetted software-publisher download domains. Downloads from these are
// treated as trusted automatically (silent for normal files) -- so getting VS Code
// from microsoft.com, Firefox from mozilla.org, etc. doesn't pop a review. This is
// SEPARATE from the user's own trust list. Critical filename tricks (double
// extension, RTL spoof, blocklist/Chrome-malware hits) STILL override this and
// trigger review -- being a known publisher doesn't excuse a disguised executable.
const KNOWN_PUBLISHER_DOMAINS = new Set([
  // Microsoft / VS Code / GitHub
  'microsoft.com', 'visualstudio.com', 'vscode.dev', 'windows.com', 'office.com',
  'live.com', 'msftconnecttest.com', 'github.com', 'githubassets.com',
  'dot.net', 'nuget.org', 'powershellgallery.com', 'githubusercontent.com',
  // Google
  'google.com', 'goog', 'chrome.com', 'gstatic.com',
  'android.com', 'dl.google.com', 'googleapis.com', 'gvt1.com', 'gvt2.com',
  // Mozilla
  'mozilla.org', 'mozilla.net', 'firefox.com',
  // Apple
  'apple.com', 'icloud.com',
  // major dev / runtimes
  'python.org', 'pythonhosted.org', 'nodejs.org', 'oracle.com', 'java.com',
  'adoptium.net', 'rust-lang.org', 'golang.org', 'go.dev', 'docker.com',
  'jetbrains.com', 'gradle.org', 'apache.org', 'eclipse.org', 'git-scm.com',
  'gitforwindows.org', 'cmake.org', 'llvm.org', 'msys2.org', 'mingw-w64.org',
  'anaconda.com', 'conda.io', 'chocolatey.org', 'wixtoolset.org',
  'npmjs.com', 'yarnpkg.com', 'pnpm.io', 'deno.com', 'bun.sh', 'ruby-lang.org',
  'rubygems.org', 'php.net', 'composer.org', 'getcomposer.org', 'perl.org',
  'cpan.org', 'lua.org', 'haskell.org', 'scala-lang.org', 'elixir-lang.org',
  'erlang.org', 'ziglang.org', 'dart.dev', 'flutter.dev', 'kotlinlang.org',
  'r-project.org', 'posit.co', 'quarto.org', 'julia-lang.org', 'vagrantup.com',
  'hashicorp.com', 'terraform.io', 'podman.io', 'kubernetes.io', 'helm.sh',
  'k8s.io',
  'sqlite.org', 'postgresql.org', 'mysql.com', 'mariadb.org', 'mongodb.com',
  'redis.io', 'elastic.co',
  // widely-used apps
  'videolan.org', 'libreoffice.org', 'gimp.org', 'blender.org', 'audacityteam.org',
  'obsproject.com', 'notepad-plus-plus.org', '7-zip.org', 'winrar.com', 'rarlab.com',
  'getsharex.com', 'signal.org', 'discord.com',
  // Spotify ships its desktop installer (SpotifySetup.exe) from its own CDN
  // (download.scdn.co / spotifycdn.com), NOT spotify.com — list the CDN too so a clean
  // install from the official site stays silent instead of grading as Suspicious.
  'spotify.com', 'scdn.co', 'spotifycdn.com',
  'slack.com', 'zoom.us', 'steampowered.com', 'epicgames.com', 'gog.com',
  'sourceforge.net', 'fosshub.com', 'ninite.com', 'adobe.com', 'telegram.org',
  'whatsapp.com', '1password.com', 'bitwarden.com', 'proton.me', 'protonvpn.com',
  'tailscale.com', 'wireguard.com', 'openvpn.net', 'anydesk.com', 'teamviewer.com',
  'rufus.ie', 'balena.io', 'voidtools.com', 'scootersoftware.com', 'winmerge.org',
  'meldmerge.org', 'greenshot.org', 'irfanview.com', 'xnview.com', 'paint.net',
  'handbrake.fr', 'makemkv.com', 'filezilla-project.org', 'winscp.net',
  'putty.org', 'chiark.greenend.org.uk', 'mobatek.net', 'mremoteng.org',
  'notion.so', 'obsidian.md', 'logseq.com', 'todoist.com', 'evernote.com',
  'resilio.com', 'syncthing.net',
  'backblaze.com', 'carbonite.com', 'easeus.com', 'macrium.com', 'veeam.com',
  'paragon-software.com', 'acronis.com', 'readdle.com', 'calibre-ebook.com',
  'qbittorrent.org', 'transmissionbt.com', 'deluge-torrent.org',
  'nordvpn.com', 'expressvpn.com', 'surfshark.com', 'mullvad.net', 'ivpn.net',
  'windscribe.com', 'privateinternetaccess.com', 'parsec.app', 'splashtop.com',
  'rustdesk.com', 'vmware.com', 'broadcom.com', 'virtualbox.org', 'qemu.org',
  'proxmox.com', 'postman.com', 'insomnia.rest', 'dbeaver.io',
  'beekeeperstudio.io', 'wiresharkfoundation.org', 'peazip.github.io',
  'peazip.org', 'codecguide.com', 'foobar2000.org', 'mpv.io', 'kodi.tv',
  'plex.tv', 'wacom.com', 'elgato.com', 'focusrite.com', 'framework.com',
  'obsproject.github.io', 'piriform.com', 'ccleaner.com', 'bleachbit.org',
  'dropboxstatic.com', 'cloudflareclient.com', 'win-rar.com', 'dotpdn.com',
  'recuva.com', 'windirstat.net', 'wiztreefree.com', 'diskinternals.com',
  'altools.co.kr', 'bandisoft.com',
  // streaming / media services
  'netflix.com', 'crunchyroll.com', 'funimation.com', 'hidive.com', 'hulu.com',
  'disneyplus.com', 'max.com', 'hbomax.com', 'paramountplus.com', 'peacocktv.com',
  'primevideo.com', 'youtube.com', 'youtu.be', 'twitch.tv', 'tubitv.com',
  'pluto.tv', 'sling.com', 'fubo.tv', 'philo.com', 'vudu.com', 'fandango.com',
  'roku.com', 'stremio.com', 'netflix.net', 'nflxvideo.net', 'nflximg.net',
  'dssott.com', 'bamgrid.com', 'disneypluscdn.com', 'huluim.com',
  'theplatform.com', 'nbcuni.com', 'nbc.com', 'starz.com', 'showtime.com',
  'amcplus.com', 'britbox.com', 'curiositystream.com', 'mubi.com',
  'criterionchannel.com', 'kanopy.com',
  // browsers
  'brave.com', 'vivaldi.com', 'opera.com', 'torproject.org', 'waterfox.net',
  'librewolf.net', 'floorp.app',
  // security vendors (their own tools)
  'malwarebytes.com', 'malwarebytes.org', 'mbamupdates.com', 'bitdefender.com',
  'eset.com', 'kaspersky.com', 'avast.com', 'avg.com', 'avira.com', 'norton.com',
  'mcafee.com', 'trendmicro.com', 'sophos.com', 'f-secure.com', 'emsisoft.com',
  'virustotal.com', 'wireshark.org', 'clamav.net', 'clamwin.com', 'crowdstrike.com',
  'kaspersky-labs.com', 'avcdn.net',
  'sentinelone.com', 'paloaltonetworks.com', 'checkpoint.com', 'fortinet.com',
  'webroot.com', 'zonealarm.com', 'comodo.com', 'glasswire.com', 'portmaster.app',
  'safing.io', 'keepass.info', 'keepassxc.org', 'yubico.com', 'veracrypt.fr',
  'gnupg.org', 'gpg4win.org', 'adguard.com', 'adguard-vpn.com', 'quad9.net',
  'nextdns.io', 'cleanbrowsing.org',
  // hardware and driver publishers
  'nvidia.com', 'amd.com', 'intel.com', 'logitech.com', 'logi.com', 'razer.com',
  'corsair.com', 'steelseries.com', 'asus.com', 'dell.com', 'hp.com',
  'lenovo.com', 'realtek.com', 'acer.com', 'msi.com', 'gigabyte.com',
  'asrock.com', 'evga.com', 'western-digital.com', 'wdc.com', 'seagate.com',
  'samsung.com', 'crucial.com', 'kingston.com', 'sandisk.com', 'synology.com',
  'qnap.com', 'tp-link.com', 'netgear.com', 'linksys.com', 'ubnt.com',
  'ui.com', 'canon.com', 'epson.com', 'brother.com', 'xerox.com',
  'beelink.com', 'minisforum.com',
  // game/platform publishers
  'battle.net', 'blizzard.com', 'ea.com', 'ubisoft.com', 'riotgames.com',
  'minecraft.net', 'rockstargames.com', 'valvesoftware.com',
  'humblebundle.com', 'bethesda.net', 'wargaming.net', 'warframe.com',
  'square-enix-games.com', 'overwolf.com', 'store.steampowered.com',
  'steamstatic.com', 'steamcontent.com', 'epicgames.dev', 'gog-statics.com',
  'ubi.com', 'riotcdn.net',
  'playvalorant.com', 'leagueoflegends.com', 'roblox.com', 'robloxcdn.com',
  'minecraftservices.com',
  // cloud/platform vendor CLIs and agents
  'aws.amazon.com', 'azure.com', 'digitalocean.com',
  'linode.com', 'akamai.com', 'cloud.google.com', 'oraclecloud.com',
  'cloudflare.com', 'fly.io', 'render.com', 'heroku.com', 'vercel.com',
  'netlify.com',
  // ---- Additional vetted publishers (expanded download exceptions) ----------
  // Same rule as the rest of this list: provider-controlled domains ONLY. No
  // shared CDNs, user-content hosts, or personal cloud drives (dropbox/mega/
  // mediafire/drive.google/etc.) -- an attacker can host a payload on those.
  // communication / meetings / chat / mail
  'webex.com', 'goto.com', 'gotomeeting.com', 'skype.com', 'thunderbird.net',
  'tuta.com', 'tutanota.com', 'element.io', 'mattermost.com', 'rocket.chat',
  'teamspeak.com', 'mumble.info', 'viber.com', 'line.me', 'wechat.com',
  'guilded.com', 'loom.com',
  // office / productivity / notes / reference
  'onlyoffice.com', 'wps.com', 'wpsoffice.com', 'softmaker.com', 'freeoffice.com',
  'grammarly.com', 'zotero.org', 'xmind.app', 'xmind.net', 'anytype.io',
  'standardnotes.com', 'joplinapp.org', 'techsmith.com',
  // Claude creates downloadable documents and archives inside the web app. Its artifact/file
  // host is multi-tenant, so it receives only the limited platform rebate below, not full trust.
  'anthropic.com', 'claude.ai', 'claude.com', 'claudeusercontent.com',
  // dev tools / editors / IDEs / terminals / databases
  'sublimetext.com', 'sublimemerge.com', 'gitkraken.com', 'sourcetreeapp.com',
  'atlassian.com', 'fork.dev', 'tortoisegit.org', 'tortoisesvn.net',
  'cursor.com', 'cursor.sh', 'warp.dev', 'iterm2.com', 'hyper.is', 'termius.com',
  'heidisql.com', 'pgadmin.org', 'sqlitebrowser.org', 'tableplus.com',
  'unity.com', 'unity3d.com', 'unrealengine.com', 'godotengine.org',
  'arduino.cc', 'raspberrypi.com', 'raspberrypi.org', 'nmap.org',
  'autohotkey.com', 'chromium.org', 'rclone.org', 'cyberduck.io',
  // remote access / backup
  'nomachine.com', 'realvnc.com', 'duplicati.com',
  // creative / graphics / audio / video production
  'serif.com', 'inkscape.org', 'krita.org', 'darktable.org', 'rawtherapee.com',
  'shotcut.org', 'kdenlive.org', 'openshot.org', 'blackmagicdesign.com',
  'streamlabs.com', 'cockos.com', 'ardour.org', 'musescore.org', 'lmms.io',
  'bandlab.com', 'image-line.com', 'ableton.com', 'native-instruments.com',
  'steinberg.net', 'presonus.com', 'mpc-hc.org', 'figma.com', 'sketch.com',
  'canva.com', 'diagrams.net', 'scribus.net',
  // media players / servers
  'jellyfin.org', 'emby.media', 'getmusicbee.com',
  // emulators (official project sites)
  'retroarch.com', 'libretro.com', 'dolphin-emu.org', 'pcsx2.net', 'ppsspp.org',
  'rpcs3.net', 'mgba.io',
  // utilities / system tools
  'sysinternals.com', 'nirsoft.net', 'ventoy.net', 'cpuid.com', 'hwinfo.com',
  'techpowerup.com', 'crystaldewworld.com', 'jam-software.com',
  'revouninstaller.com', 'binaryfortress.com', 'rainmeter.net',
  'justgetflux.com', 'screentogif.com', 'wagnardsoft.com', 'displaylink.com',
  // password managers / privacy / VPN / extra browsers
  'lastpass.com', 'dashlane.com', 'nordpass.com', 'authy.com', 'cryptomator.org',
  'cyberghostvpn.com', 'duckduckgo.com', 'palemoon.org',
  // gaming / launchers
  'playstation.com', 'xbox.com', 'nintendo.com', 'faceit.com', 'medal.tv',
  'prismlauncher.org', 'lunarclient.com',
  // audio hardware / peripherals / printers / drivers
  'rode.com', 'shure.com', 'sennheiser.com', 'jabra.com', 'system76.com',
  'qualcomm.com', 'anker.com', 'poly.com', 'benq.com', 'viewsonic.com',
  'lg.com', 'sony.com', 'kioxia.com', 'lexmark.com', 'ricoh.com',
  'garmin.com', 'gopro.com', 'dji.com',
  // Provider-controlled domains only. Shared CDNs/user-content hosts (CloudFront,
  // --- security software (a scared user's first download is often one of these) ---
  'malwarebytes.com', 'bitdefender.com', 'avast.com', 'avg.com', 'eset.com',
  'kaspersky.com', 'norton.com', 'nortonlifelock.com', 'mcafee.com', 'trendmicro.com',
  'sophos.com', 'f-secure.com', 'bleepingcomputer.com', 'piriform.com', 'ccleaner.com',
  // --- operating systems and distros (an ISO is otherwise graded on the container alone) ---
  'ubuntu.com', 'canonical.com', 'debian.org', 'fedoraproject.org', 'linuxmint.com',
  'archlinux.org', 'opensuse.org', 'raspberrypi.com', 'raspberrypi.org', 'kernel.org',
  'kali.org', 'tails.net', 'manjaro.org', 'alpinelinux.org', 'rockylinux.org',
  'almalinux.org', 'centos.org', 'nixos.org', 'gentoo.org', 'freebsd.org',
  'openbsd.org', 'netbsd.org', 'elementary.io', 'zorin.com', 'endeavouros.com',
  // --- platforms whose real download host is not the marketing domain ---
  'zoom.us', 'steamstatic.com', 'f-droid.org', 'forgecdn.net', 'curseforge.com',
  // --- browsers ---
  'brave.com', 'opera.com', 'vivaldi.com', 'duckduckgo.com', 'torproject.org',
  // --- communication / conferencing ---
  'slack.com', 'slack-edge.com', 'telegram.org', 'signal.org', 'whatsapp.com', 'skype.com',
  'teamviewer.com', 'anydesk.com', 'webex.com', 'gotomeeting.com',
  // --- media, creative and office ---
  'handbrake.fr', 'gimp.org', 'inkscape.org', 'blender.org', 'krita.org',
  'libreoffice.org', 'openoffice.org', 'onlyoffice.com', 'foxit.com', 'foxitsoftware.com',
  'irfanview.com', 'paint.net', 'getpaint.net', 'shotcut.org', 'kdenlive.org',
  'davinciresolve.com', 'blackmagicdesign.com', 'sketchup.com', 'autodesk.com',
  // --- gaming platforms and studios ---
  'gog.com', 'ea.com', 'ubisoft.com', 'battle.net', 'blizzard.com', 'riotgames.com',
  'minecraft.net', 'mojang.com', 'roblox.com', 'unity.com', 'unrealengine.com',
  // --- hardware, drivers and peripherals ---
  'corsair.com', 'razer.com', 'steelseries.com', 'msi.com', 'gigabyte.com', 'asrock.com',
  'seagate.com', 'westerndigital.com', 'samsung.com', 'brother.com', 'brother-usa.com',
  'realtek.com', 'displaylink.com', 'wacom.com', 'elgato.com', 'sandisk.com',
  'acer.com', 'msi.com', 'razerzone.com', 'synology.com', 'qnap.com', 'ubnt.com', 'ui.com',
  // --- utilities a PC owner is told to install ---
  'winscp.net', 'putty.org', 'filezilla-project.org', 'rufus.ie', 'balena.io',
  'cpuid.com', 'hwinfo.com', 'crystalmark.info', 'voidtools.com', 'sumatrapdfreader.org',
  'qbittorrent.org', 'thunderbird.net', 'protonvpn.com', 'proton.me', 'mullvad.net',
  'nordvpn.com', 'expressvpn.com', 'openvpn.net', 'wireguard.com',
  'logmein.com', 'dropbox.com', 'box.com', 'sync.com', 'pcloud.com',
  // Fastly, Akamai, GitHub Pages/raw content, Azure CDN, jsDelivr, personal cloud
  // drives, etc.) are not trusted as publishers because arbitrary third parties can
  // host there.
]);

// These are exact, vendor-operated delivery hosts on otherwise shared infrastructure.
// Trust must never widen to sibling tenants: awscli.amazonaws.com is the official AWS
// CLI route, while arbitrary-bucket.amazonaws.com remains an ordinary untrusted source.
const EXACT_OFFICIAL_INSTALLER_HOSTS = new Set([
  'dl.discordapp.net',
  'awscli.amazonaws.com',
  'azurecliprod.blob.core.windows.net',
  'epicgames-download1.akamaized.net',
  'setup.rbxcdn.com',
  'gdlp01.c-wss.com',
]);

function isKnownPublisherDomain(host) {
  const h = normalizeDownloadTrustHost(host);
  if (!h) return false;
  if (EXACT_OFFICIAL_INSTALLER_HOSTS.has(h)) return true;
  if (KNOWN_PUBLISHER_DOMAINS.has(h)) return true;
  // match subdomains: dl.google.com -> google.com, update.code.visualstudio.com etc.
  for (const dom of KNOWN_PUBLISHER_DOMAINS) {
    if (h === dom || h.endsWith('.' + dom)) return true;
  }
  return false;
}

// Known publishers that are MULTI-TENANT / user-content hosts: any third party can host
// arbitrary binaries on them (github.com release assets from any repo, sourceforge project
// files from any project). They are reputable platforms, but being on one is NOT a
// publisher endorsement of the specific file -- so they get a softened rebate rather than
// the full silent score-zero, ensuring a disguised/crack-named payload from a random
// repo/project still surfaces for review.
// githubusercontent.com is added alongside github.com because a real release download REDIRECTS
// there -- github.com/../releases/download/.. lands on objects.githubusercontent.com, so the
// softening written for github.com never applied to the host the file actually came from. It is
// single-owner (GitHub/Microsoft), and it goes in BOTH sets: the publisher set to be eligible at
// all, and this set so eligibility is the softened rebate rather than full silence.
// Suffixes where anyone can take a subdomain, so the registrable domain is the platform rather
// than an owner. Trusting the registrable domain here would hand over every tenant on it.
const SHARED_HOSTING_SUFFIXES = new Set([
  'cloudfront.net', 'amazonaws.com', 'windows.net', 'azureedge.net', 'azurewebsites.net',
  'pages.dev', 'workers.dev', 'r2.dev', 'netlify.app', 'vercel.app', 'web.app',
  'firebaseapp.com', 'herokuapp.com', 'github.io', 'gitlab.io', 'b-cdn.net', 'fastly.net',
  'akamaized.net', 'googleusercontent.com', 'dropboxusercontent.com', 'appspot.com',
  'blob.core.windows.net', 'digitaloceanspaces.com', 'backblazeb2.com', 'wasabisys.com',
  'claudeusercontent.com',
]);
// The host a Trust decision should actually be recorded against.
function downloadTrustTarget(host) {
  const h = String(host || '');
  if (!h) return '';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return h;
  const rd = regDomainBg(h);
  if (!rd) return '';
  return SHARED_HOSTING_SUFFIXES.has(rd) ? h : rd;
}

const MULTITENANT_PUBLISHER_HOSTS = new Set([
  'github.com', 'sourceforge.net', 'githubusercontent.com', 'claudeusercontent.com',
]);
function isMultiTenantPublisherHost(host) {
  const h = normalizeDownloadTrustHost(host);
  if (!h) return false;
  if (EXACT_OFFICIAL_INSTALLER_HOSTS.has(h)) return false;
  for (const dom of MULTITENANT_PUBLISHER_HOSTS) {
    if (h === dom || h.endsWith('.' + dom)) return true;
  }
  return false;
}

function trustedDownloadMatch(host, trustedSites) {
  const h = normalizeAllowlistHost(host);
  if (!h) return '';
  const list = Array.isArray(trustedSites) ? trustedSites : [];
  return list.find((site) => {
    const t = normalizeAllowlistHost(site);
    return t && (h === t || h.endsWith('.' + t));
  }) || '';
}

async function getTrustedDownloadSites() {
  const x = await downloadStateGet(DOWNLOAD_TRUSTED_KEY);
  return normalizeAllowlistHosts(x && x[DOWNLOAD_TRUSTED_KEY], 1000);
}

async function addTrustedDownloadSite(host) {
  const clean = normalizeAllowlistHost(host);
  if (!clean) return { ok: false, error: 'No valid site to trust.' };
  const list = await getTrustedDownloadSites();
  if (list.length >= 1000 && !list.includes(clean)) return { ok: false, error: 'Trusted site list is full.' };
  if (!list.some((x) => normalizeAllowlistHost(x) === clean)) list.push(clean);
  list.sort();
  await downloadStateSet({ [DOWNLOAD_TRUSTED_KEY]: list });
  return { ok: true, host: clean, items: list };
}

async function removeTrustedDownloadSite(host) {
  const clean = normalizeAllowlistHost(host);
  const list = (await getTrustedDownloadSites()).filter((x) => normalizeAllowlistHost(x) !== clean);
  await downloadStateSet({ [DOWNLOAD_TRUSTED_KEY]: list });
  return { ok: true, host: clean, items: list };
}

function downloadGradeFromScore(score, critical) {
  if (critical || score >= 10) return DOWNLOAD_GRADE_META.F;
  if (score >= 6) return DOWNLOAD_GRADE_META.E;
  if (score >= 3) return DOWNLOAD_GRADE_META.D;
  if (score >= 2) return DOWNLOAD_GRADE_META.C;
  if (score >= 1) return DOWNLOAD_GRADE_META.B;
  return DOWNLOAD_GRADE_META.A;
}

function shouldReviewDownload(rep) {
  return rep && rep.action === 'review';
}

function downloadRecommendation(grade) {
  if (grade === 'C') return 'Review the source before continuing.';
  if (grade === 'D') return 'WardenOne could not confirm where this came from. Continue if this is the file you meant to download from a site you know.';
  if (grade === 'E') return 'Cancellation is recommended unless you are completely sure this source is legitimate.';
  if (grade === 'F') return 'Cancel this download. Continuing could put this computer at serious risk.';
  return 'No action needed.';
}

function downloadSearch(query) {
  return new Promise((resolve) => {
    try {
      chrome.downloads.search(query || {}, (items) => {
        if (chrome.runtime.lastError) { resolve([]); return; }
        resolve(Array.isArray(items) ? items : []);
      });
    } catch (_) {
      resolve([]);
    }
  });
}

function appendExternalReputation(rep, entry) {
  if (!rep || !entry) return rep;
  rep.externalReputation = Array.isArray(rep.externalReputation) ? rep.externalReputation : [];
  rep.externalReputation.push(entry);
  rep.externalSummary = externalSummary(rep.externalReputation);
  return rep;
}

function downloadNameFromItemish(filenameOrUrl) {
  const raw = String(filenameOrUrl || '');
  const slashName = raw.split(/[\\/]/).pop() || raw;
  try {
    const u = new URL(raw);
    return (u.pathname.split('/').pop() || slashName || '').slice(0, 180);
  } catch (_) {
    return slashName.slice(0, 180);
  }
}

function shouldCheckVirusTotalHash(rep, url, filename) {
  if (!rep || !url || !/^https?:/i.test(url)) return false;
  try {
    const u = new URL(String(url || ''));
    if (isLocalOrPrivateHost(u.hostname)) return false;
  } catch (_) {
    return false;
  }
  if (rep.trustedEligible && !rep.blocklisted) return false;
  const name = downloadNameFromItemish(filename || url);
  const riskyType = DANGEROUS_EXT.test(name) || ARCHIVE_EXT.test(name) || CONTAINER_EXT.test(name) || MACRO_DOC_EXT.test(name) || INSTALLER_HINT.test(name);
  return rep.score >= 1 || rep.action === 'review' || riskyType;
}

function formatBytesShort(n) {
  const size = Number(n || 0);
  if (!size) return '0 B';
  if (size >= 1024 * 1024) return Math.round(size / 1024 / 1024) + ' MB';
  if (size >= 1024) return Math.round(size / 1024) + ' KB';
  return size + ' B';
}

async function fetchBytesForHash(url, maxBytes) {
  let currentUrl = '';
  let requestedUrl = '';
  try {
    const u = new URL(String(url || ''));
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || isLocalOrPrivateHost(u.hostname)) {
      return { ok: false, skipped: true, reason: 'Hash check skipped for local or private-network URL', maxBytes };
    }
    currentUrl = u.href;
    requestedUrl = currentUrl;
  } catch (_) {
    return { ok: false, skipped: true, reason: 'Hash check skipped for invalid URL', maxBytes };
  }
  for (let redirects = 0; redirects <= 4; redirects++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_HASH_TIMEOUT_MS);
    try {
      const res = await fetch(currentUrl, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'manual',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (res && res.status >= 300 && res.status < 400) {
        const location = res.headers && res.headers.get('location');
        let nextUrl = '';
        try {
          const next = new URL(String(location || ''), currentUrl);
          if (next.protocol !== 'http:' && next.protocol !== 'https:') {
            return { ok: false, skipped: true, reason: 'Hash check skipped after non-web redirect', maxBytes };
          }
          if (isLocalOrPrivateHost(next.hostname)) {
            return { ok: false, skipped: true, reason: 'Hash check skipped after local or private-network redirect', maxBytes };
          }
          nextUrl = next.href;
        } catch (_) {
          return { ok: false, skipped: true, reason: 'Hash check skipped after invalid redirect', maxBytes };
        }
        currentUrl = nextUrl;
        continue;
      }
      if (!res.ok) return { ok: false, reason: 'Download could not be re-fetched for hashing (HTTP ' + res.status + ')' };

      const contentType = String((res.headers && res.headers.get('content-type')) || '').slice(0, 120);
      const declared = Number(res.headers.get('content-length') || 0);
      if (declared && declared > maxBytes) {
        try { controller.abort(); } catch (_) {}
        return {
          ok: false,
          skipped: true,
          reason: 'File is larger than the hash-check limit (' + formatBytesShort(maxBytes) + ')',
          bytes: declared,
          maxBytes,
        };
      }

      if (!res.body || !res.body.getReader) {
        if (!declared) {
          return { ok: false, skipped: true, reason: 'File size was unknown and streaming was unavailable', maxBytes };
        }
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength > maxBytes) {
          return {
            ok: false,
            skipped: true,
            reason: 'File is larger than the hash-check limit (' + formatBytesShort(maxBytes) + ')',
            bytes: buffer.byteLength,
            maxBytes,
          };
        }
        return {
          ok: true,
          bytes: new Uint8Array(buffer),
          byteLength: buffer.byteLength,
          requestedUrl,
          finalUrl: currentUrl,
          redirects,
          contentType,
          contentLength: declared || buffer.byteLength,
          source: DOWNLOAD_HASH_SOURCE_KIND,
          exactFile: false,
        };
      }

      const reader = res.body.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        const chunk = part.value || new Uint8Array(0);
        total += chunk.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch (_) {}
          return {
            ok: false,
            skipped: true,
            reason: 'File is larger than the hash-check limit (' + formatBytesShort(maxBytes) + ')',
            bytes: total,
            maxBytes,
          };
        }
        chunks.push(chunk);
      }

      const bytes = new Uint8Array(total);
      let offset = 0;
      chunks.forEach((chunk) => {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      });
      return {
        ok: true,
        bytes,
        byteLength: total,
        requestedUrl,
        finalUrl: currentUrl,
        redirects,
        contentType,
        contentLength: declared || total,
        source: DOWNLOAD_HASH_SOURCE_KIND,
        exactFile: false,
      };
    } catch (e) {
      return { ok: false, reason: 'Download could not be re-fetched for hashing', error: String(e).slice(0, 120) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, skipped: true, reason: 'Hash check skipped after too many redirects', maxBytes };
}

// The `bytes` field on a fetchBytesForHash result is polymorphic by `ok`: a Uint8Array of the data
// when ok is true, a byte COUNT when it is false. Callers are separated by a guard today, so a
// number never actually arrives here -- but one field carrying two types is a defect waiting for the
// next return path, and crypto.subtle.digest's failure mode is an opaque TypeError that the caller
// reports as "Hash computation failed". That reads like a crypto fault rather than "there was
// nothing to hash", which is the wrong thing to tell someone about a download.
//
// An empty buffer is deliberately NOT rejected: a zero-byte file has a real, well-defined SHA-256,
// and refusing to compute it would be wrong. Only a non-BufferSource is refused.
async function sha256Hex(bytes) {
  const isBufferSource = bytes instanceof ArrayBuffer
    || (typeof ArrayBuffer.isView === 'function' && ArrayBuffer.isView(bytes));
  if (!isBufferSource) throw new TypeError('sha256Hex needs an ArrayBuffer or a view, got ' + typeof bytes);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeDownloadHashSourceKind(kind) {
  const value = String(kind || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(DOWNLOAD_HASH_SOURCE_META, value)
    ? value
    : DOWNLOAD_HASH_SOURCE.NOT_AVAILABLE;
}

function downloadHashSourceMeta(fetched, kind, extra) {
  const source = fetched || {};
  const method = normalizeDownloadHashSourceKind(kind || source.source || source.method || DOWNLOAD_HASH_SOURCE.NOT_AVAILABLE);
  const base = DOWNLOAD_HASH_SOURCE_META[method] || DOWNLOAD_HASH_SOURCE_META[DOWNLOAD_HASH_SOURCE.NOT_AVAILABLE];
  return {
    kind: method,
    method,
    label: base.label,
    available: !!base.available,
    exactFile: !!base.exactFile,
    verified: !!base.verified,
    caveat: String((extra && extra.caveat) || source.caveat || base.caveat || '').slice(0, 240),
    reason: String((extra && extra.reason) || source.reason || '').slice(0, 180),
    requestedUrl: String(source.requestedUrl || '').slice(0, 500),
    finalUrl: String(source.finalUrl || '').slice(0, 500),
    redirects: Number(source.redirects || 0),
    contentType: String(source.contentType || '').slice(0, 120),
    contentLength: Number(source.contentLength || source.byteLength || source.bytes || 0),
    maxBytes: DOWNLOAD_HASH_MAX_BYTES,
  };
}

// ---- Local keyless known-malware hash set --------------------------------------
// Default-ON URL-content fingerprint check that needs NO API key: for reviewed web
// downloads, WardenOne re-fetches the download URL, hashes that response, and matches
// it against a bundled/feed-extensible known-malware set. This is useful when the URL
// serves stable public bytes, but it is not a saved-file hash. Signed, authenticated,
// one-time, blob, or personalized downloads can differ from the re-fetched response.
const MALWARE_HASHES = new Set();
function addMalwareHashes(arr) {
  for (const h of (Array.isArray(arr) ? arr : [])) {
    const v = String(h || '').trim().toLowerCase();
    if (/^[a-f0-9]{64}$/.test(v)) MALWARE_HASHES.add(v);
  }
}
async function loadMalwareHashes() {
  // bundled seed (includes the EICAR test hash so the guard is end-to-end verifiable)
  try {
    const res = await fetch(chrome.runtime.getURL('malware-hashes.json'), { cache: 'no-store' });
    if (res && res.ok) {
      const data = await res.json();
      addMalwareHashes(Array.isArray(data) ? data : (data && data.sha256));
    }
  } catch (_) {}
  // runtime/feed-supplied set: a future hash-feed integration just writes this storage key
  try {
    const x = await localGet('wardenone_malware_hashes');
    const stored = x && x.wardenone_malware_hashes;
    addMalwareHashes(Array.isArray(stored) ? stored : (stored && stored.sha256));
  } catch (_) {}
}
loadMalwareHashes();

// Compute (and cache on rep.fileHash) the SHA-256 URL re-fetch fingerprint exactly once,
// so the local and VirusTotal hash checks share one fetch+hash instead of doing it twice.
async function ensureDownloadHash(rep, url) {
  if (rep && rep.fileHash && /^[a-f0-9]{64}$/.test(String(rep.fileHash.sha256 || ''))) {
    const source = rep.fileHash.hashSource || downloadHashSourceMeta(rep.fileHash, rep.fileHash.source || rep.fileHash.sourceKind);
    return {
      ok: true,
      sha256: String(rep.fileHash.sha256).toLowerCase(),
      bytes: rep.fileHash.bytes || 0,
      source,
      exactFile: source.exactFile === true || rep.fileHash.exactFile === true,
    };
  }
  const fetched = await fetchBytesForHash(url, DOWNLOAD_HASH_MAX_BYTES);
  if (!fetched || !fetched.ok) {
    const reason = (fetched && fetched.reason) || 'Hash check could not run';
    return {
      ok: false,
      skipped: !!(fetched && fetched.skipped),
      reason,
      bytes: (fetched && fetched.bytes) || 0,
      source: downloadHashSourceMeta(fetched, DOWNLOAD_HASH_SOURCE.NOT_AVAILABLE, { reason }),
      exactFile: false,
    };
  }
  // ok was true, but that only promises the fetch succeeded -- not that a body came with it. Caught
  // here so it lands on the ordinary download-metadata error path with a reason a person can act on,
  // instead of reaching digest() and surfacing as "Hash computation failed", which reads like a
  // crypto fault in WardenOne rather than a missing response body.
  if (!(fetched.bytes instanceof ArrayBuffer)
    && !(typeof ArrayBuffer.isView === 'function' && ArrayBuffer.isView(fetched.bytes))) {
    const reason = 'Hash check could not run: no file data was returned';
    return {
      ok: false,
      reason,
      bytes: 0,
      source: downloadHashSourceMeta(fetched, DOWNLOAD_HASH_SOURCE.NOT_AVAILABLE, { reason }),
      exactFile: false,
    };
  }
  try {
    const sha256 = await sha256Hex(fetched.bytes);
    const byteLength = fetched.byteLength || (fetched.bytes && fetched.bytes.byteLength) || 0;
    const hashSource = downloadHashSourceMeta(fetched, DOWNLOAD_HASH_SOURCE.URL_REFETCH);
    if (rep) rep.fileHash = {
      sha256,
      bytes: byteLength,
      source: hashSource.kind,
      sourceKind: hashSource.kind,
      exactFile: hashSource.exactFile,
      hashSource,
    };
    return { ok: true, sha256, bytes: byteLength, source: hashSource, exactFile: hashSource.exactFile };
  } catch (e) {
    const reason = 'Hash computation failed';
    return {
      ok: false,
      reason,
      error: String(e).slice(0, 120),
      source: downloadHashSourceMeta(null, DOWNLOAD_HASH_SOURCE.NOT_AVAILABLE, { reason }),
      exactFile: false,
    };
  }
}

// Keyless local known-malware URL-content check. Runs only on already-REVIEWED downloads
// (grade C+), which are already paused, so it adds no bandwidth surprise to normal/clean
// downloads. A hit forces grade F (critical) -> the hard-block path cancels + deletes the file.
async function enrichDownloadWithLocalHash(rep, url, filename, cfg) {
  if (!cfg || cfg.downloadHashCheck === false) return rep;
  if (!shouldReviewDownload(rep)) return rep;
  if (!MALWARE_HASHES.size) return rep;
  if (!shouldCheckVirusTotalHash(rep, url, filename)) return rep;
  const h = await ensureDownloadHash(rep, url);
  if (!h.ok) {
    if (!rep.hashReputation) {
      rep.hashReputation = {
        provider: 'Local malware-hash set',
        checked: false,
        local: true,
        skipped: !!h.skipped,
        reason: h.reason || 'Hash check could not run',
        source: h.source || downloadHashSourceMeta(null, DOWNLOAD_HASH_SOURCE.NOT_AVAILABLE, { reason: h.reason || 'Hash check could not run' }),
        exactFile: false,
        maxBytes: DOWNLOAD_HASH_MAX_BYTES,
      };
    }
    return rep;
  }
  if (MALWARE_HASHES.has(h.sha256)) {
    rep.score += 100;
    rep.blocklisted = true;
    rep.critical = true;
    rep.trustAllowed = false;
    rep.reasons.unshift('URL-content hash matches a known-malware signature (local database)');
    appendExternalReputation(rep, { provider: 'Local malware-hash set', sha256: h.sha256, hit: true, source: h.source || null, exactFile: h.exactFile === true });
    rep.hashReputation = { provider: 'Local malware-hash set', checked: true, ok: true, hit: true, local: true, sha256: h.sha256, source: h.source || null, exactFile: h.exactFile === true };
    return applyDownloadMeta(rep);
  }
  if (!rep.hashReputation) {
    rep.hashReputation = { provider: 'Local malware-hash set', checked: true, ok: true, hit: false, local: true, sha256: h.sha256, source: h.source || null, exactFile: h.exactFile === true };
  }
  return rep;
}

async function checkVirusTotalFileHash(sha256, apiKey) {
  const key = String(apiKey || '').trim();
  const id = String(sha256 || '').trim().toLowerCase();
  if (!key || !/^[a-f0-9]{64}$/.test(id)) return null;
  try {
    const res = await fetchJsonWithTimeout('https://www.virustotal.com/api/v3/files/' + encodeURIComponent(id), {
      method: 'GET',
      headers: { 'x-apikey': key, 'Accept': 'application/json' },
    });
    if (res.status === 404) return { provider: 'VirusTotal file hash', ok: true, hit: false, notFound: true, sha256: id };
    if (!res.ok) return { provider: 'VirusTotal file hash', ok: false, status: res.status, sha256: id };
    const attrs = res.data && res.data.data && res.data.data.attributes;
    const stats = (attrs && attrs.last_analysis_stats) || {};
    const malicious = Number(stats.malicious || 0);
    const suspicious = Number(stats.suspicious || 0);
    return {
      provider: 'VirusTotal file hash',
      ok: true,
      hit: malicious > 0 || suspicious > 0,
      sha256: String((attrs && attrs.sha256) || id),
      stats: {
        malicious,
        suspicious,
        harmless: Number(stats.harmless || 0),
        undetected: Number(stats.undetected || 0),
      },
      reputation: Number((attrs && attrs.reputation) || 0),
      meaningfulName: String((attrs && attrs.meaningful_name) || '').slice(0, 120),
      typeDescription: String((attrs && attrs.type_description) || '').slice(0, 80),
      lastAnalysisDate: Number((attrs && attrs.last_analysis_date) || 0),
      timesSubmitted: Number((attrs && attrs.times_submitted) || 0),
    };
  } catch (e) {
    return { provider: 'VirusTotal file hash', ok: false, error: String(e).slice(0, 120), sha256: id };
  }
}

async function enrichDownloadWithVirusTotalHash(rep, url, filename, cfg) {
  const key = String((cfg && cfg.downloadVirusTotalKey) || '').trim();
  if (!cfg || cfg.downloadVirusTotalHash !== true || !key) return rep;
  if (!shouldCheckVirusTotalHash(rep, url, filename)) return rep;

  // Shares the single re-fetch+hash with the local malware-hash check (ensureDownloadHash
  // returns the already-computed rep.fileHash if the local check ran first).
  const h = await ensureDownloadHash(rep, url);
  if (!h.ok) {
    rep.hashReputation = {
      provider: 'VirusTotal file hash',
      checked: false,
      skipped: !!h.skipped,
      reason: h.reason || 'Hash check could not run',
      source: h.source || downloadHashSourceMeta(null, DOWNLOAD_HASH_SOURCE.NOT_AVAILABLE, { reason: h.reason || 'Hash check could not run' }),
      exactFile: false,
      bytes: h.bytes || 0,
      maxBytes: DOWNLOAD_HASH_MAX_BYTES,
    };
    return rep;
  }

  try {
    const sha256 = h.sha256;
    const vt = await checkVirusTotalFileHash(sha256, key);
    if (!vt) return rep;

    rep.hashReputation = {
      provider: 'VirusTotal file hash',
      checked: true,
      ok: !!vt.ok,
      hit: !!vt.hit,
      notFound: !!vt.notFound,
      sha256,
      source: h.source || null,
      exactFile: h.exactFile === true,
      stats: vt.stats || null,
      reputation: vt.reputation || 0,
      meaningfulName: vt.meaningfulName || '',
      typeDescription: vt.typeDescription || '',
      lastAnalysisDate: vt.lastAnalysisDate || 0,
      timesSubmitted: vt.timesSubmitted || 0,
      status: vt.status || 0,
      error: vt.error || '',
    };

    if (!vt.ok || !vt.hit) return rep;

    const stats = vt.stats || {};
    const malicious = Number(stats.malicious || 0);
    const suspicious = Number(stats.suspicious || 0);
    rep.trustAllowed = false;
    appendExternalReputation(rep, {
      provider: 'VirusTotal file hash',
      sha256,
      source: h.source || null,
      exactFile: h.exactFile === true,
      stats: vt.stats,
      reputation: vt.reputation,
      meaningfulName: vt.meaningfulName || '',
      typeDescription: vt.typeDescription || '',
    });

    if (malicious >= 3) {
      rep.score += 100;
      rep.blocklisted = true;
      rep.reasons.unshift('VirusTotal URL-content hash is known malicious (' + malicious + ' detections)');
    } else if (malicious >= 1 || suspicious >= 2) {
      rep.score += 10;
      rep.reasons.unshift('VirusTotal URL-content hash has ' + malicious + ' malicious / ' + suspicious + ' suspicious detections');
    } else if (suspicious === 1) {
      rep.score += 3;
      rep.reasons.unshift('VirusTotal URL-content hash has one suspicious detection');
    }

    return applyDownloadMeta(rep);
  } catch (e) {
    rep.hashReputation = {
      provider: 'VirusTotal file hash',
      checked: false,
      reason: 'Hash check could not run',
      source: downloadHashSourceMeta(null, DOWNLOAD_HASH_SOURCE.NOT_AVAILABLE, { reason: 'Hash check could not run' }),
      exactFile: false,
      error: String(e).slice(0, 120),
      maxBytes: DOWNLOAD_HASH_MAX_BYTES,
    };
    return rep;
  }
}

// Every mutation of the pending and handled stores runs one at a time (M25).
//
// Both are whole-object read/modify/writes: read the store, add or drop one entry, write the whole
// thing back. Two legitimate scans running at once both read the same starting state, each writes
// its own version, and the second one wins -- so one of the two records is simply gone from
// storage while both are still in the heap. The heap goes at the next suspension, and what is left
// is a paused download whose review panel the recovery scan then closes, or a handled record with
// no pending record to recreate it from. Nothing is corrupted; what is lost is ownership of a file
// WardenOne paused, which is the thing that has to be recoverable.
//
// The queue is the one M18 put under the state appliers -- same defect shape, same fix. The typeof
// guard keeps this file drivable on its own, where background.js is not loaded.
function withDownloadStore(name, task) {
  return typeof serializeSubsystem === 'function' ? serializeSubsystem(name, task) : task();
}

async function rememberPendingDownload(review) {
  PENDING_DOWNLOADS[review.id] = review;
  return withDownloadStore(DOWNLOAD_PENDING_KEY, async () => {
    const x = await downloadStateGet(DOWNLOAD_PENDING_KEY);
    const store = (x && x[DOWNLOAD_PENDING_KEY] && typeof x[DOWNLOAD_PENDING_KEY] === 'object') ? x[DOWNLOAD_PENDING_KEY] : {};
    store[review.id] = review;
    const entries = Object.entries(store).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
    while (entries.length > 25) {
      const old = entries.pop();
      if (old) delete store[old[0]];
    }
    await downloadStateSet({ [DOWNLOAD_PENDING_KEY]: store });
  });
}

async function getPendingDownload(id) {
  const key = String(id || '');
  if (PENDING_DOWNLOADS[key]) return PENDING_DOWNLOADS[key];
  const x = await downloadStateGet(DOWNLOAD_PENDING_KEY);
  const store = (x && x[DOWNLOAD_PENDING_KEY]) || {};
  if (store[key]) PENDING_DOWNLOADS[key] = store[key];
  return store[key] || null;
}

async function removePendingDownload(id) {
  const key = String(id || '');
  delete PENDING_DOWNLOADS[key];
  return withDownloadStore(DOWNLOAD_PENDING_KEY, async () => {
    const x = await downloadStateGet(DOWNLOAD_PENDING_KEY);
    const store = (x && x[DOWNLOAD_PENDING_KEY] && typeof x[DOWNLOAD_PENDING_KEY] === 'object') ? x[DOWNLOAD_PENDING_KEY] : {};
    delete store[key];
    await downloadStateSet({ [DOWNLOAD_PENDING_KEY]: store });
  });
}

// The read half, unqueued on purpose: callers that already hold the lane use this one, because a
// task that waited on its own lane would wait forever.
async function readHandledDownloads() {
  const x = await downloadStateGet(DOWNLOAD_HANDLED_KEY);
  const store = (x && x[DOWNLOAD_HANDLED_KEY] && typeof x[DOWNLOAD_HANDLED_KEY] === 'object') ? x[DOWNLOAD_HANDLED_KEY] : {};
  const now = Date.now();
  let changed = false;
  Object.keys(store).forEach((id) => {
    if (!store[id] || !store[id].at || (now - store[id].at) > DOWNLOAD_HANDLED_TTL_MS) {
      delete store[id];
      changed = true;
    }
  });
  return { store, changed };
}

async function getHandledDownloads() {
  return withDownloadStore(DOWNLOAD_HANDLED_KEY, async () => {
    const { store, changed } = await readHandledDownloads();
    if (changed) await downloadStateSet({ [DOWNLOAD_HANDLED_KEY]: store });
    return store;
  });
}

async function isDownloadHandled(id) {
  const key = String(id || '');
  if (!key) return true;
  const store = await getHandledDownloads();
  return !!store[key];
}

async function rememberHandledDownload(id, decision) {
  const key = String(id || '');
  if (!key) return;
  return withDownloadStore(DOWNLOAD_HANDLED_KEY, async () => {
    const { store } = await readHandledDownloads();
    store[key] = { at: Date.now(), decision: String(decision || 'handled').slice(0, 40) };
    const entries = Object.entries(store).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
    while (entries.length > 250) {
      const old = entries.pop();
      if (old) delete store[old[0]];
    }
    await downloadStateSet({ [DOWNLOAD_HANDLED_KEY]: store });
  });
}

function reviewUrlForId(id) {
  return chrome.runtime.getURL('download-review.html?id=' + encodeURIComponent(String(id || '')));
}

function reviewIdFromUrl(url) {
  try {
    const u = new URL(url || '');
    if (!/\/download-review\.html$/i.test(u.pathname)) return '';
    return u.searchParams.get('id') || '';
  } catch (_) {
    return '';
  }
}

async function findDownloadReviewTabs(id) {
  const wanted = String(id || '');
  const tabs = await tabsQuery({});
  return tabs.filter((tab) => {
    const rid = reviewIdFromUrl(tab.url || tab.pendingUrl || '');
    return rid && (!wanted || rid === wanted);
  });
}

async function closeDownloadReviewTabs(id) {
  const tabs = await findDownloadReviewTabs(id);
  const ids = tabs.map((tab) => tab.id).filter((tabId) => tabId != null);
  if (ids.length) await tabsRemove(ids);
}

async function cleanupDownloadReviews(closeTabs) {
  try {
    // The scan reads the store, decides what is stale, and writes the survivors back -- with
    // awaits on downloads.search in between, which is a long time for a concurrent add to be lost
    // in. Queued with the adds and removes so it cannot drop a review created while it was looking.
    const { store, activeIds } = await withDownloadStore(DOWNLOAD_PENDING_KEY, async () => {
      const x = await downloadStateGet(DOWNLOAD_PENDING_KEY);
      const store = (x && x[DOWNLOAD_PENDING_KEY] && typeof x[DOWNLOAD_PENDING_KEY] === 'object') ? x[DOWNLOAD_PENDING_KEY] : {};
      const now = Date.now();
      const activeIds = new Set();
      let changed = false;

      for (const id of Object.keys(store)) {
        const review = store[id] || {};
        let stale = !review.createdAt || (now - review.createdAt) > DOWNLOAD_REVIEW_TTL_MS;
        if (!stale && review.downloadId != null) {
          const items = await downloadSearch({ id: Number(review.downloadId) });
          const item = items && items[0];
          if (!item || item.state === 'complete' || item.state === 'interrupted') stale = true;
        }
        if (stale) {
          delete store[id];
          delete PENDING_DOWNLOADS[id];
          changed = true;
        } else {
          PENDING_DOWNLOADS[id] = review;
          activeIds.add(String(id));
        }
      }

      if (changed) await downloadStateSet({ [DOWNLOAD_PENDING_KEY]: store });
      return { store, activeIds };
    });
    void store;
    await getHandledDownloads();

    if (closeTabs) {
      const tabs = await findDownloadReviewTabs('');
      const staleTabIds = tabs
        .filter((tab) => !activeIds.has(reviewIdFromUrl(tab.url || tab.pendingUrl || '')))
        .map((tab) => tab.id)
        .filter((tabId) => tabId != null);
      if (staleTabIds.length) await tabsRemove(staleTabIds);
    }
  } catch (_) {}
}

// On a NEW browser session, clear out any pending reviews left over from before so
// restored downloads don't re-pop. We mark each leftover download "handled" (so a
// restart-triggered re-scan won't surface it again) and wipe the pending store +
// any panel still showing. The download itself stays paused in Chrome for the user
// to resume/cancel -- we never silently continue a risky download.
async function quiesceDownloadReviewsForNewSession() {
  try {
    const x = await downloadStateGet(DOWNLOAD_PENDING_KEY);
    const store = (x && x[DOWNLOAD_PENDING_KEY] && typeof x[DOWNLOAD_PENDING_KEY] === 'object') ? x[DOWNLOAD_PENDING_KEY] : {};
    for (const id of Object.keys(store)) {
      const review = store[id] || {};
      await rememberHandledDownload(review.downloadId != null ? review.downloadId : id, 'previous-session');
    }
    for (const k of Object.keys(PENDING_DOWNLOADS)) delete PENDING_DOWNLOADS[k];
    await downloadStateSet({ [DOWNLOAD_PENDING_KEY]: {} });
    await dismissDownloadReviewPanels();
  } catch (_) {}
}

function downloadApiCall(method, id) {
  return new Promise((resolve) => {
    try {
      chrome.downloads[method](Number(id), () => {
        const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
        resolve({ ok: !err, error: err || '' });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

// chrome.downloads.erase takes a QUERY object ({id}), not a bare id, so it can't go
// through downloadApiCall (which passes Number(id)).
function downloadErase(id) {
  return new Promise((resolve) => {
    try {
      chrome.downloads.erase({ id: Number(id) }, () => {
        const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
        resolve({ ok: !err, error: err || '' });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

// Hard-remove a download from the machine. chrome.downloads.cancel only stops an in-flight
// transfer and is a NO-OP once the file has finished writing -- so a small/cached payload
// that completed before our scan could pause it would survive a plain "cancel". This does
// the full job: cancel the transfer if still running, delete any bytes already on disk
// (removeFile), and erase the chrome://downloads entry so it can't be resumed/reopened.
// Each step is independent and best-effort; an expected "already complete"/"already
// removed" error on one step does not stop the others.
async function hardRemoveDownload(id) {
  const out = { cancelled: false, removedFile: false, erased: false };
  try { const c = await downloadApiCall('cancel', id); out.cancelled = !!(c && c.ok); } catch (_) {}
  try { const r = await downloadApiCall('removeFile', id); out.removedFile = !!(r && r.ok); } catch (_) {}
  try { const e = await downloadErase(id); out.erased = !!(e && e.ok); } catch (_) {}
  return out;
}

async function openDownloadReview(review) {
  // Keep download details inside extension-owned UI. The web page never receives
  // the review payload, so it cannot read, hide, or tamper with the warning.
  try { await rememberPendingDownload(review); } catch (_) {}
  const url = reviewUrlForId(review && review.id);

  // Focus an existing review page for this download instead of opening duplicates.
  try {
    const tabs = await findDownloadReviewTabs(review && review.id);
    const tab = tabs && tabs[0];
    if (tab && tab.id != null) {
      if (tab.windowId != null) await windowsUpdate(tab.windowId, { focused: true });
      await tabsUpdate(tab.id, { active: true });
      try {
        chrome.runtime.sendMessage({ kind: 'download-review-updated', id: review.id, review }, () => {
          void chrome.runtime.lastError;
        });
      } catch (_) {}
      return { ok: true, reviewPage: true, existing: true };
    }
  } catch (_) {}

  try {
    const win = await windowsCreate({
      url,
      type: 'popup',
      width: 520,
      height: 720,
      focused: true,
    });
    if (win && win.ok) return { ok: true, reviewPage: true, window: true };
  } catch (_) {}

  try {
    const tab = await tabsCreate({ url, active: true });
    if (tab && tab.ok) return { ok: true, reviewPage: true, tab: true };
  } catch (_) {}

  // Last resort: a system notification so the user still knows Chrome could not
  // open the extension review surface. The pending review remains available.
  const canNotify = await extensionUiAllowed();
  if (canNotify) {
    try {
      chrome.notifications.create('wo-dl-' + review.id, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Download Shield: ' + (review.status || ('Grade ' + review.grade)),
        message: (review.file || 'A download') + '\n' + (review.recommendation || 'Review this download.'),
        priority: 2,
      });
    } catch (_) {}
  }
  return { ok: true, notification: canNotify, silent: !canNotify };
}

// Close extension-owned review UI. Omit id to close every pending review page.
async function dismissDownloadReviewPanels(id) {
  try {
    await closeDownloadReviewTabs(id || '');
  } catch (_) {}
}

function buildDownloadReview(item, rep, pauseResult) {
  const name = (item.filename || item.url || '').split(/[\\/]/).pop() || '(unknown file)';
  return {
    id: String(item.id),
    downloadId: item.id,
    file: name.slice(0, 120),
    url: item.finalUrl || item.url || '',
    source: rep.source,
    mime: item.mime || '',
    grade: rep.grade,
    status: rep.status,
    color: rep.color,
    score: rep.score,
    reasons: rep.reasons.slice(0, 8),
    recommendation: downloadRecommendation(rep.grade),
    trusted: !!rep.trusted,
    trustedEligible: !!rep.trustedEligible,
    trustAllowed: !!rep.trustAllowed,
    trustHost: rep.trustHost || '',
    chromeDanger: rep.chromeDanger || '',
    domainAge: rep.domainAge || null,
    redirectChain: rep.redirectChain || null,
    externalReputation: rep.externalReputation || [],
    fileHash: rep.fileHash || null,
    hashReputation: rep.hashReputation || null,
    paused: !!(pauseResult && pauseResult.ok),
    pauseError: pauseResult && pauseResult.error ? pauseResult.error : '',
    createdAt: Date.now(),
  };
}

function logDownloadCheck(item, rep) {
  queueHistory({
    type: 'download_reputation',
    detail: {
      grade: rep.grade,
      status: rep.status,
      score: rep.score,
      source: rep.source,
      file: ((item.filename || '').split(/[\\/]/).pop() || '').slice(0, 80),
      reasons: rep.reasons.slice(0, 4),
      trusted: !!rep.trusted,
      chromeDanger: rep.chromeDanger || '',
      domainAge: rep.domainAge || null,
      redirectChain: rep.redirectChain || null,
      externalReputation: rep.externalReputation || [],
      fileHash: rep.fileHash || null,
      hashReputation: rep.hashReputation || null,
    },
    url: item.finalUrl || item.url || rep.source,
    at: Date.now(),
  });
}

function logDownloadDecision(review, decision) {
  queueHistory({
    type: 'download_guard',
    detail: {
      grade: review.grade,
      status: review.status,
      decision,
      source: review.source,
      file: review.file,
      reasons: (review.reasons || []).slice(0, 4),
      trusted: !!review.trusted,
      chromeDanger: review.chromeDanger || '',
      domainAge: review.domainAge || null,
      redirectChain: review.redirectChain || null,
      externalReputation: review.externalReputation || [],
      fileHash: review.fileHash || null,
      hashReputation: review.hashReputation || null,
    },
    url: review.url || review.source,
    at: Date.now(),
  });
}

async function handleDownloadDecision(id, decision, sender) {
  const review = await getPendingDownload(id);
  if (!review) return { ok: false, error: 'This download review is no longer available.' };
  if (messageSenderIsTab(sender)) {
    return { ok: false, error: 'Download review decisions must come from the WardenOne review window.' };
  }
  const grade = String(review.grade || '').toUpperCase();
  if (decision === 'continue' || decision === 'keep' || decision === 'trust-continue') {
    if (grade === 'F') {
      return { ok: false, error: 'Critical downloads are blocked by Download Shield and cannot be continued.' };
    }
    let trustedHost = '';
    if (decision === 'trust-continue') {
      if (grade !== 'C') {
        return { ok: false, error: 'Only lower-risk review downloads can be trusted and continued.' };
      }
      if (!review.trustAllowed || !review.trustHost) {
        return { ok: false, error: 'This source is not eligible for trusted continuation.' };
      }
      const trust = await addTrustedDownloadSite(review.trustHost || review.source);
      if (!trust.ok) return trust;
      trustedHost = trust.host;
      review.trusted = true;
    }
    if (review.paused) {
      const res = await downloadApiCall('resume', review.downloadId);
      if (!res.ok) return { ok: false, error: res.error || 'Chrome could not resume this download.' };
    }
    logDownloadDecision(review, decision === 'trust-continue' ? 'trusted and continued' : 'continued');
    await removePendingDownload(id);
    await rememberHandledDownload(review.downloadId || id, decision === 'trust-continue' ? 'trusted and continued' : 'continued');
    dismissDownloadReviewPanels(id);
    return { ok: true, decision: decision === 'trust-continue' ? 'trusted and continued' : 'continued', trustedHost };
  }
  if (decision === 'cancel') {
    // Hard-remove instead of a bare cancel: chrome.downloads.cancel does nothing to a file
    // that already finished writing (the small/cached-file race), so "Cancel" used to leave
    // a flagged payload sitting on disk. hardRemoveDownload also deletes the bytes and
    // erases the entry. We treat this as success even if an individual step reports an
    // expected "already complete/removed" error -- the goal (file gone) is best-effort.
    const removed = await hardRemoveDownload(review.downloadId);
    logDownloadDecision(review, 'cancelled');
    await removePendingDownload(id);
    await rememberHandledDownload(review.downloadId || id, 'cancelled');
    dismissDownloadReviewPanels(id);
    return { ok: true, decision: 'cancelled', removed };
  }
  return { ok: false, error: 'Unknown decision.' };
}

// All download-risk weights in one tunable table. Positive = more suspicious; the two
// *Rebate values are SUBTRACTED. Centralised so the weights can be eyeballed and tuned in
// one place instead of hunting through the scoring prose in scoreDownload(). Proven
// behaviour-equivalent to the previous inline literals by a golden old-vs-new test.
const DL_WEIGHT = {
  // chromePending is 0 on purpose. "Chrome has not finished its scan yet" is not a fact about the
  // file, and at 1 point it combined with any other single 1-point signal to cross the review line
  // -- opening a panel built on information that was still arriving. The reason line is kept, so it
  // still shows up whenever the file is being reviewed for some real cause.
  chromeKnownBad: 100, chromeReviewFile: 3, chromeReviewOther: 2, chromeReviewWeak: 1, chromePending: 0,
  blocklist: 100, executable: 3, macroDoc: 3, container: 3,
  executableInstaller: 3, archiveInstaller: 5, archive: 1,
  noExtension: 2, noExtensionBinary: 2, uncommonType: 1,
  httpInsecure: 1, unknownDomain: 1, blobRiskyFile: 2, unusualProtocol: 1,
  redirectParam: 2, obfuscatedPath: 1, lureWording: 2,
  redirectChain: 2, redirectManyDomains: 2, redirectFlaggedHop: 6, redirectBlocklistedHop: 100,
  doubleExtension: 5, hiddenChars: 5, paddingTrick: 3, versionedReleaseRebate: 1,
  mimeDisagree: 2, mimeProgramNamedDoc: 3, multipleTricks: 5,
  ipHostInstaller: 2, rawIpExecutable: 2, rawIpInsecure: 1,
  punycodeHost: 2, confusableTld: 4, throwawayTld: 2, trustedSiteRebate: 3,
  passwordArchive: 2,
};

function normalizeDownloadRedirectRisk(info) {
  if (!info || typeof info !== 'object') return null;
  const hops = Math.max(0, Number(info.hops || 0));
  const domains = Math.max(0, Number(info.domains || 0));
  if (!hops && !domains && !info.flagged && !info.blocklisted) return null;
  const matchedOn = String(info.matchedOn || '').slice(0, 40);
  const weakHostOnlyMatch = matchedOn === 'recent-host';
  return {
    hops,
    domains,
    flagged: !!info.flagged && !weakHostOnlyMatch,
    blocklisted: !!info.blocklisted && !weakHostOnlyMatch,
    abuseTld: !!info.abuseTld && !weakHostOnlyMatch,
    maxed: !!info.maxed && !weakHostOnlyMatch,
    matchedOn,
    chain: Array.isArray(info.chain) ? info.chain.slice(0, 12) : [],
    finalHost: String(info.finalHost || '').slice(0, 120),
  };
}

function downloadRedirectContext(finalUrl, referrer, item) {
  try {
    if (typeof recentRedirectChainForDownload === 'function') {
      return recentRedirectChainForDownload(finalUrl, referrer || (item && item.referrer) || '', item || null);
    }
  } catch (_) {}
  return null;
}

// Returns { grade, status, color, action, source, reasons[], score }
function scoreDownload(finalUrl, referrer, filename, mime, trustedSites, chromeDanger, redirectChain) {
  const W = DL_WEIGHT;
  const reasons = [];
  let host = '';
  // A blob: URL carries its origin inside itself -- blob:https://vault.bitwarden.com/<uuid>. Parsed
  // naively the hostname comes out empty, so every in-page export (a password vault backup, a
  // spreadsheet a web app generated) was charged unknownDomain, shown as "(unknown)" in the review
  // panel, and could never match the publisher list or the user's own trusted sites.
  try {
    const raw = finalUrl || referrer || '';
    host = new URL(/^blob:https?:/i.test(raw) ? raw.slice(5) : raw).hostname;
  } catch (_) {}
  const rd = regDomainBg(host);
  const name = (filename || '').split(/[\\/]/).pop() || '';
  const isDangerous = DANGEROUS_EXT.test(name);
  const isArchive = ARCHIVE_EXT.test(name);
  const isContainer = CONTAINER_EXT.test(name);
  const isMacro = MACRO_DOC_EXT.test(name);
  const onBlocklist = rd && (BLOCKED_DOMAINS.has(rd) || BLOCKED_DOMAINS.has(host));
  const httpInsecure = /^http:\/\//i.test(finalUrl || '');
  // 192.168.x, 10.x, localhost, an intranet name: these are the office file server and the NAS in
  // the spare room, not a drive-by drop. They were being charged the full public raw-IP family --
  // insecure-http, raw-IP-installer, raw-IP-executable -- which put an ordinary intranet installer
  // at grade E, the one tier with NO Continue button. nameTrick is excluded deliberately: a
  // disguised Invoice.pdf.exe on the LAN keeps every point it earned and stays critical.
  const privateHost = !!(host && isLocalOrPrivateHost(host));
  let lanNoise = 0;
  const installerName = INSTALLER_HINT.test(name);
  const lureName = LURE_HINT.test(name);
  const trustMatch = trustedDownloadMatch(host, trustedSites);
  const danger = String(chromeDanger || '').toLowerCase();
  const chromeKnownBad = CHROME_DANGER_STRONG.has(danger);
  const chromeReview = CHROME_DANGER_MEDIUM.has(danger);
  const chromePending = CHROME_DANGER_PENDING.has(danger);
  const finalUrlText = String(finalUrl || '');
  let urlPathQuery = finalUrlText;
  try {
    const u = new URL(finalUrlText);
    urlPathQuery = (u.pathname || '') + ' ' + (u.search || '') + ' ' + (u.hash || '');
  } catch (_) {}

  let score = 0;
  if (chromeKnownBad) {
    score += W.chromeKnownBad;
    if (danger === 'url') reasons.unshift('Chrome says this download URL is known malicious');
    else if (danger === 'content') reasons.unshift('Chrome says this file is known malicious');
    else if (danger === 'host') reasons.unshift('Chrome says this host distributes malicious binaries');
    else if (danger === 'unwanted') reasons.unshift('Chrome says this download is potentially unwanted or unsafe');
    else reasons.unshift('Chrome flagged this download as dangerous');
  } else if (chromeReview) {
    score += danger === 'file' ? W.chromeReviewFile
      : (CHROME_DANGER_WEAK.has(danger) ? W.chromeReviewWeak : W.chromeReviewOther);
    if (danger === 'file') reasons.push('Chrome says the filename is suspicious');
    else if (danger === 'uncommon') reasons.push('Chrome says this download is uncommon');
    else if (danger === 'passwordprotected') reasons.push('Chrome says this file is password-protected');
    else if (danger === 'blockedtoolarge') reasons.push('Chrome says the file was too large for full scanning');
    else if (danger === 'sensitivecontentwarning') reasons.push('Chrome raised a sensitive-content warning');
    else reasons.push('Chrome could not fully complete its download safety scan');
  } else if (chromePending) {
    score += W.chromePending;
    reasons.push('Chrome safety scanning is still pending');
  }
  if (onBlocklist) { score += W.blocklist; reasons.push('Source is on a known malware/phishing blocklist'); }
  if (isDangerous) { score += W.executable; reasons.push('This is a program, not a document'); }
  if (isMacro) { score += W.macroDoc; reasons.push('Office file that can contain macros'); }
  if (isContainer) { score += W.container; reasons.push('Disk-image file (often used to smuggle malware past scanners)'); }
  if (isDangerous && lureName) { score += W.executableInstaller; reasons.push('Name suggests a crack, keygen or pirated installer'); }
  if (isArchive && lureName) { score += W.archiveInstaller; reasons.push('Archive named like a crack or keygen'); }
  if (isArchive) { score += W.archive; reasons.push('Archive (contents not visible until opened)'); }
  // A password-protected archive cannot be content-scanned by Chrome OR by our hash check --
  // encryption is a deliberate way to smuggle malware past every scanner. Elevate it so an
  // encrypted archive (which would otherwise sit near grade C from Chrome's flag alone) is
  // clearly surfaced for review rather than waved through.
  if ((isArchive || isContainer) && danger === 'passwordprotected') {
    score += W.passwordArchive; reasons.push('Password-protected archive cannot be scanned for malware');
  }

  // No / unknown file extension. Browsers normally hand a download a sensible
  // extension; a file that arrives with NO extension (e.g. "installer", "hidbusf")
  // is a classic way to slip a renamed executable past extension-based checks, so it
  // should at least get a look. "No extension + binary content type" is a stronger
  // disguise signal and is scored higher. Recognized safe document/media types stay
  // silent so this doesn't get noisy.
  const KNOWN_SAFE_EXT = /\.(pdf|docx?|xlsx?|pptx?|txt|rtf|csv|tsv|json|xml|ya?ml|html?|md|jpe?g|png|gif|webp|svg|bmp|tiff?|ico|heic|mp3|wav|flac|ogg|m4a|aac|mp4|mkv|mov|webm|avi|wmv|m4v|epub|mobi|ttf|otf|woff2?|odt|ods|odp)$/i;
  const hasExt = /\.[a-z0-9]{1,8}$/i.test(name);
  const knownType = isDangerous || isArchive || isContainer || isMacro || KNOWN_SAFE_EXT.test(name);
  // octet-stream removed for the same reason as the named-document test further down: it means
  // "unspecified binary", which dumb CDNs and share hosts send for everything they do not
  // recognise. It is not an assertion that the file is a program.
  const binaryMime = /(x-msdownload|x-msdos-program|x-executable|x-mach-binary|x-elf)/i.test(String(mime || ''));
  if (name && !hasExt) {
    score += W.noExtension; reasons.push('File has no extension (can hide what it really is)');
    if (binaryMime) { score += W.noExtensionBinary; reasons.push('No extension but served as a program/binary'); }
  } else if (name && !knownType) {
    score += W.uncommonType; reasons.push('Uncommon file type — confirm you trust the source');
  }

  if (httpInsecure) {
    score += W.httpInsecure; reasons.push('Downloaded over insecure HTTP');
    if (privateHost) lanNoise += W.httpInsecure;
  }
  if (!rd) { score += W.unknownDomain; reasons.push('Source domain could not be determined'); }
  if (/blob:/i.test(finalUrlText) && (isDangerous || isArchive || isContainer || isMacro)) {
    score += W.blobRiskyFile; reasons.push('Download uses a browser-generated blob URL that hides the original source');
  } else if (finalUrlText && !/^https?:/i.test(finalUrlText) && (isDangerous || isArchive || isContainer || isMacro)) {
    score += W.unusualProtocol; reasons.push('Download URL protocol is unusual for a risky file');
  }

  // Only when the embedded URL points somewhere ELSE. A vendor gateway that bounces you to its own
  // CDN, or SourceForge handing off to its own mirror, is the normal shape of a download link --
  // and the old test also missed the plain unencoded form entirely, so a genuinely foreign
  // redirect went unnoticed while the harmless same-site one was charged. `u` is dropped: it is a
  // common tracking parameter. Anything that will not parse fails closed and still scores.
  const embedded = /(^|[?&])(url|redirect|redir|target|dest|destination|next|download_url)=(https?%3a[^&#]*|https?:\/\/[^&#]*)/i.exec(finalUrlText);
  let embeddedForeign = false;
  if (embedded) {
    try {
      const inner = regDomainBg(new URL(decodeURIComponent(embedded[3])).hostname);
      embeddedForeign = !inner || inner !== rd;
    } catch (_) { embeddedForeign = true; }
  }
  if (embeddedForeign) {
    score += W.redirectParam; reasons.push('Download URL hides another URL inside a redirect parameter');
  }
  const redirectRisk = normalizeDownloadRedirectRisk(redirectChain);
  let redirectCritical = false;
  let redirectTrustBreaker = false;
  if (redirectRisk) {
    if (redirectRisk.blocklisted) {
      score += W.redirectBlocklistedHop;
      redirectCritical = true;
      redirectTrustBreaker = true;
      reasons.unshift('Redirect chain passed through a known malware/phishing blocklist domain');
    } else if (redirectRisk.flagged) {
      score += W.redirectFlaggedHop;
      redirectTrustBreaker = true;
      reasons.push('Redirect chain included a risky hop before the download');
    }
    if (redirectRisk.maxed) {
      score += W.redirectFlaggedHop;
      redirectTrustBreaker = true;
      reasons.push('Redirect chain exceeded the safe hop limit before the download');
    } else if (redirectRisk.hops >= 4) {
      score += W.redirectChain;
      redirectTrustBreaker = true;
      reasons.push('Download followed a multi-hop redirect chain');
    }
    if (redirectRisk.domains >= 4) {
      score += W.redirectManyDomains;
      redirectTrustBreaker = true;
      reasons.push('Redirect chain crossed several unrelated domains');
    }
    if (redirectRisk.abuseTld && !redirectRisk.blocklisted) {
      redirectTrustBreaker = true;
      reasons.push('Redirect chain touched an abuse-prone domain before the download');
    }
  }
  // A bare ../ inside a parameter VALUE is ordinary (?path=../releases/App.exe), and by the time a
  // URL reaches here the browser has already normalised real traversal out of the path. What is
  // still worth flagging is a null byte or a double-encoded traversal, which only appear on purpose.
  if (/%00|%25(2e|32)|(^|[/?&=])\.\.(%2f|%5c)/i.test(urlPathQuery)) {
    score += W.obfuscatedPath; reasons.push('Download URL contains obfuscated path characters');
  }
  // Same non-letter boundary as LURE_HINT, and for the same reason: unanchored, `crack` matched the
  // URL of firecracker.exe and nutcracker-setup.exe. This is the second copy of that pattern -- the
  // filename test is not the only place it lives, so fixing one and not the other left the grade
  // unchanged and the reason line reading "scam or piracy lure wording" over an ordinary download.
  if ((isDangerous || isArchive || isContainer || isMacro) && /(^|[^a-z])(crack|keygen|activator|nulled|warez|free[-_%20 ]?nitro|steam[-_%20 ]?gift|wallet[-_%20 ]?(verify|update)|airdrop|claim[-_%20 ]?reward)/i.test(urlPathQuery + ' ' + host)) {
    score += W.lureWording; reasons.push('Download URL uses scam or piracy lure wording');
  }

  // double-extension disguise: invoice.pdf.exe, photo.jpg.scr -- a classic trick to
  // make an executable look like a document/image. High signal.
  // Decoy (inner) extension is a controlled document/media whitelist -- deliberately
  // NOT "any inner extension", so legit dotted names like app.min.js / vue.global.js /
  // archive.tar.gz do not false-positive as a disguise. Broadened well past the old
  // pdf|jpg|... set so csv/pptx/webp/json/wav/mkv decoys no longer slip the critical flag.
  const doubleExt = /\.(pdf|jpe?g|png|gif|webp|svg|bmp|tiff?|ico|heic|docx?|xlsx?|csv|tsv|pptx?|txt|rtf|md|json|xml|html?|odt|ods|epub|mp4|mkv|mov|avi|webm|wmv|m4v|mp3|wav|flac|ogg|m4a|aac|zip|rar|7z)\.(exe|scr|com|pif|bat|cmd|js|jse|vbs|vbe|jar|msi|msix|cpl|hta|ps1|lnk|wsf|reg|msc|scf)$/i;
  const hasDoubleExt = doubleExt.test(name);
  if (hasDoubleExt) { score += W.doubleExtension; reasons.push('Double extension disguising an executable (e.g. .pdf.exe)'); }

  // RIGHT-TO-LEFT OVERRIDE spoof: U+202E reverses how the filename renders, so
  // "exe.gpj" displays as a harmless image while actually being .exe -- a well-known
  // malware filename trick. Any RTL/LTR override or zero-width char in a filename is
  // a strong red flag.
  const hasHiddenChars = /[\u202A-\u202E\u2066-\u2069\u200B-\u200F]/.test(name);
  if (hasHiddenChars) {
    score += W.hiddenChars; reasons.push('Filename contains hidden text-direction characters (used to disguise the real type)');
  }

  // name padding: "invoice                 .exe" -- many spaces/underscores before the
  // extension to push it out of view in the UI.
  const hasPaddingTrick = /\s{6,}\.[a-z0-9]{2,5}$/i.test(name) || /_{8,}\.[a-z0-9]{2,5}$/i.test(name);
  if (hasPaddingTrick) {
    score += W.paddingTrick; reasons.push('Filename padded to hide its real extension');
  }

  // ---- grading refinements (reduce false positives, sharpen true risk) ----
  // A clean, version-numbered installer name from HTTPS is a normal-software pattern
  // (e.g. "VSCodeSetup-x64-1.89.1.exe", "node-v20.11.0-x64.msi"). Slightly lower the
  // generic "executable" anxiety when the name looks like a real release artifact and
  // nothing else is wrong.
  const looksVersionedRelease = /[-_ ]v?\d+\.\d+(\.\d+)?([-_.](x64|x86|win|win32|win64|amd64|arm64|setup|installer|stable|release))*\.(exe|msi|dmg|pkg|deb|rpm|appimage|zip)$/i.test(name);
  // Only corroborate a versioned-release name when the SOURCE is already trusted (user
  // trust list or known publisher). An attacker on an unknown/throwaway host can name a
  // payload "app-v2.1.0-x64.exe" for free; granting that a score discount nudged it below
  // the review threshold (D->C). On a trusted source the name is genuine corroboration.
  if (looksVersionedRelease && !httpInsecure && !lureName && score > 0 && score <= 3
    && (trustMatch || isKnownPublisherDomain(host))) {
    score -= W.versionedReleaseRebate; reasons.push('Filename looks like a normal versioned software release');
  }

  // extension / MIME mismatch: a file served as one thing but named another. Computed
  // BEFORE trickCount so a "served as a program but named like a document" file counts
  // toward the multiple-disguise-tricks bonus below (it is a disguise trick too).
  let dangerousMimeMismatch = false;
  try {
    const m = (mime || '').toLowerCase();
    // Anchored, and with an exemption for file types whose native content type genuinely IS text.
    // Unanchored, `text` matched application/x-apple-diskimage? no -- but it did match every .js
    // served as text/javascript, every .ps1/.reg/.url/.desktop served as text/plain and every
    // .mhtml served as text/html. Those are not disagreements; that is the correct type for the
    // file. A disguise still counts: the exemption is refused whenever the NAME is doing a trick.
    const declaredDocType = /^(text\/|image\/)/.test(m) || /(application\/pdf|officedocument)/.test(m);
    const textNativeExt = /\.(js|jse|vbs|vbe|wsf|wsh|ps1|psm1|hta|reg|url|scf|inf|desktop|iqy|slk|mht|mhtml|jnlp|bat|cmd|sh|py|pl|rb)$/i.test(name);
    const nameTrick = hasDoubleExt || hasHiddenChars || hasPaddingTrick;
    if (m && isDangerous && declaredDocType && !(textNativeExt && !nameTrick)) {
      score += W.mimeDisagree; reasons.push('File type and its declared content type disagree');
    }
    // application/octet-stream used to sit in this list beside x-msdownload. It does not belong.
    // x-msdownload and x-msdos-program mean "this IS a Windows executable", which genuinely
    // contradicts a .pdf name. octet-stream means "unspecified binary" -- it is what a great many
    // ordinary servers send for every file they do not recognise, including perfectly normal PDFs.
    // Treating it as a disguise cost more than a grade: it set dangerousMimeMismatch, which feeds
    // `critical`, and critical DISABLES known-publisher silencing -- so a PDF from a trusted
    // publisher served with a lazy content type was pulled out of silence and shown as High Risk.
    if (m && /(x-msdownload|x-msdos-program)/.test(m) && /\.(pdf|jpg|jpeg|png|docx?|txt)$/i.test(name)) {
      score += W.mimeProgramNamedDoc; dangerousMimeMismatch = true; reasons.push('Served as a program but named like a document');
    }
  } catch (_) {}

  // Two independent strong tricks together = near-certain malware; push to the top.
  const trickCount = [hasDoubleExt, hasHiddenChars, hasPaddingTrick, dangerousMimeMismatch].filter(Boolean).length;
  if (trickCount >= 2) { score += W.multipleTricks; reasons.unshift('Multiple filename-disguise tricks combined (high-confidence malware pattern)'); }

  // Executable from a bare IP over insecure HTTP with an installer/crack name is a
  // classic drive-by drop -- the combination is worse than its parts.
  // lureName, not installerName: this was the one consumer the benign/lure split did not repoint,
  // so an ordinary Setup.exe from an intranet IP was still scored as though it were named crack.
  if (isDangerous && /^\d{1,3}(\.\d{1,3}){3}$/.test(host) && (lureName || isArchive)) {
    score += W.ipHostInstaller; reasons.push('Executable with installer/crack name from a raw IP host');
    if (privateHost) lanNoise += W.ipHostInstaller;
  }

  // IP-address host serving an executable -- common in malware drops; worse over HTTP
  const rawIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (isDangerous && rawIp) {
    score += W.rawIpExecutable; reasons.push('Executable served directly from a raw IP address');
    if (privateHost) lanNoise += W.rawIpExecutable;
  }
  if (isDangerous && rawIp && httpInsecure) {
    score += W.rawIpInsecure; reasons.push('Insecure raw-IP source');
    if (privateHost) lanNoise += W.rawIpInsecure;
  }

  // Archives/disk-images hide their contents until opened (the Qakbot/IcedID "exe inside
  // a zip/iso" pattern). We do NOT review every archive (most are benign), but legit
  // software essentially never ships an archive from a raw IP -- that combination is a
  // strong drive-by-drop signal that would otherwise sit silent at grade B.
  if ((isArchive || isContainer) && rawIp) {
    score += W.rawIpExecutable; reasons.push('Archive/disk-image served directly from a raw IP address (contents hidden until opened)');
    if (privateHost) lanNoise += W.rawIpExecutable;
  }

  // IDN / punycode host (xn--) for a download source -- lookalike-domain delivery
  if (/(^|\.)xn--/i.test(host)) { score += W.punycodeHost; reasons.push('Source uses a lookalike (punycode) domain'); }

  // throwaway / abuse-prone TLDs frequently used for malware distribution. The
  // .zip and .mov TLDs are especially dangerous because they look like filenames,
  // so an executable served from one is weighted higher.
  if (/\.(zip|mov)$/i.test(host)) { score += W.confusableTld; reasons.push('Source on a filename-confusable TLD (.zip/.mov)'); }
  else if (/\.(cfd|sbs|top|xyz|click|link|rest|quest|cyou|icu|gq|cf|ml|ga|tk|work|monster|lol)$/i.test(host)) {
    // Softened for ONE shape only: a lone clean executable, which is the ordinary small-vendor
    // installer that happens to live on a cheap TLD. Everything else still pays.
    //
    // The first attempt here suppressed the charge whenever the score equalled the file-type
    // baseline, which read as reasonable and was wrong: an archive scores 1 for being an archive,
    // so the test suppressed the TLD charge for EVERY zip and 7z, and a hidden-contents archive
    // from a throwaway domain -- the drive-by shape this rule exists for -- dropped to grade B and
    // went silent. Measured, not reasoned: it took an attack battery to see it.
    const loneCleanExe = isDangerous && !isArchive && !isContainer && !isMacro && score === W.executable;
    if (!loneCleanExe) {
      score += W.throwawayTld; reasons.push('Source on a throwaway-style TLD');
    }
  }

  const critical = !!(onBlocklist || chromeKnownBad || hasDoubleExt || hasHiddenChars || hasPaddingTrick || dangerousMimeMismatch || redirectCritical);
  // Refund the public-internet-only charges for a host on the user's own network -- but never for
  // a file that is critical (disguised name, blocklisted, Chrome-flagged) or lure-named.
  if (lanNoise > 0 && privateHost && !critical && !lureName) {
    score = Math.max(0, score - lanNoise);
    reasons.push('Source is on your own network, so raw-address and insecure-transport penalties were not applied');
  }
  const knownPublisher = isKnownPublisherDomain(host);
  // A known, vetted publisher (microsoft.com, mozilla.org, github.com, ...) is
  // trusted automatically -- normal downloads from them stay silent. But critical
  // tricks STILL override: a disguised .pdf.exe from any domain gets reviewed.
  const trustedEligible = !!((trustMatch || knownPublisher) && !critical && !redirectTrustBreaker);
  if (trustedEligible) {
    if (knownPublisher && !trustMatch && isMultiTenantPublisherHost(host)) {
      // github.com / sourceforge.net host arbitrary third-party binaries; being on the
      // platform is not an endorsement of THIS file. Soften with the trusted-site rebate
      // instead of full silent trust so a suspicious-named payload (installer/crack/lure
      // wording, throwaway signals) from a random repo/project still surfaces for review.
      score = Math.max(0, score - W.trustedSiteRebate);
      reasons.unshift('Hosted on a known but multi-tenant publisher — limited trust (file not endorsed by the platform)');
    } else if (knownPublisher && !trustMatch) {
      // zero out ordinary risk for a clean file from a known publisher so it's silent
      score = 0;
      reasons.unshift('Source is a known, trusted software publisher');
    } else {
      score = Math.max(0, score - W.trustedSiteRebate);
      reasons.unshift('Source is in your trusted download sites');
    }
  } else if ((trustMatch || knownPublisher) && critical) {
    reasons.unshift(knownPublisher
      ? 'Known publisher domain, but critical file indicators still require review'
      : 'Trusted site matched, but critical file indicators still require review');
  } else if ((trustMatch || knownPublisher) && redirectTrustBreaker) {
    reasons.unshift(knownPublisher
      ? 'Known publisher domain, but risky redirect-chain indicators still require review'
      : 'Trusted site matched, but risky redirect-chain indicators still require review');
  }

  // Lone-clean-executable rebate (D->C). A single executable/script over HTTPS from an
  // established registrable domain, with NO other risk signal (score is exactly the executable
  // weight -- no installer/crack/lure name, no archive/container, not a raw IP or throwaway TLD,
  // no Chrome flag), is the everyday "installer from a small/indie/FOSS vendor" case. Soften it
  // from D (High Risk) to C (Review Recommended) so it still gets a look but a lighter one that
  // prominently offers "always trust this site" (grade C shows the Trust button), cutting the
  // daily friction of every niche installer being framed as high risk.
  if (!trustedEligible && isDangerous && !critical && !isArchive && !isContainer && !isMacro
    && rd && (!httpInsecure || privateHost) && !lureName && score === W.executable) {
    score -= 1;
    reasons.push('Nothing against this file except that it is a program');
  }
  // The same reasoning for a lone clean disk image or macro document. An .iso weighs MORE than an
  // executable (container 3 vs executable 3, but with no rebate) so every distro ISO from a
  // community mirror was High Risk, and the finance team's weekly .xlsm was High Risk every
  // Monday. Gated on exact score equality, so it can only ever move 3 to 2 and can never push a
  // file below the review line.
  if (!trustedEligible && !critical && !isDangerous && !isArchive
    && rd && (!httpInsecure || privateHost) && !lureName
    && ((isContainer && !isMacro && score === W.container)
      || (isMacro && !isContainer && score === W.macroDoc))) {
    score -= 1;
    reasons.push('Nothing against this file except its type, and it came from an established site');
  }

  const meta = downloadGradeFromScore(score, (critical && (onBlocklist || redirectCritical)) || chromeKnownBad);
  return {
    grade: meta.grade,
    status: meta.status,
    color: meta.color,
    action: meta.action,
    level: Math.max(0, 'ABCDEF'.indexOf(meta.grade)),
    levelText: meta.grade + ' - ' + meta.status,
    score,
    source: host || '(unknown)',
    reasons,
    trusted: !!(trustMatch || knownPublisher),
    trustedEligible,
    knownPublisher,
    // What Trust hands over has to be what the button says. On a shared-hosting suffix the
    // registrable domain is the PLATFORM -- trusting one cloudfront distribution would have
    // allowlisted every distribution on cloudfront.net. On a raw IP it was a meaningless
    // two-label fragment ("1.20" from 192.168.1.20). Both now resolve to the exact host.
    trustAllowed: !!(downloadTrustTarget(host) && !critical && !redirectTrustBreaker),
    trustHost: trustMatch || downloadTrustTarget(host),
    critical,
    blocklisted: !!(onBlocklist || chromeKnownBad || redirectCritical),
    chromeDanger: chromeDanger || '',
    redirectChain: redirectRisk || null,
    domainAge: null,
    externalReputation: [],
  };
}

function applyDownloadMeta(rep) {
  const meta = downloadGradeFromScore(rep.score, !!rep.blocklisted);
  rep.grade = meta.grade;
  rep.status = meta.status;
  rep.color = meta.color;
  rep.action = meta.action;
  rep.level = Math.max(0, 'ABCDEF'.indexOf(meta.grade));
  rep.levelText = meta.grade + ' - ' + meta.status;
  return rep;
}

function shouldCheckDownloadDomainAge(rep) {
  if (!rep || !rep.source || rep.source === '(unknown)') return false;
  if (rep.trustedEligible) return false;
  if (rep.blocklisted) return false;
  return rep.score >= 1 || /(\.zip|\.mov|\.cfd|\.sbs|\.top|\.xyz|\.click|\.link|\.rest|\.quest|\.cyou|\.icu|\.gq|\.cf|\.ml|\.ga|\.tk|\.work|\.monster|\.lol)$/i.test(rep.source);
}

async function enrichDownloadWithDomainAge(rep, cfg) {
  if (!shouldCheckDownloadDomainAge(rep)) return rep;
  const age = await lookupDomainAge(rep.source, cfg);
  if (!age || !age.ok || typeof age.ageDays !== 'number') return rep;
  rep.domainAge = {
    domain: age.domain,
    created: age.created,
    ageDays: age.ageDays,
    risk: age.risk,
    provider: age.provider || '',
    registrar: age.registrar || '',
    registrantOrg: age.registrantOrg || '',
    registrantCountry: age.registrantCountry || '',
    privacy: !!age.privacy,
    nameServers: Array.isArray(age.nameServers) ? age.nameServers.slice(0, 4) : [],
  };
  if (age.ageDays < 7) {
    rep.score += 3;
    rep.reasons.push('Source domain is brand new (' + age.ageDays + ' days old)');
  } else if (age.ageDays < 30) {
    rep.score += 2;
    rep.reasons.push('Source domain is very new (' + age.ageDays + ' days old)');
  } else if (age.ageDays < 90) {
    rep.score += 1;
    rep.reasons.push('Source domain is fairly new (' + age.ageDays + ' days old)');
  } else if (age.ageDays >= 1825 && !age.privacy && age.registrantOrg && !rep.critical && !rep.blocklisted) {
    // The mirror image of the new-domain penalties above. A domain registered five or more years
    // ago to a named organisation, with nothing redacted, is real evidence -- but the key only ever
    // spent points, never returned any, so paying for WHOIS bought interruptions and no
    // reassurance. Floored at zero and refused on anything critical.
    if (rep.score > 0) rep.score = Math.max(0, rep.score - 1);
    rep.reasons.push('Source domain has belonged to ' + age.registrantOrg + ' for '
      + Math.floor(age.ageDays / 365) + '+ years');
  } else {
    rep.reasons.push('Source domain age checked: ' + age.risk + ' risk');
  }
  if (age.registrar) rep.reasons.push('Registrar clue: ' + age.registrar);
  if (age.registrantOrg && !age.privacy) rep.reasons.push('Registrant organization clue: ' + age.registrantOrg);
  if (age.privacy) rep.reasons.push('WHOIS ownership appears privacy-protected or redacted');
  return applyDownloadMeta(rep);
}

async function enrichDownloadWithExternalReputation(rep, url, cfg) {
  if (!url || !/^https?:/i.test(url)) return rep;
  const checks = [];
  if (cfg && cfg.downloadSafeBrowsing === true && String(cfg.downloadSafeBrowsingKey || '').trim()) {
    checks.push(safeBrowsingLookupUrl(url, { cfg, key: cfg.downloadSafeBrowsingKey }));
  }
  if (cfg && cfg.downloadVirusTotal === true && String(cfg.downloadVirusTotalKey || '').trim()) {
    // Never send a private-network address or a URL's query string to VirusTotal. The query is
    // where session tokens, signed-download parameters and one-time links live, and the host may be
    // an intranet name that means nothing outside this network and everything inside it. Safe
    // Browsing already goes through normalizePublicHttpUrl for exactly this reason; this did not,
    // so switching the key on quietly shipped every download URL -- including files graded A that
    // the user never even saw a panel for.
    const vtUrl = normalizePublicHttpUrl(url);
    if (vtUrl) {
      let vtSafeUrl = vtUrl;
      try {
        const u = new URL(vtUrl);
        u.search = '';
        u.hash = '';
        vtSafeUrl = u.href;
      } catch (_) {}
      checks.push(checkVirusTotalUrl(vtSafeUrl, cfg.downloadVirusTotalKey));
    }
  }
  if (cfg && cfg.urlHaus === true && String(cfg.urlHausKey || '').trim()) {
    checks.push(urlHausLookupUrl(url, { cfg, key: cfg.urlHausKey, context: 'download' }));
  }
  if (cfg && cfg.phishTank === true && String(cfg.phishTankKey || '').trim()) {
    checks.push(checkPhishTankUrl(url, cfg));
  }
  if (cfg && cfg.openPhish === true) {
    checks.push(checkOpenPhishUrl(url, cfg));
  }
  if (cfg && cfg.abuseIpDb === true && String(cfg.abuseIpDbKey || '').trim() && ipFromUrl(url)) {
    checks.push(abuseIpDbLookupUrl(url, { cfg, key: cfg.abuseIpDbKey }));
  }
  if (cfg && cfg.whoisXmlReputation === true && String(cfg.whoisXmlKey || '').trim()) {
    checks.push(whoisXmlDomainReputationLookupUrl(url, { cfg, key: cfg.whoisXmlKey }));
  }
  if (cfg && cfg.whoisXmlThreatIntel === true && String(cfg.whoisXmlKey || '').trim()) {
    checks.push(whoisXmlThreatIntelLookupUrl(url, { cfg, key: cfg.whoisXmlKey }));
  }
  if (!checks.length) return rep;

  const results = (await Promise.all(checks)).filter(Boolean);
  const hits = [];
  results.forEach((result) => {
    if (!result || !result.ok || !result.hit) return;
    hits.push(result);
    rep.trustAllowed = false;
    if (result.provider === 'Google Safe Browsing') {
      rep.score += 100;
      rep.blocklisted = true;
      rep.reasons.unshift('Google Safe Browsing flagged this download URL' + (result.threats && result.threats.length ? ': ' + result.threats.join(', ') : ''));
    } else if (result.provider === 'PhishTank') {
      rep.score += 100;
      rep.blocklisted = true;
      rep.reasons.unshift('PhishTank verified this download URL as phishing' + (result.phishId ? ' (#' + result.phishId + ')' : ''));
    } else if (result.provider === 'OpenPhish') {
      rep.score += 100;
      rep.blocklisted = true;
      rep.reasons.unshift('OpenPhish feed matched this download URL as phishing');
    } else if (result.provider === 'AbuseIPDB') {
      rep.score += 100;
      rep.blocklisted = true;
      rep.reasons.unshift('AbuseIPDB reports high abuse confidence for this raw-IP download source (' + (result.score || 0) + '%)');
    } else if (result.provider === 'URLhaus') {
      rep.score += 100;
      rep.blocklisted = true;
      const family = result.signatures && result.signatures.length ? ' (' + result.signatures.slice(0, 3).join(', ') + ')' : '';
      const scope = result.hostOnly ? 'download host' : 'download URL';
      rep.reasons.unshift('URLhaus flagged this ' + scope + ' as malware delivery' + (result.threat ? ': ' + result.threat : '') + family);
    } else if (result.provider === 'WhoisXML Domain Reputation') {
      const score = result.reputationScore != null ? Math.round(Number(result.reputationScore)) : null;
      rep.score += 100;
      rep.blocklisted = true;
      rep.reasons.unshift('WhoisXML Domain Reputation flagged this source' + (score != null ? ' (' + score + '/100 reputation)' : ''));
    } else if (result.provider === 'WhoisXML Threat Intelligence') {
      rep.score += 100;
      rep.blocklisted = true;
      rep.reasons.unshift('WhoisXML Threat Intelligence matched this download URL' + ((result.threatTypes && result.threatTypes.length) ? ': ' + result.threatTypes.join(', ') : ''));
    } else if (result.provider === 'VirusTotal') {
      const stats = result.stats || {};
      const malicious = Number(stats.malicious || 0);
      const suspicious = Number(stats.suspicious || 0);
      if (malicious >= 2) {
        rep.score += 10;
        rep.reasons.unshift('VirusTotal reports ' + malicious + ' malicious detections for this URL');
      } else if (malicious === 1 || suspicious >= 2) {
        // Capped on a vetted publisher. One engine out of ~70 disagreeing about a Mozilla or
        // Microsoft installer is a false positive far more often than it is a compromise, and at
        // the full weight it dragged a silent grade-A download to D or E -- publisher trust was
        // applied before enrichment and never re-applied after. It can still warn; it can no
        // longer outrank the match.
        rep.score += (rep.trustedEligible ? 2 : 6);
        rep.reasons.unshift('VirusTotal reports suspicious URL detections');
      } else if (suspicious === 1) {
        rep.score += (rep.trustedEligible ? 2 : 3);
        rep.reasons.unshift('VirusTotal has one suspicious detection for this URL');
      }
    }
  });
  // A clean consensus is evidence too. Until now every enrichment could only ever ADD points, so
  // turning on a key bought more interruptions and never fewer -- a file scanned by seventy
  // engines with nothing against it scored exactly the same as a file nobody had ever looked at.
  // One point, floored at zero, refused on anything critical or blocklisted, and deliberately
  // NOT keyed to the file hash: DOWNLOAD_HASH_SOURCE_META marks our only hash kind as
  // exactFile:false because it hashes a re-fetch, so a server can serve clean bytes to us and
  // malware to Chrome. A penalty resting on that fails safe; a rebate would not.
  if (!rep.critical && !rep.blocklisted) {
    const vtClean = results.find((r) => r && r.ok && !r.hit && r.provider === 'VirusTotal'
      && r.stats && Number(r.stats.malicious || 0) === 0 && Number(r.stats.suspicious || 0) === 0
      && Number(r.stats.harmless || 0) >= 10);
    if (vtClean && rep.score > 0) {
      rep.score = Math.max(0, rep.score - 1);
      rep.reasons.push('VirusTotal found nothing against this file across '
        + Number(vtClean.stats.harmless || 0) + ' engines');
    }
  }
  results.forEach((result) => {
    if (!result || !result.ok || result.hit || result.provider !== 'AbuseIPDB' || !result.warning) return;
    rep.trustAllowed = false;
    rep.score += rep.trustedEligible ? 2 : (Number(result.score || 0) >= 50 ? 3 : 2);
    rep.reasons.unshift('AbuseIPDB reports suspicious raw-IP source (' + (result.score || 0) + '% abuse confidence)');
  });
  results.forEach((result) => {
    if (!result || !result.ok || result.hit || !result.warning) return;
    if (result.provider === 'WhoisXML Domain Reputation') {
      rep.trustAllowed = false;
      const score = result.reputationScore != null ? Math.round(Number(result.reputationScore)) : null;
      rep.score += score != null && score < 45 ? 4 : 2;
      rep.reasons.unshift('WhoisXML reports suspicious domain reputation' + (score != null ? ' (' + score + '/100)' : ''));
    } else if (result.provider === 'WhoisXML Threat Intelligence') {
      rep.trustAllowed = false;
      rep.score += 4;
      rep.reasons.unshift('WhoisXML Threat Intelligence returned an IoC warning');
    }
  });
  rep.externalReputation = results.map((result) => {
    if (result.provider === 'VirusTotal') {
      return {
        provider: result.provider,
        ok: result.ok !== false,
        hit: !!result.hit,
        notFound: !!result.notFound,
        status: result.status || 0,
        error: result.error || '',
        stats: result.stats || null,
        reputation: result.reputation || 0,
      };
    }
    if (result.provider === 'PhishTank') {
      return {
        provider: result.provider,
        ok: result.ok !== false,
        hit: !!result.hit,
        status: result.status || 0,
        error: result.error || '',
        threats: result.threats || [],
        inDatabase: !!result.inDatabase,
        verified: !!result.verified,
        valid: !!result.valid,
        phishId: result.phishId || '',
        detailPage: result.detailPage || '',
        rateLimited: !!result.rateLimited,
        cloudflare: !!result.cloudflare,
      };
    }
    if (result.provider === 'OpenPhish') {
      return {
        provider: result.provider,
        ok: result.ok !== false,
        hit: !!result.hit,
        status: result.status || 0,
        error: result.error || '',
        threats: result.threats || [],
        matchedUrl: result.matchedUrl || '',
        feedSize: Number(result.feedSize || 0),
        stale: !!result.stale,
      };
    }
    if (result.provider === 'AbuseIPDB') {
      return abuseIpDbPublic(result);
    }
    if (result.provider === 'URLhaus') {
      return urlHausPublic(result);
    }
    if (result.provider === 'WhoisXML Domain Reputation') {
      return {
        provider: result.provider,
        ok: result.ok !== false,
        hit: !!result.hit,
        warning: !!result.warning,
        status: result.status || 0,
        error: result.error || '',
        threats: result.threats || [],
        domain: result.domain || '',
        reputationScore: result.reputationScore != null ? Number(result.reputationScore) : null,
        warningCodes: Array.isArray(result.warningCodes) ? result.warningCodes.slice(0, 12) : [],
        warnings: Array.isArray(result.warnings) ? result.warnings.slice(0, 8) : [],
        rateLimited: !!result.rateLimited,
      };
    }
    if (result.provider === 'WhoisXML Threat Intelligence') {
      return {
        provider: result.provider,
        ok: result.ok !== false,
        hit: !!result.hit,
        warning: !!result.warning,
        status: result.status || 0,
        error: result.error || '',
        threats: result.threats || [],
        ioc: result.ioc || '',
        total: Number(result.total || 0),
        threatTypes: Array.isArray(result.threatTypes) ? result.threatTypes.slice(0, 8) : [],
        results: Array.isArray(result.results) ? result.results.slice(0, 8) : [],
        rateLimited: !!result.rateLimited,
      };
    }
    return {
      provider: result.provider,
      ok: result.ok !== false,
      hit: !!result.hit,
      status: result.status || 0,
      error: result.error || '',
      threats: result.threats || [],
    };
  });
  if (rep.externalReputation.length) rep.externalSummary = externalSummary(rep.externalReputation);
  return applyDownloadMeta(rep);
}

function isRecentCompletedDownload(item) {
  try {
    const ts = item && item.endTime ? new Date(item.endTime).getTime() : 0;
    // widened from 15s to 60s: a fast download can complete before our scheduled
    // scan runs, and we still want to surface a review for it.
    return !!ts && (Date.now() - ts) < 60000;
  } catch (_) {
    return false;
  }
}

async function latestDownloadItem(id, hint) {
  const items = await downloadSearch({ id: Number(id) });
  if (items && items[0]) return Object.assign({}, hint || {}, items[0]);
  return hint && hint.id != null ? hint : null;
}

async function runDownloadGuardScan(id, hint, reason) {
  const key = String(id || (hint && hint.id) || '');
  if (!key) return;
  if (DOWNLOAD_SCANNING[key]) {
    scheduleDownloadGuardScan(key, hint, 'rescan-after-busy', 900);
    return;
  }
  DOWNLOAD_SCANNING[key] = true;

  try {
    await cleanupDownloadReviews(false);
    let pending = await getPendingDownload(key);
    if (await isDownloadHandled(key) && !pending) return;

    const item = await latestDownloadItem(key, hint);
    if (!item || item.id == null) return;

    if (item.state === 'interrupted') {
      if (pending) {
        await removePendingDownload(key);
        await rememberHandledDownload(key, 'interrupted');
        await closeDownloadReviewTabs(key);
      }
      return;
    }

    if (item.state === 'complete' && pending) {
      await removePendingDownload(key);
      await rememberHandledDownload(key, 'completed');
      await closeDownloadReviewTabs(key);
      return;
    }

    // Leftover from a PREVIOUS browser session (Chrome restores paused/interrupted
    // downloads on restart). Never re-pop a review for these -- resolve quietly and
    // leave the download paused in Chrome for the user to manage.
    if (downloadStartedBeforeSession(item)) {
      if (pending) await removePendingDownload(key);
      await rememberHandledDownload(key, 'previous-session');
      await closeDownloadReviewTabs(key);
      return;
    }

    const cfgStore = await downloadStateGet(['wardenone_config', DOWNLOAD_TRUSTED_KEY]);
    const cfg = (cfgStore && cfgStore.wardenone_config) || {};
    if (cfg.enabled === false || cfg.downloadReputation === false) {
      // Guard is off -> never leave a file stuck in the onCreated early-pause.
      if (EARLY_PAUSED.has(key)) { Promise.resolve(downloadApiCall('resume', item.id)).catch(() => {}); EARLY_PAUSED.delete(key); }
      return;
    }
    const trustedSites = Array.isArray(cfgStore && cfgStore[DOWNLOAD_TRUSTED_KEY]) ? cfgStore[DOWNLOAD_TRUSTED_KEY] : [];
    // scoreDownload consults BLOCKED_DOMAINS and the recent-redirect window, both of which are
    // hydrated asynchronously. The first download after a service-worker suspension used to be
    // scored against an empty set and an empty window, so a file from a blocklisted host that
    // arrived through a flagged redirect chain scored as if neither had happened (M17).
    if (typeof securityStoresReady === 'function') await securityStoresReady();
    if (typeof RECENT_REDIRECT_MIRROR !== 'undefined') await RECENT_REDIRECT_MIRROR.ready();
    const downloadUrl = item.finalUrl || item.url || '';
    const filename = item.filename || item.url || '';
    const redirectContext = downloadRedirectContext(downloadUrl, item.referrer, item);
    let rep = scoreDownload(downloadUrl, item.referrer, filename, item.mime, trustedSites, item.danger, redirectContext);
    let pauseResult = null;

    if (shouldReviewDownload(rep) && item.state !== 'complete' && item.state !== 'interrupted') {
      pauseResult = await downloadApiCall('pause', item.id);
    }

    if (cfg.downloadDomainAge === true) rep = await enrichDownloadWithDomainAge(rep, cfg);
    rep = await enrichDownloadWithExternalReputation(rep, downloadUrl, cfg);
    // Keyless local known-malware URL-content hash check (default ON). Runs only on
    // already-reviewed (hence already-paused) downloads, so it adds no cost to normal
    // downloads. A hit forces grade F -> hard-block path deletes the file.
    rep = await enrichDownloadWithLocalHash(rep, downloadUrl, filename, cfg);
    if (!pauseResult && shouldReviewDownload(rep) && item.state !== 'complete' && item.state !== 'interrupted'
      && shouldCheckVirusTotalHash(rep, downloadUrl, filename)
      && cfg.downloadVirusTotalHash === true && String(cfg.downloadVirusTotalKey || '').trim()) {
      pauseResult = await downloadApiCall('pause', item.id);
    }
    rep = await enrichDownloadWithVirusTotalHash(rep, downloadUrl, filename, cfg);

    if (!shouldReviewDownload(rep)) {
      // Resume if WE paused it -- either the scan's own pause, or the onCreated early-pause.
      if ((pauseResult && pauseResult.ok) || EARLY_PAUSED.has(key)) await downloadApiCall('resume', item.id);
      EARLY_PAUSED.delete(key);
      // A review panel may already be open from an earlier scan that ran while Chrome had not
      // finished its own check. The verdict is in now and it is clean, so withdraw the panel
      // instead of leaving the user staring at a warning about a file that has been cleared.
      try { await dismissDownloadReviewPanels(key); } catch (_) {}
      if (item.state === 'complete' && !DOWNLOAD_SAFE_LOGGED.has(key)) {
        DOWNLOAD_SAFE_LOGGED.add(key);
        logDownloadCheck(item, rep);
        await rememberHandledDownload(key, 'allowed');
      }
      return;
    }

    // A risky download should ALWAYS surface a review the first time we see it,
    // whether it finished fast (small/cached file) or slowly. The previous logic
    // only showed a review if the file was still in-flight or had completed within
    // 15s AND had no prior pending entry -- so a quick download that finished before
    // the first scan ran was silently logged instead of reviewed (the "sometimes it
    // shows, sometimes it doesn't" bug). We now treat "have we already handled/shown
    // this id?" as the gate, not the completion timing.
    const alreadyHandled = await isDownloadHandled(key);
    if (item.state === 'complete' && !isRecentCompletedDownload(item) && !pending && alreadyHandled) {
      // genuinely stale (finished long ago, already dealt with) -> just log, no popup
      logDownloadCheck(item, rep);
      return;
    }

    if (!pauseResult && item.state !== 'complete' && item.state !== 'interrupted') {
      pauseResult = await downloadApiCall('pause', item.id);
    }

    const oldReview = await getPendingDownload(key);
    const review = buildDownloadReview(item, rep, pauseResult);
    if (oldReview && oldReview.createdAt) review.createdAt = oldReview.createdAt;
    if (oldReview && oldReview.paused) {
      review.paused = true;
      if (!review.pauseError) review.pauseError = oldReview.pauseError || '';
    }

    // Grade F = critical threat (Chrome-known-bad, on a malware/phishing blocklist, or a
    // high-confidence filename-disguise trick). Pausing alone leaves the payload on disk,
    // resumable from chrome://downloads outside our UI -- so "blocks malware downloads" was
    // not literally true. For F we HARD-BLOCK by default: cancel the transfer, delete any
    // bytes already written, and erase the entry. The review window still opens (below) as a
    // no-Continue notification so the user learns why the file disappeared. Grades C/D/E
    // keep pause-then-review. Set downloadHardBlockCritical:false to fall back to pause-only.
    if (review.grade === 'F' && cfg.downloadHardBlockCritical !== false) {
      review.removed = await hardRemoveDownload(item.id);
      review.autoBlocked = true;
      review.paused = false; // the file is gone, not paused
    }
    // From here the review's own pause/removed state owns the download; drop the early-pause tag.
    EARLY_PAUSED.delete(key);

    await rememberPendingDownload(review);
    if (!oldReview || oldReview.grade !== review.grade || oldReview.score !== review.score) {
      logDownloadCheck(item, rep);
    }
    // mark handled so a follow-up scan of the same id won't suppress (via the stale
    // guard above) or duplicate this review.
    // Known MV3 gap: if the service worker dies between the pause() calls above and
    // this write, no handled-state is persisted and the next scan re-runs from
    // scratch -- worst case a duplicate pause/review, never a missed one. Chrome
    // offers no way to make pause+mark atomic (no transactional storage), so
    // cleanupDownloadReviews() and the isDownloadHandled() check at the top absorb
    // what's left of the window.
    await rememberHandledDownload(key, review.autoBlocked ? 'auto-blocked' : 'reviewed');
    await openDownloadReview(review);
  } catch (e) {
    queueHistory({
      type: 'download_guard',
      detail: { decision: 'error', reason: reason || '', error: String(e).slice(0, 120) },
      url: hint && (hint.finalUrl || hint.url) || '',
      at: Date.now(),
    });
  } finally {
    delete DOWNLOAD_SCANNING[key];
  }
}

function scheduleDownloadGuardScan(id, hint, reason, delayMs) {
  const key = String(id || (hint && hint.id) || '');
  if (!key) return;
  if (DOWNLOAD_SCAN_TIMERS[key]) clearTimeout(DOWNLOAD_SCAN_TIMERS[key]);
  DOWNLOAD_SCAN_TIMERS[key] = setTimeout(() => {
    delete DOWNLOAD_SCAN_TIMERS[key];
    runDownloadGuardScan(key, hint || null, reason || 'scheduled');
  }, typeof delayMs === 'number' ? delayMs : 250);
}

try {
  chrome.downloads.onCreated.addListener((item) => {
    // Race shrink: a small/cached risky file can finish writing to disk before the +180ms
    // scan can pause it. Pause IMMEDIATELY on a dangerous-looking name/URL; the scan resumes
    // it within ~200ms-1.2s if it grades clean. Pausing is reversible, so an over-pause on a
    // clean file is invisible to the user. Only meaningful while download guard is on.
    try {
      // Skip the early-pause when the cached config already says the guard is off (avoids a
      // pointless pause/resume cycle; a cold cache falls through and the scan resolves it).
      const guardOff = __cfgCacheValid && __cfgCache && (__cfgCache.enabled === false || __cfgCache.downloadReputation === false);
      if (!guardOff && item && item.id != null && item.state !== 'complete' && item.state !== 'interrupted' && downloadLooksRisky(item)) {
        EARLY_PAUSED.add(String(item.id));
        Promise.resolve(downloadApiCall('pause', item.id)).catch(() => {});
      }
    } catch (_) {}
    scheduleDownloadGuardScan(item.id, item, 'created', 180);
    setTimeout(() => scheduleDownloadGuardScan(item.id, null, 'created-followup', 0), 1200);
  });
  chrome.downloads.onChanged.addListener((delta) => {
    if (!delta || delta.id == null) return;
    const relevant = delta.filename || delta.finalUrl || delta.url || delta.mime || delta.danger || delta.state || delta.exists || delta.paused;
    if (relevant) scheduleDownloadGuardScan(delta.id, { id: delta.id }, 'changed', 160);
  });
} catch (_) {}

// Anything WardenOne paused must be accounted for on every worker boot (M25).
//
// The early pause happens in onCreated, before the review record is written, and both the pause
// timer and EARLY_PAUSED are heap-only -- so a worker death in that gap left a file paused in
// Chrome with no pending record, no review panel and nothing that would ever look at it again.
// The whole-object write race could strand one the same way.
//
// This asks Chrome directly rather than trusting our own records: every paused download in this
// session that we have no pending record for, and have not already handled, gets its review
// rebuilt. Duplicate review beats silent continuation, and nothing here resumes a file -- a
// genuinely risky download stays paused until the user decides.
async function recoverStrandedPausedDownloads() {
  try {
    const cfgStore = await localGet('wardenone_config');
    const cfg = (cfgStore && cfgStore.wardenone_config) || {};
    if (cfg.enabled === false || cfg.downloadReputation === false) return 0;
    const items = await downloadSearch({ state: 'in_progress', paused: true });
    if (!Array.isArray(items) || !items.length) return 0;
    let recovered = 0;
    for (const item of items) {
      if (!item || item.id == null) continue;
      // Not ours to speak for: the user paused it, or it predates this browser session and the
      // new-session quiesce has already had its say.
      if (downloadStartedBeforeSession(item)) continue;
      const key = String(item.id);
      if (await isDownloadHandled(key)) continue;
      if (await getPendingDownload(key)) continue;
      scheduleDownloadGuardScan(item.id, item, 'recover', 0);
      recovered++;
    }
    return recovered;
  } catch (_) {
    return 0;
  }
}

try {
  setTimeout(() => cleanupDownloadReviews(true), 1000);
  setTimeout(() => { recoverStrandedPausedDownloads().catch(() => {}); }, 1500);
  chrome.runtime.onStartup?.addListener(() => {
    // new browser session: stamp the boundary FIRST, then purge leftover reviews so
    // restored downloads can't re-pop. markBrowserSessionStart runs synchronously
    // enough that a (debounced) restore scan sees the new boundary.
    markBrowserSessionStart();
    setTimeout(() => { quiesceDownloadReviewsForNewSession(); cleanupDownloadReviews(true); }, 800);
  });
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && reviewIdFromUrl(tab && (tab.url || tab.pendingUrl))) {
      cleanupDownloadReviews(true);
    }
  });
} catch (_) {}

try {
  if (globalThis.__WARDENONE_TEST__) {
    globalThis.__woDownloadTest = Object.freeze({
      DOWNLOAD_GRADE_META,
      DOWNLOAD_HASH_SOURCE,
      DL_WEIGHT,
      downloadLooksRisky,
      scoreDownload,
      applyDownloadMeta,
      downloadHashSourceMeta,
      normalizeDownloadHashSourceKind,
      normalizeDownloadRedirectRisk,
      buildDownloadReview,
      hardRemoveDownload,
      runDownloadGuardScan,
      getPendingDownload,
      shouldReviewDownload,
    });
  }
} catch (_) {}
