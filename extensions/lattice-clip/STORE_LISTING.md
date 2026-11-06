# Store listing

Copy and disclosures for the Chrome Web Store (and Edge Add-ons, which accepts
the same package). Everything here maps to a field in the submission form, so a
release is copy-paste rather than a rewrite.

## Listing

| Field | Value |
| --- | --- |
| Name | Lattice Clip |
| Category | Productivity |
| Language | English |
| Short description (≤132) | Send the current page, link, or selection to your Lattice knowledge inbox. |
| Version | `1.0.0` (bump in `manifest.json`, then `node build.mjs`) |

**Detailed description**

> Lattice Clip puts the page you are reading into your own Lattice knowledge
> inbox, without leaving the tab.
>
> - Click the toolbar icon to capture the page title, URL, and any note you add.
> - Right-click a page, link, or selected text and choose **Save page to Lattice**.
> - The capture opens in Lattice's quick-capture flow, already filled in, where
>   it is stored in your workspace and synced to your other devices.
>
> Lattice Clip talks only to the Lattice instance you configure in the popup —
> your own self-hosted server or a workspace you already use. There is no Lattice
> account service behind this extension, no analytics, and no third-party server.
> The extension has no network permission of its own; it hands your selection to
> the Lattice app in a new tab.

## Single purpose

Send a page, link, or text selection to the user's own Lattice instance.

## Permission justifications

| Permission | Why it is needed |
| --- | --- |
| `activeTab` | Read the current tab's title and URL when you click the icon or the context menu, so the capture is pre-filled. Only the tab you act on is read. |
| `contextMenus` | Add the **Save page to Lattice** item to right-click menus for pages, links, and selections. |
| `storage` | Remember the Lattice URL you configure. It is stored with `chrome.storage.sync` so your own devices agree on it, and nothing else is stored. |
| Host permissions | None. The extension does not inject scripts and does not call any API on your behalf. |

## Remote code

None. All JavaScript is packaged in the zip; the extension does not fetch or
evaluate remote code, and the manifest declares no remote sources. This is
required for the "are you using remote code?" answer to be **No**.

## Data usage disclosures

| Question | Answer |
| --- | --- |
| Collects personally identifiable information? | No |
| Collects health information? | No |
| Collects financial or payment information? | No |
| Collects authentication information? | No |
| Collects personal communications? | No |
| Collects location? | No |
| Collects web history? | No |
| Collects user activity? | No |
| Collects website content? | **Yes — handed to the user's own instance, not to the developer.** The page title, URL, and selected text you capture are placed in the URL of a Lattice tab you open. The extension does not transmit them anywhere else and the developer never receives them. |
| Sells data to third parties? | No |
| Uses data for purposes unrelated to the single purpose? | No |
| Uses data to determine creditworthiness or for lending? | No |

Privacy policy URL: point this at your own hosted copy of `PRIVACY.md`.

## Screenshots to prepare

1. Popup open on a documentation page, note field filled.
2. Right-click menu showing **Save page to Lattice** on a selection.
3. The resulting Lattice inbox capture with the link pre-filled.

Store requirement: 1280×800 or 640×400 PNG, no rounded corners baked in.

## Release checklist

1. Bump `version` in `manifest.json`.
2. `node build.mjs` — validation must pass with no errors (warnings are reviewable).
3. `unzip -t dist/lattice-clip-<version>.zip` — or trust the build, which uses the same format.
4. Load `dist/unpacked` in `chrome://extensions` with Developer mode on and walk the three listing screenshots.
5. Upload the zip, paste the listing copy, answer the disclosures above, attach the privacy policy URL.
6. Record the `sha256` from `dist/build-report.json` in the release notes so self-hosters can verify the package they download.
