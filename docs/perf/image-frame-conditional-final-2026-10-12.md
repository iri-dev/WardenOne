# WardenOne performance profile

- commit `7507f01` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x1, 5 runs per cell, 2026-10-12T06:51:01.378Z
- variants: on:logger-off, on; pages served from 127.0.0.1; nothing left the machine
- Iframe logger settings alternated between runs in one browser profile.
- readiness: on:logger-off = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger off in 8 frames, remote host lists 3636 hosts; on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger on in 8 frames, remote host lists 3636 hosts; the worker's own task time is not exposed by this browser's worker target

## /image-frames.html

| metric | phase | on:logger-off median / p90 / max | on median / p90 / max | on - on:logger-off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 405.51 / 439.19 / 454.19 | 427.38 / 451.31 / 461.61 | +21.87 (+5.39%) |
| main-thread task ms | warm | 369.35 / 397.42 / 405.11 | 392.62 / 433.1 / 448.87 | +23.27 (+6.3%) |
| script ms | cold | 219.72 / 238.94 / 244.55 | 239.67 / 255.7 / 265.35 | +19.95 (+9.08%) |
| script ms | warm | 218.88 / 226.63 / 230.85 | 236.27 / 263.41 / 278.19 | +17.39 (+7.94%) |
| layout ms | cold | 14.52 / 16.21 / 17 | 15.05 / 15.28 / 15.41 | +0.53 (+3.65%) |
| layout ms | warm | 6.49 / 7.06 / 7.27 | 6.35 / 6.49 / 6.58 | -0.14 (-2.16%) |
| style ms | cold | 7.21 / 7.44 / 7.48 | 7.17 / 7.63 / 7.82 | -0.04 (-0.55%) |
| style ms | warm | 7.11 / 8.32 / 8.65 | 6.69 / 7.48 / 7.51 | -0.42 (-5.91%) |
| frame mutation batches ms | cold | 492.2 / 513.94 / 527.5 | 524.6 / 43354.52 / 71902.4 | +32.4 (+6.58%) |
| frame mutation batches ms | warm | 499.8 / 586.8 / 630 | 564.2 / 43448.9 / 72006.7 | +64.4 (+12.89%) |
| long tasks | cold | 1 / 1 / 1 | 1 / 1 / 1 | +0 (+0%) |
| long tasks | warm | 0 / 1 / 1 | 1 / 1 / 1 | +1 |
| long-task ms | cold | 56 / 65.8 / 67 | 57 / 59.4 / 61 | +1 (+1.79%) |
| long-task ms | warm | 0 / 51.8 / 53 | 54 / 67.8 / 77 | +54 |
| DOMContentLoaded ms | cold | 60.2 / 65.78 / 67.1 | 58.1 / 61.52 / 63.8 | -2.1 (-3.49%) |
| DOMContentLoaded ms | warm | 66.6 / 68.92 / 69.6 | 67.5 / 72.3 / 72.7 | +0.9 (+1.35%) |
| load ms | cold | 243.3 / 258.8 / 262.8 | 168.2 / 239.08 / 247 | -75.1 (-30.87%) |
| load ms | warm | 202.1 / 209.24 / 211.2 | 213.7 / 231.08 / 241.4 | +11.6 (+5.74%) |
| fixture completion ms | cold | 2128 / 2158.4 / 2160 | 2128 / 15506.6 / 24419 | +0 (+0%) |
| fixture completion ms | warm | 2165 / 2173 / 2173 | 2169 / 15779.6 / 24846 | +4 (+0.18%) |
| heap after GC MB | cold | 6.79 / 6.79 / 6.8 | 6.87 / 6.88 / 6.88 | +0.08 (+1.18%) |
| heap after GC MB | warm | 6.81 / 6.82 / 6.82 | 6.89 / 6.9 / 6.91 | +0.08 (+1.17%) |
| DOM nodes | cold | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| DOM nodes | warm | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| listeners | cold | 550 / 550 / 550 | 552 / 552 / 552 | +2 (+0.36%) |
| listeners | warm | 589 / 589.6 / 590 | 580 / 585.6 / 588 | -9 (-1.53%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
