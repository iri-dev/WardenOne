# WardenOne performance profile

- commit `7507f01` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x4, 5 runs per cell, 2026-10-12T09:05:46.154Z
- variants: on:logger-off, on; pages served from 127.0.0.1; nothing left the machine
- Iframe logger settings alternated between runs in one browser profile.
- readiness: on:logger-off = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger off in 8 frames, remote host lists 3636 hosts; on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger on in 8 frames, remote host lists 3636 hosts; the worker's own task time is not exposed by this browser's worker target

## /image-frames.html

| metric | phase | on:logger-off median / p90 / max | on median / p90 / max | on - on:logger-off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 1777.29 / 1879.71 / 1925.28 | 1876.33 / 1920.09 / 1938.54 | +99.04 (+5.57%) |
| main-thread task ms | warm | 1710.18 / 1765.65 / 1782.22 | 1776.01 / 1807.44 / 1818.32 | +65.83 (+3.85%) |
| script ms | cold | 1032.57 / 1095.57 / 1130.73 | 1103.75 / 1122.45 / 1127.65 | +71.18 (+6.89%) |
| script ms | warm | 1043.29 / 1059.85 / 1069.28 | 1080.39 / 1102.75 / 1111.99 | +37.1 (+3.56%) |
| layout ms | cold | 66.35 / 69.91 / 70.41 | 65.71 / 67 / 67.03 | -0.64 (-0.96%) |
| layout ms | warm | 27.55 / 30.05 / 30.15 | 27.91 / 28.45 / 28.51 | +0.36 (+1.31%) |
| style ms | cold | 35.99 / 37.97 / 38.1 | 36.2 / 37.29 / 37.96 | +0.21 (+0.58%) |
| style ms | warm | 30 / 31.95 / 32.82 | 29.63 / 30.47 / 30.73 | -0.37 (-1.23%) |
| frame mutation batches ms | cold | 2121.5 / 2207.24 / 2252.2 | 2232.1 / 2493.56 / 2517 | +110.6 (+5.21%) |
| frame mutation batches ms | warm | 2246.3 / 2448.4 / 2523.4 | 2354.6 / 2549.3 / 2593.7 | +108.3 (+4.82%) |
| long tasks | cold | 3 / 3 / 3 | 3 / 3 / 3 | +0 (+0%) |
| long tasks | warm | 3 / 3 / 3 | 3 / 3 / 3 | +0 (+0%) |
| long-task ms | cold | 464 / 513 / 527 | 492 / 498 / 500 | +28 (+6.03%) |
| long-task ms | warm | 405 / 416.8 / 422 | 409 / 411.2 / 412 | +4 (+0.99%) |
| DOMContentLoaded ms | cold | 370.1 / 553.84 / 615.8 | 377.7 / 613.68 / 616 | +7.6 (+2.05%) |
| DOMContentLoaded ms | warm | 613 / 651.74 / 660.7 | 635.2 / 638.64 / 640.4 | +22.2 (+3.62%) |
| load ms | cold | 981.7 / 1074.48 / 1103.8 | 1034.4 / 1046.34 / 1049.9 | +52.7 (+5.37%) |
| load ms | warm | 954.4 / 962.04 / 965.4 | 964.9 / 978.82 / 982.9 | +10.5 (+1.1%) |
| fixture completion ms | cold | 3265 / 3389.2 / 3428 | 3358 / 3382 / 3398 | +93 (+2.85%) |
| fixture completion ms | warm | 3242 / 3370 / 3376 | 3314 / 3392.8 / 3408 | +72 (+2.22%) |
| heap after GC MB | cold | 6.82 / 6.84 / 6.85 | 6.94 / 6.96 / 6.96 | +0.12 (+1.76%) |
| heap after GC MB | warm | 6.89 / 6.9 / 6.9 | 7.01 / 7.01 / 7.02 | +0.12 (+1.74%) |
| DOM nodes | cold | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| DOM nodes | warm | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| listeners | cold | 571 / 580 / 584 | 552 / 586 / 586 | -19 (-3.33%) |
| listeners | warm | 585 / 590.2 / 593 | 586 / 587 / 587 | +1 (+0.17%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
