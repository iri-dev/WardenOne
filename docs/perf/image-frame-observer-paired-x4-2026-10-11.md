# WardenOne performance profile

- commit `fd160f9` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x4, 5 runs per cell, 2026-10-11T21:22:48.704Z
- variants: on:logger-off, on; pages served from 127.0.0.1; nothing left the machine
- Iframe logger settings alternated between runs in one browser profile.
- readiness: on:logger-off = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger off in 8 frames; on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger on in 8 frames; the worker's own task time is not exposed by this browser's worker target

## /image-frames.html

| metric | phase | on:logger-off median / p90 / max | on median / p90 / max | on - on:logger-off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 3165.59 / 3250.91 / 3264.6 | 3638.06 / 3725.69 / 3748.49 | +472.47 (+14.93%) |
| main-thread task ms | warm | 3026.69 / 3095.38 / 3125.22 | 3495.7 / 3591.36 / 3614.24 | +469.01 (+15.5%) |
| script ms | cold | 2166.51 / 2228.4 / 2236.06 | 2524.45 / 2624.54 / 2641.91 | +357.94 (+16.52%) |
| script ms | warm | 2062 / 2150.1 / 2174.02 | 2452.96 / 2533.31 / 2553.99 | +390.96 (+18.96%) |
| layout ms | cold | 80.69 / 84.37 / 84.39 | 81.7 / 88.91 / 91.3 | +1.01 (+1.25%) |
| layout ms | warm | 38.5 / 39.82 / 40.6 | 41.75 / 42.13 / 42.31 | +3.25 (+8.44%) |
| style ms | cold | 46 / 47.98 / 48.52 | 45.56 / 50.46 / 52.46 | -0.44 (-0.96%) |
| style ms | warm | 40.75 / 41.25 / 41.38 | 39.45 / 41.69 / 41.87 | -1.3 (-3.19%) |
| frame mutation batches ms | cold | 2031.9 / 2484.1 / 2544.5 | 3334 / 3938.54 / 4100.9 | +1302.1 (+64.08%) |
| frame mutation batches ms | warm | 1771.8 / 2655.8 / 2913.4 | 3077.5 / 3326.72 / 3357.8 | +1305.7 (+73.69%) |
| long tasks | cold | 11 / 11 / 11 | 11 / 11.6 / 12 | +0 (+0%) |
| long tasks | warm | 11 / 11.6 / 12 | 11 / 11.6 / 12 | +0 (+0%) |
| long-task ms | cold | 1172 / 1234.4 / 1240 | 1210 / 1323.6 / 1342 | +38 (+3.24%) |
| long-task ms | warm | 1080 / 1121 / 1129 | 1093 / 1171.8 / 1177 | +13 (+1.2%) |
| DOMContentLoaded ms | cold | 820.9 / 998.52 / 1084.4 | 1060.7 / 1132.04 / 1171 | +239.8 (+29.21%) |
| DOMContentLoaded ms | warm | 764.8 / 785.42 / 786.9 | 788.3 / 811.36 / 824.2 | +23.5 (+3.07%) |
| load ms | cold | 2047.2 / 2174.38 / 2181.5 | 2137.2 / 2231.72 / 2244.4 | +90 (+4.4%) |
| load ms | warm | 1939.7 / 2004.24 / 2026.4 | 2034 / 2120.24 / 2152 | +94.3 (+4.86%) |
| fixture completion ms | cold | 4181 / 4407.4 / 4491 | 4600 / 4674.8 / 4680 | +419 (+10.02%) |
| fixture completion ms | warm | 4084 / 4246.8 / 4288 | 4397 / 4531 / 4535 | +313 (+7.66%) |
| heap after GC MB | cold | 8.78 / 8.8 / 8.8 | 9 / 9.02 / 9.03 | +0.22 (+2.51%) |
| heap after GC MB | warm | 8.83 / 8.84 / 8.84 | 9.03 / 9.04 / 9.05 | +0.2 (+2.27%) |
| DOM nodes | cold | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| DOM nodes | warm | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| listeners | cold | 564 / 577.2 / 582 | 568 / 574 / 578 | +4 (+0.71%) |
| listeners | warm | 550 / 574.2 / 589 | 568 / 593.8 / 611 | +18 (+3.27%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
