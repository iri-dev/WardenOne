# WardenOne performance profile

- commit `fd160f9` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x4, 5 runs per cell, 2026-10-11T21:26:11.942Z
- variants: on:logger-off, on; pages served from 127.0.0.1; nothing left the machine
- Iframe logger settings alternated between runs in one browser profile.
- readiness: on:logger-off = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger off in 8 frames; on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger on in 8 frames; the worker's own task time is not exposed by this browser's worker target

## /image-frames.html

| metric | phase | on:logger-off median / p90 / max | on median / p90 / max | on - on:logger-off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 2689.64 / 2723.23 / 2725.92 | 2880.51 / 2978.89 / 3034.77 | +190.87 (+7.1%) |
| main-thread task ms | warm | 2621.53 / 2750.23 / 2811.67 | 2830.69 / 2880.72 / 2900.86 | +209.16 (+7.98%) |
| script ms | cold | 1813.95 / 1845.94 / 1848.1 | 1957.91 / 2011.61 / 2046.34 | +143.96 (+7.94%) |
| script ms | warm | 1819.11 / 1929.68 / 1992.73 | 1959.55 / 1992.29 / 1996.86 | +140.44 (+7.72%) |
| layout ms | cold | 71.7 / 74.65 / 76.14 | 69.58 / 74.33 / 75.24 | -2.12 (-2.96%) |
| layout ms | warm | 32.08 / 35.7 / 36.05 | 35.06 / 37.57 / 38.99 | +2.98 (+9.29%) |
| style ms | cold | 39.08 / 40.35 / 40.82 | 40.13 / 43.19 / 44.09 | +1.05 (+2.69%) |
| style ms | warm | 34.66 / 35.81 / 36.4 | 35.06 / 36.96 / 37.37 | +0.4 (+1.15%) |
| frame mutation batches ms | cold | 1495.6 / 2003.08 / 2241.8 | 1756.4 / 1841.42 / 1867.1 | +260.8 (+17.44%) |
| frame mutation batches ms | warm | 1692.1 / 3378.1 / 4456.3 | 1961 / 2035.84 / 2075.8 | +268.9 (+15.89%) |
| long tasks | cold | 11 / 11 / 11 | 11 / 11 / 11 | +0 (+0%) |
| long tasks | warm | 11 / 11.6 / 12 | 11 / 11 / 11 | +0 (+0%) |
| long-task ms | cold | 1013 / 1042 / 1050 | 1036 / 1078 / 1096 | +23 (+2.27%) |
| long-task ms | warm | 939 / 948 / 952 | 947 / 971.2 / 978 | +8 (+0.85%) |
| DOMContentLoaded ms | cold | 682.4 / 730.98 / 741.3 | 422 / 752.96 / 771.6 | -260.4 (-38.16%) |
| DOMContentLoaded ms | warm | 686.9 / 701.58 / 704.1 | 690.4 / 693.74 / 695.3 | +3.5 (+0.51%) |
| load ms | cold | 1789.5 / 1810.24 / 1821.8 | 1824.5 / 1887.2 / 1915.8 | +35 (+1.96%) |
| load ms | warm | 1711.8 / 1730.76 / 1743 | 1743.9 / 1783.2 / 1799 | +32.1 (+1.88%) |
| fixture completion ms | cold | 3899 / 3960.6 / 3977 | 3956 / 4020.2 / 4059 | +57 (+1.46%) |
| fixture completion ms | warm | 3830 / 4101 / 4207 | 3885 / 3994.2 / 4009 | +55 (+1.44%) |
| heap after GC MB | cold | 8.78 / 8.79 / 8.79 | 8.95 / 8.98 / 8.98 | +0.17 (+1.94%) |
| heap after GC MB | warm | 8.82 / 8.93 / 9 | 8.98 / 9.01 / 9.01 | +0.16 (+1.81%) |
| DOM nodes | cold | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| DOM nodes | warm | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| listeners | cold | 564 / 575.6 / 580 | 584 / 587.2 / 588 | +20 (+3.55%) |
| listeners | warm | 550 / 550 / 550 | 570 / 571 / 571 | +20 (+3.64%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
