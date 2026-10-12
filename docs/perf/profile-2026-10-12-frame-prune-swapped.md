# WardenOne performance profile

- commit `7507f01` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x1, 5 runs per cell, 2026-10-12T02:08:12.841Z
- variants: on, base; pages served from 127.0.0.1; nothing left the machine
- readiness: on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, remote host lists 3636 hosts; base = worker 1.0.2 (hldgboaaaikcdbaafdlgdkbddbicadag), page marker 1.0.2, remote host lists 3636 hosts; the worker's own task time is not exposed by this browser's worker target

## /article.html

| metric | phase | on median / p90 / max | base median / p90 / max | on - base (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 225.65 / 229.81 / 230.2 | 238.39 / 248.74 / 254.34 | -12.74 (-5.34%) |
| main-thread task ms | warm | 169.6 / 173.48 / 174.01 | 192.89 / 198.91 / 200.31 | -23.29 (-12.07%) |
| script ms | cold | 131.35 / 137.24 / 137.43 | 140.28 / 170.1 / 172.14 | -8.93 (-6.37%) |
| script ms | warm | 117.37 / 122.91 / 124.53 | 139.36 / 152.13 / 153.76 | -21.99 (-15.78%) |
| layout ms | cold | 25.52 / 27.62 / 28.29 | 25.61 / 28.06 / 28.56 | -0.09 (-0.35%) |
| layout ms | warm | 3.26 / 3.45 / 3.54 | 3.89 / 4.16 / 4.18 | -0.63 (-16.2%) |
| style ms | cold | 5.92 / 6.16 / 6.16 | 5.98 / 6.05 / 6.08 | -0.06 (-1%) |
| style ms | warm | 3.25 / 3.59 / 3.63 | 3.56 / 4.96 / 5.06 | -0.31 (-8.71%) |
| long tasks | cold | 1 / 1 / 1 | 1 / 1 / 1 | +0 (+0%) |
| long tasks | warm | 1 / 1 / 1 | 1 / 1 / 1 | +0 (+0%) |
| long-task ms | cold | 93 / 95.8 / 97 | 95 / 130.2 / 131 | -2 (-2.11%) |
| long-task ms | warm | 71 / 76.2 / 79 | 87 / 106.6 / 111 | -16 (-18.39%) |
| DOMContentLoaded ms | cold | 87.1 / 89.1 / 89.5 | 88.2 / 92.8 / 95 | -1.1 (-1.25%) |
| DOMContentLoaded ms | warm | 71.4 / 75.96 / 76.8 | 73.1 / 80.9 / 84.9 | -1.7 (-2.33%) |
| load ms | cold | 220.2 / 224 / 224.2 | 232.1 / 240.2 / 240.6 | -11.9 (-5.13%) |
| load ms | warm | 165.4 / 169.44 / 171.4 | 163.6 / 194.32 / 195 | +1.8 (+1.1%) |
| fixture completion ms | cold | 821 / 836.6 / 837 | 836 / 851.6 / 852 | -15 (-1.79%) |
| fixture completion ms | warm | 774 / 783.4 / 789 | 804 / 804.6 / 805 | -30 (-3.73%) |
| heap after GC MB | cold | 2.85 / 2.86 / 2.86 | 2.82 / 2.84 / 2.85 | +0.03 (+1.06%) |
| heap after GC MB | warm | 2.88 / 2.88 / 2.88 | 2.83 / 2.86 / 2.86 | +0.05 (+1.77%) |
| DOM nodes | cold | 697 / 697 / 697 | 697 / 697 / 697 | +0 (+0%) |
| DOM nodes | warm | 697 / 697 / 697 | 697 / 697 / 697 | +0 (+0%) |
| listeners | cold | 140 / 140 / 140 | 132 / 140 / 140 | +8 (+6.06%) |
| listeners | warm | 272 / 272 / 272 | 272 / 272 / 272 | +0 (+0%) |

## /churn.html

| metric | phase | on median / p90 / max | base median / p90 / max | on - base (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 571.16 / 580.94 / 581.7 | 740.89 / 840.4 / 906.25 | -169.73 (-22.91%) |
| main-thread task ms | warm | 503.61 / 515.93 / 516.72 | 744.45 / 889.1 / 979.43 | -240.84 (-32.35%) |
| script ms | cold | 283.53 / 300.26 / 303.57 | 442 / 464.53 / 467.12 | -158.47 (-35.85%) |
| script ms | warm | 254.62 / 262.92 / 263.92 | 403.55 / 469.04 / 493.69 | -148.93 (-36.9%) |
| layout ms | cold | 62.24 / 65.7 / 67.89 | 65.76 / 77.07 / 81.53 | -3.52 (-5.35%) |
| layout ms | warm | 41.79 / 43.46 / 44.21 | 57.97 / 66.2 / 69.07 | -16.18 (-27.91%) |
| style ms | cold | 34.93 / 36.54 / 36.73 | 34.63 / 39.08 / 40.78 | +0.3 (+0.87%) |
| style ms | warm | 32.2 / 33.51 / 33.97 | 37.02 / 54.4 / 61.92 | -4.82 (-13.02%) |
| long tasks | cold | 1 / 1.6 / 2 | 1 / 2.2 / 3 | +0 (+0%) |
| long tasks | warm | 1 / 1 / 1 | 2 / 2.6 / 3 | -1 (-50%) |
| long-task ms | cold | 69 / 102.4 / 122 | 91 / 195.8 / 263 | -22 (-24.18%) |
| long-task ms | warm | 55 / 59.2 / 60 | 155 / 208 / 228 | -100 (-64.52%) |
| DOMContentLoaded ms | cold | 82.4 / 87.32 / 90.4 | 80.9 / 121.82 / 147.5 | +1.5 (+1.85%) |
| DOMContentLoaded ms | warm | 67.2 / 71.52 / 73.6 | 74.2 / 83.44 / 84.2 | -7 (-9.43%) |
| load ms | cold | 83 / 87.84 / 91 | 81.9 / 122.84 / 148.8 | +1.1 (+1.34%) |
| load ms | warm | 67.6 / 71.98 / 74.1 | 74.6 / 83.9 / 84.7 | -7 (-9.38%) |
| fixture completion ms | cold | 2061 / 2076.6 / 2077 | 17638 / 17669 / 17669 | -15577 (-88.32%) |
| fixture completion ms | warm | 1998 / 1998.6 / 1999 | 6881 / 16835.2 / 16848 | -4883 (-70.96%) |
| heap after GC MB | cold | 2.99 / 3.01 / 3.01 | 3.05 / 3.07 / 3.08 | -0.06 (-1.97%) |
| heap after GC MB | warm | 3.02 / 3.07 / 3.1 | 3.05 / 3.3 / 3.45 | -0.03 (-0.98%) |
| DOM nodes | cold | 6570 / 6570 / 6570 | 6570 / 6570 / 6570 | +0 (+0%) |
| DOM nodes | warm | 6570 / 6570 / 6570 | 6570 / 6570 / 6570 | +0 (+0%) |
| listeners | cold | 129 / 129 / 129 | 129 / 129 / 129 | +0 (+0%) |
| listeners | warm | 129 / 129 / 129 | 129 / 129 / 129 | +0 (+0%) |

## /frames.html

| metric | phase | on median / p90 / max | base median / p90 / max | on - base (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 300.08 / 316.25 / 321.13 | 374.58 / 415.9 / 426.07 | -74.5 (-19.89%) |
| main-thread task ms | warm | 256.03 / 262.31 / 263.37 | 369.54 / 479.7 / 541.01 | -113.51 (-30.72%) |
| script ms | cold | 166.32 / 178.92 / 182.02 | 237.77 / 281.54 / 284.11 | -71.45 (-30.05%) |
| script ms | warm | 149.56 / 154.8 / 156.92 | 235.48 / 309.39 / 321.38 | -85.92 (-36.49%) |
| layout ms | cold | 17.95 / 19.27 / 19.77 | 16.95 / 17.89 / 18.04 | +1 (+5.9%) |
| layout ms | warm | 2.77 / 2.96 / 3.01 | 4.01 / 4.74 / 4.84 | -1.24 (-30.92%) |
| style ms | cold | 5.17 / 5.6 / 5.73 | 5.96 / 6.27 / 6.28 | -0.79 (-13.26%) |
| style ms | warm | 3.66 / 3.88 / 3.94 | 4.08 / 6.11 / 7.18 | -0.42 (-10.29%) |
| long tasks | cold | 1 / 1 / 1 | 1 / 1 / 1 | +0 (+0%) |
| long tasks | warm | 1 / 1 / 1 | 1 / 1 / 1 | +0 (+0%) |
| long-task ms | cold | 69 / 77.8 / 79 | 76 / 99.2 / 100 | -7 (-9.21%) |
| long-task ms | warm | 62 / 63 / 63 | 67 / 85.6 / 94 | -5 (-7.46%) |
| DOMContentLoaded ms | cold | 90.4 / 139.12 / 170.8 | 88.2 / 89.52 / 90.4 | +2.2 (+2.49%) |
| DOMContentLoaded ms | warm | 77.3 / 79.14 / 79.5 | 86.3 / 91.5 / 94.9 | -9 (-10.43%) |
| load ms | cold | 275 / 288.84 / 292.8 | 280.1 / 313.9 / 320.5 | -5.1 (-1.82%) |
| load ms | warm | 231.8 / 234.58 / 235.5 | 271.9 / 356.24 / 406.8 | -40.1 (-14.75%) |
| fixture completion ms | cold | 1116 / 1140 / 1146 | 1145 / 1576.6 / 1719 | -29 (-2.53%) |
| fixture completion ms | warm | 1084 / 1084 / 1084 | 1100 / 1644.8 / 1844 | -16 (-1.45%) |
| heap after GC MB | cold | 6.73 / 6.75 / 6.77 | 7.03 / 7.04 / 7.04 | -0.3 (-4.27%) |
| heap after GC MB | warm | 6.75 / 6.75 / 6.76 | 7.04 / 7.05 / 7.05 | -0.29 (-4.12%) |
| DOM nodes | cold | 18 / 18 / 18 | 18 / 18 / 18 | +0 (+0%) |
| DOM nodes | warm | 18 / 18 / 18 | 18 / 18 / 18 | +0 (+0%) |
| listeners | cold | 577 / 577 / 577 | 577 / 611 / 611 | +0 (+0%) |
| listeners | warm | 577 / 577 / 577 | 577 / 1113 / 1443 | +0 (+0%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
