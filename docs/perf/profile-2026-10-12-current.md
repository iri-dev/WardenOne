# WardenOne performance profile

- commit `7507f01` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x1, 5 runs per cell, 2026-10-12T08:21:27.859Z
- variants: off, on; pages served from 127.0.0.1; nothing left the machine
- readiness: off = no extension, page marker absent; on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, remote host lists 3636 hosts; the worker's own task time is not exposed by this browser's worker target

## /article.html

| metric | phase | off median / p90 / max | on median / p90 / max | on - off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 35.9 / 53.81 / 65.3 | 170.32 / 173.58 / 174.85 | +134.42 (+374.43%) |
| main-thread task ms | warm | 20.47 / 21.99 / 22.45 | 137.3 / 139.43 / 140.72 | +116.83 (+570.74%) |
| script ms | cold | 0.01 / 0.02 / 0.02 | 100.14 / 101.43 / 102.19 | +100.13 (+1001300%) |
| script ms | warm | 0.01 / 0.01 / 0.01 | 95.24 / 99.28 / 100.45 | +95.23 (+952300%) |
| layout ms | cold | 10.98 / 17.7 / 21.95 | 21.17 / 22.09 / 22.63 | +10.19 (+92.81%) |
| layout ms | warm | 3.24 / 3.76 / 3.86 | 2.81 / 3.02 / 3.1 | -0.43 (-13.27%) |
| style ms | cold | 3.16 / 4.45 / 5.09 | 4.64 / 5.07 / 5.21 | +1.48 (+46.84%) |
| style ms | warm | 1.38 / 1.95 / 2.03 | 2.58 / 3.25 / 3.59 | +1.2 (+86.96%) |
| long tasks | cold | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long tasks | warm | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long-task ms | cold | 0 / 0 / 0 | 70 / 71.2 / 72 | +70 |
| long-task ms | warm | 0 / 0 / 0 | 59 / 61.8 / 63 | +59 |
| DOMContentLoaded ms | cold | 30.7 / 44.2 / 52.6 | 64.7 / 65.6 / 65.6 | +34 (+110.75%) |
| DOMContentLoaded ms | warm | 16.4 / 18.16 / 18.6 | 57.1 / 59.26 / 59.9 | +40.7 (+248.17%) |
| load ms | cold | 31.3 / 45.12 / 53.8 | 165.9 / 169.74 / 171.1 | +134.6 (+430.03%) |
| load ms | warm | 16.8 / 18.52 / 19 | 133.2 / 136.46 / 138.3 | +116.4 (+692.86%) |
| fixture completion ms | cold | 636 / 653.4 / 663 | 775 / 777.6 / 778 | +139 (+21.86%) |
| fixture completion ms | warm | 622 / 629 / 633 | 745 / 747.2 / 748 | +123 (+19.77%) |
| heap after GC MB | cold | 0.53 / 0.53 / 0.53 | 2.86 / 2.86 / 2.86 | +2.33 (+439.62%) |
| heap after GC MB | warm | 0.53 / 0.53 / 0.53 | 2.88 / 2.88 / 2.88 | +2.35 (+443.4%) |
| DOM nodes | cold | 686 / 686 / 686 | 697 / 697 / 697 | +11 (+1.6%) |
| DOM nodes | warm | 686 / 686 / 686 | 697 / 697 / 697 | +11 (+1.6%) |
| listeners | cold | 0 / 0 / 0 | 140 / 140 / 140 | +140 |
| listeners | warm | 0 / 0 / 0 | 272 / 272 / 272 | +272 |

## /churn.html

