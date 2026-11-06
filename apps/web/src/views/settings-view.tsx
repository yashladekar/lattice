"use client";

import { auditExportFilename, auditLogToCsv, createId, exportVaultMarkdown, RETENTION_OPTIONS, type Role } from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import { Input } from "@notes-learning/ui/components/input";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@notes-learning/ui/lib/utils";
import { strToU8, zipSync } from "fflate";
import {
  ArrowUpRight,
  Brain,
  Boxes,
  Check,
  Cloud,
  CopyCheck,
  Database,
  Download,
  FolderUp,
  GitBranch,
  HardDrive,
  Loader2,
  LogOut,
  Monitor,
  Palette,
  Plus,
  RefreshCw,
  Shield,
  Sparkles,
  Trash2,
  Users,
  WifiOff,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { GithubImportDialog } from "@/components/workspace/github-import";
import { GitSyncDialog } from "@/components/workspace/git-sync-dialog";
import { VaultImportDialog } from "@/components/workspace/vault-import";
import { SqlConsolePanel } from "@/components/workspace/sql-console-panel";
import { PluginManager } from "@/components/workspace/plugin-manager";
import { DuplicateReviewPanel } from "@/components/workspace/duplicate-review";
import { authClient } from "@/lib/auth-client";
import { getApiBaseUrl } from "@/lib/config";
import { downloadBytes, downloadTextFile } from "@/lib/download";
import {
  exportWorkspaceLocal,
  importWorkspaceLocal,
  updateWorkspaceLocal,
  type LocalExport,
} from "@/lib/local/repository";
import { appRouteObject } from "@/lib/navigation";
import { client } from "@/utils/orpc";

type SettingsTab =
  | "general"
  | "appearance"
  | "members"
  | "sync"
  | "ai"
  | "devices"
  | "audit"
  | "query"
  | "plugins"
  | "duplicates";

const TABS: Array<{ id: SettingsTab; label: string; icon: typeof Cloud }> = [
  { id: "general", label: "General", icon: HardDrive },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "members", label: "Members", icon: Users },
  { id: "sync", label: "Sync & backup", icon: Cloud },
  { id: "ai", label: "Intelligence", icon: Brain },
  { id: "devices", label: "Devices", icon: Monitor },
  { id: "audit", label: "Audit log", icon: Shield },
  { id: "query", label: "Query", icon: Database },
  { id: "plugins", label: "Plugins", icon: Boxes },
  { id: "duplicates", label: "Duplicates", icon: CopyCheck },
];

const ROLES: Role[] = ["OWNER", "ADMIN", "MEMBER", "EDITOR", "VIEWER", "GUEST"];

