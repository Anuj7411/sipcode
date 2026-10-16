# Sipcode plugin for Codex

Ask Codex about your own Codex use in plain words. Each answer comes from the Sipcode command-line tool on your computer, which reads the logs Codex already writes there and makes no network calls.

## Setup

1. Install Sipcode once, in a terminal (Node.js 20 or newer; Node.js 22.15 or newer to read the logs Codex compresses):

   ```bash
   npm i -g sipcode
   ```

2. Install this plugin, then start a new chat.

The plugin runs the installed `sipcode` command, so it works where Codex can run local commands: Codex in the ChatGPT desktop app and the Codex CLI.

## Ask

| Ask | Sipcode runs |
|---|---|
| "How much did I spend on Codex this month?" | `sipcode forecast --agent codex --json` (also `today` and `stats`) |
| "How close am I to my Codex usage limit?" | `sipcode limits` |
| "Why was my last Codex session so expensive?" | `sipcode why --agent codex --json` |
| "Did Codex or Claude Code get worse after an update?" | `sipcode regress --bug-report` |

- Dollar figures are estimates at API prices; on a ChatGPT plan you are not billed per token.
- Usage limits cover your whole account. Codex use on other devices or in the cloud raises the percent without local tokens, so a "possible limit cut" is a signal, not proof.
- The plugin is four skills (instructions only): no hooks, no MCP server, no network calls.

## Links

- Website: https://anuj7411.github.io/sipcode/
- Support: https://anuj7411.github.io/sipcode/support/
- Privacy policy: https://anuj7411.github.io/sipcode/privacy/
- Terms of use: https://anuj7411.github.io/sipcode/terms/
- Source: https://github.com/Anuj7411/sipcode

MIT licensed. Built by Anuj Ojha.
