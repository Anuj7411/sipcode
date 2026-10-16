# Screenshots for the Sipcode plugin

## Do not put screenshots in the ZIP

For a skills-only plugin the directory does not take screenshots:

- Upload check `screenshot_configuration_excluded`: "Remove `interface.screenshots`. Screenshots require **With MCP** and a custom UI." ([submission errors](https://developers.openai.com/plugins/deploy/submission-errors))
- Final submission: "No screenshots, since those require a remote MCP server with custom UI."
- The [plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines) say the directory no longer shows screenshots and to provide example prompts instead. The three starter prompts in the manifest do that job.

So `plugin.json` has no `screenshots` field, and `scripts/pack-plugin.mjs` refuses to build a ZIP if one is added.

## Shots worth taking anyway

For the README, the website, a launch post, or if a reviewer asks how it works. Only you can take these: they show your own Codex app and your own numbers.

Setup for every shot:

- `npm i -g sipcode@latest` first, so the output matches the current release.
- The Sipcode plugin installed (README, "Use Sipcode inside Codex"), the ChatGPT desktop app restarted.
- A **new, empty chat** for each shot (a long chat costs more of your limit and clutters the picture).
- Window about 1600 x 1000, light theme, PNG. Crop to the chat; keep the question and the whole answer in frame.
- Before saving, check nothing private is visible: folder names, project names and session titles in the sidebar can name clients. Collapse the sidebar or crop it out.

| # | Ask, word for word | Must be visible | File name |
|---|---|---|---|
| 1 | `How much did I spend on Codex this month?` | The question, the "ran sipcode" step, the month-to-date and projected month-end amounts, and the line that they are at API prices | `plugin-spend.png` |
| 2 | `How close am I to my Codex usage limit?` | The 5-hour and weekly percents, the reset times in your local time, and the account-wide caveat (other devices and the cloud) | `plugin-limits.png` |
| 3 | `Why was my last Codex session so expensive?` | The session total, the largest requests list, and the output share | `plugin-why.png` |
| 4 | `Did Codex or Claude Code get worse after an update?` | The coverage lines (requests, sessions, dates, versions) and either the findings or "No regressions detected in your logs" | `plugin-regress.png` |
| 5 | (optional) Open **Plugins** in the desktop app | The Sipcode card with its name, short description and icon | `plugin-card.png` |

If the limits answer says "a possible limit cut", keep the word "possible" and the caveat in the crop. Do not crop a number away from its caveat.

Store the files under `docs/screenshots/plugin/` if you want them in the repo, never under `plugins/sipcode/` (that folder is the package).
