# WardenOne performance profile

- commit `7507f01` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x1, 7 runs per cell, 2026-10-12T08:36:11.606Z
- variants: on:logger-off, on; pages served from 127.0.0.1; nothing left the machine
- Iframe logger settings alternated between runs in one browser profile.
- readiness: on:logger-off = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger off in 8 frames, remote host lists 3636 hosts; on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger on in 8 frames, remote host lists 3636 hosts; the worker's own task time is not exposed by this browser's worker target

## /image-frames.html

| metric | phase | on:logger-off median / p90 / max | on median / p90 / max | on - on:logger-off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 366.6 / 383.01 / 386.72 | 388.18 / 403.96 / 413.11 | +21.58 (+5.89%) |
| main-thread task ms | warm | 344.9 / 351.74 / 355.58 | 357.92 / 371.46 / 374.02 | +13.02 (+3.78%) |
| script ms | cold | 201.75 / 211.72 / 214.14 | 220.38 / 224.36 / 226.95 | +18.63 (+9.23%) |
| script ms | warm | 203.81 / 207.43 / 208.34 | 217.02 / 221.41 / 221.99 | +13.21 (+6.48%) |
| layout ms | cold | 13.26 / 14.19 / 14.92 | 13.38 / 14.39 / 15.12 | +0.12 (+0.9%) |
| layout ms | warm | 5.7 / 5.81 / 5.92 | 5.75 / 6.1 / 6.26 | +0.05 (+0.88%) |
| style ms | cold | 6.35 / 6.91 / 7.58 | 6.46 / 6.83 / 6.91 | +0.11 (+1.73%) |
| style ms | warm | 6.49 / 6.69 / 6.73 | 6.2 / 6.65 / 6.67 | -0.29 (-4.47%) |
| frame mutation batches ms | cold | 530.8 / 549.72 / 550.8 | 512.5 / 571.82 / 596.9 | -18.3 (-3.45%) |
| frame mutation batches ms | warm | 527.3 / 587.78 / 610.4 | 587.8 / 616.2 / 625.2 | +60.5 (+11.47%) |
| long tasks | cold | 1 / 1 / 1 | 1 / 1 / 1 | +0 (+0%) |
| long tasks | warm | 0 / 0.4 / 1 | 0 / 0 / 0 | +0 |
| long-task ms | cold | 53 / 55.6 / 58 | 54 / 54.4 / 55 | +1 (+1.89%) |
| long-task ms | warm | 0 / 20 / 50 | 0 / 0 / 0 | +0 |
| DOMContentLoaded ms | cold | 54.1 / 56.02 / 56.2 | 54.2 / 58.58 / 60.8 | +0.1 (+0.18%) |
| DOMContentLoaded ms | warm | 63.8 / 66 / 68.1 | 62.7 / 64.34 / 64.7 | -1.1 (-1.72%) |
| load ms | cold | 204.5 / 222.18 / 224.7 | 153.3 / 213.04 / 215.8 | -51.2 (-25.04%) |
| load ms | warm | 193.6 / 197.8 / 202.3 | 192.4 / 197.18 / 198.8 | -1.2 (-0.62%) |
| fixture completion ms | cold | 2116 / 2192.6 / 2216 | 2123 / 2134 / 2143 | +7 (+0.33%) |
| fixture completion ms | warm | 2167 / 2171.6 / 2174 | 2156 / 2162.8 / 2167 | -11 (-0.51%) |
| heap after GC MB | cold | 6.79 / 6.8 / 6.8 | 6.88 / 6.88 / 6.89 | +0.09 (+1.33%) |
| heap after GC MB | warm | 6.8 / 6.81 / 6.82 | 6.89 / 6.89 / 6.89 | +0.09 (+1.32%) |
| DOM nodes | cold | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| DOM nodes | warm | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| listeners | cold | 550 / 561.6 / 579 | 552 / 552 / 552 | +2 (+0.36%) |
| listeners | warm | 585 / 586 / 586 | 583 / 587.8 / 589 | -2 (-0.34%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
