# WardenOne performance profile

- commit `7507f01`, extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x1, 5 runs per cell, 2026-10-12T01:53:25.781Z
- variants: off, on; pages served from 127.0.0.1; nothing left the machine
- readiness: off = no extension, page marker absent; on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, remote host lists 3636 hosts; the worker's own task time is not exposed by this browser's worker target

## /article.html

| metric | phase | off median / p90 / max | on median / p90 / max | on - off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 52.99 / 56.14 / 56.26 | 228.49 / 286.68 / 324.26 | +175.5 (+331.19%) |
| main-thread task ms | warm | 23.02 / 23.87 / 24.44 | 193.51 / 197.8 / 198.42 | +170.49 (+740.62%) |
| script ms | cold | 0.01 / 0.02 / 0.02 | 136.78 / 172.76 / 183.74 | +136.77 (+1367700%) |
| script ms | warm | 0.01 / 0.01 / 0.01 | 140.36 / 155.64 / 156.43 | +140.35 (+1403500%) |
| layout ms | cold | 16.83 / 19.07 / 19.65 | 27.04 / 60.45 / 81.98 | +10.21 (+60.67%) |
| layout ms | warm | 3.12 / 3.45 / 3.58 | 3.54 / 4.37 / 4.73 | +0.42 (+13.46%) |
| style ms | cold | 4.49 / 4.76 / 4.79 | 6.28 / 7.42 / 7.81 | +1.79 (+39.87%) |
| style ms | warm | 1.36 / 1.44 / 1.46 | 3.62 / 4.6 / 4.64 | +2.26 (+166.18%) |
| long tasks | cold | 0 / 0 / 0 | 1 / 1.6 / 2 | +1 |
| long tasks | warm | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long-task ms | cold | 0 / 0 / 0 | 107 / 191.6 / 238 | +107 |
| long-task ms | warm | 0 / 0 / 0 | 94 / 105.4 / 109 | +94 |
| DOMContentLoaded ms | cold | 45.6 / 48.5 / 49.1 | 89.1 / 90.78 / 91.5 | +43.5 (+95.39%) |
| DOMContentLoaded ms | warm | 18.2 / 19.36 / 19.8 | 77.9 / 79.82 / 81.1 | +59.7 (+328.02%) |
| load ms | cold | 46.2 / 49.36 / 49.8 | 227.7 / 289.76 / 328.2 | +181.5 (+392.86%) |
| load ms | warm | 18.7 / 19.76 / 20.2 | 186.8 / 195.98 / 201.3 | +168.1 (+898.93%) |
| fixture completion ms | cold | 651 / 665.6 / 666 | 836 / 892.8 / 930 | +185 (+28.42%) |
| fixture completion ms | warm | 634 / 634.6 / 635 | 789 / 798.6 / 805 | +155 (+24.45%) |
| heap after GC MB | cold | 0.53 / 0.53 / 0.53 | 2.84 / 2.9 / 2.93 | +2.31 (+435.85%) |
| heap after GC MB | warm | 0.53 / 0.53 / 0.53 | 2.88 / 2.91 / 2.93 | +2.35 (+443.4%) |
| DOM nodes | cold | 686 / 686 / 686 | 697 / 697 / 697 | +11 (+1.6%) |
| DOM nodes | warm | 686 / 686 / 686 | 697 / 697 / 697 | +11 (+1.6%) |
| listeners | cold | 0 / 0 / 0 | 140 / 140 / 140 | +140 |
| listeners | warm | 0 / 0 / 0 | 272 / 272 / 272 | +272 |

## /churn.html

