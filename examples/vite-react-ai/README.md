# Vite React AI Editor Example

Run from the repo root once:

```bash
pnpm install
pnpm run build:plugins
```

Then run the example:

```bash
cd examples/vite-react-ai
pnpm dev
```

Open:

```text
http://127.0.0.1:5177/editor
```

The preview is a field showcase. It registers `Scene`, `Hero NPC`, and
`Enemy Wave` field folders from `config(...)` / `val(...)` calls in `src/App.tsx`.
Changing a generated control writes raw JSON back to the matching `val(...)`
argument through the POST endpoint.

For real model prompts, set a provider key before starting Vite:

```bash
export OPENROUTER_API_KEY=...
```
