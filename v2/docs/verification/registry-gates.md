# Gate: registry-gates

## Purpose

Enforce that `v2/resources/registry/*.json` is internally consistent and
stays in sync with the v2 module skeleton. Per resource.

## Entry point

    node v2/gates/run-all.mjs
    node v2/gates/run-all.mjs --strict   # promote per-resource FAIL to global exit 1

## What it checks

| Gate id | Type | What is checked |
|---|---|---|
| registry.resources.unique_ids | hard | resource_id uniqueness |
| registry.resources.owners_declared | hard | every truth_owner maps to a declared module |
| registry.resources.layer_match | hard | resource layer == owning module layer |
| registry.layers.acyclic_lower_only | hard | layer depends_on never goes equal/higher |
| registry.edges.modules_declared | hard | every edge endpoint is a known module or layer name |
| registry.edges.no_forbidden_overlap | hard | edges list does not contain any forbidden edge |
| registry.resources.policies_declared | hard | every policy_id is registered in policies.json |
| registry.resources.forbidden_paths_unique | hard | no two resources share a forbidden_path string |
| registry.modules.probe_files_exist | hard | each module's owned_paths[0] exists with README.md |
| registry.resources.gates_resolvable | soft | each resource has a real gate script (warn while status=design) |
| per-resource (16) | design-time | resource's forbidden_paths are physically absent from v1 |

## Status policy

- `status=design`: per-resource gates may fail. Aggregated gate exits 0
  while registry integrity passes.
- `status=active`: per-resource gate must pass. CI runs `--strict`.

## CI integration

Add to `.github/workflows/ci.yml`:

```yaml
- name: v2 registry gates
  run: node v2/gates/run-all.mjs
```

Hard guard 22a: this job must run on every push.
