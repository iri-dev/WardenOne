# WardenOne performance profile

- commit `fd160f9` (working tree modified), extension 1.0.2
- Edg/150.0.4078.48 on 12th Gen Intel(R) Core(TM) i5-12400F (12 cores), CPU throttle x1, 7 runs per cell, 2026-10-11T21:27:39.691Z
- variants: on:logger-off, on; pages served from 127.0.0.1; nothing left the machine
- Iframe logger settings alternated between runs in one browser profile.
- readiness: on:logger-off = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger off in 8 frames; on = worker 1.0.2 (cbclhioddgbghebhfjjicdddpfgdgpia), page marker 1.0.2, iframe logger on in 8 frames; the worker's own task time is not exposed by this browser's worker target

## /image-frames.html

| metric | phase | on:logger-off median / p90 / max | on median / p90 / max | on - on:logger-off (median) |
|---|---|---|---|---|
| main-thread task ms | cold | 588.44 / 609.53 / 613.95 | 639.74 / 694.41 / 709.54 | +51.3 (+8.72%) |
| main-thread task ms | warm | 559.09 / 581.52 / 589.47 | 603.04 / 640.96 / 642.92 | +43.95 (+7.86%) |
| script ms | cold | 412.67 / 421.92 / 421.97 | 444.85 / 493.58 / 496.53 | +32.18 (+7.8%) |
| script ms | warm | 406.73 / 417.64 / 423.28 | 427.01 / 455.91 / 462.11 | +20.28 (+4.99%) |
| layout ms | cold | 14.19 / 14.71 / 14.83 | 14.65 / 15.26 / 15.69 | +0.46 (+3.24%) |
| layout ms | warm | 6.23 / 6.59 / 6.67 | 6.5 / 6.91 / 7.04 | +0.27 (+4.33%) |
| style ms | cold | 6.96 / 7.59 / 7.84 | 7.64 / 8.26 / 8.58 | +0.68 (+9.77%) |
| style ms | warm | 7.42 / 7.77 / 7.85 | 7.85 / 8 / 8.01 | +0.43 (+5.8%) |
| frame mutation batches ms | cold | 553.9 / 575.22 / 586.8 | 525.7 / 609.22 / 690.1 | -28.2 (-5.09%) |
| frame mutation batches ms | warm | 496.8 / 656.22 / 749.1 | 525.2 / 575.86 / 604.6 | +28.4 (+5.72%) |
| long tasks | cold | 1 / 1 / 1 | 1 / 1 / 1 | +0 (+0%) |
| long tasks | warm | 1 / 1 / 1 | 1 / 1 / 1 | +0 (+0%) |
| long-task ms | cold | 62 / 69 / 69 | 66 / 72.6 / 78 | +4 (+6.45%) |
| long-task ms | warm | 60 / 62.4 / 63 | 57 / 65.4 / 66 | -3 (-5%) |
| DOMContentLoaded ms | cold | 58.3 / 60.24 / 62.4 | 58.6 / 63.52 / 69.1 | +0.3 (+0.51%) |
| DOMContentLoaded ms | warm | 67.4 / 70.7 / 72.8 | 68.6 / 76.06 / 79.9 | +1.2 (+1.78%) |
| load ms | cold | 276.8 / 398.52 / 400.5 | 246.6 / 405.88 / 409.6 | -30.2 (-10.91%) |
| load ms | warm | 244 / 298.02 / 302.7 | 275.5 / 299.7 / 304.5 | +31.5 (+12.91%) |
| fixture completion ms | cold | 2156 / 2189.4 / 2205 | 2181 / 2206 / 2218 | +25 (+1.16%) |
| fixture completion ms | warm | 2191 / 2219 / 2219 | 2207 / 2219.4 / 2223 | +16 (+0.73%) |
| heap after GC MB | cold | 8.76 / 8.77 / 8.77 | 8.88 / 8.97 / 9.02 | +0.12 (+1.37%) |
| heap after GC MB | warm | 8.76 / 8.77 / 8.77 | 8.91 / 8.92 / 8.93 | +0.15 (+1.71%) |
| DOM nodes | cold | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| DOM nodes | warm | 17 / 17 / 17 | 17 / 17 / 17 | +0 (+0%) |
| listeners | cold | 564 / 580 / 580 | 568 / 583.6 / 589 | +4 (+0.71%) |
| listeners | warm | 576 / 587.8 / 589 | 598 / 604.6 / 607 | +22 (+3.82%) |

Raw per-run values, readiness evidence and metadata are in the JSON beside this file.
