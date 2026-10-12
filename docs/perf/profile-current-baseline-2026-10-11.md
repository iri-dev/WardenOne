# WardenOne performance profile

- commit `fd160f9` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x1, 5 runs per cell, 2026-10-11T21:43:43.040Z
- variants: off, on; pages served from 127.0.0.1; nothing left the machine
- readiness: off = no extension, page marker absent; on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2; the worker's own task time is not exposed by this browser's worker target

## /article.html

| metric | phase | off median / p90 / max | on median / p90 / max | on - off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 36.33 / 37.96 / 38.99 | 189.33 / 197.64 / 200.61 | +153 (+421.14%) |
| main-thread task ms | warm | 20.11 / 24.11 / 25.86 | 150.53 / 169.16 / 179.86 | +130.42 (+648.53%) |
| script ms | cold | 0.01 / 0.01 / 0.01 | 113.86 / 121.95 / 123.14 | +113.85 (+1138500%) |
| script ms | warm | 0.01 / 0.01 / 0.01 | 106.85 / 121.78 / 128.94 | +106.84 (+1068400%) |
| layout ms | cold | 10.92 / 12.02 / 12.52 | 22.3 / 22.98 / 23.28 | +11.38 (+104.21%) |
| layout ms | warm | 2.85 / 3.59 / 3.97 | 2.76 / 3.65 / 3.89 | -0.09 (-3.16%) |
| style ms | cold | 3.08 / 3.51 / 3.62 | 4.76 / 5.18 / 5.37 | +1.68 (+54.55%) |
| style ms | warm | 1.16 / 1.38 / 1.4 | 2.73 / 3.43 / 3.81 | +1.57 (+135.34%) |
| long tasks | cold | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long tasks | warm | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long-task ms | cold | 0 / 0 / 0 | 72 / 75.2 / 76 | +72 |
| long-task ms | warm | 0 / 0 / 0 | 63 / 68.8 / 72 | +63 |
| DOMContentLoaded ms | cold | 31.1 / 32.84 / 33.8 | 55.3 / 56.06 / 56.5 | +24.2 (+77.81%) |
| DOMContentLoaded ms | warm | 16.3 / 18.6 / 19.4 | 45 / 48.28 / 49.6 | +28.7 (+176.07%) |
| load ms | cold | 31.7 / 33.58 / 34.5 | 86.2 / 90.56 / 92.4 | +54.5 (+171.92%) |
| load ms | warm | 16.6 / 19 / 19.8 | 56.1 / 64.06 / 64.7 | +39.5 (+237.95%) |
| fixture completion ms | cold | 634 / 647.6 / 648 | 715 / 780.8 / 786 | +81 (+12.78%) |
| fixture completion ms | warm | 633 / 634 / 634 | 720 / 736.4 / 742 | +87 (+13.74%) |
| heap after GC MB | cold | 0.53 / 0.53 / 0.53 | 2.71 / 2.72 / 2.72 | +2.18 (+411.32%) |
| heap after GC MB | warm | 0.53 / 0.53 / 0.53 | 2.72 / 2.83 / 2.9 | +2.19 (+413.21%) |
| DOM nodes | cold | 686 / 686 / 686 | 697 / 697 / 697 | +11 (+1.6%) |
| DOM nodes | warm | 686 / 686 / 686 | 697 / 697 / 697 | +11 (+1.6%) |
| listeners | cold | 0 / 0 / 0 | 140 / 140 / 140 | +140 |
| listeners | warm | 0 / 0 / 0 | 272 / 272 / 272 | +272 |

## /churn.html

