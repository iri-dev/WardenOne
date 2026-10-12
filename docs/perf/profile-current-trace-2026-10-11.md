# WardenOne performance profile

- commit `fd160f9` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x1, 1 runs per cell, 2026-10-11T21:44:08.464Z
- variants: on; pages served from 127.0.0.1; nothing left the machine
- readiness: on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2; the worker's own task time is not exposed by this browser's worker target

## /article.html

| metric | phase | on median / p90 / max |
|---|---|---|
| main-thread task ms | cold | 195.68 / 195.68 / 195.68 |
| main-thread task ms | warm | 173.33 / 173.33 / 173.33 |
| script ms | cold | 119.23 / 119.23 / 119.23 |
| script ms | warm | 118.72 / 118.72 / 118.72 |
| layout ms | cold | 22.03 / 22.03 / 22.03 |
| layout ms | warm | 3.31 / 3.31 / 3.31 |
| style ms | cold | 5.2 / 5.2 / 5.2 |
| style ms | warm | 3.48 / 3.48 / 3.48 |
| long tasks | cold | 1 / 1 / 1 |
| long tasks | warm | 1 / 1 / 1 |
| long-task ms | cold | 72 / 72 / 72 |
| long-task ms | warm | 61 / 61 / 61 |
| DOMContentLoaded ms | cold | 55.6 / 55.6 / 55.6 |
| DOMContentLoaded ms | warm | 60.9 / 60.9 / 60.9 |
| load ms | cold | 82.7 / 82.7 / 82.7 |
| load ms | warm | 73.1 / 73.1 / 73.1 |
| fixture completion ms | cold | 775 / 775 / 775 |
| fixture completion ms | warm | 758 / 758 / 758 |
| heap after GC MB | cold | 2.72 / 2.72 / 2.72 |
| heap after GC MB | warm | 2.73 / 2.73 / 2.73 |
| DOM nodes | cold | 697 / 697 / 697 |
| DOM nodes | warm | 697 / 697 / 697 |
| listeners | cold | 140 / 140 / 140 |
| listeners | warm | 272 / 272 / 272 |

## /churn.html

| metric | phase | on median / p90 / max |
|---|---|---|
| main-thread task ms | cold | 806.92 / 806.92 / 806.92 |
| main-thread task ms | warm | 807.87 / 807.87 / 807.87 |
| script ms | cold | 552.95 / 552.95 / 552.95 |
| script ms | warm | 555.28 / 555.28 / 555.28 |
| layout ms | cold | 57.92 / 57.92 / 57.92 |
| layout ms | warm | 41.14 / 41.14 / 41.14 |
| style ms | cold | 32.3 / 32.3 / 32.3 |
| style ms | warm | 32.64 / 32.64 / 32.64 |
| long tasks | cold | 1 / 1 / 1 |
| long tasks | warm | 1 / 1 / 1 |
| long-task ms | cold | 57 / 57 / 57 |
| long-task ms | warm | 71 / 71 / 71 |
| DOMContentLoaded ms | cold | 56.3 / 56.3 / 56.3 |
| DOMContentLoaded ms | warm | 41.8 / 41.8 / 41.8 |
| load ms | cold | 56.8 / 56.8 / 56.8 |
| load ms | warm | 42.1 / 42.1 / 42.1 |
| fixture completion ms | cold | 1966 / 1966 / 1966 |
| fixture completion ms | warm | 2015 / 2015 / 2015 |
| heap after GC MB | cold | 3.48 / 3.48 / 3.48 |
| heap after GC MB | warm | 3.52 / 3.52 / 3.52 |
| DOM nodes | cold | 6570 / 6570 / 6570 |
| DOM nodes | warm | 6570 / 6570 / 6570 |
| listeners | cold | 129 / 129 / 129 |
| listeners | warm | 129 / 129 / 129 |

## /frames.html

| metric | phase | on median / p90 / max |
|---|---|---|
| main-thread task ms | cold | 286.11 / 286.11 / 286.11 |
| main-thread task ms | warm | 257.02 / 257.02 / 257.02 |
| script ms | cold | 173.11 / 173.11 / 173.11 |
| script ms | warm | 171.41 / 171.41 / 171.41 |
| layout ms | cold | 20.32 / 20.32 / 20.32 |
| layout ms | warm | 2.12 / 2.12 / 2.12 |
| style ms | cold | 5.25 / 5.25 / 5.25 |
| style ms | warm | 2.68 / 2.68 / 2.68 |
| long tasks | cold | 0 / 0 / 0 |
| long tasks | warm | 0 / 0 / 0 |
| long-task ms | cold | 0 / 0 / 0 |
| long-task ms | warm | 0 / 0 / 0 |
| DOMContentLoaded ms | cold | 55.2 / 55.2 / 55.2 |
| DOMContentLoaded ms | warm | 49.1 / 49.1 / 49.1 |
| load ms | cold | 158.6 / 158.6 / 158.6 |
| load ms | warm | 177.6 / 177.6 / 177.6 |
| fixture completion ms | cold | 975 / 975 / 975 |
| fixture completion ms | warm | 991 / 991 / 991 |
| heap after GC MB | cold | 7 / 7 / 7 |
| heap after GC MB | warm | 6.92 / 6.92 / 6.92 |
| DOM nodes | cold | 18 / 18 / 18 |
| DOM nodes | warm | 18 / 18 / 18 |
| listeners | cold | 617 / 617 / 617 |
| listeners | warm | 577 / 577 / 577 |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
