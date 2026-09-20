# services-page_runtime

Executes serialized page operations against internal page handles.

The daemon resolves the external `target` through `services/session` and passes
the resulting target handle to this module. Page runtime never mints or resolves
external target ids, never consults a mutable current-page projection, and
never writes the target registry.

Operation modules consume `target.page` and return `targetId`/`pageId` in their
results. Navigation, interaction, query, configuration, and wait operations all
follow that boundary. Tab operations return stable target/page information;
array position is presentation only.

`input_pipeline.mjs` serializes actions per profile. Stale targets,
cross-profile targets, and ambiguous multi-target resolution fail before a page
operation is dispatched.