export function SettingsView() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    db,
    user,
    activeWorkspace,
    activeWorkspaceId,
    role,
    online,
    syncState,
    workspaces,
    refreshWorkspaces,
    refreshWorkspace,
    retrySync,
  } = useAppData();
  const [tab, setTab] = useState<SettingsTab>("general");
  const { theme, setTheme } = useTheme();
  const [name, setName] = useState(activeWorkspace?.name ?? "");
  const [description, setDescription] = useState(activeWorkspace?.description ?? "");
  const [icon, setIcon] = useState(activeWorkspace?.icon ?? "✦");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("EDITOR");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const [githubOpen, setGithubOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);

  useEffect(() => {
    if (!activeWorkspace) return;
    setName(activeWorkspace.name);
    setDescription(activeWorkspace.description ?? "");
    setIcon(activeWorkspace.icon ?? "✦");
  }, [activeWorkspace?.id]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.storage?.persisted) return;
    void navigator.storage.persisted().then(setPersisted);
  }, []);

  const members = useQuery({
    queryKey: ["workspace-members", activeWorkspaceId],
    queryFn: async () => client.workspace.members(),
    enabled: online && Boolean(activeWorkspaceId),
  });
  const audit = useQuery({
    queryKey: ["workspace-audit", activeWorkspaceId],
    queryFn: async () => client.workspace.audit(),
    enabled: online && Boolean(activeWorkspaceId) && ["OWNER", "ADMIN"].includes(role ?? ""),
  });
  const aiStatus = useQuery({
    queryKey: ["ai-status", activeWorkspaceId],
    queryFn: async () => client.ai.status(),
    enabled: online && Boolean(activeWorkspaceId),
  });
  const devices = useQuery({
    queryKey: ["devices", user?.id],
    queryFn: async () => client.device.list(),
    enabled: online && Boolean(user),
  });
  const ingestToken = useQuery({
    queryKey: ["workspace-ingest-token", activeWorkspaceId],
    queryFn: async () => client.workspace.ingestToken(),
    enabled: online && Boolean(activeWorkspaceId),
  });
  const [newIngestToken, setNewIngestToken] = useState<string | null>(null);

  const saveGeneral = async () => {
    if (!db || !activeWorkspaceId) return;
    setBusy(true);
    try {
      await updateWorkspaceLocal(db, activeWorkspaceId, {
        name: name.trim() || activeWorkspace?.name,
        description: description.trim() || null,
        icon,
      });
      toast.success("Workspace saved locally");
    } finally {
      setBusy(false);
    }
  };

  const setAccent = async (accent: string) => {
    if (!db || !activeWorkspaceId) return;
    await updateWorkspaceLocal(db, activeWorkspaceId, { accent });
    toast.success("Workspace accent updated");
  };

  const setRetention = async (days: number) => {
    if (!db || !activeWorkspaceId) return;
    if (
      days !== 0 &&
      !window.confirm(
        `Permanently remove trash older than ${days} days? Deleted notes, canvases, decks, and captures past that age cannot be recovered.`,
      )
    ) {
      return;
    }
    await updateWorkspaceLocal(db, activeWorkspaceId, { trashRetentionDays: days });
    toast.success(
      days === 0 ? "Trash is kept forever" : `Trash older than ${days} days will be purged`,
    );
  };

  const createIngestToken = async () => {
    try {
      const result = await client.workspace.createIngestToken();
      setNewIngestToken(result.token);
      await ingestToken.refetch();
      toast.success("Ingest token created — copy it now, it is shown once.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the ingest token");
    }
  };

  const revokeIngestToken = async () => {
    try {
      await client.workspace.revokeIngestToken();
      setNewIngestToken(null);
      await ingestToken.refetch();
      toast.success("Ingest token revoked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not revoke the ingest token");
    }
  };

  const copyIngestSetup = async () => {
    if (!newIngestToken) return;
    const setup = [
      `Endpoint: ${getApiBaseUrl()}/ingest/email`,
      `Header: x-lattice-ingest-token: ${newIngestToken}`,
      'Body: {"subject":"…","text":"…","from":"…"}',
    ].join("\n");
    try {
      await navigator.clipboard.writeText(setup);
      toast.success("Webhook setup copied");
    } catch {
      toast.error("Could not copy the setup");
    }
  };

  const invite = async () => {
    if (!inviteEmail.trim()) return;
    setBusy(true);
    try {
      const result = await client.workspace.invite({
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setInviteLink(`${window.location.origin}/invite?token=${encodeURIComponent(result.token)}`);
      setInviteEmail("");
      toast.success("Invite created. Copy the link to share it.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create invite");
    } finally {
      setBusy(false);
    }
  };

  const updateMemberRole = async (memberId: string, nextRole: Role) => {
    try {
      await client.workspace.updateMember({ memberId, role: nextRole });
      await queryClient.invalidateQueries({ queryKey: ["workspace-members", activeWorkspaceId] });
      toast.success("Role updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update role");
    }
  };

  const removeMember = async (memberId: string) => {
    if (!window.confirm("Remove this member from the workspace?")) return;
    try {
      await client.workspace.removeMember({ memberId });
      await queryClient.invalidateQueries({ queryKey: ["workspace-members", activeWorkspaceId] });
      toast.success("Member removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove member");
    }
  };

  const exportWorkspace = async () => {
    if (!db || !activeWorkspaceId) return;
    const data = await exportWorkspaceLocal(db, activeWorkspaceId);
    downloadTextFile(
      `${(activeWorkspace?.name ?? "lattice").toLowerCase().replace(/\s+/g, "-")}-export.json`,
      JSON.stringify(data, null, 2),
    );
    toast.success("Workspace exported as JSON");
  };

  const exportVault = async () => {
    if (!db || !activeWorkspaceId) return;
    const [pages, documents, notebooks, tags, pageTags] = await Promise.all([
      db.pages.where("workspaceId").equals(activeWorkspaceId).toArray(),
      db.pageDocuments.where("workspaceId").equals(activeWorkspaceId).toArray(),
      db.notebooks.where("workspaceId").equals(activeWorkspaceId).toArray(),
      db.tags.where("workspaceId").equals(activeWorkspaceId).toArray(),
      db.pageTags.toArray(),
    ]);
    const documentByPage = new Map(documents.map((document) => [document.pageId, document.content]));
    const tagById = new Map(tags.map((tag) => [tag.id, tag.name]));
    const tagsByPage = new Map<string, string[]>();
    for (const link of pageTags) {
      const name = tagById.get(link.tagId);
      if (!name) continue;
      const list = tagsByPage.get(link.pageId) ?? [];
      list.push(name);
      tagsByPage.set(link.pageId, list);
    }
    const files = exportVaultMarkdown({
      pages: pages
        .filter((page) => !page.deletedAt)
        .map((page) => ({
          id: page.id,
          title: page.title,
          icon: page.icon,
          notebookId: page.notebookId,
          updatedAt: page.updatedAt,
          content: documentByPage.get(page.id) ?? null,
          tags: tagsByPage.get(page.id) ?? [],
        })),
      notebooks: notebooks
        .filter((notebook) => !notebook.deletedAt)
        .map((notebook) => ({
          id: notebook.id,
          name: notebook.name,
          parentId: notebook.parentId,
        })),
    });
    if (!files.length) {
      toast.error("There are no pages to export yet.");
      return;
    }
    const archive = zipSync(
      Object.fromEntries(files.map((file) => [file.path, strToU8(file.markdown)])),
      { level: 6 },
    );
    downloadBytes(
      `${(activeWorkspace?.name ?? "lattice").toLowerCase().replace(/\s+/g, "-")}-vault.zip`,
      archive,
      "application/zip",
    );
    toast.success(`Exported ${files.length} Markdown files`);
  };

  const requestPersistence = async () => {
    if (!navigator.storage?.persist) return;
    const granted = await navigator.storage.persist();
    setPersisted(granted);
    toast.success(granted ? "Persistent local storage granted" : "Browser declined persistent storage");
  };

  const registerDevice = async () => {
    if (!user) return;
    const id = window.localStorage.getItem("lattice.deviceId") ?? createId();
    window.localStorage.setItem("lattice.deviceId", id);
    try {
      await client.device.register({
        deviceId: id,
        name: deviceName.trim() || "Browser",
        platform: navigator.platform || "web",
      });
      setDeviceName("");
      await devices.refetch();
      toast.success("Device registered");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not register device");
    }
  };

  const removeDevice = async (deviceId: string) => {
    try {
      await client.device.remove({ deviceId });
      await devices.refetch();
      toast.success("Device removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the device");
    }
  };

  const signOut = async () => {
    await authClient.signOut();
    router.push("/");
  };

  if (!activeWorkspace) return null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-8 md:flex-row md:px-8">
      <aside className="w-full shrink-0 md:w-48">
        <div className="mb-4">
          <h1 className="font-display text-3xl tracking-[-0.03em]">Settings</h1>
          <p className="mt-1 text-[9px] text-muted-foreground">{activeWorkspace.name}</p>
        </div>
        <nav className="space-y-0.5">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                tab === entry.id && "bg-muted text-foreground",
              )}
            >
              <entry.icon className="size-3.5" />
              {entry.label}
            </button>
          ))}
        </nav>
        <div className="mt-4 rounded-lg border border-border/60 bg-card/40 p-2.5">
          <div className="flex items-center gap-1.5 text-[9px]">
            <span className={cn("status-dot", online ? "bg-moss" : "bg-saffron")} />
            {online ? "Sync available" : "Offline mode"}
          </div>
          <div className="mt-1 text-[8px] text-muted-foreground">
            {syncState.pending} local changes queued
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {tab === "general" ? (
          <section className="space-y-4">
            <SettingsCard title="Workspace identity" description="How this workspace appears across Lattice.">
              <div className="flex gap-3">
                <div className="w-16">
                  <label className="mb-1 block text-[9px] text-muted-foreground">Icon</label>
                  <Input
                    value={icon}
                    onChange={(event) => setIcon(event.target.value.slice(0, 4))}
                    className="h-9 rounded-lg text-center text-lg"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-[9px] text-muted-foreground">Name</label>
                  <Input value={name} onChange={(event) => setName(event.target.value)} className="h-9 rounded-lg text-[12px]" />
                </div>
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-[9px] text-muted-foreground">Description</label>
                <Input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What lives in this workspace?"
                  className="h-9 rounded-lg text-[11px]"
                />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" className="h-8 rounded-lg text-[10px]" disabled={busy} onClick={() => void saveGeneral()}>
                  Save changes
                </Button>
                <span className="text-[8px] text-muted-foreground">
                  Stored locally, synced when online.
                </span>
              </div>
            </SettingsCard>

            <SettingsCard
              title="Trash retention"
              description="How long soft-deleted notes, canvases, decks, and captures stay recoverable."
            >
              <div className="flex flex-wrap gap-1.5">
                {RETENTION_OPTIONS.map((days) => (
                  <Button
                    key={days}
                    variant={(activeWorkspace?.trashRetentionDays ?? 0) === days ? "default" : "outline"}
                    size="sm"
                    className="h-8 rounded-lg text-[10px]"
                    disabled={!["OWNER", "ADMIN"].includes(role ?? "")}
                    onClick={() => void setRetention(days)}
                  >
                    {days === 0 ? "Keep forever" : `${days} days`}
                  </Button>
                ))}
              </div>
              <p className="mt-2 text-[9px] leading-relaxed text-muted-foreground">
                The server purges trash past the window on a schedule and records tombstones so every
                device reflects it. There is deliberately no manual purge button: a client that
                dropped rows locally would disagree with the server and resurrect content on the
                next pull.
              </p>
            </SettingsCard>

            <SettingsCard
              title="Email capture"
              description="Point an email provider's inbound webhook at Lattice and forwarded mail lands in the inbox."
            >
              {!online ? (
                <OfflineNotice />
              ) : ingestToken.isLoading ? (
                <LoadingRow />
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span
                      className={cn(
                        "status-dot",
                        ingestToken.data?.active ? "bg-moss" : "bg-saffron",
                      )}
                    />
                    {ingestToken.data?.active
                      ? `Token active since ${new Date(ingestToken.data.createdAt ?? "").toLocaleDateString()}`
                      : "No ingest token yet"}
                  </div>

                  {newIngestToken ? (
                    <div className="rounded-lg border border-saffron/30 bg-saffron/[0.05] p-2.5">
                      <div className="text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                        Endpoint
                      </div>
                      <code className="mt-0.5 block break-all font-mono text-[9px]">
                        {getApiBaseUrl()}/ingest/email
                      </code>
                      <div className="mt-1.5 text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                        Header
                      </div>
                      <code className="mt-0.5 block break-all font-mono text-[9px]">
                        x-lattice-ingest-token: {newIngestToken}
                      </code>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          className="h-7 rounded-md text-[9px]"
                          onClick={() => void copyIngestSetup()}
                        >
                          Copy setup
                        </Button>
                        <span className="text-[8px] text-muted-foreground">
                          Shown once. Rotate the token if you lose it.
                        </span>
                      </div>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-md text-[9px]"
                      disabled={!["OWNER", "ADMIN"].includes(role ?? "")}
                      onClick={() => void createIngestToken()}
                    >
                      {ingestToken.data?.active ? "Rotate token" : "Generate token"}
                    </Button>
                    {ingestToken.data?.active ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 rounded-md text-[9px] text-destructive"
                        disabled={!["OWNER", "ADMIN"].includes(role ?? "")}
                        onClick={() => void revokeIngestToken()}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </div>

                  <p className="text-[8px] leading-relaxed text-muted-foreground">
                    The provider POSTs JSON with any of <span className="font-mono">subject</span>,{" "}
                    <span className="font-mono">text</span>, <span className="font-mono">html</span>,{" "}
                    <span className="font-mono">from</span>, and{" "}
                    <span className="font-mono">to</span>. Each email becomes an EMAIL capture in the
                    inbox, and the token is stored only as a hash.
                  </p>
                </div>
              )}
            </SettingsCard>

            <SettingsCard title="Workspaces" description="Switch or create another context.">
              <div className="space-y-1">
                {workspaces.map((workspace) => (
                  <div key={workspace.id} className="flex items-center gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-1.5">
                    <span className="text-[10px]">{workspace.icon ?? "◇"}</span>
                    <span className="min-w-0 flex-1 truncate text-[10px]">{workspace.name}</span>
                    <span className="text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
                      {workspace.type === "ORGANIZATION" ? "Organization" : "Personal"}
                    </span>
                    {workspace.id === activeWorkspaceId ? <Check className="size-3 text-moss" /> : null}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <Button variant="outline" size="sm" className="h-7 rounded-md text-[9px]" onClick={() => void refreshWorkspaces()}>
                  <RefreshCw className="size-3" /> Refresh
                </Button>
                <Button variant="outline" size="sm" className="h-7 rounded-md text-[9px]" onClick={() => void exportWorkspace()}>
                  <Download className="size-3" /> Export this workspace
                </Button>
                <Button variant="outline" size="sm" className="h-7 rounded-md text-[9px]" onClick={() => void exportVault()}>
                  <FolderUp className="size-3" /> Export Markdown vault
                </Button>
              </div>
            </SettingsCard>

            <SettingsCard title="Account" description="Your identity and local session.">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-full bg-moss/15 text-[11px] font-semibold text-moss">
                  {user?.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-medium">{user?.name}</div>
                  <div className="truncate text-[9px] text-muted-foreground">{user?.email}</div>
                </div>
                <Button variant="outline" size="sm" className="h-7 rounded-md text-[9px]" onClick={() => void signOut()}>
                  <LogOut className="size-3" /> Sign out
                </Button>
              </div>
            </SettingsCard>
          </section>
        ) : null}

        {tab === "appearance" ? (
          <section className="space-y-4">
            <SettingsCard title="Theme" description="Applies to this device immediately.">
              <div className="flex gap-1.5">
                {(["light", "dark", "system"] as const).map((value) => (
                  <Button
                    key={value}
                    variant={theme === value ? "default" : "outline"}
                    size="sm"
                    className="h-8 rounded-lg text-[10px] capitalize"
                    onClick={() => setTheme(value)}
                  >
                    {value}
                  </Button>
                ))}
              </div>
            </SettingsCard>
            <SettingsCard
              title="Workspace accent"
              description="Used for the workspace badge and identity accents."
            >
              <div className="flex flex-wrap gap-1.5">
                {["#e07a2e", "#2f6b4f", "#3b82f6", "#8b5cf6", "#dc2626", "#0891b2", "#db2777"].map(
                  (color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Set accent ${color}`}
                      onClick={() => void setAccent(color)}
                      className={cn(
                        "size-7 rounded-full border-2 transition-transform hover:scale-105",
                        activeWorkspace?.accent === color ? "border-foreground" : "border-transparent",
                      )}
                      style={{ background: color }}
                    />
                  ),
                )}
              </div>
              <p className="mt-2 text-[9px] text-muted-foreground">
                Current: {activeWorkspace?.accent ?? "default"}
              </p>
            </SettingsCard>
          </section>
        ) : null}

        {tab === "members" ? (
          <section className="space-y-4">
            <SettingsCard title="Members" description="Roles control what each person can read and change.">
              {!online ? (
                <OfflineNotice />
              ) : members.isLoading ? (
                <LoadingRow />
              ) : (
                <div className="space-y-1">
                  {members.data?.map((member) => (
                    <div key={member.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-1.5">
                      <span className="grid size-6 place-items-center rounded-full bg-sky/15 text-[8px] font-semibold text-sky">
                        {member.user.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[10px]">{member.user.name}</div>
                        <div className="truncate text-[8px] text-muted-foreground">{member.user.email}</div>
                      </div>
                      {["OWNER", "ADMIN"].includes(role ?? "") && member.role !== "OWNER" ? (
                        <select
                          value={member.role}
                          onChange={(event) => void updateMemberRole(member.id, event.target.value as Role)}
                          className="h-6 rounded border border-border bg-transparent px-1 text-[8px]"
                        >
                          {ROLES.filter((entry) => entry !== "OWNER").map((entry) => (
                            <option key={entry} value={entry}>
                              {entry}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="rounded border border-border px-1.5 py-0.5 text-[8px] text-muted-foreground">
                          {member.role}
                        </span>
                      )}
                      {["OWNER", "ADMIN"].includes(role ?? "") && member.role !== "OWNER" ? (
                        <button
                          type="button"
                          aria-label="Remove member"
                          onClick={() => void removeMember(member.id)}
                          className="grid size-5 place-items-center rounded text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="size-2.5" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </SettingsCard>

            {["OWNER", "ADMIN"].includes(role ?? "") ? (
              <SettingsCard title="Invite someone" description="Invites are scoped to this workspace and expire in 14 days.">
                <div className="flex flex-wrap gap-2">
                  <Input
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="teammate@example.com"
                    type="email"
                    className="h-8 min-w-48 flex-1 rounded-md text-[10px]"
                  />
                  <select
                    value={inviteRole}
                    onChange={(event) => setInviteRole(event.target.value as Role)}
                    className="h-8 rounded-md border border-border bg-background px-2 text-[9px]"
                  >
                    {ROLES.filter((entry) => entry !== "OWNER" && entry !== "ADMIN").map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" className="h-8 rounded-md text-[9px]" disabled={busy || !inviteEmail.trim()} onClick={() => void invite()}>
                    <Plus className="size-3" /> Create invite
                  </Button>
                </div>
                {inviteLink ? (
                  <div className="mt-2 rounded-md border border-moss/25 bg-moss/[0.05] p-2">
                    <div className="text-[8px] text-moss">Invite link</div>
                    <div className="mt-1 flex gap-1">
                      <Input value={inviteLink} readOnly className="h-7 rounded text-[8px]" />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 rounded px-2 text-[8px]"
                        onClick={() => void navigator.clipboard.writeText(inviteLink)}
                      >
                        Copy
                      </Button>
                    </div>
                  </div>
                ) : null}
              </SettingsCard>
            ) : null}
          </section>
        ) : null}

        {tab === "sync" ? (
          <section className="space-y-4">
            <SettingsCard title="Sync status" description="Your local store is authoritative; the server is a sync authority.">
              <div className="grid gap-2 sm:grid-cols-3">
                <Stat label="Connection" value={online ? "Online" : "Offline"} tone={online ? "moss" : "saffron"} />
                <Stat label="Pending changes" value={String(syncState.pending)} tone={syncState.pending ? "saffron" : "moss"} />
                <Stat label="Conflicts" value={String(syncState.conflicts)} tone={syncState.conflicts ? "rose" : "moss"} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="h-7 rounded-md text-[9px]" onClick={() => void retrySync()}>
                  <RefreshCw className="size-3" /> Sync now
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-md text-[9px]"
                  onClick={() => void refreshWorkspace(activeWorkspaceId ?? "")}
                >
                  Pull latest
                </Button>
                <Button variant="outline" size="sm" className="h-7 rounded-md text-[9px]" onClick={() => void exportWorkspace()}>
                  <Download className="size-3" /> Export JSON
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-md text-[9px]"
                  onClick={() => importRef.current?.click()}
                >
                  <ArrowUpRight className="size-3" /> Import JSON
                </Button>
                <input
                  ref={importRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file || !db || !activeWorkspaceId) return;
                    try {
                      const parsed = JSON.parse(await file.text()) as LocalExport;
                      if (parsed.workspaceId !== activeWorkspaceId) {
                        throw new Error("This export belongs to a different workspace.");
                      }
                      await importWorkspaceLocal(db, parsed);
                      await retrySync();
                      toast.success("Workspace imported. Reconciliation is queued.");
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Could not import this file");
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-md text-[9px]"
                  onClick={() => setGithubOpen(true)}
                >
                  <GitBranch className="size-3" /> Import from GitHub
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-md text-[9px]"
                  onClick={() => setVaultOpen(true)}
                >
                  <FolderUp className="size-3" /> Import a vault
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-md text-[9px]"
                  onClick={() => setGitOpen(true)}
                >
                  <RefreshCw className="size-3" /> Sync with Git
                </Button>
              </div>
              <p className="mt-2 text-[8px] text-muted-foreground">
                Last sync {syncState.lastSyncedAt ? new Date(syncState.lastSyncedAt).toLocaleString() : "not yet"}.
                Conflicts are preserved in version history and never overwritten silently.
              </p>
            </SettingsCard>

            <SettingsCard title="Local persistence" description="Browsers may evict storage unless you grant persistence.">
              <div className="flex items-center gap-2">
                <span className={cn("status-dot", persisted ? "bg-moss" : "bg-saffron")} />
                <span className="text-[10px]">
                  {persisted === null ? "Checking…" : persisted ? "Persistent storage granted" : "Best-effort storage"}
                </span>
                <Button variant="outline" size="sm" className="ml-auto h-7 rounded-md text-[9px]" onClick={() => void requestPersistence()}>
                  <HardDrive className="size-3" /> Request persistence
                </Button>
              </div>
              <div className="mt-3 rounded-md border border-border/60 bg-muted/20 p-2 text-[8.5px] leading-relaxed text-muted-foreground">
                Lattice keeps a full local copy of this workspace in IndexedDB. Export regularly, or use a
                sync server for backup. Attachments are stored on the server when uploaded.
              </div>
            </SettingsCard>
          </section>
        ) : null}

        {tab === "ai" ? (
          <section className="space-y-4">
            <SettingsCard title="Intelligence layer" description="Optional. Works without AI, with clear local fallback.">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-lg border border-border/60 bg-card">
                  <Sparkles className="size-3.5 text-saffron" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-medium">
                    {aiStatus.data?.enabled ? "Provider connected" : "Local retrieval mode"}
                  </div>
                  <div className="text-[8px] text-muted-foreground">
                    {aiStatus.data?.enabled
                      ? `Model: ${aiStatus.data.model}`
                      : "Configure AI_BASE_URL, AI_API_KEY, and AI_MODEL on the server."}
                  </div>
                </div>
                {aiStatus.data?.enabled ? <Check className="size-3.5 text-moss" /> : <WifiOff className="size-3.5 text-saffron" />}
              </div>
              <ul className="mt-3 space-y-1 text-[9px] text-muted-foreground">
                <li>• Answers always cite the source pages.</li>
                <li>• AI never edits your notes without an explicit Apply action.</li>
                <li>• Local mode uses token overlap and graph structure, not external calls.</li>
              </ul>
            </SettingsCard>
          </section>
        ) : null}

        {tab === "devices" ? (
          <section className="space-y-4">
            <SettingsCard title="Devices" description="Devices that have accessed your account.">
              {!online ? <OfflineNotice /> : null}
              <div className="space-y-1">
                {devices.data?.map((device) => (
                  <div key={device.id} className="flex items-center gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-1.5">
                    <Monitor className="size-3.5 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-[10px]">{device.name}</span>
                    <span className="text-[8px] text-muted-foreground">{device.platform}</span>
                    <span className="text-[8px] text-muted-foreground">
                      {new Date(device.lastSeenAt).toLocaleDateString()}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${device.name}`}
                      title="Remove device"
                      onClick={() => void removeDevice(device.id)}
                      className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))}
                {!devices.data?.length ? (
                  <p className="py-4 text-center text-[9px] text-muted-foreground">No registered devices yet.</p>
                ) : null}
              </div>
              <div className="mt-3 flex gap-2">
                <Input
                  value={deviceName}
                  onChange={(event) => setDeviceName(event.target.value)}
                  placeholder="This device's name"
                  className="h-8 rounded-md text-[10px]"
                />
                <Button size="sm" className="h-8 rounded-md text-[9px]" onClick={() => void registerDevice()}>
                  Register
                </Button>
              </div>
            </SettingsCard>
          </section>
        ) : null}

        {tab === "audit" ? (
          <section className="space-y-4">
            <SettingsCard title="Audit log" description="Workspace-level actions recorded on the server.">
              {!["OWNER", "ADMIN"].includes(role ?? "") ? (
                <p className="py-4 text-[10px] text-muted-foreground">Only owners and admins can view the audit log.</p>
              ) : !online ? (
                <OfflineNotice />
              ) : audit.isLoading ? (
                <LoadingRow />
              ) : audit.data?.length ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[8.5px] text-muted-foreground">
                      {audit.data.length} {audit.data.length === 1 ? "entry" : "entries"}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-md text-[9px]"
                      onClick={() => {
                        const rows = audit.data ?? [];
                        downloadTextFile(
                          auditExportFilename(activeWorkspace.name),
                          auditLogToCsv(
                            rows.map((entry) => ({
                              createdAt: entry.createdAt,
                              action: entry.action,
                              resourceType: entry.resourceType,
                              resourceId: entry.resourceId,
                              actorId: entry.actorId,
                              metadata: entry.metadata as Record<string, unknown> | null,
                            })),
                          ),
                          "text/csv;charset=utf-8",
                        );
                        toast.success(`Exported ${rows.length} entries.`);
                      }}
                    >
                      <Download className="size-3" /> Export CSV
                    </Button>
                  </div>
                  <div className="max-h-[55vh] space-y-1 overflow-y-auto">
                  {audit.data.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-1.5">
                      <span className="mt-1 size-1.5 rounded-full bg-saffron" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px]">{entry.action}</div>
                        <div className="text-[8px] text-muted-foreground">
                          {entry.resourceType} · {new Date(entry.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <ArrowUpRight className="size-2.5 text-muted-foreground/40" />
                    </div>
                  ))}
                  </div>
                </div>
              ) : (
                <p className="py-4 text-center text-[9px] text-muted-foreground">No audit entries yet.</p>
              )}
            </SettingsCard>
          </section>
        ) : null}

        {tab === "query" ? (
          !online ? (
            <section className="space-y-4">
              <SettingsCard title="Query" description="Run read-only SQL against this workspace.">
                <OfflineNotice />
              </SettingsCard>
            </section>
          ) : (
            <section className="space-y-4">
              <SqlConsolePanel />
            </section>
          )
        ) : null}

        {tab === "plugins" ? (
          <section className="space-y-4">
            <PluginManager />
          </section>
        ) : null}

        {tab === "duplicates" ? (
          <section className="space-y-4">
            <DuplicateReviewPanel />
          </section>
        ) : null}

        <div className="mt-6 flex items-center justify-between border-t border-border/60 pt-3 text-[8px] text-muted-foreground">
          <span>{activeWorkspace.name} · {activeWorkspace.type.toLowerCase()}</span>
          <button type="button" onClick={() => router.push(appRouteObject({ view: "home" }))} className="hover:text-foreground">
            Back home
          </button>
        </div>
      </div>

      <GithubImportDialog open={githubOpen} onClose={() => setGithubOpen(false)} />
      <VaultImportDialog open={vaultOpen} onClose={() => setVaultOpen(false)} />
      <GitSyncDialog open={gitOpen} onClose={() => setGitOpen(false)} />
    </div>
  );
}

function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/35 p-4">
      <h2 className="text-[12px] font-semibold tracking-[-0.01em]">{title}</h2>
      <p className="mt-0.5 text-[9px] leading-relaxed text-muted-foreground">{description}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "moss" | "saffron" | "rose" }) {
  const colors = { moss: "text-moss", saffron: "text-saffron", rose: "text-rose" };
  return (
    <div className="rounded-lg border border-border/60 bg-background/50 px-2.5 py-2">
      <div className={cn("text-[15px] font-semibold", colors[tone])}>{value}</div>
      <div className="text-[8px] uppercase tracking-[0.1em] text-muted-foreground">{label}</div>
    </div>
  );
}

function OfflineNotice() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-saffron/25 bg-saffron/[0.05] px-2.5 py-2 text-[9px] text-muted-foreground">
      <WifiOff className="size-3 text-saffron" />
      This section needs a sync server connection.
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center gap-2 py-4 text-[10px] text-muted-foreground">
      <Loader2 className="size-3 animate-spin" /> Loading…
    </div>
  );
}
