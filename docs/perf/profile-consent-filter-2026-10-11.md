# WardenOne performance profile

- commit `fd160f9` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x1, 5 runs per cell, 2026-10-11T21:48:03.355Z
- variants: off, on; pages served from 127.0.0.1; nothing left the machine
- readiness: off = no extension, page marker absent; on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2; the worker's own task time is not exposed by this browser's worker target

## /article.html

| metric | phase | off median / p90 / max | on median / p90 / max | on - off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 35.97 / 39.8 / 41.03 | 185.69 / 192.28 / 193.33 | +149.72 (+416.24%) |
| main-thread task ms | warm | 19.11 / 19.58 / 19.82 | 125.72 / 142.16 / 145.83 | +106.61 (+557.88%) |
| script ms | cold | 0.01 / 0.01 / 0.02 | 107.05 / 112.46 / 114.8 | +107.04 (+1070400%) |
| script ms | warm | 0.01 / 0.01 / 0.01 | 84.48 / 97.72 / 100.81 | +84.47 (+844700%) |
| layout ms | cold | 11.3 / 11.86 / 11.97 | 22.07 / 25.9 / 27.59 | +10.77 (+95.31%) |
| layout ms | warm | 2.57 / 3.21 / 3.45 | 2.7 / 2.8 / 2.82 | +0.13 (+5.06%) |
| style ms | cold | 3.41 / 3.85 / 4.02 | 5.12 / 6.15 / 6.65 | +1.71 (+50.15%) |
| style ms | warm | 1.19 / 1.31 / 1.36 | 2.37 / 2.48 / 2.49 | +1.18 (+99.16%) |
| long tasks | cold | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long tasks | warm | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long-task ms | cold | 0 / 0 / 0 | 71 / 76 / 78 | +71 |
| long-task ms | warm | 0 / 0 / 0 | 57 / 58.6 / 59 | +57 |
| DOMContentLoaded ms | cold | 31.5 / 33.7 / 34.3 | 55.6 / 58.3 / 58.7 | +24.1 (+76.51%) |
| DOMContentLoaded ms | warm | 15.9 / 16.32 / 16.4 | 47.2 / 51.72 / 53.8 | +31.3 (+196.86%) |
| load ms | cold | 32 / 34.4 / 35 | 89.3 / 141.28 / 175.4 | +57.3 (+179.06%) |
| load ms | warm | 16.3 / 16.62 / 16.7 | 61.7 / 64.82 / 65.3 | +45.4 (+278.53%) |
| fixture completion ms | cold | 637 / 639.6 / 640 | 776 / 784.4 / 790 | +139 (+21.82%) |
| fixture completion ms | warm | 631 / 635 / 635 | 713 / 732.4 / 744 | +82 (+13%) |
| heap after GC MB | cold | 0.53 / 0.53 / 0.53 | 2.76 / 2.85 / 2.91 | +2.23 (+420.75%) |
| heap after GC MB | warm | 0.53 / 0.53 / 0.53 | 2.97 / 3.4 / 3.65 | +2.44 (+460.38%) |
| DOM nodes | cold | 686 / 686 / 686 | 697 / 697 / 697 | +11 (+1.6%) |
| DOM nodes | warm | 686 / 686 / 686 | 697 / 697 / 697 | +11 (+1.6%) |
| listeners | cold | 0 / 0 / 0 | 140 / 140 / 140 | +140 |
| listeners | warm | 0 / 0 / 0 | 272 / 272 / 272 | +272 |

## /churn.html

