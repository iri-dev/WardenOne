# WardenOne performance profile

- commit `7507f01`, extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x1, 7 runs per cell, 2026-10-12T08:37:43.538Z
- variants: on:logger-off, on; pages served from 127.0.0.1; nothing left the machine
- Iframe logger settings alternated between runs in one browser profile.
- readiness: on:logger-off = worker 1.0.2 (ijjeoloinofdglhdabnmihickekcmnno), page marker 1.0.2, iframe logger off in 8 frames, remote host lists 3636 hosts; on = worker 1.0.2 (ijjeoloinofdglhdabnmihickekcmnno), page marker 1.0.2, iframe logger on in 8 frames, remote host lists 3636 hosts; the worker's own task time is not exposed by this browser's worker target

## /image-frames.html

| metric | phase | on:logger-off median / p90 / max | on median / p90 / max | on - on:logger-off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 424.12 / 428.33 / 428.52 | 435.65 / 448.84 / 461.54 | +11.53 (+2.72%) |
| main-thread task ms | warm | 392.29 / 398.86 / 404.53 | 412.55 / 421.19 / 422.67 | +20.26 (+5.16%) |
| script ms | cold | 253.1 / 259.47 / 259.93 | 260.37 / 269.04 / 269.13 | +7.27 (+2.87%) |
| script ms | warm | 244.85 / 249.15 / 250.6 | 261.14 / 264.82 / 266.13 | +16.29 (+6.65%) |
| layout ms | cold | 13.67 / 14.14 / 14.62 | 13.85 / 14.6 / 15.47 | +0.18 (+1.32%) |
| layout ms | warm | 6.1 / 6.46 / 6.54 | 5.87 / 5.99 / 6.05 | -0.23 (-3.77%) |
| style ms | cold | 6.72 / 7.08 / 7.39 | 6.76 / 7.08 / 7.25 | +0.04 (+0.6%) |
| style ms | warm | 6.75 / 7.03 / 7.27 | 6.53 / 6.77 / 7.02 | -0.22 (-3.26%) |
| frame mutation batches ms | cold | 460.9 / 488.48 / 490.4 | 500.1 / 541.18 / 549.4 | +39.2 (+8.51%) |
| frame mutation batches ms | warm | 485.8 / 526.68 / 530.4 | 535.6 / 597.02 / 632.6 | +49.8 (+10.25%) |
| long tasks | cold | 1 / 1 / 1 | 1 / 1 / 1 | +0 (+0%) |
| long tasks | warm | 0 / 0 / 0 | 0 / 0 / 0 | +0 |
| long-task ms | cold | 56 / 59.6 / 62 | 53 / 56.4 / 57 | -3 (-5.36%) |
| long-task ms | warm | 0 / 0 / 0 | 0 / 0 / 0 | +0 |
| DOMContentLoaded ms | cold | 55.2 / 58.7 / 59.3 | 53.7 / 58.92 / 59.1 | -1.5 (-2.72%) |
| DOMContentLoaded ms | warm | 63.9 / 64.7 / 65.6 | 64.5 / 69.34 / 70 | +0.6 (+0.94%) |
| load ms | cold | 231.4 / 249.32 / 254 | 154.8 / 241.74 / 250.8 | -76.6 (-33.1%) |
| load ms | warm | 207.5 / 211.7 / 213.2 | 212.4 / 216.22 / 216.7 | +4.9 (+2.36%) |
| fixture completion ms | cold | 2147 / 2207 / 2216 | 2130 / 2163.8 / 2189 | -17 (-0.79%) |
| fixture completion ms | warm | 2163 / 2177.2 / 2179 | 2180 / 2183.6 / 2186 | +17 (+0.79%) |
| heap after GC MB | cold | 7.09 / 7.09 / 7.09 | 7.23 / 7.24 / 7.24 | +0.14 (+1.97%) |
| heap after GC MB | warm | 7.08 / 7.1 / 7.11 | 7.24 / 7.25 / 7.25 | +0.16 (+2.26%) |
| DOM nodes | cold | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| DOM nodes | warm | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| listeners | cold | 550 / 566 / 566 | 568 / 576 / 588 | +18 (+3.27%) |
| listeners | warm | 585 / 587 / 587 | 599 / 604.2 / 606 | +14 (+2.39%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
