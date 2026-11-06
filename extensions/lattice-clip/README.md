# Lattice Clip

A minimal Manifest V3 extension that sends the current page, link, or selection to Lattice's quick-capture flow.

## Install locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this directory.
4. Open the popup and save your Lattice URL. There is no default: until it is set, the extension asks for one instead of opening a dead link.

Capture flows:

- Click the extension icon and save.
- Right-click a page, link, or selected text → **Save page to Lattice**.

The extension opens:

```text
/app?view=inbox&title=…&url=…&text=…
```

The workspace shell detects those share-target parameters, opens quick capture, and preselects link mode when a URL is present.
