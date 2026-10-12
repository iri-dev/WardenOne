# WardenOne performance profile

- commit `7507f01` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x4, 5 runs per cell, 2026-10-12T09:07:22.665Z
- variants: on:logger-off, on; pages served from 127.0.0.1; nothing left the machine
- Iframe logger settings alternated between runs in one browser profile.
- readiness: on:logger-off = worker 1.0.2 (pgigkjmejfhpakjkfkokmlhblcbklhpp), page marker 1.0.2, iframe logger off in 8 frames, remote host lists 3636 hosts; on = worker 1.0.2 (pgigkjmejfhpakjkfkokmlhblcbklhpp), page marker 1.0.2, iframe logger on in 8 frames, remote host lists 3636 hosts; the worker's own task time is not exposed by this browser's worker target

## /image-frames.html

| metric | phase | on:logger-off median / p90 / max | on median / p90 / max | on - on:logger-off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 1770.14 / 1874.5 / 1928.22 | 1890.2 / 1903.17 / 1907.13 | +120.06 (+6.78%) |
| main-thread task ms | warm | 1666.81 / 1727.49 / 1761.51 | 1783.73 / 1807.45 / 1809.93 | +116.92 (+7.01%) |
| script ms | cold | 1031.55 / 1104.9 / 1142.73 | 1107.23 / 1124.74 / 1125.67 | +75.68 (+7.34%) |
| script ms | warm | 1002.13 / 1041.74 / 1064.21 | 1092.12 / 1114.75 / 1115.52 | +89.99 (+8.98%) |
| layout ms | cold | 64.96 / 71.75 / 74.14 | 62.61 / 65.11 / 65.96 | -2.35 (-3.62%) |
| layout ms | warm | 26.4 / 27.47 / 27.76 | 28.19 / 28.68 / 28.81 | +1.79 (+6.78%) |
| style ms | cold | 35.12 / 39 / 40.08 | 35.12 / 36.83 / 36.83 | +0 (+0%) |
| style ms | warm | 28.94 / 31.35 / 31.82 | 29.42 / 30.79 / 31.01 | +0.48 (+1.66%) |
| frame mutation batches ms | cold | 2071.7 / 2159.64 / 2172.4 | 2099.5 / 2393.36 / 2479 | +27.8 (+1.34%) |
| frame mutation batches ms | warm | 2208.6 / 2433.12 / 2535 | 2469.4 / 2686.96 / 2722.2 | +260.8 (+11.81%) |
| long tasks | cold | 3 / 3 / 3 | 3 / 3 / 3 | +0 (+0%) |
| long tasks | warm | 3 / 3 / 3 | 3 / 3 / 3 | +0 (+0%) |
| long-task ms | cold | 472 / 504.6 / 523 | 477 / 489.4 / 497 | +5 (+1.06%) |
| long-task ms | warm | 404 / 416.8 / 420 | 405 / 411.6 / 412 | +1 (+0.25%) |
| DOMContentLoaded ms | cold | 430.8 / 712.52 / 744.8 | 366.2 / 645.32 / 662.4 | -64.6 (-15%) |
| DOMContentLoaded ms | warm | 613.7 / 637.16 / 638.6 | 635.3 / 639.98 / 640.1 | +21.6 (+3.52%) |
| load ms | cold | 1009.3 / 1064.74 / 1095.7 | 1004.9 / 1043.16 / 1051.2 | -4.4 (-0.44%) |
| load ms | warm | 943.3 / 959.64 / 960.2 | 968.5 / 984.18 / 990.3 | +25.2 (+2.67%) |
| fixture completion ms | cold | 3322 / 3473.2 / 3484 | 3323 / 3424 / 3448 | +1 (+0.03%) |
| fixture completion ms | warm | 3263 / 3339.8 / 3381 | 3312 / 3357.2 / 3360 | +49 (+1.5%) |
| heap after GC MB | cold | 6.82 / 6.86 / 6.86 | 6.92 / 6.97 / 6.97 | +0.1 (+1.47%) |
| heap after GC MB | warm | 6.89 / 6.9 / 6.9 | 6.97 / 6.99 / 7 | +0.08 (+1.16%) |
| DOM nodes | cold | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| DOM nodes | warm | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| listeners | cold | 574 / 585.8 / 587 | 552 / 586 / 586 | -22 (-3.83%) |
| listeners | warm | 586 / 586 / 586 | 589 / 595 / 595 | +3 (+0.51%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
