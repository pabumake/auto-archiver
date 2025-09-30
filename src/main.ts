import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  Notice,
  normalizePath
} from "obsidian";

type Path = string;

interface AutoArchiverSettings {
  /** One or more YAML/frontmatter keys to check (case-insensitive). Any truthy -> archive */
  propertyNames: string[];          // default ["Archived"]
  /** Extra string values to treat as truthy (in addition to true, "true", 1). Case-insensitive. */
  extraTruthyValues: string[];      // default ["yes","y","archived","done"]
  /** One or more tags (without '#'). Any present -> archive */
  tags: string[];                   // default ["archived"]
  /** Root folder where archived notes go, preserving original subfolders */
  archiveRoot: string;              // default "Archive"
  /** Folders to ignore (prefix match) */
  excludedRoots: string[];          // default []
  /** If true, log actions but do not move files */
  dryRun: boolean;                  // default false
  /** Show a toast on actions */
  showNotice: boolean;              // default true
  /** Unarchive behavior toggles */
  unarchiveOnMissingAll: boolean;   // default true (if no properties/tags match)
}

const DEFAULT_SETTINGS: AutoArchiverSettings = {
  propertyNames: ["Archived"],
  extraTruthyValues: ["yes", "y", "archived", "done"],
  tags: ["archived"],
  archiveRoot: "Archive",
  excludedRoots: [],
  dryRun: false,
  showNotice: true,
  unarchiveOnMissingAll: true,
};

