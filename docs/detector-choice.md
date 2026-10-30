# Detector choice (Step 4.6)

Benchmark run 2026-10-30T21:41:27.917Z on Apple M2 Pro, 10 cores, 16 GB RAM (CPU, onnxruntime-node 1.30.0, transformers.js 4.3.2). Command: `npm run bench:detector`.

Data: 10 COCO val2017 photos in `test/fixtures/images/detect/`, labelled by hand (`labels.json`): 25 present labels and 30 absent but plausible distractors (55 total). Each model scores every label on every image; the threshold is the one that maximises accuracy (present ≥ t, absent < t).

| Model | dtype | Accuracy | Best threshold | Warm latency / image | Load (cached) |
|---|---|---|---|---|---|
| onnx-community/grounding-dino-tiny-ONNX | q8 | 85.5 % (47/55) | 0.03 | 1513 ms (max 2433) | 791 ms |
| Xenova/owlv2-base-patch16 | q8 | 94.5 % (52/55) | 0.15 | 2055 ms (max 2582) | 470 ms |

## Decision
**`DETECTOR_MODEL=Xenova/owlv2-base-patch16`, `DETECTOR_DTYPE=q8`, `DETECTOR_THRESHOLD=0.15`** (now the defaults in `qa/config.mjs` and `.env.image.example`).

Rule from the plan: higher accuracy wins unless the difference is under 5 points; more than 8 s/image disqualifies. OWLv2 is 9.1 points more accurate and both are far below the latency budget.

## Why Grounding DINO lost (in this stack)
- With one phrase per call it always finds a best match: `dog` scored 0.54 on the photo of two cats, above `cat` (0.47). So it needs a joint prompt (`cat. remote control. dog.`).
- With a joint prompt the box scores are good, but transformers.js 4.3.2 returns phrases glued from the whole prompt (`"cat remote. dog."` for the cat box). We map each box to the label that appears earliest in its phrase; several present objects still lose their box to another phrase (score 0).
- Misclassified at t=0.03:
  - coco-000000039769.jpg: present `couch` scored 0.000
  - coco-000000039769.jpg: absent `dog` scored 0.030
  - coco-000000000139.jpg: present `potted plant` scored 0.000
  - coco-000000000139.jpg: present `person` scored 0.000
  - coco-000000000632.jpg: absent `television` scored 0.054
  - coco-000000000724.jpg: present `tree` scored 0.000
  - coco-000000000724.jpg: absent `bicycle` scored 0.037
  - coco-000000000785.jpg: present `ski pole` scored 0.000

## OWLv2 misclassifications at t=0.15
  - coco-000000000632.jpg: absent `television` scored 0.237
  - coco-000000000785.jpg: present `person` scored 0.085
  - coco-000000000872.jpg: present `helmet` scored 0.146

## Notes
- Worker RSS with one model loaded: about 1.6–1.7 GB (measured in the smoke tests and the benchmark). Fine on a 16 GB laptop.
- The report lists the top-3 scores per label, so a customer can see near misses (e.g. 0.146 vs 0.15).
- Slow test: `npm run test:slow` checks 3 photos with the chosen config (all present labels pass, all absent labels fail, 2 cats counted).
