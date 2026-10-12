# WardenOne performance profile

- commit `7507f01` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x1, 7 runs per cell, 2026-10-12T09:04:09.646Z
- variants: on:logger-off, on; pages served from 127.0.0.1; nothing left the machine
- Iframe logger settings alternated between runs in one browser profile.
- readiness: on:logger-off = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger off in 8 frames, remote host lists 3636 hosts; on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger on in 8 frames, remote host lists 3636 hosts; the worker's own task time is not exposed by this browser's worker target

## /image-frames.html

| metric | phase | on:logger-off median / p90 / max | on median / p90 / max | on - on:logger-off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 376.51 / 383.48 / 386.41 | 392.51 / 402.99 / 405.04 | +16 (+4.25%) |
| main-thread task ms | warm | 356.48 / 372.92 / 392.06 | 357.91 / 373.04 / 377.18 | +1.43 (+0.4%) |
| script ms | cold | 204.34 / 207.24 / 207.34 | 218.89 / 220.59 / 220.93 | +14.55 (+7.12%) |
| script ms | warm | 206.38 / 214.87 / 222.1 | 212.78 / 220.14 / 221.99 | +6.4 (+3.1%) |
| layout ms | cold | 13.72 / 13.92 / 13.97 | 13.84 / 14.49 / 15.07 | +0.12 (+0.87%) |
| layout ms | warm | 5.99 / 6.23 / 6.47 | 6.1 / 6.26 / 6.3 | +0.11 (+1.84%) |
| style ms | cold | 6.65 / 6.91 / 7.08 | 6.48 / 7.04 / 7.2 | -0.17 (-2.56%) |
| style ms | warm | 6.7 / 6.98 / 7 | 6.67 / 6.82 / 6.83 | -0.03 (-0.45%) |
| frame mutation batches ms | cold | 484.3 / 509.82 / 521.7 | 522.3 / 599.52 / 625.5 | +38 (+7.85%) |
| frame mutation batches ms | warm | 487.9 / 519.38 / 556.4 | 554.5 / 574.4 / 579.8 | +66.6 (+13.65%) |
| long tasks | cold | 1 / 1 / 1 | 1 / 1 / 1 | +0 (+0%) |
| long tasks | warm | 0 / 1 / 1 | 0 / 0 / 0 | +0 |
| long-task ms | cold | 53 / 55 / 55 | 53 / 55 / 55 | +0 (+0%) |
| long-task ms | warm | 0 / 51 / 51 | 0 / 0 / 0 | +0 |
| DOMContentLoaded ms | cold | 54.3 / 57.54 / 59.7 | 55.8 / 59.24 / 60.8 | +1.5 (+2.76%) |
| DOMContentLoaded ms | warm | 64.9 / 72.94 / 83.5 | 62.1 / 65.46 / 66.9 | -2.8 (-4.31%) |
| load ms | cold | 207.4 / 221.62 / 226 | 152.7 / 211.28 / 212.9 | -54.7 (-26.37%) |
| load ms | warm | 196.6 / 212.24 / 231.2 | 185.4 / 198.46 / 199.6 | -11.2 (-5.7%) |
| fixture completion ms | cold | 2115 / 2126.4 / 2142 | 2123 / 2137.4 / 2141 | +8 (+0.38%) |
| fixture completion ms | warm | 2161 / 2185.6 / 2206 | 2154 / 2159.8 / 2161 | -7 (-0.32%) |
| heap after GC MB | cold | 6.79 / 6.8 / 6.8 | 6.89 / 6.9 / 6.91 | +0.1 (+1.47%) |
| heap after GC MB | warm | 6.81 / 6.82 / 6.82 | 6.91 / 6.91 / 6.91 | +0.1 (+1.47%) |
| DOM nodes | cold | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| DOM nodes | warm | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| listeners | cold | 550 / 556.4 / 566 | 552 / 552 / 552 | +2 (+0.36%) |
| listeners | warm | 585 / 586.4 / 587 | 587 / 588.8 / 590 | +2 (+0.34%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
