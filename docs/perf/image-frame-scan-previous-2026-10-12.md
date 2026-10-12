# WardenOne performance profile

- commit `7507f01` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x1, 7 runs per cell, 2026-10-12T09:02:38.374Z
- variants: on:logger-off, on; pages served from 127.0.0.1; nothing left the machine
- Iframe logger settings alternated between runs in one browser profile.
- readiness: on:logger-off = worker 1.0.2 (pgigkjmejfhpakjkfkokmlhblcbklhpp), page marker 1.0.2, iframe logger off in 8 frames, remote host lists 3636 hosts; on = worker 1.0.2 (pgigkjmejfhpakjkfkokmlhblcbklhpp), page marker 1.0.2, iframe logger on in 8 frames, remote host lists 3636 hosts; the worker's own task time is not exposed by this browser's worker target

## /image-frames.html

| metric | phase | on:logger-off median / p90 / max | on median / p90 / max | on - on:logger-off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 378.43 / 390.35 / 394.26 | 387.86 / 397.97 / 398.64 | +9.43 (+2.49%) |
| main-thread task ms | warm | 346.76 / 368.4 / 378.34 | 366.86 / 374.64 / 375.99 | +20.1 (+5.8%) |
| script ms | cold | 209.02 / 214.21 / 214.28 | 219.76 / 221.72 / 223.69 | +10.74 (+5.14%) |
| script ms | warm | 205.42 / 214.08 / 218.55 | 218.86 / 222.76 / 223.47 | +13.44 (+6.54%) |
| layout ms | cold | 14.16 / 14.59 / 14.67 | 13.72 / 13.93 / 13.94 | -0.44 (-3.11%) |
| layout ms | warm | 6 / 6.43 / 6.94 | 6.01 / 6.22 / 6.42 | +0.01 (+0.17%) |
| style ms | cold | 6.52 / 7.24 / 7.31 | 6.49 / 6.86 / 6.91 | -0.03 (-0.46%) |
| style ms | warm | 6.55 / 7.07 / 7.51 | 6.62 / 7.09 / 7.16 | +0.07 (+1.07%) |
| frame mutation batches ms | cold | 500.6 / 554.7 / 555.9 | 530.4 / 567.04 / 593.8 | +29.8 (+5.95%) |
| frame mutation batches ms | warm | 519.7 / 578.48 / 584.6 | 491.1 / 528.54 / 532.2 | -28.6 (-5.5%) |
| long tasks | cold | 1 / 1 / 1 | 1 / 1 / 1 | +0 (+0%) |
| long tasks | warm | 0 / 0.4 / 1 | 0 / 0.4 / 1 | +0 |
| long-task ms | cold | 56 / 57 / 57 | 53 / 55.8 / 57 | -3 (-5.36%) |
| long-task ms | warm | 0 / 20.4 / 51 | 0 / 20 / 50 | +0 |
| DOMContentLoaded ms | cold | 55.8 / 57.2 / 57.2 | 54.6 / 57.88 / 59.5 | -1.2 (-2.15%) |
| DOMContentLoaded ms | warm | 63.2 / 64.52 / 65.6 | 64.1 / 64.84 / 65.2 | +0.9 (+1.42%) |
| load ms | cold | 204.3 / 223.62 / 224.4 | 148.3 / 219.64 / 225.1 | -56 (-27.41%) |
| load ms | warm | 192 / 199.84 / 203.2 | 197.3 / 198.86 / 199.1 | +5.3 (+2.76%) |
| fixture completion ms | cold | 2132 / 2175.2 / 2201 | 2124 / 2130.2 / 2132 | -8 (-0.38%) |
| fixture completion ms | warm | 2157 / 2165.6 / 2168 | 2160 / 2171.4 / 2172 | +3 (+0.14%) |
| heap after GC MB | cold | 6.79 / 6.79 / 6.8 | 6.87 / 6.88 / 6.89 | +0.08 (+1.18%) |
| heap after GC MB | warm | 6.8 / 6.81 / 6.81 | 6.89 / 6.9 / 6.9 | +0.09 (+1.32%) |
| DOM nodes | cold | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| DOM nodes | warm | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| listeners | cold | 550 / 556.4 / 566 | 552 / 552 / 552 | +2 (+0.36%) |
| listeners | warm | 586 / 589.4 / 590 | 583 / 589 / 589 | -3 (-0.51%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
