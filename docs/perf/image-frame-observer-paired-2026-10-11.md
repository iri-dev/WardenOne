# WardenOne performance profile

- commit `fd160f9` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x1, 7 runs per cell, 2026-10-11T21:19:36.236Z
- variants: on:logger-off, on; pages served from 127.0.0.1; nothing left the machine
- Iframe logger settings alternated between runs in one browser profile.
- readiness: on:logger-off = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger off in 8 frames; on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger on in 8 frames; the worker's own task time is not exposed by this browser's worker target

## /image-frames.html

| metric | phase | on:logger-off median / p90 / max | on median / p90 / max | on - on:logger-off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 605.14 / 671.09 / 681.16 | 677.95 / 727.3 / 735.42 | +72.81 (+12.03%) |
| main-thread task ms | warm | 583.49 / 618.6 / 619.01 | 678.44 / 694.3 / 710.18 | +94.95 (+16.27%) |
| script ms | cold | 428.97 / 459.46 / 462.55 | 477.15 / 522.9 / 535.95 | +48.18 (+11.23%) |
| script ms | warm | 420.79 / 441.29 / 446.29 | 479.93 / 499.01 / 515.23 | +59.14 (+14.05%) |
| layout ms | cold | 15.58 / 17.59 / 18.06 | 15.9 / 17.05 / 17.71 | +0.32 (+2.05%) |
| layout ms | warm | 6.3 / 6.93 / 7.21 | 6.89 / 7.06 / 7.06 | +0.59 (+9.37%) |
| style ms | cold | 8.42 / 9.08 / 9.6 | 7.94 / 8.99 / 8.99 | -0.48 (-5.7%) |
| style ms | warm | 7.28 / 8.43 / 8.56 | 8.38 / 8.71 / 8.73 | +1.1 (+15.11%) |
| frame mutation batches ms | cold | 506.2 / 577.8 / 577.8 | 583.9 / 971.52 / 1473 | +77.7 (+15.35%) |
| frame mutation batches ms | warm | 610.4 / 753.6 / 915.9 | 598.1 / 622.72 / 638.5 | -12.3 (-2.02%) |
| long tasks | cold | 1 / 1 / 1 | 1 / 1 / 1 | +0 (+0%) |
| long tasks | warm | 1 / 1 / 1 | 1 / 1 / 1 | +0 (+0%) |
| long-task ms | cold | 71 / 73.4 / 74 | 68 / 70 / 73 | -3 (-4.23%) |
| long-task ms | warm | 63 / 65.4 / 66 | 61 / 66.4 / 67 | -2 (-3.17%) |
| DOMContentLoaded ms | cold | 63.7 / 68.4 / 71.1 | 61.8 / 66.28 / 66.4 | -1.9 (-2.98%) |
| DOMContentLoaded ms | warm | 72.2 / 77.54 / 84.8 | 74.7 / 81.76 / 82.6 | +2.5 (+3.46%) |
| load ms | cold | 296.1 / 392.28 / 410.1 | 243.4 / 346.5 / 377.7 | -52.7 (-17.8%) |
| load ms | warm | 263.1 / 324.78 / 342.6 | 315.2 / 342.74 / 356.3 | +52.1 (+19.8%) |
| fixture completion ms | cold | 2169 / 2213.2 / 2233 | 2195 / 2295.4 / 2386 | +26 (+1.2%) |
| fixture completion ms | warm | 2222 / 2263 / 2266 | 2224 / 2261.8 / 2263 | +2 (+0.09%) |
| heap after GC MB | cold | 8.71 / 8.76 / 8.76 | 8.89 / 8.99 / 9.07 | +0.18 (+2.07%) |
| heap after GC MB | warm | 8.75 / 8.77 / 8.78 | 8.94 / 8.95 / 8.95 | +0.19 (+2.17%) |
| DOM nodes | cold | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| DOM nodes | warm | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| listeners | cold | 570 / 580.8 / 582 | 568 / 582 / 594 | -2 (-0.35%) |
| listeners | warm | 585 / 587.8 / 589 | 568 / 596.8 / 601 | -17 (-2.91%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
