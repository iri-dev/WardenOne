# Near-limit DNR reconciliation check

Local manual run on 2026-09-27 with `node tools/browser-dnr-reconcile.js`. The script
loads the checkout into a disposable Microsoft Edge profile, adds temporary rules,
instruments the worker's DNR API calls, restores the original setting, and removes
the temporary rules before deleting the profile.

The profile held **29,800 dynamic and session rules** (29,549 temporary, 134 existing
dynamic, 117 existing session). An unrelated search appearance switch caused zero DNR
reads and writes. Turning SafeSearch on added 11 rules; restoring it removed them and
left the SafeSearch band byte-for-byte equal to its starting state.

The table is one representative run. Startup remote-list and Grabber maintenance
overlapped the first toggle in some runs and settled before it in others, so its
dynamic counts varied between one and two reads. Those call stacks were recorded
separately from the central reconciler's calls.

| Window | Dynamic reads | Session reads | Dynamic writes | Session writes |
| --- | ---: | ---: | ---: | ---: |
| Unrelated appearance change | 0 | 0 | 0 | 0 |
| SafeSearch on | 2 | 1 | 1 | 1 |
| SafeSearch restored | 0 | 1 | 0 | 1 |

The follow-up batch run changed SafeSearch and login compatibility together: one
session read and one session write applied both bands, and the restore did the same.
It then changed fingerprint-script blocking and sponsored-search cleanup together:
one dynamic read and one dynamic write applied both bands, with the same counts on
restore. Both band pairs were byte-for-byte equal to their baseline after restore.
Three SafeSearch writes made 40 ms apart settled to the newest value with one
session write; restoring the original value returned the exact starting band.

The SafeSearch-on window overlapped the startup remote-list update and one Grabber
feed read. Instrumented stacks identified those callers; they did not come from the
central SafeSearch applier. Before removing a duplicate storage-listener trigger,
the same check made three dynamic reads, including two Grabber reads. In the final
run the two dynamic reads took 557 ms in total and the dynamic update took 679 ms.
The session read took 3 ms and its update 4 ms.
These are **API promise durations in one disposable browser run**, not a general
latency estimate. The script waits 2.2 seconds after each setting write so the
whole observed window includes that deliberate delay.

The remote-list updater now compares its desired bands with the installed snapshot
and skips its Chrome update when they match. The first fetch in this fresh profile
changed those bands, so the table correctly includes that update; the guarded
commit path has a regression check for the identical-band case.

The independently scheduled remote-list and Grabber jobs still enumerate rules
when their own data changes. They are separate maintenance work from the central
settings generation. The profiler remains available to detect future duplicate
work or final-state regressions.
