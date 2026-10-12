# WardenOne performance profile

- commit `fd160f9` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x1, 1 runs per cell, 2026-10-11T21:48:27.694Z
- variants: on; pages served from 127.0.0.1; nothing left the machine
- readiness: on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2; the worker's own task time is not exposed by this browser's worker target

## /article.html

| metric | phase | on median / p90 / max |
|---|---|---|
| main-thread task ms | cold | 185.35 / 185.35 / 185.35 |
| main-thread task ms | warm | 148.32 / 148.32 / 148.32 |
| script ms | cold | 109.34 / 109.34 / 109.34 |
| script ms | warm | 101.99 / 101.99 / 101.99 |
| layout ms | cold | 22.87 / 22.87 / 22.87 |
| layout ms | warm | 2.7 / 2.7 / 2.7 |
| style ms | cold | 5.59 / 5.59 / 5.59 |
| style ms | warm | 2.46 / 2.46 / 2.46 |
| long tasks | cold | 1 / 1 / 1 |
| long tasks | warm | 1 / 1 / 1 |
| long-task ms | cold | 76 / 76 / 76 |
| long-task ms | warm | 60 / 60 / 60 |
| DOMContentLoaded ms | cold | 52.5 / 52.5 / 52.5 |
| DOMContentLoaded ms | warm | 49.8 / 49.8 / 49.8 |
| load ms | cold | 86.2 / 86.2 / 86.2 |
| load ms | warm | 60.7 / 60.7 / 60.7 |
| fixture completion ms | cold | 778 / 778 / 778 |
| fixture completion ms | warm | 722 / 722 / 722 |
| heap after GC MB | cold | 2.77 / 2.77 / 2.77 |
| heap after GC MB | warm | 2.76 / 2.76 / 2.76 |
| DOM nodes | cold | 697 / 697 / 697 |
| DOM nodes | warm | 697 / 697 / 697 |
| listeners | cold | 140 / 140 / 140 |
| listeners | warm | 272 / 272 / 272 |

## /churn.html

| metric | phase | on median / p90 / max |
|---|---|---|
| main-thread task ms | cold | 779.66 / 779.66 / 779.66 |
| main-thread task ms | warm | 662.74 / 662.74 / 662.74 |
| script ms | cold | 504.27 / 504.27 / 504.27 |
| script ms | warm | 443.97 / 443.97 / 443.97 |
| layout ms | cold | 68.55 / 68.55 / 68.55 |
| layout ms | warm | 38.78 / 38.78 / 38.78 |
| style ms | cold | 36.89 / 36.89 / 36.89 |
| style ms | warm | 30.13 / 30.13 / 30.13 |
| long tasks | cold | 1 / 1 / 1 |
| long tasks | warm | 0 / 0 / 0 |
| long-task ms | cold | 88 / 88 / 88 |
| long-task ms | warm | 0 / 0 / 0 |
| DOMContentLoaded ms | cold | 50 / 50 / 50 |
| DOMContentLoaded ms | warm | 47.6 / 47.6 / 47.6 |
| load ms | cold | 50.3 / 50.3 / 50.3 |
| load ms | warm | 48.1 / 48.1 / 48.1 |
| fixture completion ms | cold | 2032 / 2032 / 2032 |
| fixture completion ms | warm | 1925 / 1925 / 1925 |
| heap after GC MB | cold | 3.64 / 3.64 / 3.64 |
| heap after GC MB | warm | 3.39 / 3.39 / 3.39 |
| DOM nodes | cold | 6570 / 6570 / 6570 |
| DOM nodes | warm | 6570 / 6570 / 6570 |
| listeners | cold | 129 / 129 / 129 |
| listeners | warm | 129 / 129 / 129 |

## /frames.html

| metric | phase | on median / p90 / max |
|---|---|---|
| main-thread task ms | cold | 158.49 / 158.49 / 158.49 |
| main-thread task ms | warm | 280.97 / 280.97 / 280.97 |
| script ms | cold | 60.39 / 60.39 / 60.39 |
| script ms | warm | 183.99 / 183.99 / 183.99 |
| layout ms | cold | 12.58 / 12.58 / 12.58 |
| layout ms | warm | 4.19 / 4.19 / 4.19 |
| style ms | cold | 3.93 / 3.93 / 3.93 |
| style ms | warm | 3.08 / 3.08 / 3.08 |
| long tasks | cold | 0 / 0 / 0 |
| long tasks | warm | 1 / 1 / 1 |
| long-task ms | cold | 0 / 0 / 0 |
| long-task ms | warm | 50 / 50 / 50 |
| DOMContentLoaded ms | cold | 51.4 / 51.4 / 51.4 |
| DOMContentLoaded ms | warm | 51 / 51 / 51 |
| load ms | cold | 150.9 / 150.9 / 150.9 |
| load ms | warm | 142.1 / 142.1 / 142.1 |
| fixture completion ms | cold | 977 / 977 / 977 |
| fixture completion ms | warm | 1038 / 1038 / 1038 |
| heap after GC MB | cold | 5.43 / 5.43 / 5.43 |
| heap after GC MB | warm | 6.94 / 6.94 / 6.94 |
| DOM nodes | cold | 15 / 15 / 15 |
| DOM nodes | warm | 18 / 18 / 18 |
| listeners | cold | 534 / 534 / 534 |
| listeners | warm | 577 / 577 / 577 |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