| metric | phase | off median / p90 / max | on median / p90 / max | on - off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 193.28 / 204.22 / 206.97 | 678.32 / 729.1 / 742.29 | +485.04 (+250.95%) |
| main-thread task ms | warm | 182.28 / 187.68 / 188.44 | 676.66 / 740.27 / 782.23 | +494.38 (+271.22%) |
| script ms | cold | 23.27 / 24.28 / 24.4 | 457.99 / 493.69 / 501.66 | +434.72 (+1868.16%) |
| script ms | warm | 22.08 / 28.24 / 32.1 | 465.4 / 515.39 / 544.84 | +443.32 (+2007.79%) |
| layout ms | cold | 49.09 / 52.44 / 52.61 | 54.21 / 56.65 / 57.68 | +5.12 (+10.43%) |
| layout ms | warm | 36.94 / 38.93 / 39.78 | 38.23 / 39.76 / 40.5 | +1.29 (+3.49%) |
| style ms | cold | 25.31 / 27.59 / 27.76 | 31.08 / 33.26 / 34.54 | +5.77 (+22.8%) |
| style ms | warm | 24.25 / 25.6 / 26.05 | 28.41 / 29.13 / 29.22 | +4.16 (+17.15%) |
| long tasks | cold | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long tasks | warm | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long-task ms | cold | 0 / 0 / 0 | 69 / 76.4 / 78 | +69 |
| long-task ms | warm | 0 / 0 / 0 | 60 / 95 / 117 | +60 |
| DOMContentLoaded ms | cold | 14.4 / 14.84 / 15 | 64.5 / 72.32 / 75.2 | +50.1 (+347.92%) |
| DOMContentLoaded ms | warm | 8.9 / 9.14 / 9.3 | 59.3 / 78.66 / 90.3 | +50.4 (+566.29%) |
| load ms | cold | 14.6 / 15.1 / 15.3 | 64.8 / 72.82 / 75.7 | +50.2 (+343.84%) |
| load ms | warm | 9.1 / 9.28 / 9.4 | 59.7 / 79.06 / 90.7 | +50.6 (+556.04%) |
| fixture completion ms | cold | 1939 / 11385.6 / 17682 | 1989 / 2040.6 / 2049 | +50 (+2.58%) |
| fixture completion ms | warm | 1931 / 13966.4 / 16878 | 1984 / 2989.4 / 3659 | +53 (+2.74%) |
| heap after GC MB | cold | 0.53 / 0.53 / 0.53 | 3.95 / 3.97 / 3.98 | +3.42 (+645.28%) |
| heap after GC MB | warm | 0.62 / 0.62 / 0.62 | 3.98 / 4.01 / 4.02 | +3.36 (+541.94%) |
| DOM nodes | cold | 6567 / 6567 / 6567 | 6570 / 6570 / 6570 | +3 (+0.05%) |
| DOM nodes | warm | 6567 / 6567 / 6567 | 6570 / 6570 / 6570 | +3 (+0.05%) |
| listeners | cold | 1 / 1 / 1 | 129 / 129 / 129 | +128 (+12800%) |
| listeners | warm | 1 / 1.6 / 2 | 129 / 129 / 129 | +128 (+12800%) |

## /frames.html

| metric | phase | off median / p90 / max | on median / p90 / max | on - off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 46.2 / 49.8 / 51.74 | 442.45 / 451.38 / 453 | +396.25 (+857.68%) |
| main-thread task ms | warm | 33.3 / 37.51 / 38.55 | 409.21 / 424.79 / 429.1 | +375.91 (+1128.86%) |
| script ms | cold | 0.52 / 0.54 / 0.55 | 334.74 / 350.14 / 350.94 | +334.22 (+64273.08%) |
| script ms | warm | 0.26 / 0.29 / 0.3 | 325.24 / 339.45 / 344.41 | +324.98 (+124992.31%) |
| layout ms | cold | 12.98 / 13.96 / 14.11 | 13.49 / 14.24 / 14.45 | +0.51 (+3.93%) |
| layout ms | warm | 1.85 / 2.02 / 2.1 | 2.01 / 2.08 / 2.09 | +0.16 (+8.65%) |
| style ms | cold | 3.43 / 3.82 / 3.89 | 4.14 / 4.36 / 4.49 | +0.71 (+20.7%) |
| style ms | warm | 1.86 / 1.94 / 1.97 | 2.65 / 2.73 / 2.75 | +0.79 (+42.47%) |
| long tasks | cold | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long tasks | warm | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long-task ms | cold | 0 / 0 / 0 | 66 / 66.6 / 67 | +66 |
| long-task ms | warm | 0 / 0 / 0 | 62 / 64.4 / 66 | +62 |
| DOMContentLoaded ms | cold | 11.8 / 12.38 / 12.5 | 69.7 / 71.44 / 72 | +57.9 (+490.68%) |
| DOMContentLoaded ms | warm | 13.3 / 14.9 / 15.5 | 64.7 / 65.04 / 65.2 | +51.4 (+386.47%) |
| load ms | cold | 49.7 / 53.28 / 55.2 | 224.7 / 234.78 / 236.3 | +175 (+352.11%) |
| load ms | warm | 41 / 43 / 44 | 200.4 / 204.52 / 206.6 | +159.4 (+388.78%) |
| fixture completion ms | cold | 1697 / 1734.4 / 1758 | 1075 / 1094 / 1104 | -622 (-36.65%) |
| fixture completion ms | warm | 887 / 1881.6 / 1882 | 1038 / 1048.8 / 1054 | +151 (+17.02%) |
| heap after GC MB | cold | 2.01 / 2.01 / 2.01 | 8.81 / 8.81 / 8.81 | +6.8 (+338.31%) |
| heap after GC MB | warm | 2.01 / 2.01 / 2.01 | 8.82 / 8.82 / 8.82 | +6.81 (+338.81%) |
| DOM nodes | cold | 15 / 15 / 15 | 18 / 18 / 18 | +3 (+20%) |
| DOM nodes | warm | 15 / 15 / 15 | 18 / 18 / 18 | +3 (+20%) |
| listeners | cold | 9 / 9 / 9 | 577 / 577 / 577 | +568 (+6311.11%) |
| listeners | warm | 18 / 18 / 18 | 577 / 577 / 577 | +559 (+3105.56%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