| metric | phase | off median / p90 / max | on median / p90 / max | on - off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 194.83 / 202.69 / 206.11 | 761.69 / 786.04 / 799.95 | +566.86 (+290.95%) |
| main-thread task ms | warm | 184.8 / 228.51 / 229.21 | 743.78 / 783.7 / 784.28 | +558.98 (+302.48%) |
| script ms | cold | 23.91 / 25.17 / 25.82 | 509.12 / 530.58 / 534.68 | +485.21 (+2029.32%) |
| script ms | warm | 22.44 / 26.54 / 26.64 | 517.53 / 544.99 / 550.05 | +495.09 (+2206.28%) |
| layout ms | cold | 49.82 / 51.97 / 52.22 | 51.07 / 67.66 / 77.51 | +1.25 (+2.51%) |
| layout ms | warm | 39.51 / 45.84 / 45.98 | 38.21 / 40.83 / 41.58 | -1.3 (-3.29%) |
| style ms | cold | 26.08 / 27.98 / 29.09 | 29.7 / 34.15 / 34.31 | +3.62 (+13.88%) |
| style ms | warm | 24.67 / 29.68 / 30 | 29.36 / 32.91 / 33.11 | +4.69 (+19.01%) |
| long tasks | cold | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long tasks | warm | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long-task ms | cold | 0 / 0 / 0 | 65 / 71.4 / 75 | +65 |
| long-task ms | warm | 0 / 0 / 0 | 60 / 61.2 / 62 | +60 |
| DOMContentLoaded ms | cold | 14.7 / 14.9 / 14.9 | 67 / 68.18 / 68.5 | +52.3 (+355.78%) |
| DOMContentLoaded ms | warm | 8.7 / 10.46 / 10.9 | 59.5 / 60.7 / 60.9 | +50.8 (+583.91%) |
| load ms | cold | 14.8 / 15.12 / 15.2 | 67.4 / 68.54 / 68.9 | +52.6 (+355.41%) |
| load ms | warm | 8.8 / 10.62 / 11.1 | 60 / 61.2 / 61.4 | +51.2 (+581.82%) |
| fixture completion ms | cold | 1932 / 1936.2 / 1937 | 1976 / 2012.4 / 2030 | +44 (+2.28%) |
| fixture completion ms | warm | 1924 / 1940.8 / 1950 | 1959 / 1980.8 / 1982 | +35 (+1.82%) |
| heap after GC MB | cold | 0.53 / 0.53 / 0.53 | 3.53 / 3.79 / 3.79 | +3 (+566.04%) |
| heap after GC MB | warm | 0.62 / 0.62 / 0.62 | 3.56 / 3.81 / 3.82 | +2.94 (+474.19%) |
| DOM nodes | cold | 6567 / 6567 / 6567 | 6570 / 6570 / 6570 | +3 (+0.05%) |
| DOM nodes | warm | 6567 / 6567 / 6567 | 6570 / 6570 / 6570 | +3 (+0.05%) |
| listeners | cold | 1 / 1 / 1 | 129 / 130.2 / 131 | +128 (+12800%) |
| listeners | warm | 1 / 1 / 1 | 129 / 129 / 129 | +128 (+12800%) |

## /frames.html

| metric | phase | off median / p90 / max | on median / p90 / max | on - off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 54.11 / 58.94 / 59.28 | 450.47 / 483.32 / 492.47 | +396.36 (+732.51%) |
| main-thread task ms | warm | 41.5 / 43.96 / 45.49 | 454.63 / 467.57 / 468.99 | +413.13 (+995.49%) |
| script ms | cold | 0.48 / 0.53 / 0.53 | 348.5 / 367.5 / 374.38 | +348.02 (+72504.17%) |
| script ms | warm | 0.26 / 0.29 / 0.3 | 354.96 / 360.56 / 361.1 | +354.7 (+136423.08%) |
| layout ms | cold | 12.19 / 13.93 / 14.11 | 13.78 / 17.52 / 18.05 | +1.59 (+13.04%) |
| layout ms | warm | 2.03 / 2.3 / 2.43 | 2.18 / 2.49 / 2.57 | +0.15 (+7.39%) |
| style ms | cold | 3.72 / 4.26 / 4.5 | 4.09 / 5.04 / 5.65 | +0.37 (+9.95%) |
| style ms | warm | 1.9 / 2.13 / 2.18 | 2.87 / 3.19 / 3.32 | +0.97 (+51.05%) |
| long tasks | cold | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long tasks | warm | 0 / 0 / 0 | 1 / 1 / 1 | +1 |
| long-task ms | cold | 0 / 0 / 0 | 66 / 75 / 79 | +66 |
| long-task ms | warm | 0 / 0 / 0 | 74 / 77.4 / 79 | +74 |
| DOMContentLoaded ms | cold | 21.5 / 24.02 / 24.9 | 71 / 81.62 / 85.1 | +49.5 (+230.23%) |
| DOMContentLoaded ms | warm | 15.7 / 16.9 / 17.1 | 68.4 / 78.72 / 85.4 | +52.7 (+335.67%) |
| load ms | cold | 56.1 / 60.32 / 61.2 | 241.7 / 254.06 / 256.3 | +185.6 (+330.84%) |
| load ms | warm | 41.4 / 45.14 / 47.3 | 240.8 / 251.3 / 256.5 | +199.4 (+481.64%) |
| fixture completion ms | cold | 882 / 884.6 / 885 | 1099 / 1122.6 / 1131 | +217 (+24.6%) |
| fixture completion ms | warm | 881 / 883.8 / 885 | 1083 / 1132.2 / 1133 | +202 (+22.93%) |
| heap after GC MB | cold | 2.01 / 2.01 / 2.01 | 8.81 / 8.81 / 8.81 | +6.8 (+338.31%) |
| heap after GC MB | warm | 2.01 / 2.01 / 2.01 | 8.82 / 8.82 / 8.82 | +6.81 (+338.81%) |
| DOM nodes | cold | 15 / 15 / 15 | 18 / 18 / 18 | +3 (+20%) |
| DOM nodes | warm | 15 / 15 / 15 | 18 / 18 / 18 | +3 (+20%) |
| listeners | cold | 9 / 9 / 9 | 577 / 577 / 577 | +568 (+6311.11%) |
| listeners | warm | 18 / 18 / 18 | 577 / 577 / 577 | +559 (+3105.56%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