export default class AutoArchiverPlugin extends Plugin {
  settings: AutoArchiverSettings;
  private offFns: Array<() => void> = [];

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new AutoArchiverSettingTab(this.app, this));

    this.addCommand({
      id: "scan-and-archive",
      name: "Scan vault and archive/unarchive",
      callback: () => this.scanAll().catch(this.reportError)
    });

    this.addCommand({
      id: "process-current-file",
      name: "Archive/Unarchive current file (if needed)",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (checking) return true;
        this.processFile(file).catch(this.reportError);
        return true;
      },
    });

    const mdUnsub = this.app.metadataCache.on("changed", (file) => {
      if (file instanceof TFile) {
        window.setTimeout(() => this.processFile(file).catch(this.reportError), 50);
      }
    });
    this.offFns.push(() => this.app.metadataCache.offref(mdUnsub));

    const vUnsub = this.app.vault.on("modify", (file) => {
      if (file instanceof TFile) {
        window.setTimeout(() => this.processFile(file).catch(this.reportError), 50);
      }
    });
    this.offFns.push(() => this.app.vault.offref(vUnsub));
  }

  onunload() {
    this.offFns.forEach((fn) => fn());
    this.offFns.length = 0;
  }

  private reportError = (e: unknown) => {
    console.error("[Auto Archiver] Error", e);
    new Notice("Auto Archiver: error (see console)", 4000);
  };

  private norm(s: string): string { return s.trim().toLowerCase(); }

  private isInArchive(path: Path): boolean {
    const p = normalizePath(path);
    const root = normalizePath(this.settings.archiveRoot).replace(/\/+$/, "");
    return p === root || p.startsWith(root + "/");
  }

  private isExcluded(path: Path): boolean {
    if (!this.settings.excludedRoots?.length) return false;
    const p = normalizePath(path);
    return this.settings.excludedRoots.some((prefix) => {
      const root = normalizePath(prefix).replace(/\/+$/, "");
      return p === root || p.startsWith(root + "/");
    });
  }

  private async ensureFolderExists(folderPath: Path): Promise<void> {
    const { vault } = this.app;
    folderPath = normalizePath(folderPath);
    if (await vault.adapter.exists(folderPath)) return;

    const parts = folderPath.split("/").filter(Boolean);
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      const accNorm = normalizePath(acc);
      const exists = await vault.adapter.exists(accNorm);
      if (!exists) {
        await vault.createFolder(accNorm).catch((e) => {
          if (!String(e).includes("Folder already exists")) throw e;
        });
      }
    }
  }

  /** Return true if any configured property/tag indicates archive */
  private shouldArchive(file: TFile): boolean {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    const propNames = (this.settings.propertyNames ?? []).map((x) => this.norm(x));

    // Properties
    if (fm && propNames.length) {
      for (const k of Object.keys(fm)) {
        if (propNames.includes(this.norm(k))) {
          const v = (fm as any)[k];
          if (this.isTruthy(v)) return true;
        }
      }
    }

    // Tags (frontmatter tags or inline #tags)
    const tagSet = new Set<string>();
    const fmtags = (fm as any)?.tags;

    if (typeof fmtags === "string") {
      fmtags.split(/[,\s]+/).filter(Boolean)
        .forEach(t => tagSet.add(this.norm(t.replace(/^#/, ""))));
    } else if (Array.isArray(fmtags)) {
      fmtags.forEach((t) => {
        if (typeof t === "string") tagSet.add(this.norm(t.replace(/^#/, "")));
      });
    }

    const inline = cache?.tags ?? [];
    inline.forEach((t: any) => {
      const raw = t?.tag ?? "";
      if (typeof raw === "string") tagSet.add(this.norm(raw.replace(/^#/, "")));
    });

    if (this.settings.tags?.length) {
      const targets = new Set(this.settings.tags.map((x) => this.norm(x.replace(/^#/, ""))));
      for (const tg of tagSet) if (targets.has(tg)) return true;
    }

    return false;
  }

  private isTruthy(v: unknown): boolean {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v === 1;
    if (typeof v === "string") {
      const s = this.norm(v);
      if (s === "true" || s === "1") return true;
      if (this.settings.extraTruthyValues?.map((x) => this.norm(x)).includes(s)) return true;
    }
    return false;
  }

  private buildArchiveTarget(file: TFile): { dir: Path; full: Path } {
    const archiveRoot = normalizePath(this.settings.archiveRoot).replace(/\/+$/, "");
    const currentPath = normalizePath(file.path);
    const i = currentPath.lastIndexOf("/");
    const curDir = i === -1 ? "" : currentPath.slice(0, i);
    const fname = i === -1 ? currentPath : currentPath.slice(i + 1);
    const targetDir = curDir ? `${archiveRoot}/${curDir}` : archiveRoot;
    const safeDir = normalizePath(targetDir);
    const safeFull = normalizePath(`${targetDir}/${fname}`);
    return { dir: safeDir, full: safeFull };
  }

  private buildUnarchiveTarget(file: TFile): { dir: Path; full: Path } | null {
    const root = normalizePath(this.settings.archiveRoot).replace(/\/+$/, "");
    const filePath = normalizePath(file.path);
    if (!this.isInArchive(filePath)) return null;
    if (filePath === root) return null;

    const withoutRoot = filePath.slice(root.length + 1); // drop "Archive/"
    const i = withoutRoot.lastIndexOf("/");
    const curDir = i === -1 ? "" : withoutRoot.slice(0, i);
    const fname = i === -1 ? withoutRoot : withoutRoot.slice(i + 1);

    const dirSafe = curDir ? normalizePath(curDir) : "";
    const fullSafe = dirSafe ? normalizePath(`${dirSafe}/${fname}`) : normalizePath(fname);
    return { dir: dirSafe, full: fullSafe };
  }

  private async resolveCollision(targetPath: Path): Promise<Path> {
    const { vault } = this.app;
    targetPath = normalizePath(targetPath);
    if (!(await vault.adapter.exists(targetPath))) return targetPath;

    const dot = targetPath.lastIndexOf(".");
    const hasExt = dot !== -1 && !targetPath.endsWith("/");
    const base = hasExt ? targetPath.slice(0, dot) : targetPath;
    const ext = hasExt ? targetPath.slice(dot) : "";

    let i = 1;
    while (await vault.adapter.exists(normalizePath(`${base} (${i})${ext}`))) i++;
    return normalizePath(`${base} (${i})${ext}`);
  }

  private async processFile(file: TFile): Promise<void> {
    if (file.extension !== "md") return;
    if (this.isExcluded(file.path)) return;

    const wantArchive = this.shouldArchive(file);
    const inArchive = this.isInArchive(file.path);

    // ARCHIVE
    if (wantArchive && !inArchive) {
      const { dir, full } = this.buildArchiveTarget(file);
      if (this.settings.dryRun) {
        console.debug(`[Auto Archiver] (dry) would archive "${file.path}" -> "${full}"`);
        if (this.settings.showNotice) new Notice(`(Dry run) Would archive: ${file.path}`, 2500);
        return;
      }
      await this.ensureFolderExists(dir);
      const dest = await this.resolveCollision(full);
      await this.app.fileManager.renameFile(file, dest);
      if (this.settings.showNotice) new Notice(`Archived → ${dest}`, 2500);
      return;
    }

    // UNARCHIVE
    if (!wantArchive && inArchive && this.settings.unarchiveOnMissingAll) {
      const target = this.buildUnarchiveTarget(file);
      if (!target) return;
      const { dir, full } = target;

      if (this.settings.dryRun) {
        console.debug(`[Auto Archiver] (dry) would UNarchive "${file.path}" -> "${full}"`);
        if (this.settings.showNotice) new Notice(`(Dry run) Would unarchive: ${file.path}`, 2500);
        return;
      }
      if (dir) await this.ensureFolderExists(dir);
      const dest = await this.resolveCollision(full);
      await this.app.fileManager.renameFile(file, dest);
      if (this.settings.showNotice) new Notice(`Unarchived → ${dest}`, 2500);
    }
  }

  private async scanAll(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    let archived = 0, unarchived = 0;

    for (const f of files) {
      const wasInArchive = this.isInArchive(f.path);
      await this.processFile(f);
      // After rename, Obsidian updates TFile.path; re-check:
      const nowInArchive = this.isInArchive(f.path);
      if (!wasInArchive && nowInArchive) archived++;
      if (wasInArchive && !nowInArchive) unarchived++;
    }

    if (this.settings.showNotice) {
      const prefix = this.settings.dryRun ? "(Dry run) " : "";
      new Notice(`${prefix}Archived: ${archived}, Unarchived: ${unarchived}`, 4000);
    }
  }

  async saveSettings() { await this.saveData(this.settings); }
}

class AutoArchiverSettingTab extends PluginSettingTab {
  plugin: AutoArchiverPlugin;
  constructor(app: App, plugin: AutoArchiverPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Auto Archiver" });

    new Setting(containerEl)
      .setName("Frontmatter properties")
      .setDesc("Comma-separated property names. Any truthy will archive.")
      .addText((t) =>
        t
          .setPlaceholder("Archived, Status")
          .setValue(this.plugin.settings.propertyNames.join(", "))
          .onChange(async (v) => {
            this.plugin.settings.propertyNames = v
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Extra truthy values")
      .setDesc('Case-insensitive. Example: "yes, y, archived, done"')
      .addText((t) =>
        t
          .setPlaceholder("yes, y, archived, done")
          .setValue(this.plugin.settings.extraTruthyValues.join(", "))
          .onChange(async (v) => {
            this.plugin.settings.extraTruthyValues = v
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Tags that trigger archiving")
      .setDesc('Comma-separated, without "#". Any present will archive.')
      .addText((t) =>
        t
          .setPlaceholder("archived, done")
          .setValue(this.plugin.settings.tags.join(", "))
          .onChange(async (v) => {
            this.plugin.settings.tags = v
              .split(",")
              .map((s) => s.replace(/^#/, "").trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Archive root")
      .setDesc('Folder where archived notes go (subfolders preserved). E.g., "Archive"')
      .addText((t) =>
        t
          .setPlaceholder("Archive")
          .setValue(this.plugin.settings.archiveRoot)
          .onChange(async (v) => {
            this.plugin.settings.archiveRoot = normalizePath(v.trim() || "Archive");
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Excluded roots")
      .setDesc('Comma-separated prefixes to ignore (e.g., "Templates, Daily").')
      .addText((t) =>
        t
          .setPlaceholder("Templates, Daily")
          .setValue(this.plugin.settings.excludedRoots.join(", "))
          .onChange(async (v) => {
            this.plugin.settings.excludedRoots = v
              .split(",")
              .map((s) => normalizePath(s.trim()))
              .filter(Boolean);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Dry run")
      .setDesc("Log/show actions but do not move files.")
      .addToggle((tg) =>
        tg
          .setValue(this.plugin.settings.dryRun)
          .onChange(async (v) => {
            this.plugin.settings.dryRun = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show notices")
      .setDesc("Show a toast when a note is archived/unarchived.")
      .addToggle((tg) =>
        tg
          .setValue(this.plugin.settings.showNotice)
          .onChange(async (v) => {
            this.plugin.settings.showNotice = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Unarchive when conditions no longer match")
      .setDesc("If a note is inside Archive/ but none of the properties/tags match, move it back.")
      .addToggle((tg) =>
        tg
          .setValue(this.plugin.settings.unarchiveOnMissingAll)
          .onChange(async (v) => {
            this.plugin.settings.unarchiveOnMissingAll = v;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("hr");

    new Setting(containerEl)
      .setName("Process current file")
      .setDesc("Run archive/unarchive logic on the active note.")
      .addButton((btn) =>
        btn.setButtonText("Run").onClick(() => {
          const f = this.app.workspace.getActiveFile();
          if (!f) return new Notice("No active file.");
          this.plugin.processFile(f).catch(this.plugin.reportError);
        })
      );

    new Setting(containerEl)
      .setName("Full scan")
      .setDesc("Scan the vault and archive/unarchive where needed.")
      .addButton((btn) =>
        btn.setCta().setButtonText("Scan Now").onClick(() => {
          this.plugin.scanAll().catch(this.plugin.reportError);
        })
      );
  }
}