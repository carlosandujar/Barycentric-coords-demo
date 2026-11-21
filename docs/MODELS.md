# Anatomical OBJ examples

These are prepared derivatives of the MakeHuman HM08 base mesh, not scans of identifiable people. They are distributed under **CC0 1.0 Universal**, like their source asset.

| Example | OBJ | Vertices | Triangles | Open boundary |
| --- | --- | ---: | ---: | --- |
| Human head | `human-head.obj` | 1,145 | 2,198 | Neck |
| Human head, detailed | `human-head-detailed.obj` | 2,144 | 4,196 | Neck |
| Human torso | `human-torso.obj` | 1,448 | 2,799 | Waist |
| Human bust | `human-bust.obj` | 2,148 | 4,199 | Waist |

The torso excludes the head; its neck and upper-arm ends are capped. The bust includes the head and caps the upper-arm ends. Each model has a single connected, consistently oriented manifold component, disk topology, and no degenerate triangles. The only boundary is the neck or waist, lying at Z = 0. Model coordinates are Z-up, with the front facing negative Y.

The prepared OBJ files are stored in `app/examples/`. The browser loads these local OBJ files through the same parser as imported files. No model downloads from external sites are needed at runtime. The existing Three.js, math.js, and optional CodeMirror CDN dependencies are unchanged. Vertex dots start hidden for these denser examples; selection and the Vertices display control remain available.

## Source and license

- Source: [MakeHuman HM08 base.obj](https://github.com/makehumancommunity/makehuman/blob/master/makehuman/data/3dobjs/base.obj).
- Original asset explicitly released as CC0 in September 2020.
- Original copyright holders named in the asset: Data Collection AB, Joel Palmius, and Jonas Hauquier.
- Source asset SHA-256: `8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c`.
- License text: [MAKEHUMAN-CC0.txt](../app/examples/MAKEHUMAN-CC0.txt), from the upstream [asset license](https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.ASSETS.md).

## Preparation

`scripts/prepare-human-models.js` extracts the source `body` group, splits its quads along a consistent diagonal, clips the neck at source Y = 5.9 and waist at Y = 1.8, and trims upper arms at X = +/-2.3 for the torso and bust. Secondary openings are capped. Meshoptimizer simplifies the triangles while locking the intended boundary. Opposite duplicate face pairs left by collapsing tiny folds are removed, and the output is compacted, rotated to Z-up, exported as triangles, and validated again through the application's OBJ parser and topology checks.

From the repository root, to regenerate, download the upstream source to `.model-sources/base.obj`, run `npm ci`, then:

```sh
node scripts/prepare-human-models.js
```

The preparation script verifies the source checksum. Meshoptimizer is a development dependency only; the browser uses the prepared OBJ files directly.
