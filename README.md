# Auto Archiver

Automatically archive/unarchive notes based on frontmatter properties **or** tags, while preserving folder structure under an `Archive/` root.

> **TL;DR**
> Mark a note with `Archived: true` (or a tag you choose, e.g. `#archived`) → it moves to `Archive/<original/subpath>/note.md`.
> Remove the markers → it moves back.

---

## Features

* Archive if **any configured frontmatter properties** are truthy *(true, "true", 1, or any extra truthy strings you define)* **or** **any configured tags** are present.
* **Unarchive** automatically if conditions no longer match (toggle in settings).
* **Preserves** the original subpath under `Archive/` (e.g., `Task/TASK-1234.md` → `Archive/Task/TASK-1234.md`).
* **Exclusions** (ignore selected root folders), **dry-run** mode, **notices** (toasts).
* Manual commands:

  * **Process current file**
  * **Scan vault and archive/unarchive**
* Collision handling: adds ` (1)`, ` (2)`, … if the target filename already exists.
* Uses Obsidian’s rename APIs, so **links update automatically** when files move.

---

## Installation

### From the Community Catalog (after approval)

1. In Obsidian: **Settings → Community plugins → Browse**
2. Search for **Auto Archiver**
3. Install and enable

### Manual (now)

1. Go to the repository **Releases** page
2. Download:

   * `manifest.json`
   * `main.js`
3. Place them in your vault at:

   ```
   <vault>/.obsidian/plugins/auto-archiver/
   ```
4. In Obsidian: **Settings → Community plugins** → enable **Auto Archiver**

### (Optional) BRAT (before catalog listing)

1. Install the **BRAT** plugin
2. Add this repo: `pabumake/auto-archiver`
3. Enable Auto Archiver

---

## Usage

### Archive by frontmatter

Add any of your configured properties to the YAML frontmatter and set it truthy:

```yaml
---
title: TASK-1234
Archived: true
---
```

By default, the plugin recognizes:

* `true`, `"true"`, `1`
* extra truthy strings you configure (e.g., `yes`, `y`, `archived`, `done`)

### Archive by tag

Use any of your configured tags (frontmatter or inline):

```yaml
---
tags: [archived, task]
---
```

or inline:

```
#archived
```

### Unarchive

* If a note is inside `Archive/` and **none** of the configured properties/tags match anymore, the plugin (if enabled) moves it back to its original structure by **removing the `Archive/` prefix**.
* This behavior is toggleable in settings (**Unarchive when conditions no longer match**).

---

## Settings

Open **Settings → Community plugins → Auto Archiver**:

* **Frontmatter properties**
  Comma-separated list (case-insensitive). If **any** is truthy, the note archives.
  Example: `Archived, Status`

* **Extra truthy values**
  Additional strings to treat as truthy, case-insensitive.
  Example: `yes, y, archived, done`

* **Tags that trigger archiving**
  Comma-separated list (without `#`). If **any** is present, the note archives.
  Example: `archived, done`

* **Archive root**
  Destination root folder. Defaults to `Archive`. The plugin **preserves the original subfolders** under this root.

* **Excluded roots**
  Comma-separated path prefixes to ignore.
  Example: `Templates, Daily`

* **Dry run**
  Log/show actions but **do not move** files.

* **Show notices**
  Display a toast when a note is archived/unarchived.

* **Unarchive when conditions no longer match**
  If a note lives in `Archive/` and no configured property/tag matches, move it back (mirror path).

* **Commands**

  * **Process current file**: run logic on the active note.
  * **Scan vault and archive/unarchive**: batch process all markdown files.

---

## How it moves files (and updates links)

* The plugin listens to **metadata changes** and **file modifications**, and also exposes manual commands.
* Moves are performed via Obsidian’s `fileManager.renameFile`, so Obsidian **updates links** for you.
* If the target path exists, the plugin appends ` (1)`, ` (2)`, … to the filename to avoid collisions.

---

## Examples

### Preserve subpath

* From: `Task/TASK-1234.md`
* To: `Archive/Task/TASK-1234.md`

### Unarchive

* From: `Archive/Task/TASK-1234.md`
* To: `Task/TASK-1234.md` *(mirror path after stripping `Archive/`)*

---

## Known limitations / notes

* **Assets in the same folder** (images/PDFs) are **not** moved automatically with the note. Obsidian’s renamer will keep links updated, but assets stay put.
* Case sensitivity for properties/tags is handled internally (we normalize).
* Very rapid edits can trigger multiple checks; the plugin already debounces lightly.
* Mobile: supported (no Node-only APIs). If you use very large vaults, prefer manual scans on mobile.

---

## Performance tips

* Add any noisy top-level folders (e.g., `Daily`, `Templates`) to **Excluded roots**.
* Use **dry run** when first rolling out to see what would move.
* Use the **Scan** command to reconcile the vault after changing rules.

---

## Development

```bash
npm ci
npm run build
```

* Source lives in `src/main.ts`
* Build outputs `main.js` at the repo root (what Obsidian loads)
* For a live-dev setup, run `npm run build -- --watch` and reload the plugin in Obsidian

---

## Roadmap

* Optional: move/restore **sibling assets** with the note
* Per-property **value matchers** (e.g., `Status: archived`, not just truthy)
* Rule testing panel (preview what would move)
* More granular event controls (save-only, metadata-only)

---

## Transparency & Attribution

This plugin was ideated by me and **co-created with ChatGPT** (model: *GPT-5 Thinking*) at the author’s request, for full transparency.

---

## Support / Issues

* File bugs and feature requests here:
  [https://github.com/pabumake/auto-archiver/issues](https://github.com/pabumake/auto-archiver/issues)

---

## License

File: [LICENSE](LICENSE)