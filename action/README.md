# Sipcode Score — GitHub Action

score how agent-friendly your codebase is on every pr. emits a shields.io
endpoint json so you can pin a badge to your readme.

## usage

add this step to a workflow:

```yaml
- uses: actions/checkout@v4
- uses: sipcode/sipcode/action@main
  with:
    threshold: 80      # fail the job if score < 80; default 0 (no gate)
    badge-path: badge.json
```

then commit the produced `badge.json` to a place your readme can reach, or
upload it as an artifact. once it's at a stable url, pin it:

```markdown
![sipcode score](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/<org>/<repo>/main/badge.json)
```

## what it does

runs `npx @sipcode/cli@latest score --threshold <n> --badge --no-html` inside
your repo's working directory. the cli writes `.sipcode/badge.json`; this
action copies it to `badge-path`.

## inputs

- `threshold` — minimum score (0-100) required. `0` means no gate. default `0`.
- `badge-path` — where to write the badge json. default `badge.json`.

## requirements

- node available on the runner (`actions/setup-node` or the default ubuntu runner is fine).
- a working directory that looks like a real project (package.json, source, etc.).
