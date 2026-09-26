# page_semantic_snapshot

Default `camo snapshot` writes a machine-readable semantic JSON document:
`snapshotId`, `documentId`, `url`, `title`, `viewport`, `window`, and
`tree.nodes`. Every node carries `ref`, `role`, `name/text`, `visible`,
`inViewport`, `bounds`, `state`, `actions`, and `stableLocator`.

Raw HTML is returned only when the caller explicitly requests `--raw-dom`.
The runtime never silently falls back to HTML or screenshots when a semantic
snapshot is required. Snapshot and node refs are invalidated on navigation,
tab close, session stop, TTL expiry, and capacity eviction.
