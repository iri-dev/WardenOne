# WardenOne performance profile

- commit `7507f01`, extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x4, 5 runs per cell, 2026-10-12T08:39:20.972Z
- variants: on:logger-off, on; pages served from 127.0.0.1; nothing left the machine
- Iframe logger settings alternated between runs in one browser profile.
- readiness: on:logger-off = worker 1.0.2 (ijjeoloinofdglhdabnmihickekcmnno), page marker 1.0.2, iframe logger off in 8 frames, remote host lists 3636 hosts; on = worker 1.0.2 (ijjeoloinofdglhdabnmihickekcmnno), page marker 1.0.2, iframe logger on in 8 frames, remote host lists 3636 hosts; the worker's own task time is not exposed by this browser's worker target

## /image-frames.html

| metric | phase | on:logger-off median / p90 / max | on median / p90 / max | on - on:logger-off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 1888.61 / 1963.24 / 1982.81 | 2073.06 / 2149.91 / 2174.34 | +184.45 (+9.77%) |
| main-thread task ms | warm | 1815.42 / 1835.25 / 1843.62 | 1938.02 / 2026.47 / 2078.11 | +122.6 (+6.75%) |
| script ms | cold | 1162.29 / 1182.96 / 1184.25 | 1265.33 / 1318.23 / 1336.84 | +103.04 (+8.87%) |
| script ms | warm | 1132.67 / 1140.11 / 1142.98 | 1221.65 / 1270.29 / 1301.97 | +88.98 (+7.86%) |
| layout ms | cold | 64.76 / 68.64 / 69.32 | 67.6 / 68.32 / 68.35 | +2.84 (+4.39%) |
| layout ms | warm | 28.28 / 28.91 / 28.99 | 28.03 / 28.43 / 28.5 | -0.25 (-0.88%) |
| style ms | cold | 35.96 / 39.05 / 40.26 | 36.17 / 37.8 / 37.97 | +0.21 (+0.58%) |
| style ms | warm | 30.57 / 31.66 / 32.19 | 29.38 / 30.88 / 31.76 | -1.19 (-3.89%) |
| frame mutation batches ms | cold | 2051.6 / 2165.82 / 2167.5 | 2407.2 / 2555.68 / 2606.6 | +355.6 (+17.33%) |
| frame mutation batches ms | warm | 2076.2 / 2172.68 / 2196.2 | 2569.5 / 2584.54 / 2592.5 | +493.3 (+23.76%) |
| long tasks | cold | 3 / 3 / 3 | 3 / 3 / 3 | +0 (+0%) |
| long tasks | warm | 3 / 3 / 3 | 3 / 3 / 3 | +0 (+0%) |
| long-task ms | cold | 477 / 491 / 495 | 483 / 510.8 / 522 | +6 (+1.26%) |
| long-task ms | warm | 405 / 409.6 / 412 | 397 / 419 / 429 | -8 (-1.98%) |
| DOMContentLoaded ms | cold | 356 / 632.62 / 652.3 | 374.5 / 656.1 / 682.5 | +18.5 (+5.2%) |
| DOMContentLoaded ms | warm | 621.5 / 636.62 / 640.5 | 613.2 / 634.94 / 646.5 | -8.3 (-1.34%) |
| load ms | cold | 1138 / 1168.02 / 1170.9 | 1149.3 / 1215.46 / 1240.5 | +11.3 (+0.99%) |
| load ms | warm | 1068.1 / 1076.3 / 1077.9 | 1072.9 / 1142.74 / 1174.9 | +4.8 (+0.45%) |
| fixture completion ms | cold | 3372 / 3399 / 3401 | 3447 / 3481 / 3503 | +75 (+2.22%) |
| fixture completion ms | warm | 3276 / 3304 / 3320 | 3437 / 3482.4 / 3486 | +161 (+4.91%) |
| heap after GC MB | cold | 7.11 / 7.16 / 7.16 | 7.29 / 7.3 / 7.31 | +0.18 (+2.53%) |
| heap after GC MB | warm | 7.17 / 7.17 / 7.17 | 7.34 / 7.34 / 7.35 | +0.17 (+2.37%) |
| DOM nodes | cold | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| DOM nodes | warm | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| listeners | cold | 562 / 584 / 584 | 580 / 602 / 602 | +18 (+3.2%) |
| listeners | warm | 585 / 586 / 586 | 604 / 604.6 / 605 | +19 (+3.25%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
