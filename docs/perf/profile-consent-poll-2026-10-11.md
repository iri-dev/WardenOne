# WardenOne performance profile

- commit `fd160f9` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x1, 5 runs per cell, 2026-10-11T21:51:44.021Z
- variants: off, on; pages served from 127.0.0.1; nothing left the machine
- readiness: off = no extension, page marker absent; on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2; the worker's own task time is not exposed by this browser's worker target

## /article.html

| metric | phase | off median / p90 / max | on median / p90 / max | on - off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 36.92 / 37.87 / 38.44 | 170.9 / 180.36 / 180.85 | +133.98 (+362.89%) |
| main-thread task ms | warm | 19.84 / 22.27 / 23.43 | 131.46 / 138.96 / 140.96 | +111.62 (+562.6%) |
| script ms | cold | 0.01 / 0.01 / 0.01 | 96.94 / 102.47 / 105.82 | +96.93 (+969300%) |
| script ms | warm | 0.01 / 0.01 / 0.01 | 87.72 / 91.61 / 93.24 | +87.71 (+877100%) |
| layout ms | cold | 11.35 / 11.87 / 11.87 | 22.4 / 23.92 / 24.71 | +11.05 (+97.36%) |
| layout ms | warm | 3.25 / 3.9 / 4.13 | 2.75 / 3.84 / 4.4 | -0.5 (-15.38%) |
| style ms | cold | 3.11 / 3.98 / 4.4 | 5.15 / 6.4 / 6.45 | +2.04 (+65.59%) |
| style ms | warm | 1.27 / 1.76 / 1.92 | 2.57 / 3.22 / 3.54 | +1.3 (+102.36%) |
| long tasks | cold | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long tasks | warm | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long-task ms | cold | 0 / 0 / 0 | 73 / 82.2 / 87 | +73 |
| long-task ms | warm | 0 / 0 / 0 | 56 / 59.2 / 60 | +56 |
| DOMContentLoaded ms | cold | 31.6 / 32.08 / 32.4 | 55 / 58.36 / 59.4 | +23.4 (+74.05%) |
| DOMContentLoaded ms | warm | 16.3 / 18.58 / 19.7 | 46 / 50.88 / 54 | +29.7 (+182.21%) |
| load ms | cold | 32.2 / 32.82 / 33.1 | 91.7 / 160.82 / 162.7 | +59.5 (+184.78%) |
| load ms | warm | 16.9 / 18.94 / 20.1 | 57.2 / 67.34 / 70.1 | +40.3 (+238.46%) |
| fixture completion ms | cold | 635 / 637 / 637 | 774 / 785 / 789 | +139 (+21.89%) |
| fixture completion ms | warm | 622 / 633.2 / 634 | 711 / 793.4 / 837 | +89 (+14.31%) |
| heap after GC MB | cold | 0.53 / 0.53 / 0.53 | 2.62 / 2.63 / 2.63 | +2.09 (+394.34%) |
| heap after GC MB | warm | 0.53 / 0.53 / 0.53 | 2.6 / 2.62 / 2.63 | +2.07 (+390.57%) |
| DOM nodes | cold | 686 / 686 / 686 | 697 / 697 / 697 | +11 (+1.6%) |
| DOM nodes | warm | 686 / 686 / 686 | 697 / 697 / 697 | +11 (+1.6%) |
| listeners | cold | 0 / 0 / 0 | 140 / 140 / 140 | +140 |
| listeners | warm | 0 / 0 / 0 | 272 / 272 / 272 | +272 |

## /churn.html

