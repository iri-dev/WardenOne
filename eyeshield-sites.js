/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Eye Shield's per-site themes.
 *
 * These are the hand-tuned stylesheets for the ten sites Eye Shield manages by name --
 * YouTube, Google, Reddit, Amazon, Twitch, ChatGPT, GitHub, Stack Overflow, Wikipedia and
 * Hacker News. They were part of eyeshield.js, which is registered for every frame of
 * every site, so browsing anywhere meant compiling Reddit's stylesheet and Google's
 * search-box rules in every iframe on the page and never calling them: themeFooter()
 * picks a builder by hostname and returns '' for everything else (COST-03).
 *
 * Split out and registered TOP FRAME ONLY. The trade is deliberate and worth stating: an
 * embedded frame belonging to a managed host -- a Twitch chat embed, say -- now gets the
 * generic theme rather than the site-tuned one. Most of what is here targets top-level
 * page chrome an embed does not have, and the core still themes those frames.
 *
 * The builders are unchanged. They are wrapped in a factory so they keep reading the
 * core's palette and host helpers by their own names, rather than every reference being
 * rewritten -- the version of this change that edits 186 KB of stylesheet bodies is the
 * version that silently breaks one selector and nobody notices for a month.
 */
(function () {
  'use strict';
  var reg = globalThis.__woEyeSites || (globalThis.__woEyeSites = {});
  /* The core calls this once, lazily, when it first needs a site theme -- so load order
     between the two registrations does not matter. */
  reg.factory = function (core) {
    var paletteFor = core.paletteFor;
    var isYouTubeHost = core.isYouTubeHost;
    var youtubePalette = core.youtubePalette;
    var TWITCH_NOT_CHAT_NAME = core.TWITCH_NOT_CHAT_NAME;
    var youtubeSubscribePalette = core.youtubeSubscribePalette;
    var youtubeTextVars = core.youtubeTextVars;
    var isTwitchHost = core.isTwitchHost;
    var googlePaletteFor = core.googlePaletteFor;
    var NOT_SWATCH = core.NOT_SWATCH;
    var scopedSelectors = core.scopedSelectors;
    var TWITCH_CHAT_NAME = core.TWITCH_CHAT_NAME;
    var isChatGPTHost = core.isChatGPTHost;
    var isGoogleHost = core.isGoogleHost;
    var isGitHubHost = core.isGitHubHost;
    var isStackOverflowHost = core.isStackOverflowHost;
    var isHackerNewsHost = core.isHackerNewsHost;
    var isWikipediaHost = core.isWikipediaHost;
    var isRedditHost = core.isRedditHost;
    var isAmazonHost = core.isAmazonHost;

  function youtubePlayerCSS(text) {
    /* The player is black in every mode -- YouTube builds its chrome for a black
       surface, and the first rule here forces one -- so the colour on the shell
       is white whatever the page theme is. Without it, anything inside that no
       rule below claims inherits the PAGE's text colour, which in light mode is
       near-black on a black player. */
    return '#player,#player-container,#movie_player,.html5-video-player{background-color:#000000 !important;color:#ffffff !important;}'
      + '#movie_player .html5-video-container,#movie_player .html5-video-container *,#movie_player .video-stream,#movie_player video,#movie_player .ytp-player-content,#movie_player .ytp-player-content *,#movie_player .ytp-cued-thumbnail-overlay,#movie_player .ytp-cued-thumbnail-overlay-image,#movie_player .ytp-iv-video-content,#movie_player .ytp-ad-player-overlay,#movie_player .ytp-ad-overlay-container{background-color:transparent !important;border-color:transparent !important;box-shadow:none !important;}'
      + '#movie_player .ytp-chrome-top,#movie_player .ytp-chrome-bottom,#movie_player .ytp-gradient-top,#movie_player .ytp-gradient-bottom,#movie_player .ytp-caption-window-container,#movie_player .ytp-subtitles-player-content,#movie_player .ytp-ce-element{background-color:transparent !important;}'
      + '#movie_player button' + NOT_SWATCH + ',#movie_player [role="button"]' + NOT_SWATCH + ',#movie_player .ytp-button' + NOT_SWATCH + ',#movie_player [class*="button" i]' + NOT_SWATCH + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;}'
      + '#movie_player svg,#movie_player path,#movie_player yt-icon{background-color:transparent !important;}'
      /* The clock, the seek bar and the volume slider are not buttons and carry
         no "button" in their class, so nothing above claimed them and the page
         remap painted them like ordinary page furniture -- the track and the
         buffered span went black on a black player, and the clock went dark on
         black in light mode. These are YouTube's own values, read off the site,
         not theme ones: the player is black in every mode, so they do not
         follow the page. */
      + '#movie_player .ytp-chrome-controls,#movie_player .ytp-left-controls,#movie_player .ytp-right-controls,#movie_player .ytp-progress-bar-container,#movie_player .ytp-progress-bar,#movie_player .ytp-progress-bar-padding,#movie_player .ytp-scrubber-container,#movie_player .ytp-chapter-hover-container,#movie_player .ytp-volume-area,#movie_player .ytp-volume-panel,#movie_player .ytp-volume-slider{background-color:transparent !important;}'
      /* And a net under all of it. Naming the parts one at a time leaves any
         wrapper that was not named to the page remap, which paints it like a
         card -- a pale box behind the controls. Nothing in the bottom chrome
         has a surface of its own: it is an overlay on video. The four that do
         carry paint are excluded here and given their own values below.
         `:not()` takes the specificity of its argument, so this rule outranks
         them; excluding them is what keeps their values. */
      + '#movie_player .ytp-chrome-bottom :where(div,span):not(.ytp-swatch-background-color):not(.ytp-progress-list):not(.ytp-load-progress):not(.ytp-hover-progress):not(.ytp-volume-slider-handle):not(.ytp-time-wrapper){background-color:transparent !important;background-image:none !important;box-shadow:none !important;}'
      + '#movie_player .ytp-progress-list{background-color:rgba(40,40,40,.6) !important;}'
      + '#movie_player .ytp-load-progress{background-color:rgba(255,255,255,.4) !important;}'
      + '#movie_player .ytp-hover-progress{background-color:rgba(0,0,0,.125) !important;}'
      + '#movie_player .ytp-volume-slider-handle{background-color:#ffffff !important;}'
      /* YouTube puts a faint dark pill behind the clock so it stays legible
         over a bright frame. The net above was flattening it. */
      + '#movie_player .ytp-time-wrapper{background-color:rgba(0,0,0,.3) !important;}'
      + '#movie_player .ytp-time-display,#movie_player .ytp-time-display *,#movie_player .ytp-chapter-title-content,#movie_player .ytp-chapter-container,#movie_player .ytp-bound-time-left,#movie_player .ytp-bound-time-right{background-color:transparent !important;color:#eeeeee !important;-webkit-text-fill-color:#eeeeee !important;text-shadow:none !important;opacity:1 !important;}'
      /* YouTube makes the elapsed time a shade brighter than the duration
         beside it. Same specificity as the rule above, so it has to come
         after it to win. */
      + '#movie_player .ytp-time-current{color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;}'
      /* The bar and the knob are painted by the channel's own swatch, which is
         not always red -- it was yellow on the video this was reported from --
         so nothing here sets a colour on them. They only need to be let alone. */
      + '#movie_player .ytp-swatch-background-color{border-color:transparent !important;box-shadow:none !important;}';
  }

  function youtubeVarsCSS(p) {
    const vars = [
      '--yt-spec-base-background:' + p.bg,
      '--yt-spec-raised-background:' + p.raised,
      '--yt-spec-menu-background:' + p.raised,
      '--yt-spec-general-background-a:' + p.bg,
      '--yt-spec-general-background-b:' + p.surface,
      '--yt-spec-general-background-c:' + p.raised,
      '--yt-spec-touch-response:' + (p.scheme === 'light' ? '#0000001a' : '#ffffff1a'),
      '--yt-spec-text-primary:' + p.text,
      '--yt-spec-text-secondary:' + p.muted,
      '--yt-spec-text-disabled:' + p.disabled,
      '--yt-spec-icon-active-other:' + p.text,
      '--yt-spec-icon-inactive:' + p.muted,
      '--yt-spec-call-to-action:' + p.link,
      '--yt-spec-themed-blue:' + p.link,
      '--yt-spec-outline:' + p.border,
      '--yt-spec-badge-chip-background:' + p.chip,
      '--yt-spec-button-chip-background-hover:' + (p.scheme === 'light' ? '#e5e5e5' : '#3f3f3f'),
      '--paper-dialog-background-color:' + p.raised,
      '--paper-listbox-background-color:' + p.raised,
      '--ytd-searchbox-background:' + p.input,
      '--ytd-searchbox-text-color:' + p.text,
      '--ytd-searchbox-placeholder-color:' + p.muted,
      '--ytd-searchbox-legacy-border-color:' + p.border,
      '--ytd-searchbox-legacy-button-color:' + p.button,
      '--ytd-searchbox-legacy-button-hover-color:' + p.raised,
      '--ytd-searchbox-legacy-button-border-color:' + p.border,
    ].join(' !important;') + ' !important;';
    return vars;
  }

  function youtubeShadowCSS(remap) {
    if (!isYouTubeHost()) return '';
    const p = youtubePalette(remap);
    return ':host{' + youtubeVarsCSS(p) + 'color-scheme:' + p.scheme + ' !important;background:' + p.surface + ' !important;color:' + p.text + ' !important;}'
      + '#chip-container,.ytChipShapeChip,yt-chip-cloud-chip-renderer,#button.yt-chip-cloud-chip-renderer{background:' + p.chip + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;}'
      + ':host([selected]) #chip-container,:host([iron-selected]) #chip-container,:host([aria-selected="true"]) #chip-container,#chip-container[selected],#chip-container[aria-selected="true"],.ytChipShapeChip[aria-selected="true"]{background:' + p.selected + ' !important;color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + ':host([selected]) #chip-container *,:host([iron-selected]) #chip-container *,:host([aria-selected="true"]) #chip-container *,#chip-container[selected] *,#chip-container[aria-selected="true"] *,.ytChipShapeChip[aria-selected="true"] *{color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + youtubeChipRailCSS(p)
      + '#text,#label,yt-formatted-string,paper-item,tp-yt-paper-item,a,#endpoint,#title,.title,.style-scope{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '.yt-core-attributed-string,.yt-core-attributed-string *,[class*="yt-lockup" i],[class*="yt-lockup" i] *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + ':host([selected]) #text,:host([selected]) #label,:host([selected]) yt-formatted-string,:host([selected]) #chip-container *,:host([iron-selected]) #text,:host([iron-selected]) #label,:host([iron-selected]) yt-formatted-string,:host([iron-selected]) #chip-container *,:host([aria-selected="true"]) #text,:host([aria-selected="true"]) #label,:host([aria-selected="true"]) yt-formatted-string,:host([aria-selected="true"]) #chip-container *,#chip-container[selected] *,#chip-container[aria-selected="true"] *,.ytChipShapeChip[aria-selected="true"],.ytChipShapeChip[aria-selected="true"] *{color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#metadata-line,#metadata-line span,#byline-container,#channel-name,#subtitle,#description,.secondary,.metadata{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + youtubeSearchControlCSS(p)
      + ':host(:not(ytd-searchbox):not(yt-searchbox)) #button,:host(:not(ytd-searchbox):not(yt-searchbox)) button,:host(:not(ytd-searchbox):not(yt-searchbox)) yt-icon-button{background:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;}'
      + 'yt-icon,yt-icon-shape,.yt-icon-shape,svg,path{color:' + p.text + ' !important;fill:currentColor !important;}'
      + youtubeShadowChipCSS(p)
      + youtubeShadowSubscribeButtonCSS(p);
  }

  function youtubeSearchControlCSS(p) {
    const frame = 'ytd-searchbox #search-form,yt-searchbox #search-form,#search-form.ytd-searchbox,#search-form.yt-searchbox,.ytSearchboxComponentSearchForm,[class*="ytSearchboxComponentSearchForm" i]';
    const box = 'ytd-searchbox #container,yt-searchbox #container,#container.ytd-searchbox,#container.yt-searchbox,.ytSearchboxComponentInputBox,[class*="ytSearchboxComponentInputBox" i]';
    const input = '#search-input,#search-input input,ytd-searchbox input,yt-searchbox input,input#search,input.ytd-searchbox,input.yt-searchbox,#search.ytd-searchbox,#search.yt-searchbox,.ytSearchboxComponentInput,.ytSearchboxComponentInputBox input,[class*="ytSearchboxComponentInput" i]';
    const button = 'ytd-searchbox #search-icon-legacy,yt-searchbox #search-icon-legacy,#search-icon-legacy.ytd-searchbox,#search-icon-legacy.yt-searchbox,.ytSearchboxComponentSearchButton,.ytSearchboxComponentSearchButton button,[class*="ytSearchboxComponentSearchButton" i]';
    const icon = 'ytd-searchbox yt-icon,ytd-searchbox yt-icon-shape,ytd-searchbox svg,ytd-searchbox path,yt-searchbox yt-icon,yt-searchbox yt-icon-shape,yt-searchbox svg,yt-searchbox path,.ytSearchboxComponentSearchIcon,.ytSearchboxComponentSearchIcon svg,.ytSearchboxComponentSearchIcon path,.ytSearchboxComponentClearButton svg,.ytSearchboxComponentClearButton path,[class*="ytSearchboxComponentSearchIcon" i],[class*="ytSearchboxComponentSearchIcon" i] svg,[class*="ytSearchboxComponentSearchIcon" i] path';
    return frame + '{color:' + p.text + ' !important;}'
      + box + '{background:' + p.input + ' !important;background-color:' + p.input + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + input + '{background:transparent !important;background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + p.text + ' !important;}'
      + input + '::placeholder{color:' + p.muted + ' !important;-webkit-text-fill-color:' + p.muted + ' !important;opacity:1 !important;}'
      + button + '{background:' + p.button + ' !important;background-color:' + p.button + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + icon + '{color:' + p.text + ' !important;fill:currentColor !important;stroke:currentColor !important;}'
      + youtubeSearchSuggestionsCSS(p);
  }

  function youtubeShadowChipCSS(p) {
    const chip = '#chip-container,.ytChipShapeChip,[class*="ytChipShape" i],[class*="yt-chip-shape" i],:host([chip-style]) #button,:host([chip-style]) button,:host-context(yt-chip-cloud-chip-renderer) button';
    const selected = ':host([chip-style][selected]) #chip-container,:host([chip-style][selected]) #button,:host([chip-style][selected]) button,:host([chip-style][selected]) .ytChipShapeChip,:host([chip-style][selected]) [class*="ytChipShape" i],:host([chip-style][selected]) [class*="yt-chip-shape" i],:host([chip-style][iron-selected]) #chip-container,:host([chip-style][iron-selected]) #button,:host([chip-style][iron-selected]) button,:host([chip-style][iron-selected]) .ytChipShapeChip,:host([chip-style][iron-selected]) [class*="ytChipShape" i],:host([chip-style][iron-selected]) [class*="yt-chip-shape" i],:host([chip-style][aria-selected="true"]) #chip-container,:host([chip-style][aria-selected="true"]) #button,:host([chip-style][aria-selected="true"]) button,:host([chip-style][aria-selected="true"]) .ytChipShapeChip,:host([chip-style][aria-selected="true"]) [class*="ytChipShape" i],:host([chip-style][aria-selected="true"]) [class*="yt-chip-shape" i],:host-context(yt-chip-cloud-chip-renderer[selected]) button,:host-context(yt-chip-cloud-chip-renderer[iron-selected]) button,:host-context(yt-chip-cloud-chip-renderer[aria-selected="true"]) button,:host-context(yt-chip-cloud-chip-renderer[class*="selected" i]) button,#chip-container[selected],#chip-container[aria-selected="true"],.ytChipShapeChip[selected],.ytChipShapeChip[aria-selected="true"],.ytChipShapeChip[aria-pressed="true"],.ytChipShapeChip[class*="selected" i],[class*="ytChipShape" i][class*="selected" i],[class*="yt-chip-shape" i][class*="selected" i]';
    return chip + '{background:' + p.chip + ' !important;background-color:' + p.chip + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + selected + '{background:' + p.selected + ' !important;background-color:' + p.selected + ' !important;background-image:none !important;color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + selected + ' *{color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}';
  }

  function youtubeShadowSubscribeButtonCSS(p) {
    const sub = youtubeSubscribePalette(p);
    const subBg = sub.bg;
    const subText = sub.text;
    const subBorder = sub.border;
    const subscribedBg = sub.bg;
    const subscribedText = sub.text;
    const subscribedBorder = sub.border;
    const subHost = [
      ':host-context(#subscribe-button)',
      ':host-context(ytd-subscribe-button-renderer)',
      ':host-context(yt-subscribe-button-view-model)'
    ];
    const joinHost = [
      ':host-context(#sponsor-button)',
      ':host-context(ytd-button-renderer#sponsor-button)',
      ':host-context(ytd-sponsor-button-renderer)',
      ':host-context(ytd-sponsorships-button-renderer)',
      ':host-context(yt-sponsorships-button-view-model)'
    ];
    const subscribedHost = [
      ':host-context(ytd-subscribe-button-renderer[subscribed])',
      ':host-context(yt-subscribe-button-view-model[subscribed])'
    ];
    const notifyHost = [
      ':host-context(#notification-preference-button)',
      ':host-context(ytd-subscription-notification-toggle-button-renderer)',
      ':host-context(notification-button-view-model)'
    ];
    const buttonParts = [' button', ' .yt-spec-button-shape-next'];
    const textParts = [' #text', ' #label', ' span', ' yt-formatted-string', ' .yt-core-attributed-string', ' .yt-spec-button-shape-next__button-text-content', ' [class*="button-text" i]', ' [class*="text-content" i]', ' slot', '::slotted(*)'];
    const subscribe = scopedSelectors(subHost, buttonParts) + ',button[aria-label*="Subscribe" i],.yt-spec-button-shape-next[aria-label*="Subscribe" i]';
    const subscribeText = scopedSelectors(subHost, textParts);
    const join = scopedSelectors(joinHost, buttonParts) + ',button[aria-label*="Join" i],.yt-spec-button-shape-next[aria-label*="Join" i]';
    const joinText = scopedSelectors(joinHost, textParts);
    const subscribed = scopedSelectors(subscribedHost, buttonParts) + ',button[aria-label*="Subscribed" i],button[aria-label*="Unsubscribe" i],.yt-spec-button-shape-next[aria-label*="Subscribed" i],.yt-spec-button-shape-next[aria-label*="Unsubscribe" i]';
    const subscribedTextSel = scopedSelectors(subscribedHost, textParts);
    const notify = scopedSelectors(notifyHost, buttonParts);
    const notifyText = scopedSelectors(notifyHost, textParts);
    const notifyIcon = scopedSelectors(notifyHost, [' yt-icon', ' yt-icon-shape', ' yt-animated-icon', ' .yt-icon-shape', ' svg', ' path', ' use', ' .yt-spec-icon-shape']);
    return scopedSelectors(subHost, ['']) + '{' + youtubeTextVars(subText) + 'color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;}'
      + subscribe + '{background:' + subBg + ' !important;background-color:' + subBg + ' !important;background-image:none !important;color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;border:1px solid ' + subBorder + ' !important;border-color:' + subBorder + ' !important;border-radius:9999px !important;box-shadow:none !important;overflow:hidden !important;}'
      + subscribe + ' *,' + subscribeText + ',' + subscribeText + ' *{color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + scopedSelectors(joinHost, ['']) + '{' + youtubeTextVars(subText) + 'color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;}'
      + join + '{background:' + subBg + ' !important;background-color:' + subBg + ' !important;background-image:none !important;color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;border:1px solid ' + subBorder + ' !important;border-color:' + subBorder + ' !important;border-radius:9999px !important;box-shadow:none !important;overflow:hidden !important;}'
      + join + ' *,' + joinText + ',' + joinText + ' *{color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + scopedSelectors(subscribedHost, ['']) + '{' + youtubeTextVars(subscribedText) + 'color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;}'
      + subscribed + '{background:' + subscribedBg + ' !important;background-color:' + subscribedBg + ' !important;background-image:none !important;color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;border:1px solid ' + subscribedBorder + ' !important;border-color:' + subscribedBorder + ' !important;border-radius:9999px !important;box-shadow:none !important;overflow:hidden !important;}'
      + subscribed + ' *,' + subscribedTextSel + ',' + subscribedTextSel + ' *{color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + notify + '{background:' + subscribedBg + ' !important;background-color:' + subscribedBg + ' !important;background-image:none !important;color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;border:1px solid ' + subscribedBorder + ' !important;border-color:' + subscribedBorder + ' !important;border-radius:9999px !important;box-shadow:none !important;overflow:hidden !important;}'
      + notify + ' *,' + notifyText + ',' + notifyText + ' *{color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + notifyIcon + ',' + notifyIcon + ' *{color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}';
  }

  function youtubeDocumentChipCSS(p) {
    const chip = 'yt-chip-cloud-chip-renderer,yt-chip-cloud-chip-renderer[chip-style="STYLE_DEFAULT"],yt-chip-cloud-chip-renderer #chip-container,yt-chip-cloud-chip-renderer #button,yt-chip-cloud-chip-renderer button,yt-chip-cloud-chip-renderer .ytChipShapeChip,yt-chip-cloud-chip-renderer [class*="ytChipShape" i],yt-chip-cloud-chip-renderer [class*="yt-chip-shape" i]';
    const selected = 'yt-chip-cloud-chip-renderer[selected],yt-chip-cloud-chip-renderer[iron-selected],yt-chip-cloud-chip-renderer[aria-selected="true"],yt-chip-cloud-chip-renderer[class*="selected" i],yt-chip-cloud-chip-renderer[selected] #chip-container,yt-chip-cloud-chip-renderer[iron-selected] #chip-container,yt-chip-cloud-chip-renderer[aria-selected="true"] #chip-container,yt-chip-cloud-chip-renderer[class*="selected" i] #chip-container,yt-chip-cloud-chip-renderer[selected] #button,yt-chip-cloud-chip-renderer[iron-selected] #button,yt-chip-cloud-chip-renderer[aria-selected="true"] #button,yt-chip-cloud-chip-renderer[class*="selected" i] #button,yt-chip-cloud-chip-renderer[selected] button,yt-chip-cloud-chip-renderer[iron-selected] button,yt-chip-cloud-chip-renderer[aria-selected="true"] button,yt-chip-cloud-chip-renderer[class*="selected" i] button,yt-chip-cloud-chip-renderer .ytChipShapeChip[selected],yt-chip-cloud-chip-renderer .ytChipShapeChip[aria-selected="true"],yt-chip-cloud-chip-renderer .ytChipShapeChip[aria-pressed="true"],yt-chip-cloud-chip-renderer .ytChipShapeChip[class*="selected" i],yt-chip-cloud-chip-renderer [class*="ytChipShape" i][class*="selected" i],yt-chip-cloud-chip-renderer [class*="yt-chip-shape" i][class*="selected" i]';
    return chip + '{background:' + p.chip + ' !important;background-color:' + p.chip + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + chip + ' *{color:inherit !important;-webkit-text-fill-color:currentColor !important;}'
      + selected + '{background:' + p.selected + ' !important;background-color:' + p.selected + ' !important;background-image:none !important;color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + selected + ' *{color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}';
  }

  function youtubeSearchSuggestionsCSS(p) {
    const panel = p.scheme === 'light' ? '#ffffff' : p.raised;
    const hover = p.scheme === 'light' ? '#f1f1f1' : p.chip;
    const shadow = p.scheme === 'light' ? '0 4px 16px #00000024' : '0 4px 18px #00000080';
    const popup = 'ytd-searchbox #suggestions,yt-searchbox #suggestions,ytd-searchbox tp-yt-paper-listbox,yt-searchbox tp-yt-paper-listbox,yt-searchbox-suggestions,yt-searchbox-suggestions #container,.ytSearchboxComponentSuggestionsContainer,.ytSearchboxComponentSuggestions,.ytSearchboxComponentSuggestionsList,[class*="ytSearchboxComponentSuggestions" i],.sbdd_b,.sbsb_a,.sbsb_b';
    const item = 'ytd-searchbox tp-yt-paper-item,yt-searchbox tp-yt-paper-item,yt-searchbox-suggestions [role="option"],yt-searchbox-suggestions li,yt-searchbox-suggestions yt-searchbox-suggestion,.ytSearchboxComponentSuggestion,.ytSuggestionComponent,[class*="ytSearchboxComponentSuggestion" i],[class*="ytSuggestionComponent" i],.sbsb_c,.sbqs_c,.sbpqs_a';
    const text = item + ',' + item + ' *,yt-searchbox-suggestions .yt-core-attributed-string,yt-searchbox-suggestions .yt-core-attributed-string *';
    const icon = 'yt-searchbox-suggestions yt-icon,yt-searchbox-suggestions yt-icon-shape,yt-searchbox-suggestions svg,yt-searchbox-suggestions path,ytd-searchbox #suggestions yt-icon,ytd-searchbox #suggestions svg,ytd-searchbox #suggestions path,.ytSearchboxComponentSuggestionsContainer yt-icon,.ytSearchboxComponentSuggestionsContainer svg,.ytSearchboxComponentSuggestionsContainer path,[class*="ytSearchboxComponentSuggestions" i] yt-icon,[class*="ytSearchboxComponentSuggestions" i] svg,[class*="ytSearchboxComponentSuggestions" i] path';
    const hoverItem = item.split(',').map((sel) => sel + ':hover,' + sel + '[selected],' + sel + '[aria-selected="true"]').join(',');
    return popup + '{background:' + panel + ' !important;background-color:' + panel + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:' + shadow + ' !important;}'
      + item + '{background:' + panel + ' !important;background-color:' + panel + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + hoverItem + '{background:' + hover + ' !important;background-color:' + hover + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + text + '{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + icon + '{color:' + p.muted + ' !important;fill:currentColor !important;stroke:currentColor !important;}';
  }

  function youtubeNotificationsPanelCSS(p) {
    const panel = p.scheme === 'light' ? '#ffffff' : p.raised;
    const item = p.scheme === 'light' ? '#ffffff' : p.raised;
    const hover = p.scheme === 'light' ? '#f1f1f1' : p.chip;
    const unread = p.scheme === 'light' ? '#f8fafd' : p.chip;
    const shadow = p.scheme === 'light' ? '0 4px 18px #00000024' : '0 4px 18px #00000080';
    const shell = 'ytd-popup-container,ytd-popup-container tp-yt-iron-dropdown,ytd-popup-container tp-yt-paper-dialog,ytd-popup-container ytd-multi-page-menu-renderer,ytd-popup-container ytd-menu-popup-renderer,ytd-popup-container tp-yt-paper-listbox,ytd-multi-page-menu-renderer,ytd-menu-popup-renderer,tp-yt-paper-dialog,tp-yt-paper-listbox';
    const header = 'ytd-popup-container ytd-multi-page-menu-renderer #header,ytd-popup-container ytd-multi-page-menu-renderer #header *,ytd-popup-container ytd-multi-page-menu-renderer ytd-simple-menu-header-renderer,ytd-popup-container ytd-multi-page-menu-renderer ytd-simple-menu-header-renderer *';
    const notification = 'ytd-popup-container ytd-notification-renderer,ytd-popup-container ytd-notification-renderer #content,ytd-popup-container ytd-notification-renderer #body,ytd-popup-container ytd-notification-renderer #metadata,ytd-popup-container ytd-notification-renderer #details,ytd-popup-container ytd-notification-renderer #text,ytd-popup-container ytd-notification-renderer #message';
    const notificationText = 'ytd-popup-container ytd-notification-renderer yt-formatted-string,ytd-popup-container ytd-notification-renderer .yt-core-attributed-string,ytd-popup-container ytd-notification-renderer .yt-core-attributed-string *,ytd-popup-container ytd-notification-renderer #message,ytd-popup-container ytd-notification-renderer #title,ytd-popup-container ytd-multi-page-menu-renderer #title,ytd-popup-container ytd-multi-page-menu-renderer #label';
    const notificationMuted = 'ytd-popup-container ytd-notification-renderer #metadata,ytd-popup-container ytd-notification-renderer #metadata *,ytd-popup-container ytd-notification-renderer #time,ytd-popup-container ytd-notification-renderer #time *,ytd-popup-container ytd-multi-page-menu-renderer #subtitle,ytd-popup-container ytd-multi-page-menu-renderer #subtitle *';
    const icons = 'ytd-popup-container ytd-multi-page-menu-renderer yt-icon,ytd-popup-container ytd-multi-page-menu-renderer yt-icon-shape,ytd-popup-container ytd-multi-page-menu-renderer svg,ytd-popup-container ytd-multi-page-menu-renderer path,ytd-popup-container ytd-notification-renderer yt-icon,ytd-popup-container ytd-notification-renderer yt-icon-shape,ytd-popup-container ytd-notification-renderer svg,ytd-popup-container ytd-notification-renderer path';
    return shell + '{background:' + panel + ' !important;background-color:' + panel + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:' + shadow + ' !important;}'
      + header + '{background:' + panel + ' !important;background-color:' + panel + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;text-shadow:none !important;}'
      + notification + '{background:' + item + ' !important;background-color:' + item + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + 'ytd-popup-container ytd-notification-renderer:hover,ytd-popup-container ytd-notification-renderer:focus-within,ytd-popup-container ytd-notification-renderer[selected]{background:' + hover + ' !important;background-color:' + hover + ' !important;color:' + p.text + ' !important;}'
      + 'ytd-popup-container ytd-notification-renderer[unread],ytd-popup-container ytd-notification-renderer[is-unread],ytd-popup-container ytd-notification-renderer[aria-label*="unread" i]{background:' + unread + ' !important;background-color:' + unread + ' !important;color:' + p.text + ' !important;}'
      + notificationText + '{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + notificationMuted + '{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + icons + '{color:' + p.text + ' !important;fill:currentColor !important;stroke:currentColor !important;}'
      + 'ytd-popup-container ytd-notification-renderer img,ytd-popup-container ytd-notification-renderer yt-img-shadow,ytd-popup-container ytd-notification-renderer ytd-thumbnail,ytd-popup-container ytd-notification-renderer video{filter:none !important;background:transparent !important;}';
  }

  function youtubeChipRailCSS(p) {
    const rail = 'ytd-feed-filter-chip-bar-renderer,ytd-feed-filter-chip-bar-renderer #chips-wrapper,ytd-feed-filter-chip-bar-renderer #chips-content,ytd-feed-filter-chip-bar-renderer #chips,yt-chip-cloud-renderer,yt-chip-cloud-renderer #chips,yt-chip-cloud-renderer #chips-wrapper,yt-chip-cloud-renderer #scroll-container,[class*="ytChipCloudRenderer" i],[class*="ytHorizontalListRenderer" i]';
    const arrows = 'ytd-feed-filter-chip-bar-renderer #left-arrow,ytd-feed-filter-chip-bar-renderer #right-arrow,ytd-feed-filter-chip-bar-renderer #left-arrow-button,ytd-feed-filter-chip-bar-renderer #right-arrow-button,yt-chip-cloud-renderer #left-arrow,yt-chip-cloud-renderer #right-arrow,yt-chip-cloud-renderer #left-arrow-button,yt-chip-cloud-renderer #right-arrow-button,yt-chip-cloud-renderer yt-icon-button,ytd-feed-filter-chip-bar-renderer yt-icon-button,[class*="leftArrow" i],[class*="rightArrow" i],[class*="chipCloudArrow" i]';
    const beforeAfter = 'ytd-feed-filter-chip-bar-renderer #left-arrow::before,ytd-feed-filter-chip-bar-renderer #left-arrow:before,ytd-feed-filter-chip-bar-renderer #right-arrow::before,ytd-feed-filter-chip-bar-renderer #right-arrow:before,yt-chip-cloud-renderer #left-arrow::before,yt-chip-cloud-renderer #left-arrow:before,yt-chip-cloud-renderer #right-arrow::before,yt-chip-cloud-renderer #right-arrow:before';
    return rail + '{background:' + p.bg + ' !important;background-color:' + p.bg + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + arrows + '{background:' + p.bg + ' !important;background-color:' + p.bg + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;}'
      + arrows + ' *,ytd-feed-filter-chip-bar-renderer #left-arrow svg,ytd-feed-filter-chip-bar-renderer #right-arrow svg,yt-chip-cloud-renderer #left-arrow svg,yt-chip-cloud-renderer #right-arrow svg{background:transparent !important;color:' + p.text + ' !important;fill:currentColor !important;stroke:currentColor !important;}'
      + beforeAfter + '{background:' + p.bg + ' !important;background-color:' + p.bg + ' !important;box-shadow:none !important;}';
  }

  function youtubeWatchPageCSS(p) {
    const surface = p.scheme === 'light' ? '#ffffff' : p.surface;
    const panel = p.scheme === 'light' ? '#ffffff' : p.raised;
    const soft = p.scheme === 'light' ? '#f1f1f1' : p.chip;
    const card = p.scheme === 'light' ? '#f8f8f8' : p.raised;
    const link = p.link;
    return 'ytd-watch-flexy:not([fullscreen]) #columns,ytd-watch-flexy:not([fullscreen]) #primary,ytd-watch-flexy:not([fullscreen]) #secondary,ytd-watch-flexy:not([fullscreen]) #below,ytd-watch-flexy:not([fullscreen]) #below #comments{background:' + surface + ' !important;color:' + p.text + ' !important;}'
      + 'ytd-watch-metadata,ytd-watch-metadata #above-the-fold,ytd-watch-metadata #title,ytd-watch-metadata #bottom-row,ytd-video-primary-info-renderer,ytd-video-secondary-info-renderer,ytd-structured-description-content-renderer,ytd-text-inline-expander,ytd-expander{background:transparent !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + 'ytd-watch-metadata h1,ytd-watch-metadata h1 *,ytd-watch-metadata #title,ytd-watch-metadata #title *,ytd-watch-metadata yt-formatted-string,ytd-watch-metadata yt-attributed-string,ytd-watch-metadata .yt-core-attributed-string,ytd-watch-metadata .yt-core-attributed-string *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'ytd-watch-metadata #owner,ytd-watch-metadata #owner *,ytd-watch-metadata #channel-name,ytd-watch-metadata #channel-name *,ytd-watch-metadata #upload-info,ytd-watch-metadata #upload-info *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'ytd-watch-metadata #info,ytd-watch-metadata #info *,ytd-watch-metadata #metadata,ytd-watch-metadata #metadata *,ytd-watch-metadata #description,ytd-watch-metadata #description *,ytd-text-inline-expander #content,ytd-text-inline-expander #content *{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'ytd-watch-metadata #description,ytd-watch-metadata #description-inner,ytd-watch-metadata #description-container,ytd-watch-metadata #description.ytd-watch-metadata,ytd-text-inline-expander,ytd-text-inline-expander[expanded],ytd-text-inline-expander #content,ytd-structured-description-content-renderer,ytd-structured-description-content-renderer #items,ytd-video-description-infocards-section-renderer,ytd-compact-infocard-renderer,ytd-info-panel-container-renderer,ytd-metadata-row-container-renderer,ytd-metadata-row-renderer,ytd-horizontal-card-list-renderer,ytd-compact-link-renderer,ytd-universal-watch-card-renderer,ytd-event-ticket-button-renderer{background:' + card + ' !important;background-color:' + card + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + 'ytd-watch-metadata #description:hover,ytd-watch-metadata #description:active,ytd-watch-metadata #description:focus-within,ytd-text-inline-expander:hover,ytd-text-inline-expander:active,ytd-text-inline-expander:focus-within,ytd-structured-description-content-renderer:hover,ytd-compact-link-renderer:hover,ytd-compact-link-renderer:active,ytd-metadata-row-renderer:hover,ytd-metadata-row-renderer:active,ytd-horizontal-card-list-renderer:hover,ytd-horizontal-card-list-renderer:active{background:' + card + ' !important;background-color:' + card + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'ytd-structured-description-content-renderer *,ytd-video-description-infocards-section-renderer *,ytd-compact-infocard-renderer *,ytd-info-panel-container-renderer *,ytd-metadata-row-container-renderer *,ytd-metadata-row-renderer *,ytd-horizontal-card-list-renderer *,ytd-compact-link-renderer *,ytd-universal-watch-card-renderer *,ytd-event-ticket-button-renderer *{color:inherit !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'ytd-watch-metadata a,ytd-watch-metadata a *,ytd-text-inline-expander a,ytd-text-inline-expander a *,ytd-comments a,ytd-comments a *{color:' + link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'ytd-playlist-panel-renderer,ytd-playlist-panel-renderer #container,ytd-playlist-panel-renderer #header-container,ytd-playlist-panel-renderer #header-contents,ytd-playlist-panel-renderer #items,ytd-playlist-panel-renderer #contents,ytd-playlist-panel-renderer ytd-playlist-panel-video-renderer{background:' + panel + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + 'ytd-playlist-panel-renderer ytd-playlist-panel-video-renderer[selected],ytd-playlist-panel-renderer ytd-playlist-panel-video-renderer[active],ytd-playlist-panel-renderer ytd-playlist-panel-video-renderer:hover{background:' + soft + ' !important;color:' + p.text + ' !important;}'
      + 'ytd-playlist-panel-renderer #video-title,ytd-playlist-panel-renderer #video-title *,ytd-playlist-panel-renderer #playlist-title,ytd-playlist-panel-renderer #playlist-title *,ytd-playlist-panel-renderer #title,ytd-playlist-panel-renderer #title *,ytd-playlist-panel-renderer yt-formatted-string,ytd-playlist-panel-renderer .yt-core-attributed-string,ytd-playlist-panel-renderer .yt-core-attributed-string *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'ytd-playlist-panel-renderer #byline,ytd-playlist-panel-renderer #byline *,ytd-playlist-panel-renderer #video-info,ytd-playlist-panel-renderer #video-info *,ytd-playlist-panel-renderer #publisher-container,ytd-playlist-panel-renderer #publisher-container *{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'ytd-playlist-panel-renderer yt-icon,ytd-playlist-panel-renderer yt-icon-shape,ytd-playlist-panel-renderer svg,ytd-playlist-panel-renderer path{color:' + p.text + ' !important;fill:currentColor !important;stroke:currentColor !important;}'
      + 'ytd-comments,ytd-comments #sections,ytd-comments #contents,ytd-comments-header-renderer,ytd-comment-thread-renderer,ytd-comment-view-model,ytd-comment-renderer,ytd-comment-replies-renderer,ytd-comment-reply-dialog-renderer{background:' + surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + 'ytd-comments ytd-comment-thread-renderer,ytd-comments ytd-comment-view-model,ytd-comments ytd-comment-renderer,ytd-comments ytd-comment-replies-renderer,ytd-comments #comment,ytd-comments #main,ytd-comments #main *,ytd-comments #body,ytd-comments #body *,ytd-comments #content,ytd-comments #content-text,ytd-comments #content-text *,ytd-comments #comment-content,ytd-comments #comment-content *,ytd-comments yt-formatted-string,ytd-comments yt-attributed-string,ytd-comments .yt-core-attributed-string,ytd-comments .yt-core-attributed-string *{background:transparent !important;background-color:transparent !important;box-shadow:none !important;}'
      + 'ytd-comments h2,ytd-comments h2 *,ytd-comments #title,ytd-comments #title *,ytd-comments #content-text,ytd-comments #content-text *,ytd-comments #comment-content,ytd-comments #comment-content *,ytd-comments #main,ytd-comments #main *,ytd-comments yt-formatted-string,ytd-comments yt-attributed-string,ytd-comments .yt-core-attributed-string,ytd-comments .yt-core-attributed-string *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'ytd-comments #author-text,ytd-comments #author-text *,ytd-comments #header-author,ytd-comments #header-author *,ytd-comments #published-time-text,ytd-comments #published-time-text *,ytd-comments #vote-count-middle,ytd-comments #vote-count-middle *,ytd-comments #simplebox-placeholder,ytd-comments #placeholder-area,ytd-comments #placeholder-area *{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'ytd-comments yt-icon,ytd-comments yt-icon-shape,ytd-comments svg,ytd-comments path,ytd-comments button,ytd-comments yt-icon-button{background:transparent !important;color:' + p.text + ' !important;fill:currentColor !important;stroke:currentColor !important;border-color:transparent !important;box-shadow:none !important;}'
      + 'ytd-watch-metadata #top-level-buttons-computed,ytd-watch-metadata ytd-menu-renderer,ytd-watch-metadata segmented-like-dislike-button-view-model,ytd-watch-metadata like-button-view-model,ytd-watch-metadata dislike-button-view-model,ytd-watch-metadata ytd-segmented-like-dislike-button-renderer{background:transparent !important;color:' + p.text + ' !important;border-color:transparent !important;}'
      + 'ytd-watch-metadata #top-level-buttons-computed button,ytd-watch-metadata #top-level-buttons-computed yt-button-shape,ytd-watch-metadata #top-level-buttons-computed button-view-model,ytd-watch-metadata #top-level-buttons-computed .yt-spec-button-shape-next,ytd-watch-metadata #top-level-buttons-computed .yt-spec-button-shape-next__button-text-content,ytd-watch-metadata segmented-like-dislike-button-view-model button,ytd-watch-metadata like-button-view-model button,ytd-watch-metadata dislike-button-view-model button{background:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;}'
      + 'ytd-watch-metadata #top-level-buttons-computed yt-icon,ytd-watch-metadata #top-level-buttons-computed yt-icon-shape,ytd-watch-metadata #top-level-buttons-computed .yt-icon-shape,ytd-watch-metadata #top-level-buttons-computed yt-animated-icon,ytd-watch-metadata #top-level-buttons-computed svg,ytd-watch-metadata #top-level-buttons-computed path,ytd-watch-metadata segmented-like-dislike-button-view-model yt-icon,ytd-watch-metadata segmented-like-dislike-button-view-model yt-icon-shape,ytd-watch-metadata segmented-like-dislike-button-view-model svg,ytd-watch-metadata segmented-like-dislike-button-view-model path,ytd-watch-metadata like-button-view-model yt-icon,ytd-watch-metadata like-button-view-model yt-icon-shape,ytd-watch-metadata like-button-view-model svg,ytd-watch-metadata like-button-view-model path,ytd-watch-metadata dislike-button-view-model yt-icon,ytd-watch-metadata dislike-button-view-model yt-icon-shape,ytd-watch-metadata dislike-button-view-model svg,ytd-watch-metadata dislike-button-view-model path{background:transparent !important;color:' + p.text + ' !important;fill:currentColor !important;stroke:currentColor !important;}'
      + youtubeSubscribeButtonCSS(p)
      + 'ytd-logo,#logo,ytd-topbar-logo-renderer,#country-code{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'ytd-logo #country-code,#country-code.ytd-topbar-logo-renderer{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'ytd-logo svg,ytd-logo yt-icon,ytd-topbar-logo-renderer svg,ytd-topbar-logo-renderer yt-icon{color:' + p.text + ' !important;}'
      + 'ytd-logo #youtube-paths path:not(:first-child),ytd-logo #youtube-paths_yt1 path:not(:first-child),ytd-topbar-logo-renderer #youtube-paths path:not(:first-child),ytd-topbar-logo-renderer #youtube-paths_yt1 path:not(:first-child){fill:' + p.text + ' !important;}';
  }

  function youtubeSubscribeButtonCSS(p) {
    const sub = youtubeSubscribePalette(p);
    const subBg = sub.bg;
    const subText = sub.text;
    const subBorder = sub.border;
    const subscribedBg = sub.bg;
    const subscribedText = sub.text;
    const subscribedBorder = sub.border;
    const subHost = 'ytd-subscribe-button-renderer,yt-subscribe-button-view-model,#subscribe-button,#owner ytd-subscribe-button-renderer,#owner yt-subscribe-button-view-model,#owner #subscribe-button';
    const joinHost = 'ytd-button-renderer#sponsor-button,#sponsor-button,ytd-sponsor-button-renderer,ytd-sponsorships-button-renderer,yt-sponsorships-button-view-model,#owner ytd-button-renderer#sponsor-button,#owner #sponsor-button,#owner ytd-sponsor-button-renderer,#owner ytd-sponsorships-button-renderer,#owner yt-sponsorships-button-view-model';
    const subscribedHost = 'ytd-subscribe-button-renderer[subscribed],yt-subscribe-button-view-model[subscribed],#subscribe-button[subscribed]';
    const subscribe = 'ytd-subscribe-button-renderer button,ytd-subscribe-button-renderer .yt-spec-button-shape-next,yt-subscribe-button-view-model button,yt-subscribe-button-view-model .yt-spec-button-shape-next,#subscribe-button button,#subscribe-button .yt-spec-button-shape-next,button[aria-label*="Subscribe" i],.yt-spec-button-shape-next[aria-label*="Subscribe" i]';
    const subscribeText = 'ytd-subscribe-button-renderer #text,ytd-subscribe-button-renderer #label,ytd-subscribe-button-renderer span,ytd-subscribe-button-renderer yt-formatted-string,ytd-subscribe-button-renderer .yt-core-attributed-string,ytd-subscribe-button-renderer .yt-spec-button-shape-next__button-text-content,ytd-subscribe-button-renderer [class*="button-text" i],ytd-subscribe-button-renderer [class*="text-content" i],yt-subscribe-button-view-model #text,yt-subscribe-button-view-model #label,yt-subscribe-button-view-model span,yt-subscribe-button-view-model yt-formatted-string,yt-subscribe-button-view-model .yt-core-attributed-string,yt-subscribe-button-view-model .yt-spec-button-shape-next__button-text-content,yt-subscribe-button-view-model [class*="button-text" i],yt-subscribe-button-view-model [class*="text-content" i],#subscribe-button #text,#subscribe-button #label,#subscribe-button span,#subscribe-button yt-formatted-string,#subscribe-button .yt-core-attributed-string,#subscribe-button .yt-spec-button-shape-next__button-text-content,#subscribe-button [class*="button-text" i],#subscribe-button [class*="text-content" i]';
    const join = 'ytd-button-renderer#sponsor-button button,ytd-button-renderer#sponsor-button .yt-spec-button-shape-next,#sponsor-button button,#sponsor-button .yt-spec-button-shape-next,ytd-sponsor-button-renderer button,ytd-sponsor-button-renderer .yt-spec-button-shape-next,ytd-sponsorships-button-renderer button,ytd-sponsorships-button-renderer .yt-spec-button-shape-next,yt-sponsorships-button-view-model button,yt-sponsorships-button-view-model .yt-spec-button-shape-next,#owner #sponsor-button button,#owner #sponsor-button .yt-spec-button-shape-next,button[aria-label*="Join" i],.yt-spec-button-shape-next[aria-label*="Join" i]';
    const joinText = 'ytd-button-renderer#sponsor-button #text,ytd-button-renderer#sponsor-button #label,ytd-button-renderer#sponsor-button span,ytd-button-renderer#sponsor-button yt-formatted-string,ytd-button-renderer#sponsor-button .yt-core-attributed-string,ytd-button-renderer#sponsor-button .yt-spec-button-shape-next__button-text-content,ytd-button-renderer#sponsor-button [class*="button-text" i],ytd-button-renderer#sponsor-button [class*="text-content" i],#sponsor-button #text,#sponsor-button #label,#sponsor-button span,#sponsor-button yt-formatted-string,#sponsor-button .yt-core-attributed-string,#sponsor-button .yt-spec-button-shape-next__button-text-content,#sponsor-button [class*="button-text" i],#sponsor-button [class*="text-content" i],ytd-sponsor-button-renderer #text,ytd-sponsor-button-renderer #label,ytd-sponsor-button-renderer span,ytd-sponsor-button-renderer yt-formatted-string,ytd-sponsor-button-renderer .yt-core-attributed-string,ytd-sponsor-button-renderer .yt-spec-button-shape-next__button-text-content,ytd-sponsorships-button-renderer #text,ytd-sponsorships-button-renderer #label,ytd-sponsorships-button-renderer span,ytd-sponsorships-button-renderer yt-formatted-string,ytd-sponsorships-button-renderer .yt-core-attributed-string,ytd-sponsorships-button-renderer .yt-spec-button-shape-next__button-text-content,yt-sponsorships-button-view-model #text,yt-sponsorships-button-view-model #label,yt-sponsorships-button-view-model span,yt-sponsorships-button-view-model yt-formatted-string,yt-sponsorships-button-view-model .yt-core-attributed-string,yt-sponsorships-button-view-model .yt-spec-button-shape-next__button-text-content';
    const subscribed = 'button[aria-label*="Subscribed" i],button[aria-label*="Unsubscribe" i],.yt-spec-button-shape-next[aria-label*="Subscribed" i],.yt-spec-button-shape-next[aria-label*="Unsubscribe" i],ytd-subscribe-button-renderer[subscribed] button,ytd-subscribe-button-renderer[subscribed] .yt-spec-button-shape-next,yt-subscribe-button-view-model[subscribed] button,yt-subscribe-button-view-model[subscribed] .yt-spec-button-shape-next';
    const subscribedTextSel = 'ytd-subscribe-button-renderer[subscribed] #text,ytd-subscribe-button-renderer[subscribed] #label,ytd-subscribe-button-renderer[subscribed] span,ytd-subscribe-button-renderer[subscribed] yt-formatted-string,ytd-subscribe-button-renderer[subscribed] .yt-core-attributed-string,ytd-subscribe-button-renderer[subscribed] .yt-spec-button-shape-next__button-text-content,ytd-subscribe-button-renderer[subscribed] [class*="button-text" i],ytd-subscribe-button-renderer[subscribed] [class*="text-content" i],yt-subscribe-button-view-model[subscribed] #text,yt-subscribe-button-view-model[subscribed] #label,yt-subscribe-button-view-model[subscribed] span,yt-subscribe-button-view-model[subscribed] yt-formatted-string,yt-subscribe-button-view-model[subscribed] .yt-core-attributed-string,yt-subscribe-button-view-model[subscribed] .yt-spec-button-shape-next__button-text-content,yt-subscribe-button-view-model[subscribed] [class*="button-text" i],yt-subscribe-button-view-model[subscribed] [class*="text-content" i]';
    const notify = '#notification-preference-button button,#notification-preference-button .yt-spec-button-shape-next,ytd-subscription-notification-toggle-button-renderer button,ytd-subscription-notification-toggle-button-renderer .yt-spec-button-shape-next,notification-button-view-model button,notification-button-view-model .yt-spec-button-shape-next,#owner #notification-preference-button button,#owner ytd-subscription-notification-toggle-button-renderer button,#owner notification-button-view-model button';
    const notifyText = '#notification-preference-button #text,#notification-preference-button #label,#notification-preference-button span,#notification-preference-button yt-formatted-string,ytd-subscription-notification-toggle-button-renderer #text,ytd-subscription-notification-toggle-button-renderer #label,ytd-subscription-notification-toggle-button-renderer span,ytd-subscription-notification-toggle-button-renderer yt-formatted-string,notification-button-view-model #text,notification-button-view-model #label,notification-button-view-model span,notification-button-view-model yt-formatted-string';
    const notifyIcon = '#notification-preference-button yt-icon,#notification-preference-button yt-icon-shape,#notification-preference-button yt-animated-icon,#notification-preference-button .yt-icon-shape,#notification-preference-button svg,#notification-preference-button path,#notification-preference-button use,ytd-subscription-notification-toggle-button-renderer yt-icon,ytd-subscription-notification-toggle-button-renderer yt-icon-shape,ytd-subscription-notification-toggle-button-renderer yt-animated-icon,ytd-subscription-notification-toggle-button-renderer .yt-icon-shape,ytd-subscription-notification-toggle-button-renderer svg,ytd-subscription-notification-toggle-button-renderer path,ytd-subscription-notification-toggle-button-renderer use,notification-button-view-model yt-icon,notification-button-view-model yt-icon-shape,notification-button-view-model yt-animated-icon,notification-button-view-model .yt-icon-shape,notification-button-view-model svg,notification-button-view-model path,notification-button-view-model use,#owner #notification-preference-button yt-icon,#owner #notification-preference-button yt-icon-shape,#owner #notification-preference-button svg,#owner #notification-preference-button path';
    return subHost + '{' + youtubeTextVars(subText) + 'color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;}'
      + subscribe + '{background:' + subBg + ' !important;background-color:' + subBg + ' !important;background-image:none !important;color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;border:1px solid ' + subBorder + ' !important;border-color:' + subBorder + ' !important;border-radius:9999px !important;box-shadow:none !important;overflow:hidden !important;}'
      + subscribe + ' *,' + subscribeText + ',' + subscribeText + ' *{color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + joinHost + '{' + youtubeTextVars(subText) + 'color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;}'
      + join + '{background:' + subBg + ' !important;background-color:' + subBg + ' !important;background-image:none !important;color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;border:1px solid ' + subBorder + ' !important;border-color:' + subBorder + ' !important;border-radius:9999px !important;box-shadow:none !important;overflow:hidden !important;}'
      + join + ' *,' + joinText + ',' + joinText + ' *{color:' + subText + ' !important;-webkit-text-fill-color:' + subText + ' !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + subscribedHost + '{' + youtubeTextVars(subscribedText) + 'color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;}'
      + subscribed + '{background:' + subscribedBg + ' !important;background-color:' + subscribedBg + ' !important;background-image:none !important;color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;border:1px solid ' + subscribedBorder + ' !important;border-color:' + subscribedBorder + ' !important;border-radius:9999px !important;box-shadow:none !important;overflow:hidden !important;}'
      + subscribed + ' *,' + subscribedTextSel + ',' + subscribedTextSel + ' *{color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + notify + '{background:' + subscribedBg + ' !important;background-color:' + subscribedBg + ' !important;background-image:none !important;color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;border:1px solid ' + subscribedBorder + ' !important;border-color:' + subscribedBorder + ' !important;border-radius:9999px !important;box-shadow:none !important;overflow:hidden !important;}'
      + notify + ' *,' + notifyText + ',' + notifyText + ' *{color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + notifyIcon + ',' + notifyIcon + ' *{color:' + subscribedText + ' !important;-webkit-text-fill-color:' + subscribedText + ' !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}';
  }

  function youtubeLightCSS() {
    if (!isYouTubeHost()) return '';
    const p = youtubePalette('light');
    const vars = youtubeVarsCSS(p);
    return ':root,html,html[dark],body,ytd-app{' + vars + 'color-scheme:light !important;background:#ffffff !important;color:#0f0f0f !important;}'
      + 'html,body,ytd-app,ytd-page-manager,#content,#page-manager,ytd-watch-flexy,#columns,#primary,#secondary,ytd-browse,ytd-two-column-browse-results-renderer{background:#ffffff !important;color:#0f0f0f !important;}'
      + 'ytd-masthead,#masthead-container,#container.ytd-masthead,#background.ytd-masthead,#guide-content.ytd-app,ytd-mini-guide-renderer,tp-yt-app-drawer,ytd-guide-renderer,ytd-mini-guide-entry-renderer,ytd-guide-entry-renderer{background:#ffffff !important;color:#0f0f0f !important;border-color:#d3d3d3 !important;}'
      + youtubeChipRailCSS(p)
      + 'yt-chip-cloud-chip-renderer,yt-chip-cloud-chip-renderer[chip-style="STYLE_DEFAULT"],yt-chip-cloud-chip-renderer #chip-container{background:#f1f1f1 !important;color:#0f0f0f !important;-webkit-text-fill-color:currentColor !important;border-color:#d3d3d3 !important;}'
      + 'yt-chip-cloud-chip-renderer *,yt-chip-cloud-chip-renderer yt-formatted-string{color:inherit !important;-webkit-text-fill-color:currentColor !important;}'
      + 'yt-chip-cloud-chip-renderer[selected],yt-chip-cloud-chip-renderer[iron-selected],yt-chip-cloud-chip-renderer[aria-selected="true"],yt-chip-cloud-chip-renderer[selected] #chip-container,yt-chip-cloud-chip-renderer[iron-selected] #chip-container,yt-chip-cloud-chip-renderer[aria-selected="true"] #chip-container{background:' + p.selected + ' !important;color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;border-color:#d3d3d3 !important;}'
      + 'yt-chip-cloud-chip-renderer[selected] *,yt-chip-cloud-chip-renderer[iron-selected] *,yt-chip-cloud-chip-renderer[aria-selected="true"] *{color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + youtubeDocumentChipCSS(p)
      + 'ytd-masthead #center,ytd-masthead #end,#buttons.ytd-masthead{background:#ffffff !important;color:#0f0f0f !important;}'
      + youtubeSearchControlCSS(p)
      + youtubeNotificationsPanelCSS(p)
      + '#buttons.ytd-masthead yt-icon,#buttons.ytd-masthead yt-icon-shape,#buttons.ytd-masthead .yt-icon-shape,#buttons.ytd-masthead svg,#buttons.ytd-masthead path,#end.ytd-masthead yt-icon,#end.ytd-masthead yt-icon-shape,#end.ytd-masthead .yt-icon-shape,#end.ytd-masthead svg,#end.ytd-masthead path,ytd-topbar-menu-button-renderer yt-icon,ytd-notification-topbar-button-renderer yt-icon,#buttons.ytd-masthead ytd-button-renderer yt-icon,#end.ytd-masthead ytd-button-renderer yt-icon,#buttons.ytd-masthead button-view-model yt-icon,#end.ytd-masthead button-view-model yt-icon,#buttons.ytd-masthead yt-button-shape yt-icon,#end.ytd-masthead yt-button-shape yt-icon{color:#0f0f0f !important;fill:currentColor !important;}'
      + '#buttons.ytd-masthead button,#end.ytd-masthead button,ytd-topbar-menu-button-renderer,ytd-notification-topbar-button-renderer,#buttons.ytd-masthead ytd-button-renderer,#end.ytd-masthead ytd-button-renderer,#buttons.ytd-masthead yt-button-shape,#end.ytd-masthead yt-button-shape,#buttons.ytd-masthead button-view-model,#end.ytd-masthead button-view-model,#buttons.ytd-masthead .yt-spec-button-shape-next,#end.ytd-masthead .yt-spec-button-shape-next,#buttons.ytd-masthead .yt-spec-button-shape-next__button-text-content,#end.ytd-masthead .yt-spec-button-shape-next__button-text-content{background:transparent !important;color:#0f0f0f !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;}'
      + 'ytd-masthead #voice-search-button,ytd-masthead #voice-search-button button,ytd-masthead #voice-search-button yt-icon,ytd-masthead button yt-icon,ytd-masthead button yt-icon-shape,ytd-masthead button svg,ytd-masthead button path,ytd-masthead yt-icon-button yt-icon,ytd-masthead yt-icon-button svg,ytd-masthead yt-icon-button path{background:transparent !important;color:#0f0f0f !important;-webkit-text-fill-color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;border-color:transparent !important;box-shadow:none !important;}'
      + youtubeWatchPageCSS(p)
      + 'ytd-guide-entry-renderer yt-formatted-string,ytd-mini-guide-entry-renderer yt-formatted-string,ytd-guide-section-renderer yt-formatted-string,ytd-guide-collapsible-section-entry-renderer yt-formatted-string,ytd-guide-entry-renderer a,ytd-mini-guide-entry-renderer a,ytd-guide-renderer yt-icon,ytd-mini-guide-renderer yt-icon{color:#0f0f0f !important;-webkit-text-fill-color:currentColor !important;}'
      + 'ytd-rich-grid-media,ytd-rich-grid-media #dismissible,ytd-rich-grid-media #details,ytd-rich-grid-media #meta,ytd-rich-grid-media h3,ytd-rich-item-renderer,ytd-video-renderer,ytd-video-renderer #dismissible,ytd-video-renderer #details,ytd-video-renderer #meta,ytd-video-renderer h3,ytd-compact-video-renderer,ytd-grid-video-renderer,ytd-playlist-renderer,ytd-reel-item-renderer,#contents.ytd-rich-grid-row{background:transparent !important;color:#0f0f0f !important;border-color:transparent !important;}'
      + 'a#video-title,#video-title,yt-formatted-string#video-title,#video-title-link,#video-title-link yt-formatted-string,ytd-rich-grid-media #video-title,ytd-rich-grid-media #video-title-link,ytd-rich-grid-media #video-title-link *,ytd-video-renderer #video-title,ytd-video-renderer #video-title-link,ytd-video-renderer #video-title-link *,ytd-compact-video-renderer #video-title,ytd-compact-video-renderer #video-title-link,ytd-grid-video-renderer #video-title,ytd-grid-video-renderer #video-title-link{background:transparent !important;color:#0f0f0f !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '.yt-core-attributed-string,.yt-core-attributed-string *,yt-lockup-view-model,yt-lockup-view-model *,yt-lockup-metadata-view-model,yt-lockup-metadata-view-model *,.yt-lockup-metadata-view-model__title,.yt-lockup-metadata-view-model__title *,.yt-lockup-metadata-view-model__heading-reset,.yt-lockup-metadata-view-model__heading-reset *{background:transparent !important;color:#0f0f0f !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#metadata-line,#metadata-line span,ytd-video-meta-block,ytd-video-meta-block *,#byline-container,#channel-name,#channel-name a,ytd-channel-name a,ytd-channel-name yt-formatted-string,ytd-video-owner-renderer,ytd-video-owner-renderer a{background:transparent !important;color:#606060 !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'yt-icon-button,ytd-menu-renderer yt-icon-button,ytd-menu-renderer button,#button.yt-icon-button,#button.ytd-menu-renderer,ytd-rich-grid-media ytd-menu-renderer,ytd-video-renderer ytd-menu-renderer{background:transparent !important;color:#0f0f0f !important;border-color:transparent !important;box-shadow:none !important;}'
      + 'ytd-rich-grid-media #details *,ytd-video-renderer #details *,ytd-video-meta-block *{background:transparent !important;}'
      + youtubePlayerCSS('#ffffff')
      + '#cinematics-container,#cinematics-container *{display:none !important;opacity:0 !important;background:transparent !important;}'
      + 'video,.html5-video-player,.ytp-player-content,.ytp-chrome-bottom,.ytp-gradient-top,.ytp-gradient-bottom{filter:none !important;}';
  }

  function youtubeDarkCSS(remap) {
    if (!isYouTubeHost() || (remap !== 'dark' && remap !== 'ultra')) return '';
    const p = youtubePalette(remap);
    const vars = youtubeVarsCSS(p);
    return ':root,html,html[dark],body,ytd-app{' + vars + 'color-scheme:dark !important;background:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + 'html,body,ytd-app,ytd-page-manager,#content,#page-manager,ytd-watch-flexy,#columns,#primary,#secondary,ytd-browse,ytd-two-column-browse-results-renderer{background:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + 'ytd-masthead,#masthead-container,#container.ytd-masthead,#background.ytd-masthead,#guide-content.ytd-app,ytd-mini-guide-renderer,tp-yt-app-drawer,ytd-guide-renderer,ytd-mini-guide-entry-renderer,ytd-guide-entry-renderer{background:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + 'ytd-popup-container,tp-yt-paper-dialog,ytd-menu-popup-renderer,ytd-multi-page-menu-renderer,tp-yt-paper-listbox,ytd-engagement-panel-section-list-renderer{background:' + p.raised + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + 'ytd-consent-bump-v2-lightbox,tp-yt-paper-dialog#dialog,tp-yt-paper-dialog.eom-v1-dialog,.eom-v1-dialog,ytd-consent-bump-v2-lightbox #dialog{background:' + p.raised + ' !important;background-color:' + p.raised + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + 'ytd-consent-bump-v2-lightbox :where(h1,h2,h3,h4,p,span,div,yt-formatted-string,.legal-text,a),tp-yt-paper-dialog#dialog :where(h1,h2,h3,h4,p,span,div,yt-formatted-string,.legal-text,a),tp-yt-paper-dialog.eom-v1-dialog :where(h1,h2,h3,h4,p,span,div,yt-formatted-string,.legal-text,a),.eom-v1-dialog :where(h1,h2,h3,h4,p,span,div,yt-formatted-string,.legal-text,a){color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'ytd-consent-bump-v2-lightbox a,tp-yt-paper-dialog#dialog a,tp-yt-paper-dialog.eom-v1-dialog a,.eom-v1-dialog a{color:' + p.link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'ytd-consent-bump-v2-lightbox :where(button,tp-yt-paper-button,[role="button"]),tp-yt-paper-dialog#dialog :where(button,tp-yt-paper-button,[role="button"]),tp-yt-paper-dialog.eom-v1-dialog :where(button,tp-yt-paper-button,[role="button"]),.eom-v1-dialog :where(button,tp-yt-paper-button,[role="button"]){background:' + p.button + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + youtubeChipRailCSS(p)
      + 'yt-chip-cloud-chip-renderer,yt-chip-cloud-chip-renderer[chip-style="STYLE_DEFAULT"],yt-chip-cloud-chip-renderer #chip-container,ytd-thumbnail-overlay-time-status-renderer{background:' + p.chip + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'yt-chip-cloud-chip-renderer *,yt-chip-cloud-chip-renderer yt-formatted-string{color:inherit !important;-webkit-text-fill-color:currentColor !important;}'
      + 'yt-chip-cloud-chip-renderer[selected],yt-chip-cloud-chip-renderer[iron-selected],yt-chip-cloud-chip-renderer[aria-selected="true"],yt-chip-cloud-chip-renderer[selected] #chip-container,yt-chip-cloud-chip-renderer[iron-selected] #chip-container,yt-chip-cloud-chip-renderer[aria-selected="true"] #chip-container{background:' + p.selected + ' !important;color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'yt-chip-cloud-chip-renderer[selected] *,yt-chip-cloud-chip-renderer[iron-selected] *,yt-chip-cloud-chip-renderer[aria-selected="true"] *{color:' + p.selectedText + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + youtubeDocumentChipCSS(p)
      + 'ytd-masthead #center,ytd-masthead #end,#buttons.ytd-masthead{background:' + p.surface + ' !important;color:' + p.text + ' !important;}'
      + youtubeSearchControlCSS(p)
      + youtubeNotificationsPanelCSS(p)
      + '#buttons.ytd-masthead yt-icon,#buttons.ytd-masthead yt-icon-shape,#buttons.ytd-masthead .yt-icon-shape,#buttons.ytd-masthead svg,#buttons.ytd-masthead path,#end.ytd-masthead yt-icon,#end.ytd-masthead yt-icon-shape,#end.ytd-masthead .yt-icon-shape,#end.ytd-masthead svg,#end.ytd-masthead path,ytd-topbar-menu-button-renderer yt-icon,ytd-notification-topbar-button-renderer yt-icon,#buttons.ytd-masthead ytd-button-renderer yt-icon,#end.ytd-masthead ytd-button-renderer yt-icon,#buttons.ytd-masthead button-view-model yt-icon,#end.ytd-masthead button-view-model yt-icon,#buttons.ytd-masthead yt-button-shape yt-icon,#end.ytd-masthead yt-button-shape yt-icon{color:' + p.text + ' !important;fill:currentColor !important;}'
      + '#buttons.ytd-masthead button,#end.ytd-masthead button,ytd-topbar-menu-button-renderer,ytd-notification-topbar-button-renderer,#buttons.ytd-masthead ytd-button-renderer,#end.ytd-masthead ytd-button-renderer,#buttons.ytd-masthead yt-button-shape,#end.ytd-masthead yt-button-shape,#buttons.ytd-masthead button-view-model,#end.ytd-masthead button-view-model,#buttons.ytd-masthead .yt-spec-button-shape-next,#end.ytd-masthead .yt-spec-button-shape-next,#buttons.ytd-masthead .yt-spec-button-shape-next__button-text-content,#end.ytd-masthead .yt-spec-button-shape-next__button-text-content{background:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;}'
      + youtubeWatchPageCSS(p)
      + 'ytd-guide-entry-renderer yt-formatted-string,ytd-mini-guide-entry-renderer yt-formatted-string,ytd-guide-section-renderer yt-formatted-string,ytd-guide-collapsible-section-entry-renderer yt-formatted-string,ytd-guide-entry-renderer a,ytd-mini-guide-entry-renderer a,ytd-guide-renderer yt-icon,ytd-mini-guide-renderer yt-icon{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'ytd-rich-grid-media,ytd-rich-grid-media #dismissible,ytd-rich-grid-media #details,ytd-rich-grid-media #meta,ytd-rich-grid-media h3,ytd-rich-item-renderer,ytd-video-renderer,ytd-video-renderer #dismissible,ytd-video-renderer #details,ytd-video-renderer #meta,ytd-video-renderer h3,ytd-compact-video-renderer,ytd-grid-video-renderer,ytd-playlist-renderer,ytd-reel-item-renderer,#contents.ytd-rich-grid-row{background:transparent !important;color:' + p.text + ' !important;border-color:transparent !important;}'
      + 'ytd-background-promo-renderer,ytd-feed-nudge-renderer,ytd-rich-section-renderer,ytd-rich-section-renderer #content,ytd-rich-section-renderer #dismissible,ytd-browse ytd-rich-section-renderer :where(div,section,article){background:' + p.raised + ' !important;background-color:' + p.raised + ' !important;background-image:none !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + 'ytd-background-promo-renderer *,ytd-feed-nudge-renderer *,ytd-rich-section-renderer #content *,ytd-rich-section-renderer #dismissible *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + 'a#video-title,#video-title,yt-formatted-string#video-title,#video-title-link,#video-title-link yt-formatted-string,ytd-rich-grid-media #video-title,ytd-rich-grid-media #video-title-link,ytd-rich-grid-media #video-title-link *,ytd-video-renderer #video-title,ytd-video-renderer #video-title-link,ytd-video-renderer #video-title-link *,ytd-compact-video-renderer #video-title,ytd-compact-video-renderer #video-title-link,ytd-grid-video-renderer #video-title,ytd-grid-video-renderer #video-title-link{background:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#metadata-line,#metadata-line span,ytd-video-meta-block,ytd-video-meta-block *,#byline-container,#channel-name,#channel-name a,ytd-channel-name a,ytd-channel-name yt-formatted-string,ytd-video-owner-renderer,ytd-video-owner-renderer a{background:transparent !important;color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'yt-icon-button,ytd-menu-renderer yt-icon-button,ytd-menu-renderer button,#button.yt-icon-button,#button.ytd-menu-renderer,ytd-rich-grid-media ytd-menu-renderer,ytd-video-renderer ytd-menu-renderer{background:transparent !important;color:' + p.text + ' !important;border-color:transparent !important;box-shadow:none !important;}'
      + 'ytd-rich-grid-media #details *,ytd-video-renderer #details *,ytd-video-meta-block *{background:transparent !important;}'
      + youtubePlayerCSS(p.text)
      + '#cinematics-container,#cinematics-container *{display:none !important;opacity:0 !important;background:transparent !important;}'
      + 'video,.html5-video-player,.ytp-player-content,.ytp-chrome-bottom,.ytp-gradient-top,.ytp-gradient-bottom{filter:none !important;}';
  }

  function twitchChatAndPlayerCSS(bg, surface, raised, border, text, muted, accent) {
    const chatShell = '[data-a-target="stream-chat"],[data-a-target="stream-chat-header"],[data-test-selector="chat-room-component-layout"],.stream-chat,.chat-room,.chat-shell,.chat-list,.chat-list--default';
    const chatList = '[data-a-target="chat-scroller"],[data-test-selector="chat-scrollable-area__message-container"],.chat-scrollable-area__message-container,.chat-list__lines,[role="log"]';
    const chatMessage = '[data-a-target="chat-line-message"],[data-test-selector="chat-line-message"],.chat-line__message,.chat-line__message-container,.chat-line__message-body,.chat-line__message--emote-button';
    // The chat name is the one piece of text in here whose COLOUR is information.
    //
    // Twitch gives every participant their own hue and sets it as an inline style. This rule paints
    // chat text with `!important`, and an important stylesheet declaration outranks a normal inline
    // one -- so naming the username elements here (directly, and via the `span` catch-all) repainted
    // every person in the room to the single theme foreground. Chat became a wall of identical
    // white text with no way to tell who was speaking, which is the opposite of readable.
    //
    // The names are excluded instead, so their own colours survive. Ones that are genuinely too
    // dark against the themed background are still handled -- contrastGuard lifts them while
    // keeping their hue, rather than flattening them all to one value.
    const chatName = TWITCH_CHAT_NAME;
    const chatText = chatMessage + ',' + chatMessage + ' span' + TWITCH_NOT_CHAT_NAME + ',' + chatMessage + ' a,' + chatMessage + ' button,[data-a-target="chat-message-text"],[data-a-target="chat-message-text"] *,.text-fragment';
    const chatMeta = '[data-a-target="chat-line-timestamp"],.chat-line__timestamp,.chat-author__intl-login,.chat-line__message .tw-c-text-alt,.chat-line__message .tw-c-text-alt-2';
    const chatInput = '[data-a-target="chat-input"] textarea,[data-a-target="chat-input"] [contenteditable="true"],textarea[data-a-target="chat-input"],.chat-wysiwyg-input__editor';
    const media = '.persistent-player,.persistent-player video,.persistent-player canvas,.video-player,.video-player__container,.video-player video,.video-player canvas,[data-a-target="video-player"],[data-a-target="video-player"] video,[data-a-target="video-player"] canvas,[data-a-target="video-ref"],[data-a-target="video-ref"] video,[data-a-target="video-ref"] canvas';
    // Twitch reuses generated layout wrappers inside the player; keep those transparent so page theming cannot cover the stream.
    const playerShell = ':is(.persistent-player,.video-player,.video-player__container,[data-a-target="video-player"],.channel-root__player,.channel-root__player-container,.live-video-player,.twilight-player-root)';
    const playerScope = ':is(.persistent-player,.video-player,.video-player__container,[data-a-target="video-player"],[data-a-target="video-ref"],.channel-root__player,.channel-root__player-container,.live-video-player,.twilight-player-root,[data-a-target="player-overlay-click-handler"],[data-a-target="player-overlay-mouseover-area"],[data-a-target="player-controls"],[data-a-player-state])';
    const playerSurface = playerScope + ':where(.tw-box,.tw-c-background-base,.tw-c-background-alt,.tw-c-background-alt-2),'
      + playerScope + ' :where(.tw-box,.tw-c-background-base,.tw-c-background-alt,.tw-c-background-alt-2),'
      + playerScope + ' :where([class*="Layout-sc" i],[class*="InjectLayout-sc" i],[class*="ScAspectRatio" i],[class*="overlay" i]):not(:where(.video-player,.video-player__container,.player-controls,.player-controls *,.top-bar,.top-bar *,[data-a-target="player-controls"],[data-a-target="player-controls"] *,[role="menu"],[role="menu"] *,[role="dialog"],[role="dialog"] *))';
    const playerMedia = playerScope + ' :where(video,canvas,picture,img),'
      + playerScope + ':where(video,canvas,picture,img)';
    const playerControls = playerScope + ' :where(button,[role="button"],svg,path,[data-a-target*="player" i],[data-a-target*="volume" i])';
    return chatShell + '{background:' + surface + ' !important;background-color:' + surface + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;}'
      + chatList + '{background:' + bg + ' !important;background-color:' + bg + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;}'
      + chatMessage + '{background:transparent !important;background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;box-shadow:none !important;}'
      + chatText + '{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      // Names keep their own colour, so this only makes sure nothing else stops that colour
      // painting: currentColor resolves to whatever the site set inline, and the shadow goes.
      + chatName + '{-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + chatMeta + '{color:' + muted + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '[data-a-target="chat-badge"],[data-a-target="chat-badge"] img,.chat-badge,.chat-badge img,.chat-line__message img,.chat-line__message svg{background:transparent !important;filter:none !important;}'
      + chatInput + '{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + text + ' !important;}'
      + chatInput + '::placeholder{color:' + muted + ' !important;-webkit-text-fill-color:' + muted + ' !important;opacity:1 !important;}'
      + '[data-a-target="chat-line-message"] a,.chat-line__message a{color:' + accent + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + playerShell + '{background:#000000 !important;background-color:#000000 !important;color:#ffffff !important;}'
      + playerSurface + '{background:transparent !important;background-color:transparent !important;background-image:none !important;box-shadow:none !important;text-shadow:none !important;}'
      + playerMedia + '{background:#000000 !important;background-color:#000000 !important;filter:none !important;backdrop-filter:none !important;opacity:1 !important;visibility:visible !important;}'
      + playerControls + '{filter:none !important;backdrop-filter:none !important;}'
      + media + '{filter:none !important;backdrop-filter:none !important;}';
  }

  function twitchLightCSS() {
    if (!isTwitchHost()) return '';
    const bg = '#ffffff';
    const surface = '#f7f7f8';
    const raised = '#efeff1';
    const soft = '#e3e3e8';
    const border = '#d4d4dd';
    const text = '#0e0e10';
    const muted = '#53535f';
    const accent = '#5c16c5';
    const vars = [
      '--color-background-body:' + bg,
      '--color-background-base:' + bg,
      '--color-background-alt:' + surface,
      '--color-background-alt-2:' + raised,
      '--color-background-float:' + bg,
      '--color-background-input:' + bg,
      '--color-background-button-secondary-default:' + raised,
      '--color-background-button-secondary-hover:' + soft,
      '--color-background-button-text-default:' + surface,
      '--color-background-button-text-hover:' + raised,
      '--color-fill-base:' + bg,
      '--color-fill-current:' + text,
      '--color-text-base:' + text,
      '--color-text-alt:' + muted,
      '--color-text-input:' + text,
      '--color-text-button:' + text,
      '--color-text-overlay:#ffffff',
      '--color-text-link:' + accent,
      '--color-border-base:' + border,
      '--color-border-region:' + border,
      '--color-accent:' + accent,
      '--color-accent-label:#ffffff',
    ].join(' !important;') + ' !important;';
    return ':root,html,body,#root,.tw-root--theme-dark,.tw-root--theme-light{' + vars + 'color-scheme:light !important;background:' + bg + ' !important;color:' + text + ' !important;}'
      + 'body,#root,main,.twilight-main,.twilight-minimal-root,.channel-root,.channel-page,.channel-root__main,.channel-root__info,.channel-info-content,.channel-info-section,.about-section,.side-nav,.side-nav__overlay-wrapper,.stream-chat,.chat-room,.chat-list,.chat-list--default,.chat-shell{background:' + bg + ' !important;color:' + text + ' !important;}'
      + '#root header,#root nav,.top-nav,[data-a-target="top-nav-container"],[data-a-target="side-nav-card"],[data-a-target="stream-chat"],[data-a-target="stream-chat-header"],[data-a-target="chat-input-container"],[data-test-selector="chat-input-buttons-container"],[data-test-selector="chat-room-component-layout"]{background:' + surface + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;}'
      + '[data-a-target="stream-info-card-component"],[data-a-target="channel-info-content"],[data-a-target="channel-info-header"],[data-test-selector="channel-panels-container"],[data-test-selector="chat-scrollable-area__message-container"],.metadata-layout__support,.channel-info-content,.channel-root__info,.tw-card,.tw-c-background-base,.tw-c-background-alt,.tw-c-background-alt-2{background:' + bg + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;}'
      + '#root input:not([type="range"]):not([data-a-target="chat-input"]),#root textarea:not([data-a-target="chat-input"]):not(.chat-input__textarea),#root [contenteditable="true"]:not(.chat-wysiwyg-input__editor),#root [role="textbox"]:not([data-a-target="chat-input"]):not(.chat-wysiwyg-input__editor),#root [data-a-target="tw-input"],#root [data-a-target="search-input"]{background:' + bg + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + text + ' !important;border-color:' + border + ' !important;}'
      + '#root input::placeholder,#root textarea::placeholder{color:' + muted + ' !important;-webkit-text-fill-color:' + muted + ' !important;}'
      + '#root :where(h1,h2,h3,h4,p,label,small,strong),#root .tw-c-text-base,#root .tw-c-text-alt,#root [class*="CoreText"]' + TWITCH_NOT_CHAT_NAME + ',#root [class*="Text"]' + TWITCH_NOT_CHAT_NAME + ',#root [data-a-target="stream-title"],#root [data-a-target="channel-info-title"]{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#root .tw-c-text-alt-2,#root [data-a-target="stream-game-link"],#root [data-a-target="preview-card-channel-link"]{color:' + muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '#root .tw-link,#root a[href^="/directory"],#root a[href^="/downloads"],#root a[href^="/legal"],#root a[href^="/p/"]{color:' + accent + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '#root button:not([data-a-target*="player" i]):not([data-a-target*="volume" i]),#root [role="button"]:not([data-a-target*="player" i]):not([data-a-target*="volume" i]),#root [data-a-target="chat-settings"],#root [data-a-target="emote-picker-button"]{border-color:' + border + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '#root [data-a-target="tw-pill"],#root .tw-tag{background:' + raised + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;}'
      + 'video,.video-player,.persistent-player,.persistent-player video,.tw-image,.tw-avatar,.tw-avatar img{filter:none !important;}'
      + twitchChatAndPlayerCSS(bg, surface, raised, border, text, muted, accent);
  }

  function twitchDarkCSS(remap) {
    if (!isTwitchHost() || (remap !== 'dark' && remap !== 'ultra')) return '';
    const ultra = remap === 'ultra';
    const bg = ultra ? '#000000' : '#0e0e10';
    const surface = ultra ? '#08080b' : '#18181b';
    const raised = ultra ? '#121217' : '#1f1f23';
    const soft = ultra ? '#19191f' : '#26262c';
    const border = ultra ? '#30303a' : '#3a3a44';
    const text = '#f4f4f5';
    const muted = '#adadb8';
    const accent = '#bf94ff';
    const vars = [
      '--color-background-body:' + bg,
      '--color-background-base:' + bg,
      '--color-background-alt:' + surface,
      '--color-background-alt-2:' + raised,
      '--color-background-float:' + raised,
      '--color-background-input:' + raised,
      '--color-background-button-secondary-default:' + soft,
      '--color-background-button-text-default:' + surface,
      '--color-background-button-text-hover:' + raised,
      '--color-fill-base:' + surface,
      '--color-fill-current:' + text,
      '--color-text-base:' + text,
      '--color-text-alt:' + muted,
      '--color-text-link:' + accent,
      '--color-border-base:' + border,
      '--color-border-region:' + border,
      '--color-accent:' + accent,
      '--color-accent-label:' + text,
    ].join(' !important;') + ' !important;';
    return ':root,html,body,#root,.tw-root--theme-dark,.tw-root--theme-light{' + vars + 'color-scheme:dark !important;background:' + bg + ' !important;color:' + text + ' !important;}'
      + 'body,#root,main,.twilight-main,.twilight-minimal-root,.channel-root,.channel-page,.channel-root__main,.channel-root__info,.channel-info-content,.channel-info-section,.about-section,.side-nav,.side-nav__overlay-wrapper,.stream-chat,.chat-room,.chat-list,.chat-list--default,.chat-shell{background:' + bg + ' !important;color:' + text + ' !important;}'
      + '#root header,#root nav,.top-nav,[data-a-target="top-nav-container"],[data-a-target="side-nav-card"],[data-a-target="stream-chat"],[data-a-target="stream-chat-header"],[data-a-target="chat-input-container"],[data-test-selector="chat-input-buttons-container"],[data-test-selector="chat-room-component-layout"]{background:' + surface + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;}'
      + '[data-a-target="stream-info-card-component"],[data-a-target="channel-info-content"],[data-a-target="channel-info-header"],[data-test-selector="channel-panels-container"],[data-test-selector="chat-scrollable-area__message-container"],.metadata-layout__support,.channel-info-content,.channel-root__info,.tw-card,.tw-c-background-base,.tw-c-background-alt,.tw-c-background-alt-2{background:' + bg + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;}'
      + '#root input:not([type="range"]):not([data-a-target="chat-input"]),#root textarea:not([data-a-target="chat-input"]):not(.chat-input__textarea),#root [contenteditable="true"]:not(.chat-wysiwyg-input__editor),#root [role="textbox"]:not([data-a-target="chat-input"]):not(.chat-wysiwyg-input__editor),#root [data-a-target="tw-input"]{background:' + raised + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + text + ' !important;border-color:' + border + ' !important;}'
      + '#root input::placeholder,#root textarea::placeholder{color:' + muted + ' !important;-webkit-text-fill-color:' + muted + ' !important;}'
      + '#root :where(h1,h2,h3,h4,p,label,small,strong),#root .tw-c-text-base,#root .tw-c-text-alt,#root [class*="CoreText"]' + TWITCH_NOT_CHAT_NAME + ',#root [class*="Text"]' + TWITCH_NOT_CHAT_NAME + ',#root [data-a-target="stream-title"],#root [data-a-target="channel-info-title"]{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#root .tw-link,#root a[href^="/directory"],#root a[href^="/downloads"],#root a[href^="/legal"],#root a[href^="/p/"]{color:' + accent + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '#root button:not([data-a-target*="player" i]):not([data-a-target*="volume" i]),#root [role="button"]:not([data-a-target*="player" i]):not([data-a-target*="volume" i]),#root [data-a-target="chat-settings"],#root [data-a-target="emote-picker-button"]{border-color:' + border + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'video,.video-player,.persistent-player,.persistent-player video,.tw-image,.tw-avatar,.tw-avatar img{filter:none !important;}'
      + twitchChatAndPlayerCSS(bg, surface, raised, border, text, muted, accent);
  }

  function chatGPTCSS(mode, inShadow) {
    if (!isChatGPTHost()) return '';
    const ultra = mode === 'ultra';
    const light = mode === 'light';
    const p = light ? {
      scheme: 'light',
      bg: '#ffffff',
      surface: '#f7f7f8',
      raised: '#ececf1',
      input: '#ffffff',
      control: '#f4f4f5',
      border: '#d9d9e3',
      text: '#111111',
      muted: '#5f6368',
      link: '#0b57d0',
    } : {
      scheme: 'dark',
      bg: ultra ? '#000000' : '#111318',
      surface: ultra ? '#090a0d' : '#171a21',
      raised: ultra ? '#111318' : '#20242d',
      input: ultra ? '#0c0e12' : '#1c2028',
      control: ultra ? '#151820' : '#252a34',
      border: ultra ? '#2a2f3a' : '#363c49',
      text: '#f3f5f7',
      muted: '#a8afb9',
      link: '#8ab4ff',
    };
    const root = inShadow ? ':host' : ':root,html,body,#root,#__next';
    const vars = [
      '--text-primary:' + p.text,
      '--text-secondary:' + p.muted,
      '--text-tertiary:' + p.muted,
      '--text-quaternary:' + p.muted,
      '--text-default:' + p.text,
      '--surface-primary:' + p.bg,
      '--surface-secondary:' + p.surface,
      '--surface-tertiary:' + p.raised,
      '--surface-hover:' + p.raised,
      '--surface-active:' + p.raised,
      '--main-surface-primary:' + p.bg,
      '--main-surface-secondary:' + p.surface,
      '--main-surface-tertiary:' + p.raised,
      '--sidebar-surface-primary:' + p.surface,
      '--sidebar-surface-secondary:' + p.raised,
      '--sidebar-surface-tertiary:' + p.control,
      '--composer-surface:' + p.input,
      '--message-surface:' + p.bg,
      '--border-light:' + p.border,
      '--border-medium:' + p.border,
      '--border-heavy:' + p.border,
      '--link:' + p.link,
    ].join(' !important;') + ' !important;';
    const app = inShadow ? ':host,:host > *' : 'html,body,#root,#__next,main,[role="main"],[data-testid="conversation-turn"]';
    const sidebar = inShadow ? ':host([data-sidebar]),:host [data-sidebar]' : 'aside,nav,[data-testid*="sidebar" i],[class*="sidebar" i],[class*="bg-token-sidebar-surface-primary" i]';
    const tokenBg = '[class*="bg-token-main-surface-primary" i],[class*="bg-token-main-surface-secondary" i],[class*="bg-token-main-surface-tertiary" i],[class*="bg-token-surface-primary" i],[class*="bg-token-surface-secondary" i]';
    const tokenText = '[class*="text-token-text-primary" i],[class*="text-token-text-secondary" i],[class*="text-token-text-tertiary" i],[class*="text-token-text-quaternary" i]';
    const composerShell = 'form[data-type="unified-composer"],.composer-parent form';
    const textbox = '#prompt-textarea,#prompt-textarea *,textarea,[contenteditable="true"],[role="textbox"]';
    const bottom = '.composer-parent,[class*="bottom-0" i],[class*="sticky" i][class*="bottom" i],[class*="fixed" i][class*="bottom" i],[class*="bg-gradient-to-t" i],[class*="from-token-main-surface-primary" i],[class*="to-token-main-surface-primary" i]';
    return root + '{' + vars + 'color-scheme:' + p.scheme + ' !important;background:' + p.bg + ' !important;background-color:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + app + '{background:' + p.bg + ' !important;background-color:' + p.bg + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + sidebar + '{background:' + p.surface + ' !important;background-color:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + tokenBg + '{background:' + p.bg + ' !important;background-color:' + p.bg + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + tokenText + ',p,li,h1,h2,h3,h4,h5,h6,article,article *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '[class*="text-token-text-secondary" i],[class*="text-token-text-tertiary" i],[class*="text-token-text-quaternary" i],small,time{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'a[href],[role="link"]{color:' + p.link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + composerShell + '{background:' + p.input + ' !important;background-color:' + p.input + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + textbox + '{background:transparent !important;background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + p.text + ' !important;border-color:transparent !important;box-shadow:none !important;}'
      + bottom + '{background:' + p.bg + ' !important;background-color:' + p.bg + ' !important;background-image:none !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + 'button,[role="button"]{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;}'
      + 'form[data-type="unified-composer"] button,[data-testid*="composer" i] button,.composer-parent button{background:transparent !important;background-color:transparent !important;border-color:transparent !important;border-radius:9999px !important;box-shadow:none !important;overflow:visible !important;}'
      + 'svg,path{color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;}'
      + 'img,picture,video,canvas,iframe,embed,object{filter:none !important;}';
  }

  function googleShadowCSS(mode) {
    const dark = mode !== 'light';
    const gp = googlePaletteFor(mode);
    const bg = gp.bg;
    const surface = gp.surface;
    const raised = gp.raised;
    const input = gp.input;
    const chip = gp.chip;
    const border = gp.border;
    const text = gp.text;
    const muted = gp.muted;
    const link = gp.link;
    const vars = [
      '--gm3-sys-color-background:' + bg,
      '--gm3-sys-color-surface:' + surface,
      '--gm3-sys-color-surface-container:' + raised,
      '--gm3-sys-color-on-surface:' + text,
      '--gm3-sys-color-on-surface-variant:' + muted,
      '--gm3-sys-color-outline:' + border,
      '--gm3-sys-color-primary:' + link,
    ].join(' !important;') + ' !important;';
    return ':host{color-scheme:' + (dark ? 'dark' : 'light') + ' !important;' + vars + 'background:' + bg + ' !important;background-color:' + bg + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;}'
      + ':host,:host *{text-shadow:none !important;}'
      + ':host :where(div,section,article,aside,main,header,footer,nav,g-inner-card,g-section-with-header,block-component){background-color:transparent !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + ':host :where([style*="gradient" i],[class*="gradient" i],[class*="fade" i],[class*="overlay" i],[class*="shadow" i],[style*="rgba(0" i],[style*="rgb(0" i],[style*="#000" i]),:host :where([style*="gradient" i],[class*="gradient" i],[class*="fade" i],[class*="overlay" i],[class*="shadow" i],[style*="rgba(0" i],[style*="rgb(0" i],[style*="#000" i])::before,:host :where([style*="gradient" i],[class*="gradient" i],[class*="fade" i],[class*="overlay" i],[class*="shadow" i],[style*="rgba(0" i],[style*="rgb(0" i],[style*="#000" i])::after{background:transparent !important;background-color:transparent !important;background-image:none !important;box-shadow:none !important;}'
      + ':host :where(.MjjYud,.ULSxyf,.g,.Ww4FFb,.kp-blk,.kp-wholepage,.wDYxhc,.CBPhSb,.Wt5Tfe,.EyBRub,.LGOjhe,.X5LH0c,.M8OgIe,.mnr-c,.related-question-pair,[data-attrid],[data-md],[data-hveid]){background-color:' + surface + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + ':host :where(button,[role="button"],[aria-expanded],[aria-controls],[data-q],.KFFQ0c,.B3tYJb,.hqzQac){background-color:' + chip + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + ':host :where(input,textarea,[contenteditable="true"],[role="textbox"]){background:' + input + ' !important;background-color:' + input + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + text + ' !important;border-color:' + border + ' !important;}'
      + ':host :where([role="listbox"],[role="option"],.aajZCb,.erkvQe,.UUbT9,.OBMEnb,.sbct,.G43f7e,.pcTkSc,.wM6W7d,.eIPGRd,.ClJ9Yb){background-color:' + bg + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + ':host :where(p,li,span,div,section,article,h1,h2,h3,h4,h5,h6,em,strong,small,cite):not(a):not(a *){color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + ':host :where(cite,small,time,[class*="secondary" i],[class*="muted" i]){color:' + muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + ':host a,:host a *{color:' + link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + ':host :where(svg,path){color:' + text + ' !important;fill:currentColor !important;stroke:currentColor !important;}'
      + ':host :where(img,picture,video,canvas,iframe,embed,object){filter:none !important;background:transparent !important;}';
  }

  function googleLightCSS() {
    if (!isGoogleHost()) return '';
    const bg = '#ffffff';
    const surface = '#ffffff';
    const raised = '#f8fafd';
    const chip = '#f1f3f4';
    const border = '#dadce0';
    const text = '#202124';
    const muted = '#5f6368';
    const link = '#1a0dab';
    const visited = '#681da8';
    const resultFrame = '#search :where(div,section,article,aside,g-inner-card,g-section-with-header,block-component),#rso :where(div,section,article,aside,g-inner-card,g-section-with-header,block-component),#rhs :where(div,section,article,aside,g-inner-card,g-section-with-header,block-component)';
    const resultText = '#search :where(p,li,span,div,section,article,h1,h2,h3,h4,h5,h6,em,strong,small,cite,yt-formatted-string):not(a):not(a *),#rso :where(p,li,span,div,section,article,h1,h2,h3,h4,h5,h6,em,strong,small,cite):not(a):not(a *),#rhs :where(p,li,span,div,section,article,h1,h2,h3,h4,h5,h6,em,strong,small,cite):not(a):not(a *)';
    const resultSurface = '#search :where(.MjjYud,.ULSxyf,.g,.Ww4FFb,.kp-blk,.kp-wholepage,.wDYxhc,.CBPhSb,.Wt5Tfe,.EyBRub,.LGOjhe,.X5LH0c,.M8OgIe,.mnr-c,.related-question-pair,g-inner-card,g-section-with-header,block-component,[data-attrid],[data-md],[data-hveid]),#rso :where(.MjjYud,.ULSxyf,.g,.Ww4FFb,.kp-blk,.kp-wholepage,.wDYxhc,.CBPhSb,.Wt5Tfe,.EyBRub,.LGOjhe,.X5LH0c,.M8OgIe,.mnr-c,.related-question-pair,g-inner-card,g-section-with-header,block-component,[data-attrid],[data-md],[data-hveid]),#rhs :where(.MjjYud,.ULSxyf,.g,.Ww4FFb,.kp-blk,.kp-wholepage,.wDYxhc,.CBPhSb,.Wt5Tfe,.EyBRub,.LGOjhe,.X5LH0c,.M8OgIe,.mnr-c,.related-question-pair,g-inner-card,g-section-with-header,block-component,[data-attrid],[data-md],[data-hveid])';
    const resultChip = '#search :where(button,[role="button"],[aria-expanded],[aria-controls],g-expandable-container,[data-q],.KFFQ0c,.B3tYJb,.hqzQac),#rhs :where(button,[role="button"],[aria-expanded],[aria-controls],g-expandable-container,[data-q])';
    const nativeNav = '#navcnt,#navcnt *,#foot,#foot *,#bres,#bres *,#swml,#swml *';
    const resultScope = '#cnt,#rcnt,#center_col,#search,#rso,#rhs,[data-async-context]';
    const googleContainers = resultScope + ' :where(div,section,article,aside,main,header,footer,nav,ul,ol,li,g-inner-card,g-section-with-header,block-component):not([role="img"]):not(#navcnt):not(#navcnt *):not(#foot):not(#foot *):not(#bres):not(#bres *):not(#swml):not(#swml *):not(.UUbT9):not(.UUbT9 *):not(form[role="search"] *):not(#searchform *)';
    const googleText = resultScope + ' :where(p,li,span,div,section,article,h1,h2,h3,h4,h5,h6,em,strong,small,cite,yt-formatted-string,[role="heading"]):not(a):not(a *):not(#navcnt):not(#navcnt *):not(#foot):not(#foot *):not(#bres):not(#bres *):not(#swml):not(#swml *)';
    const googleFades = resultScope + ' :where([style*="gradient" i],[class*="gradient" i],[class*="fade" i],[class*="overlay" i],[class*="shadow" i],[style*="rgba(0" i],[style*="rgb(0" i],[style*="#000" i])';
    const bodyContainers = 'body :where(c-wiz,div,section,article,aside,main,header,footer,nav,ul,ol,li,g-inner-card,g-section-with-header,block-component,[jscontroller],[jsname],[data-ved],[data-hveid]):not([role="img"]):not(#navcnt):not(#navcnt *):not(#foot):not(#foot *):not(#bres):not(#bres *):not(#swml):not(#swml *):not(.UUbT9):not(.UUbT9 *):not(form[role="search"] *):not(#searchform *)';
    const bodyText = 'body :where(p,li,span,div,section,article,h1,h2,h3,h4,h5,h6,em,strong,small,cite,yt-formatted-string,[role="heading"]):not(a):not(a *):not(#navcnt):not(#navcnt *):not(#foot):not(#foot *):not(#bres):not(#bres *):not(#swml):not(#swml *)';
    const bodyDarkish = 'body :where([style*="gradient" i],[class*="gradient" i],[class*="fade" i],[class*="overlay" i],[style*="rgba(0" i],[style*="rgb(0" i],[style*="#000" i])';
    const vars = [
      '--gm3-sys-color-background:' + bg,
      '--gm3-sys-color-surface:' + surface,
      '--gm3-sys-color-surface-container:' + raised,
      '--gm3-sys-color-surface-container-low:' + surface,
      '--gm3-sys-color-surface-container-high:' + raised,
      '--gm3-sys-color-on-surface:' + text,
      '--gm3-sys-color-on-surface-variant:' + muted,
      '--gm3-sys-color-outline:' + border,
      '--gm3-sys-color-primary:' + link,
      '--gm3-sys-color-on-primary-container:' + text,
      '--gm3-sys-color-primary-container:' + chip,
      '--m3-sys-color-background:' + bg,
      '--m3-sys-color-surface:' + surface,
      '--m3-sys-color-on-surface:' + text,
      '--m3-sys-color-on-surface-variant:' + muted,
      '--m3-sys-color-outline:' + border,
    ].join(' !important;') + ' !important;';
    return ':root,html,body,#cnt,#rcnt{color-scheme:light !important;' + vars + '}'
      + 'html,body,#main,#cnt,#rcnt,#center_col,#rso,#rhs,[role="main"]{background:' + bg + ' !important;background-color:' + bg + ' !important;color:' + text + ' !important;}'
      + '#gb,#gb *,#sfcnt,#sfcnt *,#hdtb,#hdtbSum,.sfbg,.appbar,.minidiv,.A8SBwf,.RNNXgb{background-color:' + bg + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;text-shadow:none !important;}'
      + '#hdtb a,#hdtb [role="button"],#hdtb button,#hdtb .hdtb-mitem,#hdtb .KFFQ0c,.KFFQ0c,.B3tYJb,.hqzQac{background:' + chip + ' !important;background-color:' + chip + ' !important;background-image:none !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + '#search,#rso,#rhs,#center_col,.MjjYud,.ULSxyf,.g,.Ww4FFb,.kp-blk{background-color:' + bg + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + bodyContainers + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + bodyContainers + '::before,' + bodyContainers + '::after{background-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + bodyDarkish + ',' + bodyDarkish + '::before,' + bodyDarkish + '::after{background:transparent !important;background-color:transparent !important;background-image:none !important;box-shadow:none !important;text-shadow:none !important;}'
      + bodyText + '{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + nativeNav + '{background-color:transparent !important;box-shadow:none !important;text-shadow:none !important;-webkit-text-fill-color:initial !important;}'
      + '#navcnt a,#navcnt a span,#foot a,#bres a,#swml a{color:#1a0dab !important;-webkit-text-fill-color:currentColor !important;text-decoration:none !important;}'
      + '#navcnt .csb,#navcnt span[style*="background-position"],#foot .csb,#foot span[style*="background-position"]{background-image:url("/images/nav_logo321.webp") !important;background-repeat:no-repeat !important;background-color:transparent !important;color:transparent !important;-webkit-text-fill-color:transparent !important;}'
      + '#hdtb a,#hdtb [role="button"],#hdtb button,#hdtb .hdtb-mitem,#hdtb .KFFQ0c,.KFFQ0c,.B3tYJb,.hqzQac,body button,body [role="button"],body [aria-expanded],body [aria-controls]{background-color:' + chip + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + resultScope + '{background-color:' + bg + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;text-shadow:none !important;}'
      + googleContainers + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + googleContainers + '::before,' + googleContainers + '::after{background-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + googleFades + ',' + googleFades + '::before,' + googleFades + '::after{background:transparent !important;background-color:transparent !important;background-image:none !important;box-shadow:none !important;}'
      + googleText + '{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + resultFrame + '{background-color:transparent !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + resultSurface + '{background-color:' + surface + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + resultChip + '{background-color:' + chip + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + '#search :where([class*="gradient" i],[style*="gradient"],[style*="rgba(0"],[style*="#000"],[style*="rgb(0"]){background-image:none !important;}'
      + resultText + ',.VuuXrf,.IsZvec,.VwiC3b,.MUxGbd,.hgKElc,.LEwnzc,.kno-rdesc,.kb0PBd{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#search cite,#search small,#rso cite,#rso small,#rhs cite,#rhs small,#search .MUxGbd,#search .hgKElc,#search .LEwnzc,#search .VwiC3b{color:' + muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '#search p *,#search li *,#rso p *,#rso li *,.VuuXrf *,.IsZvec *,.VwiC3b *,.MUxGbd *,.hgKElc *,.LEwnzc *{color:inherit !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#search a,#rso a,#rhs a,#search a *,#rso a *,#rhs a *{color:' + link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '#search a:visited,#rso a:visited,#rhs a:visited,#search a:visited *,#rso a:visited *,#rhs a:visited *{color:' + visited + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '#search h1,#search h2,#search h3,#rso h2,#rso h3,#rhs h2,#rhs h3{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#search button,#search [role="button"],#search [aria-label*="More" i],#search [aria-label*="Tools" i],#rhs button,#rhs [role="button"]{background:' + chip + ' !important;background-color:' + chip + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + '#search svg,#search path,#rhs svg,#rhs path,#gb svg,#gb path{color:' + text + ' !important;fill:currentColor !important;stroke:currentColor !important;}'
      + '.LC20lb,.DKV0Md,.yuRUbf a h3{color:#1a0dab !important;-webkit-text-fill-color:currentColor !important;}'
      // Same as the dark sheet: the rule above colours the title, and Chrome
      // will not honour it on a visited link's h3. Light mode got away with it
      // because the colour Chrome substitutes there is a purple close enough to
      // the intended one to pass for it. Being right by luck is still a thing
      // that stops being true, and it is one line to not depend on it.
      + '#search a:visited h3,#rso a:visited h3,#rhs a:visited h3,#search a:visited .LC20lb,#rso a:visited .LC20lb,.yuRUbf a:visited h3{color:' + visited + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + nativeNav + '{background-color:transparent !important;box-shadow:none !important;text-shadow:none !important;-webkit-text-fill-color:initial !important;}'
      + '#navcnt a,#navcnt a span,#foot a,#bres a,#swml a{color:#1a0dab !important;-webkit-text-fill-color:currentColor !important;text-decoration:none !important;}'
      + '#navcnt .csb,#navcnt span[style*="background-position"],#foot .csb,#foot span[style*="background-position"]{background-image:url("/images/nav_logo321.webp") !important;background-repeat:no-repeat !important;background-color:transparent !important;color:transparent !important;-webkit-text-fill-color:transparent !important;}'
      // "People also search for" / related-search tiles live in the BOTTOM area
      // (#botstuff/#bres/#brs), which the result-scope text rules don't reach, so their
      // text kept Google's native light grey -> near-invisible on white. Force that text
      // (incl. inside the tile <a>) dark, and give the suggestion tiles a real chip
      // surface + border so they read as tiles. PASF tiles link to /search?q=...
      + '#botstuff,#bres,#brs,#botabar,#extrares{background-color:transparent !important;}'
      + '#botstuff :where(p,li,span,div,h3,b,em,cite,a,a *,[role="link"],[role="link"] *),#bres :where(p,li,span,div,h3,b,em,cite,a,a *,[role="link"],[role="link"] *),#brs :where(p,li,span,div,h3,b,em,cite,a,a *,[role="link"],[role="link"] *){color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      // chip surface for PASF/related tiles ONLY — exclude pagination & nav (their links are
      // also /search?… links, which is what boxed every page number into "weird boxes").
      + '#botstuff :where(a[href*="/search"],[role="link"]):not(:where([role="navigation"],nav,table,#navcnt,#nav,#pnnext) *),#bres :where(a[href*="/search"],[role="link"]):not(:where([role="navigation"],nav,table,#navcnt) *),#brs :where(a[href*="/search"],[role="link"]):not(:where([role="navigation"],nav,table,#navcnt) *){background-color:' + chip + ' !important;border:1px solid ' + border + ' !important;box-shadow:none !important;}'
      + '#botstuff svg,#botstuff path,#bres svg,#bres path,#brs svg,#brs path{color:' + muted + ' !important;fill:currentColor !important;stroke:currentColor !important;}'
      // The "Goooogle" pagination is a sprite (.SJajHc / nav_logo). When Google itself is dark,
      // it serves the WHITE (dark-theme) sprite letters; on EyeShield's forced-white light bg
      // those are invisible. Force them black so the pagination is readable. (verified live)
      + '#botstuff .SJajHc{filter:brightness(0) !important;}'
      + googleSearchBoxCSS('light');
  }

  function googleSearchBoxCSS(remap) {
    const dark = remap !== 'light';
    const gp = googlePaletteFor(remap);
    // Dark/Ultra use EyeShield's paletteFor(mode) colours directly here. Keep the
    // dropdown flat on that palette instead of reintroducing Google's native grey
    // rich-panel boxes, which were visibly lighter in Dark and darker in Ultra.
    const panel = gp.bg;
    const card = panel;
    const hover = gp.hover;
    const border = gp.border;
    const text = gp.text;
    const muted = gp.muted;
    const icon = gp.icon;
    const shadow = dark ? '0 6px 18px rgba(0,0,0,.55)' : '0 4px 12px rgba(60,64,67,.18)';
    const link = gp.link;
    const inputSel = 'form[role="search"] input[name="q"],form[role="search"] textarea[name="q"],textarea[name="q"],input[name="q"],.gLFyf,#APjFqb';
    const shellSel = 'form[role="search"],#searchform form';
    const searchOuterSel = 'form[role="search"] > div,form[role="search"] .A8SBwf,#searchform form > div,#searchform .A8SBwf';
    const searchPillSel = 'form[role="search"] .RNNXgb,#searchform .RNNXgb';
    const searchActionsSel = 'form[role="search"] .dRYYxd,form[role="search"] .BKRPef,#searchform .dRYYxd,#searchform .BKRPef';
    const inputShellSel = 'form[role="search"] .SDkEP,form[role="search"] .a4bIc,form[role="search"] .YacQv,form[role="search"] .iblpc,#searchform .SDkEP,#searchform .a4bIc,#searchform .YacQv,#searchform .iblpc';
    const iconSel = 'form[role="search"] svg,form[role="search"] path,form[role="search"] .z1asCe,form[role="search"] .z1asCe svg,form[role="search"] .z1asCe path,form[role="search"] .nDcEnd,form[role="search"] .Tg7LZd,form[role="search"] .XDyW0e,#searchform svg,#searchform path,#searchform .z1asCe,#searchform .z1asCe svg,#searchform .z1asCe path,#searchform .nDcEnd,#searchform .Tg7LZd,#searchform .XDyW0e';
    const rowSel = 'form[role="search"] .sbct,form[role="search"] .G43f7e,form[role="search"] .pcTkSc,form[role="search"] .wM6W7d,form[role="search"] .eIPGRd,form[role="search"] .ClJ9Yb,form[role="search"] [role="option"],#searchform .sbct,#searchform .G43f7e,#searchform .pcTkSc,#searchform .wM6W7d,#searchform .eIPGRd,#searchform .ClJ9Yb,#searchform [role="option"],.aajZCb .sbct,.aajZCb .G43f7e,.aajZCb .pcTkSc,.aajZCb .wM6W7d,.aajZCb .eIPGRd,.aajZCb .ClJ9Yb,.erkvQe .sbct,.erkvQe .G43f7e,.erkvQe .pcTkSc,.erkvQe .wM6W7d';
    const suggestionText = rowSel + ',form[role="search"] .sbl1,form[role="search"] .sbl2,form[role="search"] .wM6W7d span,form[role="search"] .pcTkSc span,form[role="search"] .G43f7e span,.aajZCb .sbl1,.aajZCb .sbl2,.aajZCb span,.erkvQe .sbl1,.erkvQe .sbl2,.erkvQe span';
    const suggestionMuted = 'form[role="search"] .sbl2,form[role="search"] .ClJ9Yb,form[role="search"] .aVbWac,.aajZCb .sbl2,.aajZCb .ClJ9Yb,.aajZCb .aVbWac,.erkvQe .sbl2,.erkvQe .ClJ9Yb,.erkvQe .aVbWac';
    const suggestionIcons = 'form[role="search"] .sbic,form[role="search"] .sbic svg,form[role="search"] .sbic path,form[role="search"] .wM6W7d svg,form[role="search"] .wM6W7d path,.aajZCb .sbic,.aajZCb .sbic svg,.aajZCb .sbic path,.erkvQe .sbic,.erkvQe .sbic svg,.erkvQe .sbic path';
    const googleSuggestNames = '.UUbT9,.aajZCb,.erkvQe,.OBMEnb,.xtSCL,.mkHrUc,.ynRric,.lnnVSe,.G43f7e,#Alh6id,#jZ2SBf,#shJ2Vb,#ERWdKc,#GZcH3e,[role="listbox"]';
    const googleSuggestGlobalNames = '.UUbT9,.aajZCb,.erkvQe,.OBMEnb,.xtSCL,#Alh6id,#jZ2SBf,#shJ2Vb,#ERWdKc,#GZcH3e';
    const googleSuggestRoot = ':where(form[role="search"],#searchform) :where(' + googleSuggestNames + '),:where(' + googleSuggestGlobalNames + ')';
    const googleSuggestInner = ':where(form[role="search"],#searchform) :where(' + googleSuggestNames + ') :where(div,section,ul,ol,li,table,tbody,tr,td,g-inner-card,g-section-with-header,block-component):not([role="option"]):not([style*="url"]):not(img):not(picture):not(video):not(canvas):not(svg):not(path),:where(' + googleSuggestGlobalNames + ') :where(div,section,ul,ol,li,table,tbody,tr,td,g-inner-card,g-section-with-header,block-component):not([role="option"]):not([style*="url"]):not(img):not(picture):not(video):not(canvas):not(svg):not(path)';
    const googleSuggestStrongRoot = ':is(form[role="search"],#searchform) :is(' + googleSuggestNames + '),:is(' + googleSuggestGlobalNames + ')';
    const googleSuggestStrongLayers = ':is(form[role="search"],#searchform) :is(' + googleSuggestNames + ') :is(div,section,ul,ol,li,table,tbody,tr,td,g-inner-card,g-section-with-header,block-component):not([role="option"]):not([role="option"] *):not([style*="url"]):not(img):not(picture):not(video):not(canvas):not(svg):not(path),:is(' + googleSuggestGlobalNames + ') :is(div,section,ul,ol,li,table,tbody,tr,td,g-inner-card,g-section-with-header,block-component):not([role="option"]):not([role="option"] *):not([style*="url"]):not(img):not(picture):not(video):not(canvas):not(svg):not(path)';
    const googleSuggestStrongRich = ':is(form[role="search"],#searchform) :is(' + googleSuggestNames + ') :is(.Ww4FFb,.wDYxhc,.ULSxyf,.related-question-pair,.CBPhSb,.Wt5Tfe,.EyBRub,.LGOjhe,.X5LH0c,.M8OgIe,.mnr-c,g-inner-card,g-section-with-header,block-component,[data-attrid],[data-md],[data-hveid]):not([style*="url"]),:is(' + googleSuggestGlobalNames + ') :is(.Ww4FFb,.wDYxhc,.ULSxyf,.related-question-pair,.CBPhSb,.Wt5Tfe,.EyBRub,.LGOjhe,.X5LH0c,.M8OgIe,.mnr-c,g-inner-card,g-section-with-header,block-component,[data-attrid],[data-md],[data-hveid]):not([style*="url"])';
    const googleSuggestStrongControls = ':is(form[role="search"],#searchform) :is(' + googleSuggestNames + ') :is(button,[role="button"],[aria-expanded],[aria-controls],[role="link"]),:is(' + googleSuggestGlobalNames + ') :is(button,[role="button"],[aria-expanded],[aria-controls],[role="link"])';
    const googleSuggestStrongSearchLinks = ':is(form[role="search"],#searchform) :is(' + googleSuggestNames + ') :is(a[href*="/search"],[role="link"]):not(:where([role="navigation"],nav,table,#navcnt,#nav,#pnnext) *),:is(' + googleSuggestGlobalNames + ') :is(a[href*="/search"],[role="link"]):not(:where([role="navigation"],nav,table,#navcnt,#nav,#pnnext) *)';
    const googleSuggestTileText = ':is(form[role="search"],#searchform) :is(' + googleSuggestNames + ') :is(a[href*="/search"],[role="link"]) :is(div,span,p,cite,small,b,strong):not([style*="url"]):not(img):not(picture):not(video):not(canvas):not(svg):not(path),:is(' + googleSuggestGlobalNames + ') :is(a[href*="/search"],[role="link"]) :is(div,span,p,cite,small,b,strong):not([style*="url"]):not(img):not(picture):not(video):not(canvas):not(svg):not(path)';
    const googleSuggestStrongText = ':is(form[role="search"],#searchform) :is(' + googleSuggestNames + ') :is(p,li,span,div,cite,b,strong,em,small,h1,h2,h3,h4,[role="heading"]):not(a):not(a *),:is(' + googleSuggestGlobalNames + ') :is(p,li,span,div,cite,b,strong,em,small,h1,h2,h3,h4,[role="heading"]):not(a):not(a *)';
    const googleSuggestStrongLinks = ':is(form[role="search"],#searchform) :is(' + googleSuggestNames + ') a,:is(form[role="search"],#searchform) :is(' + googleSuggestNames + ') a *,:is(' + googleSuggestGlobalNames + ') a,:is(' + googleSuggestGlobalNames + ') a *';
    const googleSuggestStrongIcons = ':is(form[role="search"],#searchform) :is(' + googleSuggestNames + ') :is(svg,path,.sbic,.z1asCe),:is(' + googleSuggestGlobalNames + ') :is(svg,path,.sbic,.z1asCe)';
    return shellSel + '{color-scheme:' + (dark ? 'dark' : 'light') + ' !important;background:transparent !important;background-color:transparent !important;color:' + text + ' !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + searchOuterSel + '{background:transparent !important;background-color:transparent !important;color:' + text + ' !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + searchPillSel + '{background:' + panel + ' !important;background-color:' + panel + ' !important;color:' + text + ' !important;border:1px solid ' + border + ' !important;border-radius:9999px !important;box-shadow:none !important;text-shadow:none !important;}'
      + searchActionsSel + '{background-color:transparent !important;color:' + icon + ' !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + inputShellSel + '{background-color:transparent !important;background-image:none !important;color:' + text + ' !important;border-color:transparent !important;border-bottom-color:transparent !important;box-shadow:none !important;outline:0 !important;text-shadow:none !important;}'
      + inputShellSel + '::before,' + inputShellSel + '::after{background:transparent !important;background-color:transparent !important;background-image:none !important;border-color:transparent !important;box-shadow:none !important;}'
      + inputSel + '{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + text + ' !important;background:transparent !important;background-color:transparent !important;border-color:transparent !important;border-bottom-color:transparent !important;box-shadow:none !important;outline:0 !important;}'
      + inputSel + '::placeholder{color:' + muted + ' !important;-webkit-text-fill-color:' + muted + ' !important;opacity:1 !important;}'
      + iconSel + '{background-color:transparent !important;color:' + icon + ' !important;fill:currentColor !important;stroke:currentColor !important;border-color:transparent !important;box-shadow:none !important;}'
      // The dropdown is ONE opaque surface: paint only the OUTER wrapper (.UUbT9) and
      // give IT the single shadow + border. Make every inner layer transparent so the
      // nested panels (incl. the right-hand "People also ask / People also search for"
      // rich panel) inherit it instead of stacking shadows/borders or leaking native
      // (dark) colours through. The old panel selector painted bg+shadow+border on all 5
      // nested layers -> concentric outlines + a dingy/off box in every mode.
      + googleSuggestRoot + '{background-color:' + panel + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + googleSuggestInner + '{background-color:transparent !important;color:' + text + ' !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + googleSuggestStrongRoot + '{background-color:' + panel + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + googleSuggestStrongLayers + '{background-color:' + panel + ' !important;color:' + text + ' !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + 'form[role="search"] .UUbT9,#searchform .UUbT9,.UUbT9{background:' + panel + ' !important;background-color:' + panel + ' !important;background-image:none !important;color:' + text + ' !important;border:1px solid ' + border + ' !important;box-shadow:' + shadow + ' !important;}'
      + '.UUbT9 *{box-shadow:none !important;}'
      // Paint inner layers via background-COLOR only - NOT the `background`
      // shorthand and NOT background-image:none, both of which would wipe the
      // "People also search for" tile THUMBNAILS (Google renders them as background-image
      // on a div). This keeps the single-surface look while preserving thumbnails.
      + '.UUbT9 :is(div,section,ul,ol,li,table,tbody,tr,td,g-inner-card,g-section-with-header,block-component):not([role="option"]):not([role="option"] *):not([style*="url"]):not(a):not(a *){background-color:' + panel + ' !important;border-color:transparent !important;box-shadow:none !important;}'
      // Google paints a subtle elevation GRADIENT (background-image) on the panel /
      // "People also ask" / rich-panel boxes. It can survive colour overrides and
      // render as a lighter box. Strip it so the dropdown is one flat surface, but
      // EXCLUDE anything inside a tile link (a / [role=link]) or with an inline url(),
      // which is where the "People also search for" THUMBNAILS live - don't touch those.
      + '.UUbT9 :where([style*="gradient" i],[class*="gradient" i],[class*="fade" i],[class*="overlay" i],[class*="shadow" i]):not([role="option"]):not([role="link"]):not([role="link"] *):not(a):not(a *):not([style*="url"]){background-image:none !important;}'
      // Newer Google search dropdowns use nested rich panels for "People also ask"
      // and "People also search for". Flatten those containers to the dropdown
      // background so Dark and Ultra differ by the real mode background only.
      + '.UUbT9 .OBMEnb,.UUbT9 .aajZCb,.UUbT9 .erkvQe,.UUbT9 .mkHrUc,.UUbT9 .ynRric,.UUbT9 .lnnVSe,.UUbT9 .G43f7e,.UUbT9 [role="listbox"]{background-color:' + panel + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + '.UUbT9 :where(.Ww4FFb,.wDYxhc,.ULSxyf,.related-question-pair,.CBPhSb,.Wt5Tfe,.EyBRub,.LGOjhe,.X5LH0c,.M8OgIe,.mnr-c,g-inner-card,g-section-with-header,block-component,[data-attrid],[data-md],[data-hveid]):not([style*="url"]){background-color:' + card + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + googleSuggestStrongRich + '{background-color:' + panel + ' !important;color:' + text + ' !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + rowSel + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;text-shadow:none !important;}'
      + rowSel + ':hover,' + rowSel + '[aria-selected="true"]{background:' + hover + ' !important;background-color:' + hover + ' !important;color:' + text + ' !important;}'
      + suggestionText + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      // Reclaim PAA/PASF pills + any aria/role control inside the dropdown from
      // googleLightCSS's "body [aria-*]/[role=button]{background:chip}" grey rule
      // (.UUbT9 X out-specifies body [aria-*], so this wins -> no grey pills).
      + '.UUbT9 button,.UUbT9 [role="button"],.UUbT9 [aria-expanded],.UUbT9 [aria-controls],.UUbT9 [role="link"]{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + border + ' !important;}'
      + googleSuggestStrongControls + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + '.UUbT9 :where(a[href*="/search"],[role="link"]):not(:where([role="navigation"],nav,table,#navcnt,#nav,#pnnext) *){background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border:1px solid transparent !important;border-radius:8px !important;box-shadow:none !important;}'
      + googleSuggestStrongSearchLinks + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border:1px solid transparent !important;border-radius:8px !important;box-shadow:none !important;text-shadow:none !important;}'
      + googleSuggestTileText + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      // Text + anchors across the WHOLE dropdown (covers the rich panel, not just rows).
      + '.UUbT9 :where(p,li,span,div,cite,b,strong,em,small,h1,h2,h3,h4,[role="heading"]):not(a):not(a *){background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + '.UUbT9 a,.UUbT9 a *{background-color:transparent !important;color:' + link + ' !important;-webkit-text-fill-color:currentColor !important;box-shadow:none !important;text-shadow:none !important;}'
      + googleSuggestStrongText + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + googleSuggestStrongLinks + '{background-color:transparent !important;color:' + link + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + suggestionMuted + '{background-color:transparent !important;color:' + muted + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + suggestionIcons + '{background-color:transparent !important;color:' + icon + ' !important;fill:currentColor !important;stroke:currentColor !important;}'
      + googleSuggestStrongIcons + '{background-color:transparent !important;color:' + icon + ' !important;fill:currentColor !important;stroke:currentColor !important;box-shadow:none !important;}'
      + '.UUbT9 svg,.UUbT9 path{color:' + icon + ' !important;fill:currentColor !important;stroke:currentColor !important;}'
      + '.UUbT9 img,.aajZCb img,.erkvQe img{filter:none !important;background:transparent !important;}';
  }

  function googleDarkCSS(remap) {
    if (!isGoogleHost() || (remap !== 'dark' && remap !== 'ultra')) return '';
    const gp = googlePaletteFor(remap);
    const bg = gp.bg;
    const surface = gp.surface;
    const raised = gp.raised;
    const row = gp.row;
    const border = gp.border;
    const text = gp.text;
    const muted = gp.muted;
    const link = gp.link;
    const visited = gp.visited;
    return 'html,body,#main,#cnt,#rcnt,#center_col,#rso,#rhs,[role="main"]{background:' + bg + ' !important;background-color:' + bg + ' !important;color:' + text + ' !important;}'
      + '#search,#rso,#rhs,#center_col,.MjjYud,.ULSxyf,.g,.Ww4FFb,.kp-blk{background:transparent !important;color:' + text + ' !important;border-color:' + border + ' !important;}'
      + '#search p,#search li,#rso p,#rso li,#search span,#rso span,.VuuXrf,.IsZvec,.VwiC3b,.MUxGbd,.hgKElc,.LEwnzc,.kno-rdesc,.kb0PBd{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#search p *,#search li *,#rso p *,#rso li *,.VuuXrf *,.IsZvec *,.VwiC3b *,.MUxGbd *,.hgKElc *,.LEwnzc *{color:inherit !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#search a,#rso a,#rhs a,#search a *,#rso a *,#rhs a *{color:' + link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      // Light mode has had this since it was written; dark and ultra never did,
      // which is why a results page in either one read as entirely unvisited.
      // The generic a[href]:visited rule cannot reach here -- an #id selector
      // outranks it -- so the Google sheet has to say it again. The descendant
      // half matters as much as the anchor: a result title is an h3 inside the
      // link, and without it the title keeps the unvisited colour while only
      // the bare anchors change.
      + '#search a:visited,#rso a:visited,#rhs a:visited,#search a:visited *,#rso a:visited *,#rhs a:visited *{color:' + visited + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '[aria-label="AI Overview"],[aria-label="AI Overview"]{background:' + bg + ' !important;background-color:' + bg + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;text-shadow:none !important;}'
      + '[aria-label="AI Overview"] *,[aria-label="AI Overview"] ~ div *{text-shadow:none !important;}'
      + '[aria-label="AI Overview"] div[role="button"],[aria-label="AI Overview"] button,#search [aria-expanded],#search [aria-controls],#search g-expandable-container,#search g-inner-card,#search .Ww4FFb,#search .wDYxhc{background:' + surface + ' !important;background-color:' + surface + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + '#search [role="button"],#search button,#search [aria-label*="More" i],#search [aria-label*="Tools" i]{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + border + ' !important;}'
      + '#search [data-q],#search .related-question-pair,#search .CBPhSb,#search .Wt5Tfe,#search .EyBRub,#search .ULSxyf,#search .sh-dgr__grid-result,#search .LGOjhe,#search .X5LH0c{background:' + row + ' !important;background-color:' + row + ' !important;color:' + text + ' !important;border-color:' + border + ' !important;box-shadow:none !important;}'
      + '#search .related-question-pair:hover,#search .CBPhSb:hover,#search .Wt5Tfe:hover,#search [role="button"]:hover{background:' + raised + ' !important;background-color:' + raised + ' !important;color:' + text + ' !important;}'
      + '#search h1,#search h2,#search h3,#rso h2,#rso h3,#rhs h2,#rhs h3{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '#search cite,#search small,#search .MUxGbd,#search .hgKElc,#search .LEwnzc,#search .VwiC3b,#rso cite,#rso small{color:' + muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      // FLATTEN result containers to the page bg (verified live). The old surface/row rules
      // boxed every organic result + PAA + group container into a grey rectangle that Google's
      // native dark mode never shows ("weird boxes / you still see backgrounds"). Forcing them to
      // bg (not transparent) keeps them flat AND still overrides a light-served Google. Late rule
      // => same specificity as the surface/row rules above but wins by source order.
      + '#search .Ww4FFb,#search .wHYlTd,#search .tF2Cxc,#search .ULSxyf,#search .Wt5Tfe,#search .related-question-pair,#search .dnXCYb,#search .EyBRub,#search .LGOjhe,#search .X5LH0c,#search .g,#rso .Ww4FFb,#rso .ULSxyf,#rso .tF2Cxc{background:' + bg + ' !important;background-color:' + bg + ' !important;border-color:transparent !important;box-shadow:none !important;}'
      // Put the result title and the site-name line back the right way round.
      // Google's markup is <a href><h3>Title</h3></a>, with a SEPARATE anchor for
      // the site name above it. Two rules above collide at equal specificity
      // (`#search a *` and `#search h3`, both 101), so source order decided it and
      // the h3 rule -- being later -- painted titles with `text` while the generic
      // anchor rule painted the site-name line with `link`. The result was the
      // exact inverse of Google's own dark mode: white titles and blue site names,
      // i.e. the least important line on every result was the loudest thing on it.
      // These two win on specificity (102 and 110), not on ordering luck.
      + '#search a h3,#rso a h3,#rhs a h3,#search h3 a,#rso h3 a,#search a .LC20lb,#rso a .LC20lb{color:' + link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      // The result TITLE needs its own :visited rule, and the reason is not the
      // cascade. Chrome refuses author colour on anything INSIDE a visited link:
      // set the h3 green and an unvisited title goes green while a visited one
      // does not -- it gets the browser's own visited colour instead, which on a
      // dark page is a pale lavender that reads as washed-out blue. So the
      // generic '#search a:visited *' above cannot reach the title however
      // specific it is, and the title rule right above this one cannot either.
      // A rule naming the h3 with :visited on the anchor is the one thing that
      // does apply. Verified on a real results page: with only this rule changed
      // the title follows, and with it removed the title goes back to the
      // browser's colour while the site-name line still changes.
      //
      // This is what "only the URL turned purple, the headline stayed blue"
      // was: one of the two lines was being coloured by us and the other by
      // Chrome.
      + '#search a:visited h3,#rso a:visited h3,#rhs a:visited h3,#search h3 a:visited,#rso h3 a:visited,#search a:visited .LC20lb,#rso a:visited .LC20lb{color:' + visited + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '#search cite,#rso cite,#search .VuuXrf,#rso .VuuXrf,#search .UdQCqe,#rso .UdQCqe,#search .byrV5b,#rso .byrV5b,#search .tjvcx,#rso .tjvcx{color:' + muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + googleSearchBoxCSS(remap);
  }

  function githubCSS(mode) {
    if (!isGitHubHost()) return '';
    const p = paletteFor(mode);
    const scheme = mode === 'light' ? 'light' : 'dark';
    const vars = [
      '--color-canvas-default:' + p.bg,
      '--color-canvas-subtle:' + p.surface,
      '--color-canvas-inset:' + p.raised,
      '--color-canvas-overlay:' + p.raised,
      '--color-fg-default:' + p.text,
      '--color-fg-muted:' + p.muted,
      '--color-fg-subtle:' + p.muted,
      '--color-border-default:' + p.border,
      '--color-border-muted:' + p.border,
      '--color-accent-fg:' + p.link,
      '--bgColor-default:' + p.bg,
      '--bgColor-muted:' + p.surface,
      '--bgColor-inset:' + p.raised,
      '--fgColor-default:' + p.text,
      '--fgColor-muted:' + p.muted,
      '--borderColor-default:' + p.border,
      '--button-default-bgColor-rest:' + p.control,
      '--button-default-fgColor-rest:' + p.text,
      '--button-default-borderColor-rest:' + p.border,
      '--button-primary-bgColor-rest:#1f883d',
      '--button-primary-fgColor-rest:#ffffff',
    ].join(' !important;') + ' !important;';
    return ':root,html,body{color-scheme:' + scheme + ' !important;' + vars + 'background:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + 'body,.application-main,main,#js-repo-pjax-container,#repo-content-pjax-container,.Layout,.PageLayout,.feed-background{background:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + '.Header,.AppHeader,.AppHeader-globalBar,.UnderlineNav,.Box,.Box-row,.Popover,.Popover-message,.SelectMenu-modal,.Overlay,.flash,.color-bg-default,.color-bg-subtle,.color-bg-inset,.markdown-body table tr{background:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + 'html body :is(header,.Header,.AppHeader,.AppHeader-globalBar,.HeaderMenu,.HeaderMenu--logged-out) :where(a,span,button,div,summary,svg,path){color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      + 'html body :is(header,.Header,.AppHeader) .search-input-container.search-with-dialog,html body :is(header,.Header,.AppHeader) .search-input-container.search-with-dialog :where(div,span,input,button){background:' + p.input + ' !important;background-color:' + p.input + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + 'html body [class*="Primer_Brand__FormControl" i] :where(label,span,div),html body [class*="FormControl-label" i]{color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;text-shadow:none !important;}'
      + 'html body [class*="Primer_Brand__Button" i]{color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;text-shadow:none !important;}'
      + '.markdown-body,.markdown-body p,.markdown-body li,.markdown-body td,.markdown-body th,.markdown-body blockquote,.repo-list-item,.feed-item-content,.js-navigation-item,.text-normal,.fgColor-default{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '.color-fg-muted,.fgColor-muted,.text-small,.note,.Counter,[class*="muted" i]{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'a,a.Link--primary,.Link--muted:hover{color:' + p.link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '.btn,.Button,[role="button"],button:not(.HeaderMenu-link){background:' + p.control + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + '.btn-primary,.Button--primary,[class*="primary" i][class*="Button" i],a[href="/signup"]{background:#1f883d !important;border-color:#1f883d !important;color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;}'
      + 'html body input,html body textarea,html body select,html body [contenteditable="true"]{background:' + p.input + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + 'html body input::placeholder,html body textarea::placeholder{color:' + p.muted + ' !important;-webkit-text-fill-color:' + p.muted + ' !important;opacity:1 !important;}'
      + 'svg,path,octicon-icon{color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;}'
      + 'img,picture,video,canvas,iframe,embed,object{filter:none !important;background:transparent !important;}';
  }

  function stackOverflowCSS(mode) {
    if (!isStackOverflowHost()) return '';
    const p = paletteFor(mode);
    const scheme = mode === 'light' ? 'light' : 'dark';
    return ':root,html,body{color-scheme:' + scheme + ' !important;--theme-body-background-color:' + p.bg + ' !important;--theme-content-background-color:' + p.bg + ' !important;--theme-primary-color:' + p.link + ' !important;--theme-link-color:' + p.link + ' !important;background:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + 'html,body,#content,.container,.wmx12,.js-main-container,.snippet-hidden,.question-summary,.s-post-summary,.s-post-summary--content,.answer,.question,.post-layout,.left-sidebar,.s-sidebarwidget,.site-footer,#mainbar,#questions,.questions,.flush-left{background:' + p.bg + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + '.s-topbar,.topbar-dialog,.s-sidebarwidget,.s-card,.s-notice,.js-dismissable-hero,.js-consent-banner,.fc-black-050,.bg-black-050,.bg-white,.bar-sm,.ba{background:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + '.s-notice *,.js-dismissable-hero *,.js-consent-banner *,.s-sidebarwidget *,.s-card *,.question-hyperlink,.s-link,.s-navigation--item,p,li,td,th,label,.fc-black-900,.fc-black-800,.fc-black-700,.fc-black-600,.fc-dark{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '.fc-black-500,.fc-black-400,.fc-medium,.s-post-summary--meta,.relativetime,.user-action-time{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + '.s-post-summary--stats,.s-post-summary--stats *,.s-post-summary--stats-item,.s-post-summary--stats-item *{background:transparent !important;color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '.s-post-summary--stats-item__emphasized,.s-post-summary--stats-item__emphasized *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'a,.s-link{color:' + p.link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'html body :is(.s-navigation,.nav-links,#left-sidebar) :is(.s-navigation--item,.s-navigation--item.is-selected,.s-navigation--item.youarehere,.youarehere,a){background:' + p.control + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + 'html body :is(.s-navigation,.nav-links,#left-sidebar) :is(.s-navigation--item,.s-navigation--item.is-selected,.s-navigation--item.youarehere,.youarehere,a) *{color:inherit !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'button,.s-btn,[role="button"],input[type="submit"]{background:' + p.control + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + 'input,textarea,select{background:' + p.input + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + '.js-vote-count,.s-badge,.post-tag{background:' + p.control + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + 'img,picture,video,canvas,iframe,embed,object{filter:none !important;background:transparent !important;}';
  }

  function hackerNewsCSS(mode) {
    if (!isHackerNewsHost()) return '';
    const p = paletteFor(mode);
    const scheme = mode === 'light' ? 'light' : 'dark';
    return ':root,html,body{color-scheme:' + scheme + ' !important;background:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + 'body,center,#hnmain,#hnmain > tbody,#hnmain > tbody > tr,#hnmain > tbody > tr > td,.itemlist,.itemlist tbody,.itemlist tr,.itemlist td{background:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + '#hnmain > tbody > tr:first-child > td,.pagetop,.pagetop *,td.title,span.titleline,span.titleline a{background:' + p.surface + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '.title,.title a,.athing,.athing td,.athing a,.comment,.comment span,.commtext,.commtext *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '.subtext,.subtext a,.hnuser,.age,.score,.comhead,.sitestr{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'a{color:' + p.link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'input,textarea,select{background:' + p.input + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;}'
      + 'img{filter:none !important;background:transparent !important;}';
  }

  function wikipediaCSS(mode) {
    if (!isWikipediaHost()) return '';
    const p = paletteFor(mode);
    const scheme = mode === 'light' ? 'light' : 'dark';
    return ':root,html,body{color-scheme:' + scheme + ' !important;--background-color-base:' + p.bg + ' !important;--background-color-neutral-subtle:' + p.surface + ' !important;--color-base:' + p.text + ' !important;--color-subtle:' + p.muted + ' !important;--border-color-base:' + p.border + ' !important;background:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + 'html,body,#content,.mw-body,.vector-body,.vector-page-titlebar,.vector-header-container,.vector-column-start,.vector-column-end,.vector-sticky-header,.mw-page-container,.mw-parser-output,.infobox,.sidebar,.navbox,.wikitable,.metadata{background:' + p.bg + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;}'
      + '#content :where(div,section,article,aside,table,thead,tbody,tfoot,tr,td,th,ul,ol,li,figure,figcaption):not(img):not(picture):not(video):not(canvas):not(svg):not(path):not([style*="url"]){background-color:transparent !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + '.vector-header-container,.vector-sticky-header,.infobox,.sidebar,.navbox,.wikitable,.toc,.catlinks,.mw-footer{background:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + '#mp-topbanner,#mp-left,#mp-right,#mp-middle,.mp-box,.MainPageBG,.nomobile,.mw-parser-output [style*="background"]{background:' + p.surface + ' !important;background-image:none !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + '#mp-topbanner h2,#mp-left h2,#mp-right h2,#mp-middle h2,.mp-box h2,.MainPageBG h2,.mw-parser-output [style*="background"] :where(h1,h2,h3,h4){background:' + p.control + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + 'p,li,td,th,caption,h1,h2,h3,h4,h5,h6,label,legend,.mw-headline,.vector-menu-heading{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + '.reference,.mw-editsection,.vector-menu-content,.metadata,.ambox,.hatnote{color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'a{color:' + p.link + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'input,textarea,select,button,.cdx-button{background:' + p.control + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + 'img,picture,video,canvas,iframe,embed,object{filter:none !important;background:transparent !important;}';
  }

  function redditCSS(mode) {
    if (!isRedditHost()) return '';
    const p = paletteFor(mode);
    const weakText = mode === 'light' ? p.text : p.muted;
    const vars = [
      '--color-neutral-background:' + p.bg,
      '--color-neutral-background-weak:' + p.bg,
      '--color-neutral-background-medium:' + p.surface,
      '--color-neutral-background-strong:' + p.raised,
      '--color-neutral-background-inverted:' + p.surface,
      '--color-neutral-background-selected:' + p.surface,
      '--color-neutral-background-hover:' + p.controlHover,
      '--color-neutral-content:' + p.text,
      '--color-neutral-content-weak:' + weakText,
      '--color-neutral-content-strong:' + p.text,
      '--color-neutral-content-disabled:' + weakText,
      '--color-neutral-content-inverted:' + p.text,
      '--color-neutral-border:' + p.border,
      '--color-neutral-border-weak:' + p.border,
      '--color-tone-1:' + p.text,
      '--color-tone-2:' + weakText,
      '--color-tone-3:' + weakText,
      '--color-tone-4:' + p.border,
      '--color-tone-5:' + p.control,
      '--color-tone-6:' + p.surface,
      '--color-tone-7:' + p.bg,
      '--color-media-background:' + p.surface,
      '--color-primary:' + p.link,
      '--color-primary-hover:' + p.focus,
      '--color-primary-background:' + p.selected,
      '--color-primary-background-hover:' + p.selected,
      '--color-primary-onBackground:' + p.selectedText,
      '--color-secondary:' + p.control,
      '--color-secondary-hover:' + p.controlHover,
      '--color-secondary-background:' + p.control,
      '--color-secondary-background-hover:' + p.controlHover,
      '--color-secondary-plain:' + p.text,
      '--color-secondary-plain-hover:' + p.text,
      '--color-button-secondary-background:' + p.control,
      '--color-button-secondary-background-hover:' + p.controlHover,
      '--color-button-secondary-text:' + p.text,
      '--color-button-plain-text:' + p.text,
      '--color-interactive-content:' + p.link,
      '--color-interactive-content-hover:' + p.focus,
      '--color-a-default:' + p.link,
      '--color-a-hover:' + p.focus,
      '--shreddit-content-background:' + p.bg,
      '--shreddit-color-wordmark:' + p.text,
      '--newCommunityTheme-body:' + p.bg,
      '--newCommunityTheme-bodyText:' + p.text,
      '--newCommunityTheme-line:' + p.border,
      '--newCommunityTheme-metaText:' + weakText,
      '--newCommunityTheme-field:' + p.input,
      '--newCommunityTheme-linkText:' + p.link,
      '--newCommunityTheme-button:' + p.primary,
      '--newCommunityTheme-buttonText:' + p.primaryText,
      '--newRedditTheme-body:' + p.bg,
      '--newRedditTheme-bodyText:' + p.text,
      '--newRedditTheme-line:' + p.border,
      '--newRedditTheme-metaText:' + weakText,
      '--newRedditTheme-field:' + p.input,
      '--newRedditTheme-linkText:' + p.link,
      '--newRedditTheme-button:' + p.primary,
      '--newRedditTheme-buttonText:' + p.primaryText
    ].join(' !important;') + ' !important;';
    const root = ':root,html,body,shreddit-app';
    const app = 'html,body,shreddit-app,main,[role="main"],#main-content,[data-testid="frontpage-main"],[data-testid="post-container"]';
    const chrome = 'reddit-header-large,reddit-header-action-items,reddit-sidebar-nav,left-nav-top-section,left-nav-topic-tracker,[slot="left-nav"],[slot="right-sidebar"],#left-sidebar,#right-sidebar,aside,nav,header';
    const panels = 'shreddit-post,[data-testid="post-container"],[data-testid="post"],article,[role="article"],reddit-sidebar,reddit-recent-posts,community-highlight-card,faceplate-tracker,faceplate-hovercard,faceplate-batch';
    const inboxRows = 'notifications-main-manager,notifications-main-manager faceplate-tracker,notification-item,rpl-inbox-row,rpl-inbox-row[class],faceplate-tracker rpl-inbox-row,faceplate-tracker notification-item rpl-inbox-row';
    const inboxText = 'notifications-main-manager :where(h1,h2,h3,h4,h5,h6,p,span,small,strong,em,faceplate-timeago,faceplate-number,[class*="text" i],[class*="title" i],[class*="truncate" i])';
    const headers = 'reddit-sidebar-nav h1,reddit-sidebar-nav h2,reddit-sidebar-nav h3,left-nav-top-section h1,left-nav-top-section h2,left-nav-top-section h3,[slot="left-nav"] h1,[slot="left-nav"] h2,[slot="left-nav"] h3,shreddit-post h1,shreddit-post h2,shreddit-post h3';
    const textBits = 'shreddit-app :where(h1,h2,h3,h4,h5,h6,p,span,small,strong,em,blockquote,figcaption,summary,legend,caption,th,td,faceplate-timeago,faceplate-number,shreddit-post-title,[slot="title"],[slot="text-body"],[slot="subredditName"],[slot="authorName"],[slot="communityName"],[slot="description"],[class*="truncate" i],[class*="line-clamp" i],[class*="font-" i],[class*="text-" i]):not(img):not(picture):not(video):not(canvas):not(svg):not(path)';
    const mutedBits = 'shreddit-app :where([class*="muted" i],[class*="secondary" i],[class*="subtle" i],[class*="meta" i],[class*="caption" i],[class*="timestamp" i],faceplate-timeago,[slot="credit-bar"],[slot="subtitle"])';
    const links = 'shreddit-app :where(main,[role="main"],shreddit-post,[data-testid="post-container"],[data-testid="post"]) a,shreddit-app :where(main,[role="main"],shreddit-post,[data-testid="post-container"],[data-testid="post"]) a *,shreddit-app :where(main,[role="main"],shreddit-post,[data-testid="post-container"],[data-testid="post"]) [role="link"],shreddit-app :where(main,[role="main"],shreddit-post,[data-testid="post-container"],[data-testid="post"]) [role="link"] *';
    const navLinks = 'reddit-sidebar-nav a,reddit-sidebar-nav a *,left-nav-top-section a,left-nav-top-section a *,[slot="left-nav"] a,[slot="left-nav"] a *';
    const sideText = 'reddit-sidebar-nav *,left-nav-top-section *,left-nav-topic-tracker *,[slot="left-nav"] *,#left-sidebar *';
    const fields = 'shreddit-app input:not([type="range"]):not([type="checkbox"]):not([type="radio"]),shreddit-app textarea,shreddit-app select,shreddit-app [contenteditable="true"],shreddit-app [role="textbox"],reddit-search-large input,reddit-search-large [role="textbox"]';
    const searchHost = 'reddit-search-large';
    const controls = 'shreddit-app :where(button,[role="button"],summary,shreddit-async-loader,faceplate-dropdown-menu,faceplate-menu,faceplate-tooltip),reddit-header-action-items :where(button,[role="button"])';
    const controlHover = 'shreddit-app :where(button,[role="button"],summary,shreddit-async-loader,faceplate-dropdown-menu,faceplate-menu,faceplate-tooltip):where(:hover,[aria-expanded="true"],[aria-pressed="true"],[aria-selected="true"]),reddit-header-action-items :where(button,[role="button"]):where(:hover,[aria-expanded="true"],[aria-pressed="true"],[aria-selected="true"])';
    const media = 'shreddit-app img,shreddit-app picture,shreddit-app video,shreddit-app canvas,shreddit-app svg,shreddit-app iframe,shreddit-app embed,shreddit-app object';
    const bgUtilities = 'shreddit-app :where([class*="bg-neutral" i],[class*="bg-secondary" i],[class*="bg-ui" i],[class*="bg-tone" i],[class*="bg-black" i],[class*="bg-white" i],[class*="background" i],reddit-recent-posts,[slot="right-sidebar"],reddit-search-large):not(img):not(picture):not(video):not(canvas):not(svg):not(path):not([style*="url"])';
    const lightRepair = mode === 'light'
      ? bgUtilities + '{background-color:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
        + 'reddit-search-large,reddit-search-large form,reddit-search-large label,reddit-search-large :where(div,span,button,[role="button"]):not(svg):not(path){background-color:' + p.surface + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
        + 'reddit-search-large input,reddit-search-large [role="textbox"],reddit-search-large textarea{background-color:' + p.input + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
        + 'reddit-search-large input::placeholder,reddit-search-large textarea::placeholder{color:' + p.muted + ' !important;-webkit-text-fill-color:' + p.muted + ' !important;opacity:1 !important;}'
        + 'reddit-recent-posts,reddit-recent-posts :where(div,section,article,li),[slot="right-sidebar"],[slot="right-sidebar"] :where(div,section,article,li){background-color:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
        + 'reddit-recent-posts :where(a,span,p,small,strong,em,faceplate-timeago,faceplate-number,[class*="text" i],[class*="title" i]),[slot="right-sidebar"] :where(a,span,p,small,strong,em,faceplate-timeago,faceplate-number,[class*="text" i],[class*="title" i]){background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;opacity:1 !important;text-shadow:none !important;}'
        + 'reddit-sidebar-nav :where(a,span,p,small,strong,em,faceplate-number,[class*="text" i],[class*="truncate" i],[class*="community" i],[class*="subreddit" i]),left-nav-top-section :where(a,span,p,small,strong,em,faceplate-number,[class*="text" i],[class*="truncate" i],[class*="community" i],[class*="subreddit" i]),left-nav-topic-tracker :where(a,span,p,small,strong,em,faceplate-number,[class*="text" i],[class*="truncate" i],[class*="community" i],[class*="subreddit" i]),[slot="left-nav"] :where(a,span,p,small,strong,em,faceplate-number,[class*="text" i],[class*="truncate" i],[class*="community" i],[class*="subreddit" i]),#left-sidebar :where(a,span,p,small,strong,em,faceplate-number,[class*="text" i],[class*="truncate" i],[class*="community" i],[class*="subreddit" i]){background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;opacity:1 !important;filter:none !important;text-shadow:none !important;}'
        + 'body :where(reddit-sidebar-nav,left-nav-top-section,left-nav-topic-tracker,[slot="left-nav"],#left-sidebar,nav,aside,[role="navigation"]) :where(div,section,article):not([style*="url"]):not(img):not(picture):not(video):not(canvas):not(svg):not(path){background-color:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
        + '#flex-left-nav-container,#left-sidebar-container,#left-sidebar-container #flex-left-nav-container{background-color:' + p.surface + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
        + '#flex-left-nav-container *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
        + 'body :where(aside,nav,[role="navigation"],[data-testid*="left" i],[id*="left" i],[class*="left-nav" i],[class*="sidebar" i],[aria-label*="commun" i],[aria-label*="sidebar" i]) :where(a,span,p,small,strong,em,faceplate-number,[class*="text" i],[class*="truncate" i],[class*="community" i],[class*="subreddit" i]){background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;opacity:1 !important;filter:none !important;text-shadow:none !important;}'
        + 'body :where([slot="right-sidebar"],#right-sidebar,[data-testid*="right" i],[class*="right-sidebar" i],reddit-recent-posts) :where(a,span,p,small,strong,em,faceplate-timeago,faceplate-number,[class*="text" i],[class*="title" i]){background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;opacity:1 !important;filter:none !important;text-shadow:none !important;}'
        + 'body :where([slot="right-sidebar"],#right-sidebar,[data-testid*="right" i],[class*="right-sidebar" i],reddit-recent-posts) :where(div,section,article,li):not([style*="url"]):not([class*="text" i]):not([class*="title" i]):not([class*="truncate" i]){background-color:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
        + 'reddit-sidebar-nav :where(svg,path),left-nav-top-section :where(svg,path),left-nav-topic-tracker :where(svg,path),[slot="left-nav"] :where(svg,path),#left-sidebar :where(svg,path){color:' + p.text + ' !important;fill:currentColor !important;stroke:currentColor !important;opacity:1 !important;filter:none !important;}'
        + 'body :where(button,[role="button"],a):where([aria-label*="Collapse" i],[title*="Collapse" i]){background-color:' + p.control + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
        + 'body :where(button,[role="button"],a):where([aria-label*="Collapse" i],[title*="Collapse" i]) *{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;fill:currentColor !important;stroke:currentColor !important;text-shadow:none !important;}'
      : '';
    return root + '{' + vars + 'color-scheme:' + p.scheme + ' !important;background-color:' + p.bg + ' !important;color:' + p.text + ' !important;}'
      + app + '{background-color:' + p.bg + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;text-shadow:none !important;}'
      + chrome + '{background-color:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + panels + '{background-color:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + inboxRows + '{background-color:' + p.surface + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + inboxText + '{background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;opacity:1 !important;text-shadow:none !important;}'
      + 'notifications-main-manager a,notifications-main-manager a *{background-color:transparent !important;color:' + p.link + ' !important;-webkit-text-fill-color:currentColor !important;opacity:1 !important;text-shadow:none !important;}'
      + 'shreddit-post::part(background),shreddit-post::part(container),reddit-sidebar-nav::part(container),left-nav-top-section::part(container){background-color:' + p.surface + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + 'shreddit-post [slot="text-body"],shreddit-post [slot="text-body"] *,shreddit-post [slot="title"],shreddit-post [slot="title"] *{background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + textBits + '{background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + headers + '{background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;text-shadow:none !important;}'
      + mutedBits + '{background-color:transparent !important;color:' + p.muted + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;text-shadow:none !important;}'
      + links + '{background-color:transparent !important;color:' + p.link + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + navLinks + '{background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + sideText + '{color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;opacity:1 !important;text-shadow:none !important;}'
      + fields + '{background-color:' + p.input + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;outline-color:' + p.focus + ' !important;text-shadow:none !important;}'
      + fields + '::placeholder{color:' + p.muted + ' !important;-webkit-text-fill-color:' + p.muted + ' !important;opacity:1 !important;}'
      + searchHost + ',' + searchHost + '[class]{background-color:' + p.input + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border:1px solid ' + p.border + ' !important;border-radius:999px !important;box-shadow:none !important;outline:0 !important;overflow:visible !important;text-shadow:none !important;}'
      + searchHost + '::before,' + searchHost + '::after,' + searchHost + '[class]::before,' + searchHost + '[class]::after,' + searchHost + ':focus::before,' + searchHost + ':focus::after,' + searchHost + ':focus-within::before,' + searchHost + ':focus-within::after{content:none !important;display:none !important;background:transparent !important;background-color:transparent !important;background-image:none !important;border:0 !important;box-shadow:none !important;opacity:0 !important;}'
      + searchHost + ':focus-within{border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + controls + '{background-color:' + p.control + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + controlHover + '{background-color:' + p.controlHover + ' !important;color:' + p.text + ' !important;}'
      + bgUtilities + '{color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + 'shreddit-app :where([class*="bg-neutral" i],[class*="bg-secondary" i],[class*="bg-ui" i],[class*="bg-tone" i]):where(span,p,small,strong,em,h1,h2,h3,h4,h5,h6,[slot]){background-color:transparent !important;}'
      + 'shreddit-app :where(hr,[role="separator"]){border-color:' + p.border + ' !important;background-color:' + p.border + ' !important;}'
      + media + '{filter:none !important;}'
      + 'reddit-header-large :where(svg,path),reddit-header-action-items :where(svg,path),shreddit-app :where(button,[role="button"]) :where(svg,path){fill:currentColor !important;stroke:currentColor !important;}'
      + lightRepair;
  }

  function redditShadowCSS(mode) {
    const p = paletteFor(mode);
    const weakText = mode === 'light' ? p.text : p.muted;
    const vars = [
      '--color-neutral-background:' + p.bg,
      '--color-neutral-background-weak:' + p.bg,
      '--color-neutral-background-medium:' + p.surface,
      '--color-neutral-background-strong:' + p.raised,
      '--color-neutral-background-inverted:' + p.surface,
      '--color-neutral-background-selected:' + p.surface,
      '--color-neutral-background-hover:' + p.controlHover,
      '--color-neutral-content:' + p.text,
      '--color-neutral-content-weak:' + weakText,
      '--color-neutral-content-strong:' + p.text,
      '--color-neutral-content-disabled:' + weakText,
      '--color-neutral-content-inverted:' + p.text,
      '--color-neutral-border:' + p.border,
      '--color-neutral-border-weak:' + p.border,
      '--color-tone-1:' + p.text,
      '--color-tone-2:' + weakText,
      '--color-tone-3:' + weakText,
      '--color-tone-4:' + p.border,
      '--color-tone-5:' + p.control,
      '--color-tone-6:' + p.surface,
      '--color-tone-7:' + p.bg,
      '--color-media-background:' + p.surface,
      '--color-a-default:' + p.link,
      '--color-a-hover:' + p.focus,
      '--color-interactive-content:' + p.link,
      '--color-interactive-content-hover:' + p.focus
    ].join(' !important;') + ' !important;';
    const text = ':where(a,span,p,small,strong,em,h1,h2,h3,h4,h5,h6,faceplate-number,faceplate-timeago,[class*="text" i],[class*="title" i],[class*="truncate" i],[class*="community" i],[class*="subreddit" i])';
    const field = ':where(input:not([type="range"]):not([type="checkbox"]):not([type="radio"]),textarea,select,[contenteditable="true"],[role="textbox"])';
    const control = ':where(button,[role="button"],summary)';
    const blackSurface = mode === 'light'
      ? ':where([class*="bg-black" i],[class*="bg-neutral-background-inverted" i],[class*="bg-neutral-background-strong" i],[class*="bg-tone-1" i],[class*="bg-tone-2" i]):not(img):not(picture):not(video):not(canvas):not(svg):not(path):not([style*="url"]){background-color:' + p.surface + ' !important;color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      : '';
    return ':host,:host *{' + vars + 'color-scheme:' + p.scheme + ' !important;}'
      + ':host{color:' + p.text + ' !important;border-color:' + p.border + ' !important;text-shadow:none !important;}'
      + text + '{background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;opacity:1 !important;filter:none !important;text-shadow:none !important;}'
      + ':where([class*="muted" i],[class*="secondary" i],[class*="subtle" i],[class*="meta" i],[class*="caption" i],faceplate-timeago){color:' + weakText + ' !important;-webkit-text-fill-color:currentColor !important;opacity:1 !important;text-shadow:none !important;}'
      + field + '{background-color:' + p.input + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + p.text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;outline:0 !important;text-shadow:none !important;}'
      + control + '{background-color:' + p.control + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + control + ':where(:hover,[aria-expanded="true"],[aria-pressed="true"],[aria-selected="true"]){background-color:' + p.controlHover + ' !important;color:' + p.text + ' !important;}'
      + ':where(hr,[role="separator"]){border-color:' + p.border + ' !important;background-color:' + p.border + ' !important;}'
      + ':where(img,picture,video,canvas,iframe,embed,object){filter:none !important;}'
      + ':host(reddit-search-large){background-color:' + p.input + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border:1px solid ' + p.border + ' !important;box-shadow:none !important;outline:0 !important;overflow:visible !important;text-shadow:none !important;}'
      + ':host(faceplate-search-input) :where(.label-container,.input-container,input,textarea,[role="textbox"]),:host(faceplate-search-input:focus-within) :where(.label-container,.input-container,input,textarea,[role="textbox"]){background-color:' + p.input + ' !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:transparent !important;box-shadow:none !important;outline:0 !important;text-shadow:none !important;}'
      + ':host(reddit-search-large) .reddit-search-bar,:host(reddit-search-large) .reddit-search-bar[class]{background-color:transparent !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border:0 !important;border-radius:0 !important;box-shadow:none !important;outline:0 !important;overflow:visible !important;text-shadow:none !important;}'
      + ':host(reddit-search-large:focus-within) .reddit-search-bar,:host(reddit-search-large:focus-within) .reddit-search-bar[class]{border:0 !important;border-radius:0 !important;box-shadow:none !important;outline:0 !important;overflow:visible !important;}'
      + ':host(reddit-search-large) :where(.reddit-search-bar > :first-child,form,label,faceplate-search-input,.search-input){background-color:' + p.input + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + ':host(reddit-search-large) :where(#search-dropdown-results-container,.search-results-list,[id*="search-dropdown" i],[class*="search-results" i]){background-color:' + p.surface + ' !important;background-image:none !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;outline:0 !important;border-radius:0 !important;text-shadow:none !important;}'
      + ':host(reddit-search-large) :where(#search-dropdown-results-container,.search-results-list,[id*="search-dropdown" i],[class*="search-results" i]) :where(li,a,span,p,small,strong,em,div){background-color:transparent !important;color:' + p.text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + ':host(reddit-search-large)::before,:host(reddit-search-large)::after,:host(reddit-search-large:focus)::before,:host(reddit-search-large:focus)::after,:host(reddit-search-large:focus-within)::before,:host(reddit-search-large:focus-within)::after,:host(reddit-search-large) .reddit-search-bar::before,:host(reddit-search-large) .reddit-search-bar::after{content:none !important;display:none !important;background:transparent !important;background-color:transparent !important;background-image:none !important;border:0 !important;box-shadow:none !important;opacity:0 !important;}'
      + ':host(reddit-search-large:focus-within){border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + blackSurface;
  }

  function amazonCSS(mode) {
    if (!isAmazonHost()) return '';
    const p = paletteFor(mode);
    const light = mode === 'light';
    const pageBg = light ? '#eaeded' : p.bg;
    const panel = light ? '#ffffff' : p.surface;
    const card = light ? '#ffffff' : p.raised;
    const mediaMat = '#ffffff';
    const navBg = light ? '#ffffff' : '#161a20';
    const navSub = light ? '#f7f8fb' : '#20242c';
    const text = light ? '#111318' : p.text;
    const muted = light ? '#5b6270' : p.muted;
    const link = light ? '#0066c0' : p.link;
    const price = light ? '#b12704' : '#ffb089';
    const root = 'html,body,#a-page';
    const top = 'body :where(#a-page,#dp,#search,#zg,#pageContent,#centerCol,#rightCol,#leftCol,#main,#content,#gw-content-grid,#desktop-grid,#rhf,#navFooter,#navFooter,#navFooterAmazon)';
    const nav = 'body :where(#navbar,#nav-belt,#nav-main,#nav-subnav,#nav-flyout-searchAjax,#nav-flyout-iss-anchor,#nav-progressive-subnav)';
    const navInner = '#navbar :where(div,span,a,label,form,button,[role="button"],.nav-a,.nav-line-1,.nav-line-2,.nav-search-label,.nav-search-dropdown)';
    const sections = 'body :where(.a-cardui,.a-cardui-body,.a-box,.a-box-inner,.a-section,.celwidget,.bxc-grid__container,.bxc-grid__row,.bxc-grid__content,.bxc-grid__column,.feed-carousel,.a-carousel-container,.a-carousel-viewport,.a-carousel,.a-carousel-row-inner,[data-a-card-type],[data-card-metrics-id],[data-cel-widget],[cel_widget_id],[class*="gw-card" i],[class*="desktop-grid" i],[class*="card-layout" i],[class*="carousel" i],[class*="deal" i]):not(img):not(picture):not(video):not(canvas):not(svg):not(path):not([style*="url"])';
    const cards = 'body :where(.a-carousel-card,.s-result-item,.s-card-container,.puis-card-container,.sg-col-inner,[data-asin],[data-component-type="s-search-result"],[class*="product-card" i],[class*="deal-card" i],[class*="dealCard" i]):not(img):not(picture):not(video):not(canvas):not(svg):not(path):not([style*="url"])';
    const textBits = 'body :is(#a-page,#navbar) :where(h1,h2,h3,h4,h5,h6,p,span,li,td,th,small,strong,em,label,legend,.a-size-base,.a-size-medium,.a-size-small,.a-size-mini,.a-text-normal,.a-color-base,.a-row,.a-list-item,.s-title-instructions-style,.a-truncate,.a-price,.a-offscreen,.a-price-whole,.a-price-fraction)';
    const mutedBits = 'body :is(#a-page,#navbar) :where(.a-color-secondary,.a-color-tertiary,.s-color-swatch-link,[class*="secondary" i],[class*="subtitle" i],[class*="byline" i],[class*="availability" i])';
    const field = 'body :is(#a-page,#nav-search) :where(input:not([type="image"]):not([type="range"]):not([type="checkbox"]):not([type="radio"]),textarea,select,[role="textbox"])';
    const control = 'body :is(#a-page,#nav-search) :where(button,[role="button"],.a-button,.a-button-inner,.a-button-text,.a-dropdown-prompt,.nav-search-submit,.nav-search-scope)';
    const media = 'body :where(#a-page) :where(img,picture,video,canvas,iframe,embed,object)';
    const mediaWrap = 'body :where(#a-page) :where(.a-image-container,.s-product-image-container,.s-image-square-aspect,.s-image-fixed-height,.a-dynamic-image-container,[class*="image-container" i],[class*="imageWrapper" i],[class*="image-wrapper" i]):not([style*="url"])';
    const sectionHeadings = 'body :is(#a-page) :where(.a-cardui-header,.a-cardui-header *,h1,h2,h3,h4,[class*="headline" i],[class*="heading" i])';
    return root + '{background-color:' + pageBg + ' !important;color:' + text + ' !important;color-scheme:' + p.scheme + ' !important;}'
      + top + '{background-color:' + pageBg + ' !important;color:' + text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + nav + '{background-color:' + navBg + ' !important;color:' + text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + '#nav-main,#nav-subnav,#nav-progressive-subnav{background-color:' + navSub + ' !important;}'
      + navInner + '{color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;text-shadow:none !important;}'
      + sections + '{background-color:' + panel + ' !important;color:' + text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + cards + '{background-color:' + card + ' !important;color:' + text + ' !important;border:1px solid ' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + cards + ':hover{background-color:' + p.controlHover + ' !important;}'
      + sectionHeadings + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + textBits + '{background-color:transparent !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + mutedBits + '{background-color:transparent !important;color:' + muted + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + 'body :is(#a-page) :where(.a-price,.a-price-whole,.a-price-fraction,.a-color-price,.p13n-sc-price){color:' + price + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'body :is(#a-page,#navbar) a,body :is(#a-page,#navbar) a *{background-color:transparent !important;color:' + link + ' !important;-webkit-text-fill-color:currentColor !important;text-shadow:none !important;}'
      + field + '{background-color:' + p.input + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;caret-color:' + text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + field + '::placeholder{color:' + muted + ' !important;-webkit-text-fill-color:' + muted + ' !important;opacity:1 !important;}'
      + '#nav-search-bar-form,#nav-search form,#nav-search .nav-search-field,#nav-search .nav-search-scope,#nav-search .nav-search-submit{background-color:' + p.input + ' !important;color:' + text + ' !important;border-color:' + p.border + ' !important;box-shadow:none !important;}'
      + control + '{background-color:' + p.control + ' !important;color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;border-color:' + p.border + ' !important;box-shadow:none !important;text-shadow:none !important;}'
      + control + ':hover{background-color:' + p.controlHover + ' !important;color:' + text + ' !important;}'
      + mediaWrap + '{background-color:' + mediaMat + ' !important;border-color:' + (light ? p.border : '#ffffff') + ' !important;box-shadow:none !important;}'
      + media + '{filter:none !important;background:transparent !important;}'
      // Deals (dcl-*) widget outer wrappers + nav-assistant shortcut panel ship native
      // WHITE backgrounds via class !important rules that the :where()-wrapped selectors
      // above can't out-specify, so they stayed as bright patches. Cover them explicitly
      // with id-level specificity (#a-page + :is) so the page reads dark end to end.
      + 'body #a-page :is(.dcl-container,.dcl-container-inner){background-color:' + pageBg + ' !important;}'
      + 'body #a-page :is(nav.nav-assistant,.nav-assistant,.shortcut-help-container,#shortcut-menu){background-color:' + panel + ' !important;border-color:' + p.border + ' !important;}'
      + 'body #a-page :is(.nav-assistant,#shortcut-menu) :is(h1,h2,h3,h4,span,li,a,div,p){color:' + text + ' !important;-webkit-text-fill-color:currentColor !important;}'
      + 'body :is(#a-page) :where(hr,[role="separator"],.a-divider,.a-spacing-top-base){border-color:' + p.border + ' !important;background-color:' + p.border + ' !important;}';
  }
    return {
      amazonCSS: amazonCSS,
      chatGPTCSS: chatGPTCSS,
      githubCSS: githubCSS,
      googleDarkCSS: googleDarkCSS,
      googleLightCSS: googleLightCSS,
      googleShadowCSS: googleShadowCSS,
      hackerNewsCSS: hackerNewsCSS,
      redditCSS: redditCSS,
      redditShadowCSS: redditShadowCSS,
      stackOverflowCSS: stackOverflowCSS,
      twitchDarkCSS: twitchDarkCSS,
      twitchLightCSS: twitchLightCSS,
      wikipediaCSS: wikipediaCSS,
      youtubeDarkCSS: youtubeDarkCSS,
      youtubeLightCSS: youtubeLightCSS,
      youtubeShadowCSS: youtubeShadowCSS,
    };
  };
}());
