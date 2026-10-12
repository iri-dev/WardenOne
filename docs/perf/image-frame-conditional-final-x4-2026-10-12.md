# WardenOne performance profile

- commit `7507f01` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x4, 5 runs per cell, 2026-10-12T06:56:13.427Z
- variants: on:logger-off, on; pages served from 127.0.0.1; nothing left the machine
- Iframe logger settings alternated between runs in one browser profile.
- readiness: on:logger-off = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger off in 8 frames, remote host lists 3636 hosts; on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger on in 8 frames, remote host lists 3636 hosts; the worker's own task time is not exposed by this browser's worker target

## /image-frames.html

| metric | phase | on:logger-off median / p90 / max | on median / p90 / max | on - on:logger-off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 1957.62 / 1998.71 / 1999.21 | 1961.15 / 2185.75 / 2210.53 | +3.53 (+0.18%) |
| main-thread task ms | warm | 1911.11 / 1990 / 2002.44 | 2100.59 / 2117.04 / 2122.31 | +189.48 (+9.91%) |
| script ms | cold | 1188.09 / 1234.63 / 1261.15 | 1223.64 / 1392.92 / 1425.47 | +35.55 (+2.99%) |
| script ms | warm | 1190.88 / 1239.77 / 1257.71 | 1313.15 / 1354.39 / 1370.52 | +122.27 (+10.27%) |
| layout ms | cold | 67.03 / 69.7 / 69.91 | 68.21 / 71.71 / 72.38 | +1.18 (+1.76%) |
| layout ms | warm | 31.4 / 31.61 / 31.62 | 26.15 / 28.77 / 29.58 | -5.25 (-16.72%) |
| style ms | cold | 35.74 / 36.66 / 36.66 | 34.26 / 36.8 / 36.84 | -1.48 (-4.14%) |
| style ms | warm | 31.87 / 34.97 / 36.62 | 27.58 / 29.12 / 29.35 | -4.29 (-13.46%) |
| frame mutation batches ms | cold | 2407.7 / 56839.32 / 72084.6 | 52777.5 / 66843.54 / 72278.7 | +50369.8 (+2092.03%) |
| frame mutation batches ms | warm | 2479.3 / 71855.82 / 72097.9 | 71714.9 / 72168.44 / 72222.6 | +69235.6 (+2792.55%) |
| long tasks | cold | 3 / 3 / 3 | 3 / 3 / 3 | +0 (+0%) |
| long tasks | warm | 3 / 3 / 3 | 3 / 3 / 3 | +0 (+0%) |
| long-task ms | cold | 571 / 664.4 / 698 | 550 / 656.4 / 660 | -21 (-3.68%) |
| long-task ms | warm | 482 / 537.4 / 543 | 547 / 594 / 622 | +65 (+13.49%) |
| DOMContentLoaded ms | cold | 358.4 / 716.22 / 755.1 | 378.2 / 560.42 / 642.3 | +19.8 (+5.52%) |
| DOMContentLoaded ms | warm | 719.4 / 747.76 / 751.6 | 733 / 818.84 / 869 | +13.6 (+1.89%) |
| load ms | cold | 1024.1 / 1220.2 / 1260.2 | 1145.2 / 1266.6 / 1303.4 | +121.1 (+11.83%) |
| load ms | warm | 1156.7 / 1171.16 / 1171.2 | 1196.3 / 1303.42 / 1366.1 | +39.6 (+3.42%) |
| fixture completion ms | cold | 3372 / 20787 / 25261 | 20344 / 25100.8 / 25230 | +16972 (+503.32%) |
| fixture completion ms | warm | 3472 / 24960.2 / 25025 | 24209 / 25633.2 / 25828 | +20737 (+597.26%) |
| heap after GC MB | cold | 6.83 / 6.87 / 6.89 | 6.91 / 6.94 / 6.95 | +0.08 (+1.17%) |
| heap after GC MB | warm | 6.89 / 6.91 / 6.91 | 6.98 / 7 / 7 | +0.09 (+1.31%) |
| DOM nodes | cold | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| DOM nodes | warm | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| listeners | cold | 550 / 570.4 / 584 | 552 / 572.4 / 586 | +2 (+0.36%) |
| listeners | warm | 584 / 587.8 / 589 | 552 / 585.2 / 586 | -32 (-5.48%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
