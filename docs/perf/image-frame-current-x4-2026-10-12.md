# WardenOne performance profile

- commit `7507f01` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x4, 5 runs per cell, 2026-10-12T02:54:55.707Z
- variants: on:logger-off, on; pages served from 127.0.0.1; nothing left the machine
- Iframe logger settings alternated between runs in one browser profile.
- readiness: on:logger-off = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger off in 8 frames, remote host lists 3636 hosts; on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger on in 8 frames, remote host lists 3636 hosts; the worker's own task time is not exposed by this browser's worker target

## /image-frames.html

| metric | phase | on:logger-off median / p90 / max | on median / p90 / max | on - on:logger-off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 2266.22 / 2319.96 / 2351.7 | 2427.48 / 2526.8 / 2530.21 | +161.26 (+7.12%) |
| main-thread task ms | warm | 2184.38 / 2217.95 / 2233.51 | 2284.77 / 2506.82 / 2569.32 | +100.39 (+4.6%) |
| script ms | cold | 1313.71 / 1353.13 / 1364.33 | 1466.49 / 1504.84 / 1508.13 | +152.78 (+11.63%) |
| script ms | warm | 1313.1 / 1338.06 / 1347.4 | 1389.49 / 1533.9 / 1585.08 | +76.39 (+5.82%) |
| layout ms | cold | 81.96 / 84.63 / 85.5 | 82.06 / 84.2 / 85.32 | +0.1 (+0.12%) |
| layout ms | warm | 34.68 / 37.92 / 39.23 | 34.82 / 37.98 / 39.14 | +0.14 (+0.4%) |
| style ms | cold | 46.17 / 46.52 / 46.61 | 42.69 / 45.85 / 46.54 | -3.48 (-7.54%) |
| style ms | warm | 38.49 / 39.16 / 39.6 | 37.89 / 41.78 / 43.44 | -0.6 (-1.56%) |
| frame mutation batches ms | cold | 2065.5 / 2682.66 / 2770.7 | 3204.7 / 3364.08 / 3402.2 | +1139.2 (+55.15%) |
| frame mutation batches ms | warm | 2764.7 / 2979.26 / 3051.1 | 3365.5 / 3674.4 / 3783.8 | +600.8 (+21.73%) |
| long tasks | cold | 3 / 3 / 3 | 3 / 3 / 3 | +0 (+0%) |
| long tasks | warm | 3 / 3 / 3 | 3 / 4 / 4 | +0 (+0%) |
| long-task ms | cold | 591 / 602.8 / 610 | 592 / 607.6 / 612 | +1 (+0.17%) |
| long-task ms | warm | 485 / 492.2 / 495 | 517 / 543.4 / 557 | +32 (+6.6%) |
| DOMContentLoaded ms | cold | 456.6 / 908.68 / 964.8 | 470 / 885.22 / 919.3 | +13.4 (+2.93%) |
| DOMContentLoaded ms | warm | 742.9 / 753 / 758.8 | 732.4 / 784.58 / 799.1 | -10.5 (-1.41%) |
| load ms | cold | 1256.6 / 1282.74 / 1293.9 | 1291.2 / 1314.82 / 1315.1 | +34.6 (+2.75%) |
| load ms | warm | 1185.5 / 1203.34 / 1204.5 | 1202.3 / 1289.54 / 1305.7 | +16.8 (+1.42%) |
| fixture completion ms | cold | 3626 / 3721.6 / 3734 | 3826 / 3907.8 / 3951 | +200 (+5.52%) |
| fixture completion ms | warm | 3656 / 3702.6 / 3733 | 3842 / 3981.2 / 4012 | +186 (+5.09%) |
| heap after GC MB | cold | 6.81 / 6.87 / 6.87 | 6.98 / 7.03 / 7.04 | +0.17 (+2.5%) |
| heap after GC MB | warm | 6.89 / 6.89 / 6.9 | 7.07 / 7.07 / 7.07 | +0.18 (+2.61%) |
| DOM nodes | cold | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| DOM nodes | warm | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| listeners | cold | 550 / 587 / 589 | 568 / 591.4 / 607 | +18 (+3.27%) |
| listeners | warm | 584 / 587.4 / 589 | 600 / 602 / 602 | +16 (+2.74%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
