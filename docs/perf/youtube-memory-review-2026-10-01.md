# YouTube memory review — 2026-10-01

The owner's Brave tab hover card reported 1.2 GB while playing [Bossfight — Endgame](https://www.youtube.com/watch?v=duNv2_IplR4). That single reading cannot assign memory to YouTube, media decoding, Brave, or WardenOne.

I loaded that watch page in fresh, isolated Brave 154 and Edge 150 profiles. Each run used the same window size, loaded WardenOne from this working tree when enabled, closed its onboarding tab, and sampled the JavaScript heap, DOM counters, and Windows working sets for the profile's processes. These process totals are **not** the browser's tab-hover number. The diagnostic script and Edge samples are saved locally under `.store-candidates/`.

| Browser | WardenOne | Video at 45 s | Page JS heap | Largest renderer working set | Whole profile working set |
| --- | --- | --- | ---: | ---: | ---: |
| Brave | off | paused at 0 s | 95 MB | 372 MB | 1,090 MB |
| Brave | on | playing at 46 s | 98 MB | 422 MB | 1,389 MB |
| Edge | off | paused at 0 s | 110 MB | 386 MB | 1,099 MB |
| Edge | on | playing at 46 s | 113 MB | 1,276 MB | 2,255 MB |

The extension-off browser immediately paused the video even after a play request and a click, so the on/off process-memory totals are **not a valid measurement of WardenOne's contribution**. In the playing Edge run, renderer memory rose from 501 MB after loading to 1,276 MB at 45 seconds while the page JS heap stayed around 113 MB and the live DOM count stayed near 10,460. A later Brave run with WardenOne playing the same video at 480p reached 1,177 MB in its largest renderer at 45 seconds while JS heap fell from 112 MB to 98 MB and live DOM stayed near 10,970. The two Brave runs differed substantially, so a single short run cannot predict this tab's memory. The pattern is consistent with memory outside the measured JS heap, including the browser's media pipeline, but does not prove a specific allocator or rule out an extension interaction.

WardenOne's YouTube player module does not intercept `MediaSource` or `SourceBuffer`; its fetch response rewriting targets player and watch responses rather than video segments. Memory Shield intentionally preserves the active or audible tab, so it cannot free this video tab while playback continues.

For the user's live Brave session, record Brave Task Manager (`Shift+Esc`) when the warning appears, especially the YouTube tab and WardenOne extension rows. Compare the same tab immediately after reload, then after a few minutes of playback. A lower video quality and turning off YouTube Ambient mode are reversible ways to test media/rendering cost without stopping protection. A sustained rise in the YouTube row with stable extension memory would justify a browser/media investigation; growth in the WardenOne row would justify a heap capture and module isolation.
