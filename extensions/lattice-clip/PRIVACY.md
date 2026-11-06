# Privacy policy — Lattice Clip

Last updated: 2026-11-04

Lattice Clip is a browser extension that sends a page, link, or text selection
you choose to a Lattice instance you control.

## What the extension handles

- **Page title and URL** of the tab you act on, read only when you click the
  toolbar icon or the **Save page to Lattice** context menu item.
- **Selected text**, only when you invoke the context menu on a selection.
- **A note you type** in the popup, if you type one.
- **The Lattice URL you configure**, stored with `chrome.storage.sync`.

The extension reads nothing else: no page content beyond the selection you ask
for, no browsing history, no passwords, no cookies, no keyboard input.

## Where that data goes

Nowhere except the Lattice instance you configured. The extension builds a URL
in the form `https://your-lattice.example/app?view=inbox&…` and opens it in a
new tab, exactly as if you had typed it. From that point the capture is handled
by the Lattice application and stored in your own workspace — a server you or
your organization runs.

The extension itself performs no network requests, has no host permissions, and
contains no analytics, telemetry, advertising, or third-party SDKs. The
developer of this extension operates no servers that receive your data and
cannot see anything you capture.

## What is stored on your machine

Only your configured Lattice URL, in extension storage, so the popup and context
menu know where to send captures. Removing the extension removes it.

## Sharing

The extension shares data with no third party. It does not sell data. It does
not transfer data for advertising, creditworthiness, or lending purposes.

## Changes

Material changes to this policy will be published in the extension's repository
alongside a version bump, and the _"Last updated"_ date above will change.

## Contact

Open an issue in the Lattice repository that ships this extension, or contact
the maintainer of the Lattice instance you use.
