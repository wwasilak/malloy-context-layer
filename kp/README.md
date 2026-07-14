# Knowledge Plane (OKF bundle)

Canonical business concepts, one markdown file per concept, in the
[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) shape.

- namespace: `https://yourorg.example/kp#`
- **Folder = domain = steward.** `sales/`, `finance/`, `merchandising/`, `operations/`
  hold stewarded concepts; `core/` holds shared, un-stewarded ones.
- **Humans edit concept files. The build owns bookkeeping**: every `index.md` and every
  `## Implementations` section between the GENERATED markers is rewritten by
  `npm run build` — never edit those by hand.
- New concept? Copy the matching file from `_templates/`, set `status: draft`.
  The exporter only publishes `approved` concepts to the agent map.
- Malloy models link here via `# concept = "kp:..."` annotations. The build
  hard-fails if an annotation points at a URI that has no file here.