| metric | phase | off median / p90 / max | on median / p90 / max | on - off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 190.84 / 193.63 / 194.25 | 508.12 / 539.85 / 551.42 | +317.28 (+166.25%) |
| main-thread task ms | warm | 182.23 / 185.24 / 185.87 | 489.25 / 502.18 / 504.92 | +307.02 (+168.48%) |
| script ms | cold | 22.41 / 23.22 / 23.36 | 293.43 / 307.74 / 316 | +271.02 (+1209.37%) |
| script ms | warm | 21.34 / 21.64 / 21.65 | 285.41 / 294.46 / 296.7 | +264.07 (+1237.44%) |
| layout ms | cold | 49.86 / 50.81 / 51.17 | 49.81 / 51.99 / 52.38 | -0.05 (-0.1%) |
| layout ms | warm | 37.79 / 39.27 / 39.51 | 37.24 / 39.8 / 40.22 | -0.55 (-1.46%) |
| style ms | cold | 25.2 / 26.49 / 27.16 | 28.89 / 30.14 / 30.15 | +3.69 (+14.64%) |
| style ms | warm | 24.41 / 24.67 / 24.84 | 28.3 / 29.23 / 29.24 | +3.89 (+15.94%) |
| long tasks | cold | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long tasks | warm | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long-task ms | cold | 0 / 0 / 0 | 64 / 70 / 74 | +64 |
| long-task ms | warm | 0 / 0 / 0 | 59 / 60.2 / 61 | +59 |
| DOMContentLoaded ms | cold | 14.8 / 16.96 / 18 | 65 / 67.16 / 68.4 | +50.2 (+339.19%) |
| DOMContentLoaded ms | warm | 9 / 9.4 / 9.6 | 59.3 / 60.58 / 60.7 | +50.3 (+558.89%) |
| load ms | cold | 15 / 17.06 / 18.1 | 65.6 / 67.52 / 68.8 | +50.6 (+337.33%) |
| load ms | warm | 9.1 / 9.44 / 9.6 | 59.6 / 60.88 / 61 | +50.5 (+554.95%) |
| fixture completion ms | cold | 1939 / 1942 / 1942 | 2015 / 2022.2 / 2023 | +76 (+3.92%) |
| fixture completion ms | warm | 1926 / 1935.8 / 1941 | 2002 / 2008.4 / 2010 | +76 (+3.95%) |
| heap after GC MB | cold | 0.53 / 0.53 / 0.53 | 3.16 / 3.2 / 3.2 | +2.63 (+496.23%) |
| heap after GC MB | warm | 0.62 / 0.62 / 0.62 | 3.15 / 3.19 / 3.19 | +2.53 (+408.06%) |
| DOM nodes | cold | 6567 / 6567 / 6567 | 6570 / 6570 / 6570 | +3 (+0.05%) |
| DOM nodes | warm | 6567 / 6567 / 6567 | 6570 / 6570 / 6570 | +3 (+0.05%) |
| listeners | cold | 1 / 1 / 1 | 129 / 129 / 129 | +128 (+12800%) |
| listeners | warm | 1 / 1 / 1 | 129 / 129 / 129 | +128 (+12800%) |

## /frames.html

| metric | phase | off median / p90 / max | on median / p90 / max | on - off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 56.74 / 57.84 / 58.09 | 431.16 / 434.14 / 435.01 | +374.42 (+659.89%) |
| main-thread task ms | warm | 40.82 / 41.11 / 41.13 | 406.47 / 419.36 / 423.79 | +365.65 (+895.76%) |
| script ms | cold | 0.51 / 0.56 / 0.58 | 332.71 / 333.14 / 333.37 | +332.2 (+65137.25%) |
| script ms | warm | 0.26 / 0.27 / 0.27 | 324.78 / 330.12 / 332.18 | +324.52 (+124815.38%) |
| layout ms | cold | 12.77 / 13.58 / 13.74 | 13.52 / 14.14 / 14.27 | +0.75 (+5.87%) |
| layout ms | warm | 1.93 / 2.09 / 2.13 | 2.05 / 2.42 / 2.58 | +0.12 (+6.22%) |
| style ms | cold | 3.91 / 4.06 / 4.09 | 4.12 / 4.28 / 4.38 | +0.21 (+5.37%) |
| style ms | warm | 1.85 / 1.98 / 2.03 | 2.68 / 3.02 / 3.17 | +0.83 (+44.86%) |
| long tasks | cold | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long tasks | warm | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long-task ms | cold | 0 / 0 / 0 | 67 / 68.2 / 69 | +67 |
| long-task ms | warm | 0 / 0 / 0 | 61 / 62.6 / 63 | +61 |
| DOMContentLoaded ms | cold | 21.8 / 22.6 / 23 | 68.9 / 69.24 / 69.4 | +47.1 (+216.06%) |
| DOMContentLoaded ms | warm | 15.2 / 15.48 / 15.6 | 64 / 66.32 / 67.2 | +48.8 (+321.05%) |
| load ms | cold | 58.6 / 59.82 / 59.9 | 223.6 / 231.48 / 236.2 | +165 (+281.57%) |
| load ms | warm | 41.8 / 42.74 / 42.9 | 198.3 / 211.46 / 216.7 | +156.5 (+374.4%) |
| fixture completion ms | cold | 888 / 888.6 / 889 | 1070 / 1091 / 1103 | +182 (+20.5%) |
| fixture completion ms | warm | 884 / 886.8 / 888 | 1039 / 1043.2 / 1044 | +155 (+17.53%) |
| heap after GC MB | cold | 2.01 / 2.01 / 2.01 | 8.79 / 8.79 / 8.79 | +6.78 (+337.31%) |
| heap after GC MB | warm | 2.01 / 2.01 / 2.01 | 8.8 / 8.8 / 8.8 | +6.79 (+337.81%) |
| DOM nodes | cold | 15 / 15 / 15 | 18 / 18 / 18 | +3 (+20%) |
| DOM nodes | warm | 15 / 15 / 15 | 18 / 18 / 18 | +3 (+20%) |
| listeners | cold | 9 / 9 / 9 | 577 / 577 / 577 | +568 (+6311.11%) |
| listeners | warm | 18 / 18 / 18 | 577 / 577 / 577 | +559 (+3105.56%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