| metric | phase | off median / p90 / max | on median / p90 / max | on - off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 229.02 / 248.91 / 261.8 | 561.3 / 668.2 / 736.15 | +332.28 (+145.09%) |
| main-thread task ms | warm | 216.81 / 281.69 / 322.65 | 546.38 / 577.74 / 589.69 | +329.57 (+152.01%) |
| script ms | cold | 26.72 / 30.05 / 31.28 | 272.89 / 376.54 / 438.42 | +246.17 (+921.29%) |
| script ms | warm | 24.87 / 35.63 / 40.07 | 273.26 / 285.98 / 286.52 | +248.39 (+998.75%) |
| layout ms | cold | 60.23 / 64.53 / 64.95 | 60.8 / 64.11 / 64.63 | +0.57 (+0.95%) |
| layout ms | warm | 55.32 / 70.06 / 70.32 | 45.23 / 48.43 / 50.27 | -10.09 (-18.24%) |
| style ms | cold | 28.15 / 31.74 / 32.54 | 34.64 / 35.1 / 35.13 | +6.49 (+23.06%) |
| style ms | warm | 28.51 / 41.83 / 43.59 | 34.77 / 39.8 / 41.17 | +6.26 (+21.96%) |
| long tasks | cold | 0 / 0 / 0 | 1 / 1.6 / 2 | +1 |
| long tasks | warm | 0 / 1 / 1 | 1 / 1.6 / 2 | +1 |
| long-task ms | cold | 0 / 0 / 0 | 63 / 124 / 162 | +63 |
| long-task ms | warm | 0 / 121.2 / 134 | 59 / 98.2 / 119 | +59 |
| DOMContentLoaded ms | cold | 19.4 / 22.36 / 23.6 | 76.5 / 77.48 / 77.6 | +57.1 (+294.33%) |
| DOMContentLoaded ms | warm | 11.8 / 14.96 / 17 | 69.8 / 72.68 / 73.4 | +58 (+491.53%) |
| load ms | cold | 19.6 / 22.58 / 23.9 | 77 / 77.94 / 78.1 | +57.4 (+292.86%) |
| load ms | warm | 11.8 / 15.06 / 17.1 | 70.2 / 73.34 / 74.1 | +58.4 (+494.92%) |
| fixture completion ms | cold | 1937 / 1937 / 1937 | 2030 / 10473.8 / 16103 | +93 (+4.8%) |
| fixture completion ms | warm | 2415 / 14327.2 / 16026 | 2013 / 2057.6 / 2076 | -402 (-16.65%) |
| heap after GC MB | cold | 0.53 / 0.53 / 0.53 | 3 / 3.07 / 3.11 | +2.47 (+466.04%) |
| heap after GC MB | warm | 0.62 / 0.63 / 0.63 | 3.02 / 3.07 / 3.1 | +2.4 (+387.1%) |
| DOM nodes | cold | 6567 / 6567 / 6567 | 6570 / 6570 / 6570 | +3 (+0.05%) |
| DOM nodes | warm | 6567 / 6567 / 6567 | 6570 / 6570 / 6570 | +3 (+0.05%) |
| listeners | cold | 1 / 1 / 1 | 129 / 129 / 129 | +128 (+12800%) |
| listeners | warm | 1 / 2 / 2 | 129 / 129 / 129 | +128 (+12800%) |

## /frames.html

| metric | phase | off median / p90 / max | on median / p90 / max | on - off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 67.5 / 79.3 / 80.32 | 332.48 / 352.16 / 357.13 | +264.98 (+392.56%) |
| main-thread task ms | warm | 45.07 / 55.74 / 57.33 | 309.19 / 321.22 / 326.08 | +264.12 (+586.02%) |
| script ms | cold | 0.68 / 0.85 / 0.9 | 207.14 / 221.52 / 224.48 | +206.46 (+30361.76%) |
| script ms | warm | 0.28 / 0.38 / 0.39 | 205.32 / 213.08 / 214.09 | +205.04 (+73228.57%) |
| layout ms | cold | 15.16 / 17.35 / 17.47 | 15.39 / 16.31 / 16.37 | +0.23 (+1.52%) |
| layout ms | warm | 2.42 / 2.73 / 2.76 | 2.65 / 2.83 / 2.94 | +0.23 (+9.5%) |
| style ms | cold | 4.76 / 5.16 / 5.34 | 4.97 / 5.32 / 5.38 | +0.21 (+4.41%) |
| style ms | warm | 2.33 / 2.44 / 2.46 | 3.29 / 3.71 / 3.72 | +0.96 (+41.2%) |
| long tasks | cold | 0 / 0 / 0 | 1 / 1.6 / 2 | +1 |
| long tasks | warm | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long-task ms | cold | 0 / 0 / 0 | 68 / 96 / 112 | +68 |
| long-task ms | warm | 0 / 0 / 0 | 62 / 70.2 / 71 | +62 |
| DOMContentLoaded ms | cold | 15.5 / 24.42 / 29.1 | 89.4 / 90.28 / 90.8 | +73.9 (+476.77%) |
| DOMContentLoaded ms | warm | 17.7 / 20.3 / 21.9 | 72.4 / 84.8 / 85.4 | +54.7 (+309.04%) |
| load ms | cold | 64 / 73.9 / 75.9 | 260.1 / 270.46 / 275.9 | +196.1 (+306.41%) |
| load ms | warm | 52.3 / 62.06 / 65.3 | 231.2 / 244.24 / 248 | +178.9 (+342.07%) |
| fixture completion ms | cold | 1689 / 1689 / 1689 | 1100 / 1109 / 1115 | -589 (-34.87%) |
| fixture completion ms | warm | 1208 / 1675.8 / 1905 | 1084 / 1109 / 1115 | -124 (-10.26%) |
| heap after GC MB | cold | 2.01 / 2.01 / 2.01 | 7.03 / 7.03 / 7.03 | +5.02 (+249.75%) |
| heap after GC MB | warm | 2.01 / 2.22 / 2.22 | 7.03 / 7.04 / 7.04 | +5.02 (+249.75%) |
| DOM nodes | cold | 15 / 15 / 15 | 18 / 18 / 18 | +3 (+20%) |
| DOM nodes | warm | 15 / 15 / 15 | 18 / 18 / 18 | +3 (+20%) |
| listeners | cold | 9 / 9 / 9 | 577 / 577 / 577 | +568 (+6311.11%) |
| listeners | warm | 18 / 18 / 18 | 577 / 577 / 577 | +559 (+3105.56%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
