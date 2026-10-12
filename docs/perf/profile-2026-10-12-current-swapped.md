# WardenOne performance profile

- commit `7507f01` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x1, 5 runs per cell, 2026-10-12T08:23:13.821Z
- variants: on, off; pages served from 127.0.0.1; nothing left the machine
- readiness: on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, remote host lists 3636 hosts; off = no extension, page marker absent; the worker's own task time is not exposed by this browser's worker target

## /article.html

| metric | phase | on median / p90 / max | off median / p90 / max | on - off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 170.99 / 174.51 / 176.08 | 34.9 / 35.57 / 35.9 | +136.09 (+389.94%) |
| main-thread task ms | warm | 135.71 / 137.57 / 138.67 | 19.04 / 21.03 / 22.12 | +116.67 (+612.76%) |
| script ms | cold | 100.21 / 102.15 / 103.17 | 0.01 / 0.01 / 0.01 | +100.2 (+1002000%) |
| script ms | warm | 96.78 / 97.77 / 98.36 | 0.01 / 0.01 / 0.01 | +96.77 (+967700%) |
| layout ms | cold | 20.8 / 21.28 / 21.36 | 10.78 / 10.92 / 10.97 | +10.02 (+92.95%) |
| layout ms | warm | 2.71 / 2.91 / 3.01 | 2.6 / 2.87 / 2.9 | +0.11 (+4.23%) |
| style ms | cold | 4.55 / 4.89 / 4.95 | 3.09 / 3.16 / 3.21 | +1.46 (+47.25%) |
| style ms | warm | 2.51 / 2.59 / 2.62 | 1.17 / 1.26 / 1.27 | +1.34 (+114.53%) |
| long tasks | cold | 1 / 1 / 1 | 0 / 0 / 0 | +1 |
| long tasks | warm | 1 / 1 / 1 | 0 / 0 / 0 | +1 |
| long-task ms | cold | 70 / 72.6 / 73 | 0 / 0 / 0 | +70 |
| long-task ms | warm | 58 / 60.6 / 61 | 0 / 0 / 0 | +58 |
| DOMContentLoaded ms | cold | 65.5 / 66.72 / 67.4 | 29.4 / 29.7 / 29.7 | +36.1 (+122.79%) |
| DOMContentLoaded ms | warm | 56.5 / 59.92 / 61.4 | 14.8 / 16 / 16.2 | +41.7 (+281.76%) |
| load ms | cold | 167.4 / 169.12 / 169.6 | 30 / 30.32 / 30.4 | +137.4 (+458%) |
| load ms | warm | 132.1 / 134.38 / 135.3 | 15.2 / 16.34 / 16.5 | +116.9 (+769.08%) |
| fixture completion ms | cold | 777 / 777.6 / 778 | 636 / 638 / 638 | +141 (+22.17%) |
| fixture completion ms | warm | 745 / 746.6 / 747 | 624 / 630 / 634 | +121 (+19.39%) |
| heap after GC MB | cold | 2.86 / 2.86 / 2.86 | 0.53 / 0.53 / 0.53 | +2.33 (+439.62%) |
| heap after GC MB | warm | 2.88 / 2.88 / 2.88 | 0.53 / 0.53 / 0.53 | +2.35 (+443.4%) |
| DOM nodes | cold | 697 / 697 / 697 | 686 / 686 / 686 | +11 (+1.6%) |
| DOM nodes | warm | 697 / 697 / 697 | 686 / 686 / 686 | +11 (+1.6%) |
| listeners | cold | 140 / 140 / 140 | 0 / 0 / 0 | +140 |
| listeners | warm | 272 / 272 / 272 | 0 / 0 / 0 | +272 |

## /churn.html

