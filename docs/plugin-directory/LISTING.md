# Sipcode: plugin directory listing kit

Everything the OpenAI plugin directory (shared by ChatGPT and Codex) asks for, filled in.
Most fields are imported from the ZIP's `plugin.json` when you upload it, so you mostly check them instead of typing them.
Source of truth: `plugins/sipcode/plugin.json` (`extensions["com.openai"]`). If a value here and the manifest ever differ, the manifest wins; fix this file.

Requirements are from [Upload and submit your plugin](https://developers.openai.com/plugins/deploy/submission), [Plugin submission errors](https://developers.openai.com/plugins/deploy/submission-errors), [Submit desktop-only plugins](https://developers.openai.com/plugins/deploy/desktop-only) and the [plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines), read on 2026-10-16.

## Submission type

| Question in the portal | Answer |
|---|---|
| With MCP or Skills only | **Skills only** (four skills, no MCP server, no hooks, no apps) |
| Desktop only | Yes. The manifest sets `requires_local_executor: true`, because each skill runs the `sipcode` command on the user's computer. The listing shows a **Desktop only** badge; people install it from the ChatGPT desktop app. |
| Package version | `1.7.5` (same as the npm package) |
| ZIP | `dist-plugin/sipcode-plugin-1.7.5.zip`, built by `node scripts/pack-plugin.mjs` |

## Listing fields

| Field (manifest key) | Limit | Value | Length |
|---|---|---|---|
| Display name (`displayName`) | 30 | `Sipcode` | 7 |
| Short description (`shortDescription`) | 30 | `Spend, limits and regressions` | 29 |
| Long description (`longDescription`) | 4,000 | see below | 1,001 |
| Developer name (`developerName`) | 80 | `Anuj Ojha` (the portal replaces it with the name on your verified identity) | 9 |
| Category (`category`) | one of the list | `Developer Tools` | |
| Capabilities (`capabilities`) | 20 items, 120 chars each | `Read` | |
| Website (`websiteURL`) | HTTPS, 1,024 | https://anuj7411.github.io/sipcode/ | |
| Support (`supportURL`) | HTTPS, 1,024 | https://anuj7411.github.io/sipcode/support/ | |
| Privacy policy (`privacyPolicyURL`) | HTTPS, 1,024 | https://anuj7411.github.io/sipcode/privacy/ | |
| Terms of service (`termsOfServiceURL`) | HTTPS, 1,024 | https://anuj7411.github.io/sipcode/terms/ | |
| Brand color (`brandColor`) | `#RRGGBB`, 2:1 against white | `#5B4FCF` (about 6:1 against white) | |
| Brand color, dark (`brandColorDark`) | optional | not set; the portal derives one | |
| Starter prompts (`defaultPrompt`) | 3, 128 chars each, unique, no @mentions | see below | |
| Logo (`logo`) | square, 48 to 4,096 px, 5 MiB | `./assets/logo.png` | |
| Composer icon (`composerIcon`) | same | `./assets/logo.png` | |
| Screenshots (`screenshots`) | not allowed for skills-only | none (see SCREENSHOTS.md) | |

Valid categories (from `plugin_category_unknown` in the errors reference): Productivity, Creativity, Developer Tools, Business & Operations, Data & Analytics, Communication, Education & Research, Security, Finance, Healthcare, Travel, Entertainment, Other.

The four listing URLs are optional for a skills-only plugin ("Website, privacy policy, terms, and support URLs are optional for skills-only plugins"), but the guidelines require a published privacy policy and support contact, so all four are set. They go live when the `docs/site` change is deployed to GitHub Pages (merging to `main` runs `.github/workflows/deploy-site.yml`). Check each one opens before you submit.

### Long description

Paste exactly (the blank lines are part of it; line breaks are allowed):

```
Sipcode answers questions about your own Codex use from the logs Codex already writes on this computer: how much you spent today or this month (estimated at API prices), how close you are to your usage limits and whether a limit may have shrunk, why a session used so many tokens, and whether Codex or Claude Code got worse after an update. Each answer comes from the Sipcode command-line tool (npm package sipcode), which reads the logs locally and makes no network calls.

Setup: install the tool once with npm i -g sipcode (Node.js 20 or newer; Node.js 22.15 or newer to read the logs Codex compresses). The plugin runs that command on your computer, so it works where Codex can run local commands: Codex in the ChatGPT desktop app and the Codex CLI.

Limitations: dollar figures are estimates at API prices, not your bill. Usage limits cover your whole account, so Codex use on other devices or in the cloud raises the percent without local tokens, and a possible limit cut is a signal, not proof.
```

### Starter prompts

The directory takes at most three. These are in the manifest:

1. `How much did I spend on Codex this month?` (41 characters)
2. `How close am I to my Codex usage limit?` (39)
3. `Did Codex or Claude Code get worse after an update?` (51)

The fourth question does not fit as a starter prompt but works the same way, and the long description names it:

4. `Why was my last Codex session so expensive?`

What each one runs:

| Ask | Skill | Sipcode runs |
|---|---|---|
| How much did I spend on Codex this month? | `sipcode-spend` | `sipcode forecast --agent codex --json` (also `today` and `stats`) |
| How close am I to my Codex usage limit? | `sipcode-limits` | `sipcode limits` |
| Why was my last Codex session so expensive? | `sipcode-why` | `sipcode why --agent codex --json` |
| Did Codex or Claude Code get worse after an update? | `sipcode-regress` | `sipcode regress --bug-report` (this prompt names both tools; a Codex-only question runs `--agent codex`, which takes about a second, and the Claude Code logs are read only when the user asks about Claude Code) |

## Package identity (root of `plugin.json`)

| Field | Value |
|---|---|
| `name` | `sipcode` |
| `version` | `1.7.5` |
| `description` | "Ask about your Codex usage in plain words: spend, usage limits, why a session was expensive, and whether Codex or Claude Code got worse after an update. Runs the Sipcode CLI on this computer, which reads your local Codex and Claude Code logs and makes no network calls." (269 characters) |
| `author.name` / `author.url` | `Anuj Ojha` / https://github.com/Anuj7411 |
| `author.email` | not set (optional). Decision for you, see below. |
| `homepage` | https://anuj7411.github.io/sipcode/ |
| `repository` | https://github.com/Anuj7411/sipcode |
| `license` | `MIT` |
| `keywords` | codex, usage, limits, tokens, spend, regression |

## Logo and icon

| File | Format | Size | Bytes | Used for |
|---|---|---|---|---|
| `plugins/sipcode/assets/logo.png` | PNG | 180 x 180 (square) | 4,004 | `logo` and `composerIcon` |

The spec is "square and at least 48 by 48 pixels", at most 4,096 px and 5 MiB, in PNG, JPEG, WebP or SVG. The current file meets it, so no new icon was made. Optional later: a `logoDark` / `composerIconDark` variant, because the black outline is hard to see on a dark background.

## Skills in the package

| Skill | What it answers |
|---|---|
| `sipcode-spend` | Spend today, this month, the month-end forecast, or a period |
| `sipcode-limits` | How close you are to the 5-hour, weekly or 30-day limit, and whether a limit may have shrunk |
| `sipcode-why` | Why a session used so many tokens |
| `sipcode-regress` | Whether Codex or Claude Code got worse after an update |

Each skill: runs one `sipcode` command, never reads the log files itself, never installs anything, asks the user before re-running with read access when the sandbox blocks `~/.codex`, and tells the user `npm i -g sipcode` when the command is missing.

## Setup required (say this wherever the form allows notes)

- Install the CLI once: `npm i -g sipcode`.
- Node.js 20 or newer. Node.js 22.15 or newer to read the session logs Codex compresses (`.jsonl.zst`); on an older Node.js they are skipped, with a warning.
- Works where Codex can run local commands: Codex in the ChatGPT desktop app and the Codex CLI. Not on ChatGPT web or mobile (hence Desktop only).
- No account, no sign-in, no API key, so there are no reviewer credentials to enter.

## Fields left out on purpose

| Field | Why |
|---|---|
| `review.test_cases`, `review.demo_recording_url` | "Skills-only plugins don't need MCP app review cases or a demo recording." |
| `screenshots` | `screenshot_configuration_excluded`: screenshots need a remote MCP server with custom UI. |
| `onboardingSkill` | Optional. Could later point at a setup skill that checks `sipcode` is installed. |
| `publication.countries` | Omitted: available everywhere the directory is. |
| `publication.release_notes` | Optional; type them in the portal if asked. |
| `test_credentials`, `reviewer_instructions` | Rejected in ZIP metadata. Nothing to sign in to anyway. |

## Decisions for Anuj

- **Support email.** The docs do not require an email: the support URL plus GitHub issues is the support contact. If the portal asks for one, use an address you will read, in place of `SUPPORT_EMAIL_TBD`, and optionally add it as `author.email` in both manifests (the test keeps them identical).
- **Desktop only.** Kept on because the skills cannot work without a local shell. If the portal says `requires_local_executor` is not allowed, the desktop-only page says to send your organization ID to an OpenAI representative; see SUBMIT.md for what to do if you do not have one.
- **Read the terms page** (`docs/site/src/pages/terms.astro`). It is plain words, not legal advice.
