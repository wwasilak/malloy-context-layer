# Knowledge Plane (OKF bundle)

Canonical business concepts, one markdown file per concept, in the
[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) shape.

- namespace: `https://yourorg.example/kp#`
- **Folder = domain = steward.** `sales/`, `finance/`, `merchandising/`, `operations/`
  hold domain-local concepts; `global/` holds company-wide concepts every domain shares.
- **Humans edit concept files. The build owns bookkeeping**: every `index.md` and every
  `## Implementations` section between the GENERATED markers is rewritten by
  `npm run build` — never edit those by hand.
- New concept? Copy the matching file from `_templates/`, set `status: draft`.
  The exporter only publishes `approved` concepts to the agent map.
- Malloy models link here via `# concept = "kp:..."` annotations. The build
  hard-fails if an annotation points at a URI that has no file here.

## Global vs local, and promotion

- `global/` = the whole company agrees on this definition. Domain folders = the
  domain's local concepts.
- **Promotion path:** when the build's "Shared concepts (>1 model)" report shows a
  domain concept referenced by other domains' models, that's demand evidence —
  debate it, then promote by moving the file to `global/` in a reviewed PR
  (identity is the `uri:`, so nothing breaks). Humans move files; the build only
  detects candidates.
- **Same label, different meanings** (rare, deliberate): distinct URIs
  (e.g. kp:SalesActiveCustomer), possibly sharing a label. Ambiguous labels
  resolve to the global/ concept unless the question names the domain.
