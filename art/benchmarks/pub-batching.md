# Pub scene census

Measured with `node --import tsx scripts/benchmark-pub-batching.ts` on 2026-09-14.

| Fully loaded room, every wall visible | Before | After |
| --- | ---: | ---: |
| Main-pass draw submissions | 460 | 310 |
| Visible mesh objects | 456 | 306 |
| Triangles, including every instance | 3,171,110 | 1,181,561 |
| Transparent draw submissions | 28 | 28 |

The fixture parses the actual GLB geometry and material graph. Canvas drawing and
image decoding are stubbed, so these are scene counts, **not GPU timings or FPS**.
Frustum culling, shadows, reflections and postprocessing are outside the census.
The construction duration in each JSON is an incidental CPU observation, not a
browser startup benchmark.

Static bar trim is merged within its existing visibility groups. Repeated scanned
stools, slot/TV cabinets and gallery-frame parts share instanced submissions. The
five animated displays keep their original meshes and parents; transparent glass
retains its original sorting boundaries. Batched shapes retain their UVs, normals,
world transforms, render order, shadow flags and triangle count.

Shelf bottles use nine separately authored lower-detail meshes. The original
hero GLBs remain available, and the five close counter bottle designs still load
their original meshes. No props were removed. The two optimizations account for
32.6% fewer draws and 62.7% fewer triangles in this fixture.

`pub-before.json` preserves the baseline census and `pub-after.json` preserves the
new one. The original source tree was copied before editing to
`/tmp/coolpool-render-baseline`; while that copy exists, rerun the baseline with:

```sh
node --import tsx scripts/benchmark-pub-batching.ts --baseline
node --import tsx scripts/benchmark-pub-batching.ts
node --import tsx --test tests/pub-batching.test.ts tests/pub-models.test.ts tests/pub-entertainment.test.ts
```

`buildPub(...).diagnostics()` reports current visible submissions and construction
batch reductions per section. Construction reductions include the interior batching
that already existed before this change; use the paired census files to compare
this change with the previous implementation.