| metric | phase | off median / p90 / max | on median / p90 / max | on - off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 184.03 / 185.27 / 185.59 | 426.28 / 451.39 / 465.42 | +242.25 (+131.64%) |
| main-thread task ms | warm | 181.05 / 188.39 / 188.82 | 415.14 / 436.04 / 445.18 | +234.09 (+129.3%) |
| script ms | cold | 21.76 / 22.36 / 22.42 | 214.49 / 232.62 / 243.14 | +192.73 (+885.71%) |
| script ms | warm | 20.75 / 21.79 / 22.25 | 208.45 / 222.68 / 230.2 | +187.7 (+904.58%) |
| layout ms | cold | 48.25 / 48.48 / 48.51 | 50.69 / 50.98 / 50.98 | +2.44 (+5.06%) |
| layout ms | warm | 37.37 / 40.05 / 40.78 | 38.04 / 38.94 / 39.01 | +0.67 (+1.79%) |
| style ms | cold | 24.6 / 24.67 / 24.7 | 28.59 / 28.88 / 28.9 | +3.99 (+16.22%) |
| style ms | warm | 24.35 / 25.73 / 26.25 | 27.57 / 29.02 / 29.93 | +3.22 (+13.22%) |
| long tasks | cold | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long tasks | warm | 0 / 0 / 0 | 0 / 0.6 / 1 | +0 |
| long-task ms | cold | 0 / 0 / 0 | 51 / 52.8 / 54 | +51 |
| long-task ms | warm | 0 / 0 / 0 | 0 / 30 / 50 | +0 |
| DOMContentLoaded ms | cold | 14 / 14.16 / 14.2 | 60.5 / 69.56 / 74.8 | +46.5 (+332.14%) |
| DOMContentLoaded ms | warm | 8.8 / 9.28 / 9.6 | 56.7 / 61.4 / 64.4 | +47.9 (+544.32%) |
| load ms | cold | 14.2 / 14.3 / 14.3 | 60.9 / 69.92 / 75.2 | +46.7 (+328.87%) |
| load ms | warm | 8.8 / 9.38 / 9.7 | 57 / 61.76 / 64.8 | +48.2 (+547.73%) |
| fixture completion ms | cold | 1938 / 1942.6 / 1943 | 1984 / 1999 / 2007 | +46 (+2.37%) |
| fixture completion ms | warm | 1927 / 1941.6 / 1944 | 1972 / 1980 / 1984 | +45 (+2.34%) |
| heap after GC MB | cold | 0.53 / 0.53 / 0.53 | 3 / 3.01 / 3.02 | +2.47 (+466.04%) |
| heap after GC MB | warm | 0.62 / 0.62 / 0.62 | 3 / 3.04 / 3.05 | +2.38 (+383.87%) |
| DOM nodes | cold | 6567 / 6567 / 6567 | 6570 / 6570 / 6570 | +3 (+0.05%) |
| DOM nodes | warm | 6567 / 6567 / 6567 | 6570 / 6570 / 6570 | +3 (+0.05%) |
| listeners | cold | 1 / 1 / 1 | 129 / 129 / 129 | +128 (+12800%) |
| listeners | warm | 1 / 1 / 1 | 129 / 129 / 129 | +128 (+12800%) |

## /frames.html

| metric | phase | off median / p90 / max | on median / p90 / max | on - off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 53.36 / 54.41 / 54.74 | 220.15 / 221.75 / 222.11 | +166.79 (+312.57%) |
| main-thread task ms | warm | 40.89 / 41.47 / 41.63 | 197.06 / 198.54 / 199.44 | +156.17 (+381.93%) |
| script ms | cold | 0.45 / 0.51 / 0.54 | 125.2 / 125.56 / 125.73 | +124.75 (+27722.22%) |
| script ms | warm | 0.29 / 0.31 / 0.32 | 118.23 / 119.41 / 119.77 | +117.94 (+40668.97%) |
| layout ms | cold | 12.23 / 12.48 / 12.48 | 13.54 / 13.65 / 13.71 | +1.31 (+10.71%) |
| layout ms | warm | 1.91 / 1.99 / 2.01 | 2.13 / 2.23 / 2.28 | +0.22 (+11.52%) |
| style ms | cold | 3.61 / 3.78 / 3.86 | 4.09 / 4.2 / 4.23 | +0.48 (+13.3%) |
| style ms | warm | 1.92 / 2.02 / 2.02 | 2.6 / 2.64 / 2.65 | +0.68 (+35.42%) |
| long tasks | cold | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long tasks | warm | 0 / 0 / 0 | 0 / 0 / 0 | +0 |
| long-task ms | cold | 0 / 0 / 0 | 54 / 55.6 / 56 | +54 |
| long-task ms | warm | 0 / 0 / 0 | 0 / 0 / 0 | +0 |
| DOMContentLoaded ms | cold | 20.9 / 21 / 21 | 64.8 / 65.96 / 66 | +43.9 (+210.05%) |
| DOMContentLoaded ms | warm | 16.1 / 16.42 / 16.5 | 60.1 / 63.1 / 64.5 | +44 (+273.29%) |
| load ms | cold | 54.5 / 56.36 / 56.6 | 199.7 / 203.22 / 203.7 | +145.2 (+266.42%) |
| load ms | warm | 42.3 / 42.78 / 42.9 | 175.2 / 177.72 / 179.2 | +132.9 (+314.18%) |
| fixture completion ms | cold | 886 / 886.6 / 887 | 1057 / 1064.2 / 1069 | +171 (+19.3%) |
| fixture completion ms | warm | 885 / 885.6 / 886 | 1036 / 1041.2 / 1042 | +151 (+17.06%) |
| heap after GC MB | cold | 2.01 / 2.01 / 2.01 | 6.73 / 6.73 / 6.73 | +4.72 (+234.83%) |
| heap after GC MB | warm | 2.01 / 2.01 / 2.01 | 6.74 / 6.74 / 6.74 | +4.73 (+235.32%) |
| DOM nodes | cold | 15 / 15 / 15 | 18 / 18 / 18 | +3 (+20%) |
| DOM nodes | warm | 15 / 15 / 15 | 18 / 18 / 18 | +3 (+20%) |
| listeners | cold | 9 / 9 / 9 | 561 / 561 / 561 | +552 (+6133.33%) |
| listeners | warm | 18 / 18 / 18 | 561 / 561 / 561 | +543 (+3016.67%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
