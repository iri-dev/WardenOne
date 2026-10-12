# WardenOne performance profile

- commit `7507f01` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x1, 5 runs per cell, 2026-10-12T02:39:26.419Z
- variants: on:logger-off, on; pages served from 127.0.0.1; nothing left the machine
- Iframe logger settings alternated between runs in one browser profile.
- readiness: on:logger-off = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger off in 8 frames, remote host lists 3636 hosts; on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger on in 8 frames, remote host lists 3636 hosts; the worker's own task time is not exposed by this browser's worker target

## /image-frames.html

| metric | phase | on:logger-off median / p90 / max | on median / p90 / max | on - on:logger-off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 449.2 / 471.01 / 478.11 | 483.4 / 498.79 / 501.55 | +34.2 (+7.61%) |
| main-thread task ms | warm | 439.77 / 476.98 / 489.95 | 456.18 / 473.04 / 473.54 | +16.41 (+3.73%) |
| script ms | cold | 247.01 / 253.98 / 258.4 | 276.92 / 279.99 / 280.17 | +29.91 (+12.11%) |
| script ms | warm | 252.93 / 275.79 / 283.65 | 271.12 / 276.64 / 277.36 | +18.19 (+7.19%) |
| layout ms | cold | 16.14 / 17.52 / 17.68 | 15.62 / 17.48 / 18.2 | -0.52 (-3.22%) |
| layout ms | warm | 8.31 / 8.65 / 8.65 | 7.74 / 8.6 / 8.72 | -0.57 (-6.86%) |
| style ms | cold | 8.18 / 8.46 / 8.54 | 8.13 / 8.45 / 8.5 | -0.05 (-0.61%) |
| style ms | warm | 8.74 / 8.94 / 8.99 | 8.21 / 8.95 / 9.45 | -0.53 (-6.06%) |
| frame mutation batches ms | cold | 520.3 / 589.7 / 616.9 | 590 / 43042.94 / 71334.3 | +69.7 (+13.4%) |
| frame mutation batches ms | warm | 552.1 / 575.22 / 577.3 | 635.3 / 43579.2 / 72202.6 | +83.2 (+15.07%) |
| long tasks | cold | 1 / 1 / 1 | 1 / 1 / 1 | +0 (+0%) |
| long tasks | warm | 1 / 1 / 1 | 1 / 1 / 1 | +0 (+0%) |
| long-task ms | cold | 62 / 64.6 / 65 | 62 / 77.8 / 85 | +0 (+0%) |
| long-task ms | warm | 58 / 61.2 / 62 | 57 / 71.8 / 81 | -1 (-1.72%) |
| DOMContentLoaded ms | cold | 63.3 / 70.88 / 73.4 | 64.1 / 69.18 / 70.9 | +0.8 (+1.26%) |
| DOMContentLoaded ms | warm | 78.1 / 87.54 / 91.5 | 74 / 75.3 / 76.1 | -4.1 (-5.25%) |
| load ms | cold | 254.3 / 278.72 / 288.6 | 254.3 / 279.34 / 281.3 | +0 (+0%) |
| load ms | warm | 231.6 / 253.78 / 266.1 | 225.5 / 229.68 / 231.2 | -6.1 (-2.63%) |
| fixture completion ms | cold | 2168 / 2178.6 / 2185 | 2169 / 15535 / 24435 | +1 (+0.05%) |
| fixture completion ms | warm | 2200 / 2218.6 / 2231 | 2231 / 15257 / 23931 | +31 (+1.41%) |
| heap after GC MB | cold | 6.78 / 6.79 / 6.8 | 6.94 / 6.95 / 6.95 | +0.16 (+2.36%) |
| heap after GC MB | warm | 6.81 / 6.82 / 6.82 | 6.95 / 6.97 / 6.97 | +0.14 (+2.06%) |
| DOM nodes | cold | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| DOM nodes | warm | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| listeners | cold | 550 / 550 / 550 | 568 / 568 / 568 | +18 (+3.27%) |
| listeners | warm | 585 / 587.8 / 589 | 600 / 604.6 / 605 | +15 (+2.56%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