| metric | phase | on median / p90 / max | off median / p90 / max | on - off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 433.03 / 446.76 / 448.91 | 182.62 / 185.36 / 185.88 | +250.41 (+137.12%) |
| main-thread task ms | warm | 415.1 / 419 / 420.99 | 183.54 / 194.43 / 201.58 | +231.56 (+126.16%) |
| script ms | cold | 222.53 / 231.59 / 235.73 | 21.65 / 22.05 / 22.11 | +200.88 (+927.85%) |
| script ms | warm | 209.65 / 213.23 / 214.76 | 21.33 / 22.17 / 22.6 | +188.32 (+882.89%) |
| layout ms | cold | 49.25 / 51.36 / 51.82 | 47.67 / 48.6 / 49.12 | +1.58 (+3.31%) |
| layout ms | warm | 37.09 / 37.45 / 37.62 | 39.12 / 40.47 / 41.2 | -2.03 (-5.19%) |
| style ms | cold | 28.8 / 29.57 / 29.64 | 24.46 / 24.47 / 24.48 | +4.34 (+17.74%) |
| style ms | warm | 27.64 / 28.04 / 28.1 | 24.88 / 26.23 / 27.13 | +2.76 (+11.09%) |
| long tasks | cold | 1 / 1 / 1 | 0 / 0 / 0 | +1 |
| long tasks | warm | 0 / 0 / 0 | 0 / 0 / 0 | +0 |
| long-task ms | cold | 52 / 53.6 / 54 | 0 / 0 / 0 | +52 |
| long-task ms | warm | 0 / 0 / 0 | 0 / 0 / 0 | +0 |
| DOMContentLoaded ms | cold | 60.4 / 61.1 / 61.5 | 13.8 / 14.56 / 15 | +46.6 (+337.68%) |
| DOMContentLoaded ms | warm | 55.7 / 56.64 / 57 | 8.7 / 9.04 / 9.2 | +47 (+540.23%) |
| load ms | cold | 60.8 / 61.5 / 61.9 | 13.9 / 14.72 / 15.2 | +46.9 (+337.41%) |
| load ms | warm | 56 / 56.98 / 57.3 | 8.8 / 9.08 / 9.2 | +47.2 (+536.36%) |
| fixture completion ms | cold | 1990 / 1991.6 / 1992 | 1944 / 1944.6 / 1945 | +46 (+2.37%) |
| fixture completion ms | warm | 1974 / 1976.8 / 1978 | 1926 / 1935.8 / 1939 | +48 (+2.49%) |
| heap after GC MB | cold | 2.99 / 3 / 3 | 0.53 / 0.53 / 0.53 | +2.46 (+464.15%) |
| heap after GC MB | warm | 3 / 3.01 / 3.02 | 0.62 / 0.62 / 0.62 | +2.38 (+383.87%) |
| DOM nodes | cold | 6570 / 6570 / 6570 | 6567 / 6567 / 6567 | +3 (+0.05%) |
| DOM nodes | warm | 6570 / 6570 / 6570 | 6567 / 6567 / 6567 | +3 (+0.05%) |
| listeners | cold | 129 / 129 / 129 | 1 / 1 / 1 | +128 (+12800%) |
| listeners | warm | 129 / 129 / 129 | 1 / 1 / 1 | +128 (+12800%) |

## /frames.html

| metric | phase | on median / p90 / max | off median / p90 / max | on - off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 217.71 / 223.12 / 224.08 | 53.18 / 54.93 / 55.74 | +164.53 (+309.38%) |
| main-thread task ms | warm | 195.98 / 196.43 / 196.63 | 38.65 / 41.75 / 41.9 | +157.33 (+407.06%) |
| script ms | cold | 122.79 / 129.1 / 130.48 | 0.47 / 0.49 / 0.51 | +122.32 (+26025.53%) |
| script ms | warm | 118.3 / 119.16 / 119.47 | 0.23 / 0.24 / 0.24 | +118.07 (+51334.78%) |
| layout ms | cold | 13.28 / 13.59 / 13.64 | 12.07 / 12.4 / 12.42 | +1.21 (+10.02%) |
| layout ms | warm | 2.14 / 2.18 / 2.19 | 1.93 / 2.04 / 2.08 | +0.21 (+10.88%) |
| style ms | cold | 4.04 / 4.08 / 4.09 | 3.57 / 3.71 / 3.71 | +0.47 (+13.17%) |
| style ms | warm | 2.58 / 2.65 / 2.69 | 1.86 / 2 / 2.06 | +0.72 (+38.71%) |
| long tasks | cold | 1 / 1 / 1 | 0 / 0 / 0 | +1 |
| long tasks | warm | 0 / 0 / 0 | 0 / 0 / 0 | +0 |
| long-task ms | cold | 53 / 55.4 / 57 | 0 / 0 / 0 | +53 |
| long-task ms | warm | 0 / 0 / 0 | 0 / 0 / 0 | +0 |
| DOMContentLoaded ms | cold | 63.9 / 68.58 / 71.3 | 21.2 / 21.36 / 21.4 | +42.7 (+201.42%) |
| DOMContentLoaded ms | warm | 60.7 / 60.88 / 61 | 14.5 / 14.66 / 14.7 | +46.2 (+318.62%) |
| load ms | cold | 197.7 / 202.9 / 204.1 | 55.5 / 56.78 / 57.5 | +142.2 (+256.22%) |
| load ms | warm | 175 / 175.48 / 175.8 | 41.1 / 43.2 / 43.8 | +133.9 (+325.79%) |
| fixture completion ms | cold | 1054 / 1055.6 / 1056 | 887 / 887 / 887 | +167 (+18.83%) |
| fixture completion ms | warm | 1040 / 1043 / 1043 | 885 / 889.2 / 890 | +155 (+17.51%) |
| heap after GC MB | cold | 6.73 / 6.73 / 6.73 | 2.01 / 2.01 / 2.01 | +4.72 (+234.83%) |
| heap after GC MB | warm | 6.74 / 6.74 / 6.74 | 2.01 / 2.01 / 2.01 | +4.73 (+235.32%) |
| DOM nodes | cold | 18 / 18 / 18 | 15 / 15 / 15 | +3 (+20%) |
| DOM nodes | warm | 18 / 18 / 18 | 15 / 15 / 15 | +3 (+20%) |
| listeners | cold | 561 / 561 / 561 | 9 / 9 / 9 | +552 (+6133.33%) |
| listeners | warm | 561 / 561 / 561 | 18 / 18 / 18 | +543 (+3016.67%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
