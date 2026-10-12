# WardenOne performance profile

- commit `7507f01` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x4, 5 runs per cell, 2026-10-12T08:40:57.518Z
- variants: on:logger-off, on; pages served from 127.0.0.1; nothing left the machine
- Iframe logger settings alternated between runs in one browser profile.
- readiness: on:logger-off = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger off in 8 frames, remote host lists 3636 hosts; on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger on in 8 frames, remote host lists 3636 hosts; the worker's own task time is not exposed by this browser's worker target

## /image-frames.html

| metric | phase | on:logger-off median / p90 / max | on median / p90 / max | on - on:logger-off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 1770.61 / 1813.19 / 1828.95 | 1866.53 / 1924.61 / 1944.6 | +95.92 (+5.42%) |
| main-thread task ms | warm | 1685.15 / 1728.56 / 1742.94 | 1756.82 / 1807.58 / 1832.4 | +71.67 (+4.25%) |
| script ms | cold | 1048.74 / 1073.59 / 1088.43 | 1123 / 1154 / 1166.17 | +74.26 (+7.08%) |
| script ms | warm | 1015.09 / 1046.06 / 1056.33 | 1073.86 / 1108.83 / 1122.65 | +58.77 (+5.79%) |
| layout ms | cold | 66.53 / 67.09 / 67.43 | 64.9 / 65.52 / 65.6 | -1.63 (-2.45%) |
| layout ms | warm | 26.93 / 27.04 / 27.06 | 27.62 / 28.43 / 28.71 | +0.69 (+2.56%) |
| style ms | cold | 34.97 / 37.75 / 38.97 | 35.59 / 36.25 / 36.54 | +0.62 (+1.77%) |
| style ms | warm | 30.73 / 31.23 / 31.5 | 28.41 / 28.87 / 29.06 | -2.32 (-7.55%) |
| frame mutation batches ms | cold | 2027.2 / 2250.7 / 2330.7 | 2310.4 / 2511.8 / 2642.4 | +283.2 (+13.97%) |
| frame mutation batches ms | warm | 2167.4 / 2348.36 / 2408 | 2559.9 / 2635.16 / 2654.2 | +392.5 (+18.11%) |
| long tasks | cold | 3 / 3 / 3 | 3 / 3 / 3 | +0 (+0%) |
| long tasks | warm | 3 / 3 / 3 | 3 / 3 / 3 | +0 (+0%) |
| long-task ms | cold | 476 / 499.4 / 507 | 476 / 491 / 493 | +0 (+0%) |
| long-task ms | warm | 405 / 421.6 / 430 | 389 / 409 / 409 | -16 (-3.95%) |
| DOMContentLoaded ms | cold | 355 / 581.62 / 697.7 | 374.4 / 663.5 / 666.1 | +19.4 (+5.46%) |
| DOMContentLoaded ms | warm | 634.6 / 653.72 / 666.4 | 599.5 / 639.76 / 641 | -35.1 (-5.53%) |
| load ms | cold | 1008.3 / 1065.44 / 1091.2 | 1022.7 / 1038.3 / 1042.7 | +14.4 (+1.43%) |
| load ms | warm | 960.2 / 995.62 / 1017.5 | 946.2 / 990.34 / 995.7 | -14 (-1.46%) |
| fixture completion ms | cold | 3318 / 3383.2 / 3416 | 3370 / 3437.4 / 3469 | +52 (+1.57%) |
| fixture completion ms | warm | 3279 / 3302.8 / 3312 | 3305 / 3327 / 3331 | +26 (+0.79%) |
| heap after GC MB | cold | 6.81 / 6.85 / 6.87 | 6.92 / 6.95 / 6.95 | +0.11 (+1.62%) |
| heap after GC MB | warm | 6.89 / 6.9 / 6.9 | 6.99 / 7 / 7 | +0.1 (+1.45%) |
| DOM nodes | cold | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| DOM nodes | warm | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| listeners | cold | 550 / 579.2 / 584 | 566 / 586 / 586 | +16 (+2.91%) |
| listeners | warm | 587 / 587.6 / 588 | 587 / 589.2 / 590 | +0 (+0%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
