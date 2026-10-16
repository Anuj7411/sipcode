# How to submit Sipcode to the plugin directory

Plain steps, in order. Field values are in [LISTING.md](LISTING.md). The steps follow OpenAI's [Upload and submit your plugin](https://developers.openai.com/plugins/deploy/submission) and [Submit desktop-only plugins](https://developers.openai.com/plugins/deploy/desktop-only) (read on 2026-10-16). If the portal looks different from this, trust the portal.

## Before you start (once)

1. **Put the new pages online.** Merge the `plugin-directory` branch into `main`. That runs the "Deploy site to GitHub Pages" workflow. When it is green, open each link and check it loads and shows your name:
   - https://anuj7411.github.io/sipcode/
   - https://anuj7411.github.io/sipcode/support/
   - https://anuj7411.github.io/sipcode/privacy/
   - https://anuj7411.github.io/sipcode/terms/

   The portal checks that "Public URLs must be accessible and identify the same publisher as the submission."
2. **Read the terms and privacy pages yourself.** They are plain words, not legal advice. Change anything you do not agree with before you submit.
3. **Build the ZIP.** In the repo folder, run:

   ```bash
   node scripts/pack-plugin.mjs
   ```

   It prints 9 files and writes `dist-plugin/sipcode-plugin-1.7.5.zip` (about 18 KB). It stops with an error if the plugin folder has anything that a skills-only upload rejects.

## 1. Check your access

4. Go to https://platform.openai.com and sign in with the account you want to publish under. (Do this yourself; never share the password.)
5. At the top left, pick the **organization** and **project** that will own the plugin.
6. You must be an **organization owner**, or have the **Apps Management Write** permission. Check at https://platform.openai.com/settings/organization/people/roles. On a personal organization you are usually the owner.
7. **Verify your identity.** Open https://platform.openai.com/settings/organization/general and complete **individual verification** (or business verification, if you want a company name shown). The directory shows the name from this verified identity, for example "Anuj Ojha". You cannot submit without it.

## 2. Upload the ZIP

8. Open https://platform.openai.com/plugins.
9. Click **Upload new or existing plugin**. If it asks **With MCP** or **Skills only**, choose **Skills only**.
10. Choose your verified **Developer identity**.
11. Click **Upload plugin** and pick `dist-plugin/sipcode-plugin-1.7.5.zip`.
12. You may see warnings you only need to confirm:
    - `manifest_normalized`: the portal saves its own copy of the manifest. Check that nothing important changed.
    - `developer_name_defaulted`: the developer name comes from your verified identity. That is expected.
13. **If it says `requires_local_executor` is not allowed:** the desktop-only page says to send your organization ID (from https://platform.openai.com/settings/organization/general) to an OpenAI representative to confirm submission access. If you do not have one, ask OpenAI support through https://help.openai.com (include the plugin ID and organization ID, and say it is a skills-only plugin that runs a local CLI and needs the Desktop only flag). Do not just delete the flag: without it the plugin would also be offered in ChatGPT on the web and on phones, where it cannot run.

## 3. Fix any findings

14. Open **Metadata & Skills**. Wait for the checks to finish. The safety scans of the four skills can take **up to 2 hours**.
15. If there are **Issues**, click **Copy issues**. Fix them in `plugins/sipcode/`, run `node scripts/pack-plugin.mjs` again, then click **Upload plugin to fix issues** and pick the new ZIP. (You can paste the copied issues into Codex or Claude Code and ask what to change.)
16. Compare every listing field the portal shows with [LISTING.md](LISTING.md): name, short description, long description, category **Developer Tools**, capability **Read**, the four URLs, the three starter prompts, the icon. These come from the ZIP and are read-only in the portal; to change one, edit `plugins/sipcode/plugin.json` and `plugins/sipcode/.codex-plugin/plugin.json` (keep them the same; `npx vitest run tests/plugin` checks this) and upload again.

## 4. Review details

17. Open **Review information > Review details**.
    - **Test account / credentials:** none. Sipcode has no account and no sign-in. Leave it empty, or say "No sign-in needed."
    - **Test cases and demo video:** not needed for a skills-only plugin.
    - **Release notes** (if there is a field): `First directory release: four skills (spend, usage limits, why a session was expensive, regressions after an update) that run the local Sipcode command-line tool.`
    - **Notes for the reviewer** (only if there is a free-text field):

      ```
      Sipcode is skills only. Each skill runs the open-source Sipcode CLI on the user's computer, so the reviewer needs: Codex in the ChatGPT desktop app (or the Codex CLI), Node.js 20 or newer, and `npm i -g sipcode` once in a terminal. Sipcode reads the Codex logs in ~/.codex and makes no network calls. With no Codex history on the test machine it reports that no sessions were found. Try: "How much did I spend on Codex this month?"
      ```
18. Click **Save details**.

## 5. Submit

19. Select the draft and click **Submit for review**.
20. Read each **policy attestation** yourself and only tick what is true. (For Sipcode: no data collected, no restricted data, no ads, no sales, nothing aimed at children.)
21. Follow progress under **Review status** on the Plugins page. The review team writes to you by **email**.
    - Only one review can be open per plugin. To change the ZIP during a review, cancel the review first.
    - **Rejected:** read the reason in the email, fix it, build a new ZIP and submit again. To appeal, reply to the rejection email.

## 6. Publish

22. When it is approved, open the approved version and click **Publish plugin**. Nothing goes live until you click this.
23. Check the listing in the ChatGPT desktop app: open **Plugins**, search for Sipcode, install it, and ask one of the starter prompts in a new chat.

## Shipping a new version later

1. Release the CLI as usual. `plugins/sipcode/plugin.json` and the overlay must carry the same version as `package.json` (a test enforces it, and the portal warns `plugin_version_unchanged` if you reuse a version).
2. Keep the plugin name `sipcode`; an update with a different name is rejected (`plugin_name_mismatch`).
3. Run `node scripts/pack-plugin.mjs`.
4. At https://platform.openai.com/plugins open Sipcode, click **Upload plugin to make changes**, pick the new ZIP, and repeat steps 14 to 22. Each upload gets its own checks and review. Publishing replaces the previous version.
5. A new skill or a changed listing needs a new ZIP. A fix that only changes the `sipcode` npm package does not: users get it with `npm i -g sipcode@latest`.
