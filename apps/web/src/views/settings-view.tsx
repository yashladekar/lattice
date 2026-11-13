"use client";

import { auditExportFilename, auditLogToCsv, createId, exportVaultMarkdown, formatRelative, RETENTION_OPTIONS, type Role } from "@notes-learning/domain";
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
  GitPullRequest,
  HardDrive,
  Loader2,
  LogOut,
  Monitor,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Scale,
  Shapes,
  Shield,
  Sparkles,
  Trash2,
  Users,
  Webhook,
  WifiOff,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { GithubConnectionCard } from "@/components/workspace/github-connection";
import { GithubImportDialog } from "@/components/workspace/github-import";
import { GitSyncDialog } from "@/components/workspace/git-sync-dialog";
import { VaultImportDialog } from "@/components/workspace/vault-import";
import { SqlConsolePanel } from "@/components/workspace/sql-console-panel";
import { PluginManager } from "@/components/workspace/plugin-manager";
import { DuplicateReviewPanel } from "@/components/workspace/duplicate-review";
import { ReviewQueue } from "@/components/workspace/review-queue";
import { ObjectTypeManager } from "@/components/workspace/object-type-manager";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { WebhookManager } from "@/components/workspace/webhook-manager";
import { authClient } from "@/lib/auth-client";
import { getApiBaseUrl } from "@/lib/config";
import { downloadBytes, downloadTextFile } from "@/lib/download";
import { openExternalUrl } from "@/lib/open-external";
import { useWorkspaceNotebooks, useWorkspacePages } from "@/hooks/use-local-data";
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
  | "reviews"
  | "types"
  | "sync"
  | "ai"
  | "webhooks"
  | "devices"
  | "legal"
  | "audit"
  | "query"
  | "plugins"
  | "duplicates";

const TABS: Array<{ id: SettingsTab; label: string; icon: typeof Cloud }> = [
  { id: "general", label: "General", icon: HardDrive },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "members", label: "Members", icon: Users },
  { id: "reviews", label: "Reviews", icon: GitPullRequest },
  { id: "types", label: "Object types", icon: Shapes },
  { id: "sync", label: "Sync & backup", icon: Cloud },
  { id: "ai", label: "Intelligence", icon: Brain },
  { id: "webhooks", label: "Automations", icon: Webhook },
  { id: "devices", label: "Devices", icon: Monitor },
  { id: "legal", label: "Legal", icon: Scale },
  { id: "audit", label: "Audit log", icon: Shield },
  { id: "query", label: "Query", icon: Database },
  { id: "plugins", label: "Plugins", icon: Boxes },
  { id: "duplicates", label: "Duplicates", icon: CopyCheck },
];

const ROLES: Role[] = ["OWNER", "ADMIN", "MEMBER", "EDITOR", "VIEWER", "GUEST"];

type ChatSource = "auto" | "chatgpt" | "workspace" | "deployment";

const CHAT_SOURCE_CHOICES: Array<{ value: ChatSource; label: string; hint: string }> = [
  { value: "auto", label: "Automatic", hint: "Your ChatGPT plan, then the workspace provider, then deployment." },
  { value: "chatgpt", label: "ChatGPT plan", hint: "Always use your ChatGPT plan for chat." },
  { value: "workspace", label: "Workspace provider", hint: "Always use this workspace's API key." },
  { value: "deployment", label: "Deployment provider", hint: "Always use the server's AI_API_KEY." },
];

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
  const scimTokens = useQuery({
    queryKey: ["workspace-scim-tokens", activeWorkspaceId],
    queryFn: async () => client.workspace.scimTokens(),
    enabled: online && Boolean(activeWorkspaceId),
  });
  const ssoConnection = useQuery({
    queryKey: ["workspace-sso", activeWorkspaceId],
    queryFn: async () => client.workspace.ssoConnection(),
    enabled: online && Boolean(activeWorkspaceId),
  });
  const legalHolds = useQuery({
    queryKey: ["workspace-legal-holds", activeWorkspaceId],
    queryFn: async () => client.workspace.legalHolds(),
    enabled: online && Boolean(activeWorkspaceId),
  });
  const aiConfig = useQuery({
    queryKey: ["workspace-ai-config", activeWorkspaceId],
    queryFn: async () => client.workspace.aiConfig(),
    enabled: online && Boolean(activeWorkspaceId),
  });
  const embeddingStatus = useQuery({
    queryKey: ["ai-embeddings", activeWorkspaceId],
    queryFn: async () => client.ai.embeddingStatus(),
    enabled: online && Boolean(activeWorkspaceId),
  });
  const chatgpt = useQuery({
    queryKey: ["chatgpt-status", user?.id, activeWorkspaceId],
    queryFn: async () => client.chatgpt.status(),
    enabled: online && Boolean(user) && Boolean(activeWorkspaceId),
  });
  const chatgptModels = useQuery({
    queryKey: ["chatgpt-models", user?.id],
    queryFn: async () => client.chatgpt.models(),
    enabled: online && Boolean(user) && Boolean(chatgpt.data?.connected),
  });
  const [newIngestToken, setNewIngestToken] = useState<string | null>(null);
  const [scimName, setScimName] = useState("Identity provider");
  const [newScimToken, setNewScimToken] = useState<string | null>(null);
  const [ssoIssuer, setSsoIssuer] = useState("");
  const [ssoClientId, setSsoClientId] = useState("");
  const [ssoSecret, setSsoSecret] = useState("");
  const [ssoDomains, setSsoDomains] = useState("");
  const [ssoEnabled, setSsoEnabled] = useState(true);
  const [holdScope, setHoldScope] = useState<"WORKSPACE" | "NOTEBOOK" | "PAGE">("WORKSPACE");
  const [holdTarget, setHoldTarget] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiEmbeddingModel, setAiEmbeddingModel] = useState("");
  const [aiTranscribeModel, setAiTranscribeModel] = useState("");
  const [aiKey, setAiKey] = useState("");
  const legalNotebooks = useWorkspaceNotebooks();
  const legalPages = useWorkspacePages();
  const [pendingRetention, setPendingRetention] = useState<number | null>(null);
  const [pendingMember, setPendingMember] = useState<{ id: string; name: string } | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [chatgptBusy, setChatgptBusy] = useState(false);
  const chatgptCredentialInput = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();
  const chatgptRedirect = searchParams?.get("chatgpt") ?? null;
  const handledChatGptRedirect = useRef<string | null>(null);
  const requestedTab = searchParams?.get("tab") ?? null;

  useEffect(() => {
    const match = TABS.find((entry) => entry.id === requestedTab);
    if (match) setTab(match.id);
  }, [requestedTab]);

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
    if (days !== 0) {
      setPendingRetention(days);
      return;
    }
    await applyRetention(days);
  };

  const applyRetention = async (days: number) => {
    if (!db || !activeWorkspaceId) return;
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

  const createScimToken = async () => {
    if (!scimName.trim()) return;
    try {
      const result = await client.workspace.createScimToken({ name: scimName.trim() });
      setNewScimToken(result.token);
      await scimTokens.refetch();
      toast.success("SCIM token created — copy it now, it is shown once.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the SCIM token");
    }
  };

  const revokeScimToken = async (id: string) => {
    try {
      await client.workspace.revokeScimToken({ id });
      setNewScimToken(null);
      await scimTokens.refetch();
      toast.success("SCIM token revoked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not revoke the SCIM token");
    }
  };

  useEffect(() => {
    const connection = ssoConnection.data;
    if (!connection) return;
    setSsoIssuer(connection.issuer);
    setSsoClientId(connection.clientId);
    setSsoDomains(connection.domains.join(", "));
    setSsoEnabled(connection.enabled);
    setSsoSecret("");
  }, [ssoConnection.data]);

  const saveSso = async () => {
    try {
      await client.workspace.saveSsoConnection({
        issuer: ssoIssuer,
        clientId: ssoClientId,
        ...(ssoSecret.trim() ? { clientSecret: ssoSecret.trim() } : {}),
        domains: ssoDomains
          .split(",")
          .map((domain) => domain.trim())
          .filter(Boolean),
        enabled: ssoEnabled,
      });
      setSsoSecret("");
      await ssoConnection.refetch();
      toast.success("Single sign-on saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the SSO connection");
    }
  };

  const removeSso = async () => {
    try {
      await client.workspace.removeSsoConnection();
      await ssoConnection.refetch();
      toast.success("Single sign-on removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the SSO connection");
    }
  };

  const createLegalHold = async () => {
    try {
      await client.workspace.createLegalHold({
        scope: holdScope,
        targetId: holdScope === "WORKSPACE" ? null : holdTarget || null,
        reason: holdReason,
      });
      setHoldReason("");
      setHoldTarget("");
      await legalHolds.refetch();
      toast.success("Legal hold created — the purge will skip this content");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the hold");
    }
  };

  const releaseLegalHold = async (id: string) => {
    try {
      await client.workspace.releaseLegalHold({ id });
      await legalHolds.refetch();
      toast.success("Hold released");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not release the hold");
    }
  };

  const downloadLegalExport = async () => {
    try {
      const bundle = await client.workspace.legalExport();
      downloadTextFile(
        `lattice-legal-export-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(bundle, null, 2),
      );
      const total = Object.values(bundle.counts).reduce((sum, count) => sum + count, 0);
      toast.success(
        `Exported ${total.toLocaleString()} records${bundle.truncated.length ? ` (${bundle.truncated.join(", ")} truncated)` : ""}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not build the export");
    }
  };

  useEffect(() => {
    const config = aiConfig.data;
    if (!config) return;
    setAiBaseUrl(config.baseUrl);
    setAiModel(config.model);
    setAiEmbeddingModel(config.embeddingModel);
    setAiTranscribeModel(config.transcribeModel);
    setAiKey("");
  }, [aiConfig.data]);

  const saveAiProvider = async () => {
    try {
      await client.workspace.saveAiConfig({
        baseUrl: aiBaseUrl,
        ...(aiKey.trim() ? { apiKey: aiKey.trim() } : {}),
        model: aiModel,
        embeddingModel: aiEmbeddingModel,
        transcribeModel: aiTranscribeModel,
      });
      setAiKey("");
      await Promise.all([aiConfig.refetch(), embeddingStatus.refetch()]);
      toast.success("Workspace AI credentials saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the AI credentials");
    }
  };

  const removeAiProvider = async () => {
    try {
      await client.workspace.removeAiConfig();
      await Promise.all([aiConfig.refetch(), embeddingStatus.refetch()]);
      toast.success("Workspace AI credentials removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the AI credentials");
    }
  };

  const buildEmbeddingIndex = async () => {
    setIndexing(true);
    try {
      const result = await client.ai.reindex();
      await embeddingStatus.refetch();
      if (result.ok) {
        toast.success(`Indexed ${result.indexed} pages with ${result.model}`);
      } else {
        toast.error(result.reason);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not build the index");
    } finally {
      setIndexing(false);
    }
  };

  useEffect(() => {
    if (!chatgptRedirect || handledChatGptRedirect.current === chatgptRedirect) return;
    handledChatGptRedirect.current = chatgptRedirect;
    setTab("ai");
    if (chatgptRedirect === "connected") {
      toast.success("ChatGPT connected");
      void Promise.all([chatgpt.refetch(), chatgptModels.refetch(), aiStatus.refetch()]);
    } else if (chatgptRedirect === "denied") {
      toast.error("ChatGPT plan usage was not granted");
    } else if (chatgptRedirect === "error") {
      toast.error("The ChatGPT sign-in did not complete");
    }
  }, [chatgptRedirect]);

  const connectChatGpt = async (options: { consent?: boolean } = {}) => {
    setChatgptBusy(true);
    try {
      const result = await client.chatgpt.start(options);
      await openExternalUrl(result.authorizeUrl);
      toast.success("Finish signing in to ChatGPT in your browser.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start the ChatGPT sign-in",
      );
    } finally {
      setChatgptBusy(false);
    }
  };

  const disconnectChatGpt = async () => {
    setChatgptBusy(true);
    try {
      const result = await client.chatgpt.disconnect();
      await Promise.all([chatgpt.refetch(), aiStatus.refetch()]);
      toast.success(
        result.revoked
          ? "ChatGPT disconnected"
          : "ChatGPT disconnected locally — remote revocation was not confirmed.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disconnect ChatGPT");
    } finally {
      setChatgptBusy(false);
    }
  };

  const chooseChatGptModel = async (model: string) => {
    try {
      await client.chatgpt.setModel({ model });
      await Promise.all([chatgpt.refetch(), aiStatus.refetch()]);
      toast.success(`ChatGPT model set to ${model}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not set the model");
    }
  };

  const setChatSource = async (source: ChatSource) => {
    try {
      await client.chatgpt.setPreference({ source });
      await Promise.all([chatgpt.refetch(), aiStatus.refetch()]);
      toast.success("AI backend preference saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the preference");
    }
  };

  const exportChatGptCredential = async () => {
    try {
      const bundle = await client.chatgpt.exportCredential();
      downloadTextFile(
        `lattice-chatgpt-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(bundle, null, 2),
      );
      toast.success("Credential file exported — store it like a password.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export the credential");
    }
  };

  const importChatGptCredential = async (file: File) => {
    setChatgptBusy(true);
    try {
      const parsed = JSON.parse(await file.text()) as Parameters<
        typeof client.chatgpt.importCredential
      >[0];
      await client.chatgpt.importCredential(parsed);
      await Promise.all([chatgpt.refetch(), chatgptModels.refetch(), aiStatus.refetch()]);
      toast.success("ChatGPT credential imported");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import the credential");
    } finally {
      setChatgptBusy(false);
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
        <ConfirmDialog
          open={pendingRetention !== null}
          title="Change the trash window?"
          description={
            pendingRetention
              ? `Deleted notes, canvases, decks, and captures older than ${pendingRetention} days will be permanently removed on the next purge and cannot be recovered.`
              : ""
          }
          confirmLabel="Change window"
          onClose={() => setPendingRetention(null)}
          onConfirm={async () => {
            const days = pendingRetention;
            setPendingRetention(null);
            if (days !== null) await applyRetention(days);
          }}
        />

        <ConfirmDialog
          open={pendingMember !== null}
          title="Remove this member?"
          description={
            pendingMember
              ? `${pendingMember.name} loses access to this workspace immediately. Their content stays.`
              : ""
          }
          confirmLabel="Remove"
          onClose={() => setPendingMember(null)}
          onConfirm={async () => {
            const member = pendingMember;
            setPendingMember(null);
            if (member) await removeMember(member.id);
          }}
        />

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
                          onClick={() => setPendingMember({ id: member.id, name: member.user.name })}
                          className="grid size-7 place-items-center rounded text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive tap-target"
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

            {["OWNER", "ADMIN"].includes(role ?? "") ? (
              <SettingsCard
                title="Provisioning (SCIM)"
                description="Point an identity provider at this endpoint to create, update, and deprovision members automatically. Group names map to roles: admin, editor/member, viewer; ownership is never granted."
              >
                <div className="rounded-lg border border-border/60 bg-background/50 p-2.5">
                  <div className="text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                    SCIM base URL
                  </div>
                  <code className="mt-0.5 block break-all font-mono text-[9px]">
                    {getApiBaseUrl()}/scim/v2
                  </code>
                  <div className="mt-1.5 text-[8px] text-muted-foreground">
                    Bearer token authentication · Users and Groups · PATCH supported
                  </div>
                </div>

                {newScimToken ? (
                  <div className="mt-2 rounded-lg border border-saffron/30 bg-saffron/[0.05] p-2.5">
                    <div className="text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                      Token (shown once)
                    </div>
                    <code className="mt-0.5 block break-all font-mono text-[9px]">{newScimToken}</code>
                    <div className="mt-1.5 flex gap-2">
                      <Button
                        size="sm"
                        className="h-6 rounded-md text-[8px]"
                        onClick={() => void navigator.clipboard.writeText(newScimToken)}
                      >
                        Copy token
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 rounded-md text-[8px]"
                        onClick={() => setNewScimToken(null)}
                      >
                        Done
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="mt-2 space-y-1">
                  {(scimTokens.data ?? []).length ? (
                    (scimTokens.data ?? []).map((token) => (
                      <div
                        key={token.id}
                        className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-1.5 text-[9px]"
                      >
                        <span className="min-w-0 flex-1 truncate">{token.name}</span>
                        <span className="text-muted-foreground">
                          {token.revokedAt
                            ? "revoked"
                            : token.lastUsedAt
                              ? `used ${formatRelative(token.lastUsedAt)}`
                              : "never used"}
                        </span>
                        {token.revokedAt ? null : (
                          <button
                            type="button"
                            aria-label={`Revoke ${token.name}`}
                            onClick={() => void revokeScimToken(token.id)}
                            className="grid size-7 place-items-center rounded text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive tap-target"
                          >
                            <Trash2 className="size-2.5" />
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-[9px] text-muted-foreground">
                      No tokens yet. Create one per identity provider so revocation stays scoped.
                    </p>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <Input
                    value={scimName}
                    onChange={(event) => setScimName(event.target.value)}
                    placeholder="Okta, Entra ID…"
                    className="h-8 min-w-40 flex-1 rounded-md text-[10px]"
                  />
                  <Button size="sm" className="h-8 rounded-lg text-[10px]" onClick={() => void createScimToken()}>
                    Create SCIM token
                  </Button>
                </div>
              </SettingsCard>
            ) : null}

            {["OWNER", "ADMIN"].includes(role ?? "") ? (
              <SettingsCard
                title="Single sign-on (OIDC)"
                description="Sign in through the workspace's identity provider. Register the redirect URI below at the provider, then save its issuer and client credentials."
              >
                <div className="rounded-lg border border-border/60 bg-background/50 p-2.5">
                  <div className="text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                    Redirect URI
                  </div>
                  <code className="mt-0.5 block break-all font-mono text-[9px]">
                    {getApiBaseUrl()}/api/auth/sso/callback
                  </code>
                  <div className="mt-1.5 text-[8px] text-muted-foreground">
                    {ssoConnection.data?.configured
                      ? `Configured${ssoConnection.data.enabled ? "" : " · disabled"} · ${ssoConnection.data.domains.join(", ") || "no domains"}`
                      : "Not configured"}
                  </div>
                </div>

                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                      Issuer URL
                    </span>
                    <Input
                      value={ssoIssuer}
                      onChange={(event) => setSsoIssuer(event.target.value)}
                      placeholder="https://login.example.com"
                      spellCheck={false}
                      className="h-8 rounded-md font-mono text-[10px]"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                      Client ID
                    </span>
                    <Input
                      value={ssoClientId}
                      onChange={(event) => setSsoClientId(event.target.value)}
                      spellCheck={false}
                      className="h-8 rounded-md font-mono text-[10px]"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                      Client secret
                    </span>
                    <Input
                      value={ssoSecret}
                      onChange={(event) => setSsoSecret(event.target.value)}
                      type="password"
                      placeholder={ssoConnection.data?.configured ? "Leave blank to keep" : ""}
                      className="h-8 rounded-md text-[10px]"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                      Email domains
                    </span>
                    <Input
                      value={ssoDomains}
                      onChange={(event) => setSsoDomains(event.target.value)}
                      placeholder="example.com, example.org"
                      className="h-8 rounded-md text-[10px]"
                    />
                  </label>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-[9.5px]">
                    <input
                      type="checkbox"
                      checked={ssoEnabled}
                      onChange={(event) => setSsoEnabled(event.target.checked)}
                      className="size-3 accent-[var(--moss)]"
                    />
                    Enabled
                  </label>
                  <Button size="sm" className="h-8 rounded-lg text-[10px]" onClick={() => void saveSso()}>
                    Save connection
                  </Button>
                  {ssoConnection.data?.configured ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg text-[10px] text-destructive"
                      onClick={() => void removeSso()}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
                <p className="mt-1.5 text-[8.5px] leading-relaxed text-muted-foreground">
                  Sign-in requires an active, provisioned membership; SCIM or an invite creates one.
                  The client secret is encrypted with the deployment secret before it is stored.
                </p>
              </SettingsCard>
            ) : null}
          </section>
        ) : null}

        {tab === "sync" ? (
          <section className="space-y-4">
            <GithubConnectionCard />

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
                    {aiStatus.data?.mode === "chatgpt"
                      ? "ChatGPT plan connected"
                      : aiStatus.data?.enabled
                        ? "Provider connected"
                        : "Local retrieval mode"}
                  </div>
                  <div className="text-[8px] text-muted-foreground">
                    {aiStatus.data?.enabled
                      ? `Model: ${aiStatus.data.model}`
                      : "Configure AI_BASE_URL, AI_API_KEY, and AI_MODEL on the server, or connect a ChatGPT plan below."}
                  </div>
                  {aiStatus.data?.degradedReason ? (
                    <div className="mt-0.5 text-[8px] text-saffron">
                      {aiStatus.data.degradedReason}
                    </div>
                  ) : null}
                  {aiStatus.data && !aiStatus.data.agent.enabled ? (
                    <div className="mt-0.5 text-[8px] text-muted-foreground">
                      Plan mode is off on this server. Set AI_AGENT_ENABLED=true to let the
                      assistant draft pages and propose edits.
                    </div>
                  ) : null}
                </div>
                {aiStatus.data?.enabled ? <Check className="size-3.5 text-moss" /> : <WifiOff className="size-3.5 text-saffron" />}
              </div>
              <ul className="mt-3 space-y-1 text-[9px] text-muted-foreground">
                <li>• Answers always cite the source pages.</li>
                <li>• AI never edits your notes without an explicit Apply action.</li>
                <li>• Local mode uses token overlap and graph structure, not external calls.</li>
              </ul>
            </SettingsCard>

            <SettingsCard
              title="ChatGPT plan"
              description="Use your own ChatGPT Plus or Pro plan for AI answers instead of an API key. Tokens stay on this server, encrypted, and never reach the browser."
            >
              {!online ? (
                <OfflineNotice />
              ) : !chatgpt.data ? (
                <LoadingRow />
              ) : !chatgpt.data.canConnect ? (
                <p className="text-[9px] text-muted-foreground">
                  This server cannot complete the ChatGPT sign-in callback.
                </p>
              ) : chatgpt.data.connected ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-[10px]">
                    <span
                      className={cn(
                        "status-dot",
                        chatgpt.data.planEnabled ? "bg-moss" : "bg-saffron",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[10px] font-medium">
                        {chatgpt.data.email ?? chatgpt.data.name ?? "ChatGPT account"}
                      </div>
                      <div className="text-[8px] text-muted-foreground">
                        {chatgpt.data.planEnabled
                          ? "ChatGPT plan usage is enabled"
                          : "Signed in, but plan usage was not granted"}
                      </div>
                    </div>
                  </div>

                  {chatgptModels.data?.models.length ? (
                    <div>
                      <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                        Model
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {chatgptModels.data.models.map((model) => (
                          <button
                            key={model.slug}
                            type="button"
                            onClick={() => void chooseChatGptModel(model.slug)}
                            className={cn(
                              "rounded-md border px-2 py-1 text-[9px]",
                              chatgpt.data?.model === model.slug
                                ? "border-saffron/60 bg-saffron/10 text-foreground"
                                : "border-border/60 bg-card text-muted-foreground hover:bg-muted/50",
                            )}
                          >
                            {model.displayName}
                          </button>
                        ))}
                      </div>
                      {chatgptModels.data.error ? (
                        <p className="mt-1 text-[8px] text-muted-foreground">
                          {chatgptModels.data.error}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <div>
                    <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                      Preferred AI backend
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {CHAT_SOURCE_CHOICES.map((choice) => (
                        <button
                          key={choice.value}
                          type="button"
                          title={choice.hint}
                          onClick={() => void setChatSource(choice.value)}
                          className={cn(
                            "rounded-md border px-2 py-1 text-[9px]",
                            (chatgpt.data?.preference ?? "auto") === choice.value
                              ? "border-saffron/60 bg-saffron/10 text-foreground"
                              : "border-border/60 bg-card text-muted-foreground hover:bg-muted/50",
                          )}
                        >
                          {choice.label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-[8px] text-muted-foreground">
                      {
                        CHAT_SOURCE_CHOICES.find(
                          (choice) => choice.value === (chatgpt.data?.preference ?? "auto"),
                        )?.hint
                      }
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-md text-[9px]"
                      disabled={chatgptBusy}
                      onClick={() => void connectChatGpt()}
                    >
                      Sign in again
                    </Button>
                    {!chatgpt.data.planEnabled ? (
                      <Button
                        size="sm"
                        className="h-7 rounded-md text-[9px]"
                        disabled={chatgptBusy}
                        onClick={() => void connectChatGpt({ consent: true })}
                      >
                        Enable plan usage
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-md text-[9px] text-destructive"
                      disabled={chatgptBusy}
                      onClick={() => void disconnectChatGpt()}
                    >
                      Disconnect
                    </Button>
                    <a
                      href="https://chatgpt.com/settings/usage"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[8px] text-link hover:underline"
                    >
                      Usage and limits
                    </a>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-md text-[9px]"
                      disabled={chatgptBusy}
                      onClick={() => void exportChatGptCredential()}
                    >
                      <Download className="size-3" /> Export credential
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-md text-[9px]"
                      disabled={chatgptBusy}
                      onClick={() => chatgptCredentialInput.current?.click()}
                    >
                      <FolderUp className="size-3" /> Import credential
                    </Button>
                    <input
                      ref={chatgptCredentialInput}
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void importChatGptCredential(file);
                      }}
                    />
                    <span className="text-[8px] text-muted-foreground">
                      Only needed when you run more than one Lattice server.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Button
                    size="sm"
                    className="h-8 rounded-lg text-[10px]"
                    disabled={chatgptBusy}
                    data-oai-siwc-button
                    onClick={() => void connectChatGpt()}
                  >
                    Continue with ChatGPT
                  </Button>
                  <p className="text-[8px] leading-relaxed text-muted-foreground">
                    Needs a ChatGPT Plus or Pro account. The sign-in completes against the Lattice
                    server on this computer, because OpenAI only accepts a loopback callback.
                  </p>
                  {chatgpt.data.lastError ? (
                    <p className="text-[8px] text-destructive">
                      Last error: {chatgpt.data.lastError}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-md text-[9px]"
                      disabled={chatgptBusy}
                      onClick={() => chatgptCredentialInput.current?.click()}
                    >
                      <FolderUp className="size-3" /> Import credential
                    </Button>
                    <input
                      ref={chatgptCredentialInput}
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void importChatGptCredential(file);
                      }}
                    />
                  </div>
                </div>
              )}
            </SettingsCard>

            {["OWNER", "ADMIN"].includes(role ?? "") ? (
              <SettingsCard
                title="Workspace AI credentials"
                description="Point this workspace at its own OpenAI-compatible provider. The key is encrypted before it is stored and only ever shown masked. Leave it blank to keep the current one."
              >
                <div className="flex items-center gap-2 text-[9px]">
                  <span
                    className={cn(
                      "status-dot",
                      aiConfig.data?.source === "workspace"
                        ? "bg-moss"
                        : aiConfig.data?.deploymentAvailable
                          ? "bg-saffron"
                          : "bg-border",
                    )}
                  />
                  <span className="text-muted-foreground">
                    {aiConfig.data?.source === "workspace"
                      ? `Using workspace credentials${aiConfig.data.apiKeyMasked ? ` · ${aiConfig.data.apiKeyMasked}` : ""}`
                      : aiConfig.data?.deploymentAvailable
                        ? "Using the deployment's provider configuration"
                        : "No provider configured — AI answers fall back to local retrieval"}
                  </span>
                </div>

                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                      Base URL
                    </span>
                    <Input
                      value={aiBaseUrl}
                      onChange={(event) => setAiBaseUrl(event.target.value)}
                      placeholder="https://api.openai.com/v1"
                      spellCheck={false}
                      className="h-8 rounded-md font-mono text-[10px]"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                      API key
                    </span>
                    <Input
                      value={aiKey}
                      onChange={(event) => setAiKey(event.target.value)}
                      type="password"
                      placeholder={aiConfig.data?.configured ? "Leave blank to keep" : "sk-…"}
                      className="h-8 rounded-md text-[10px]"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                      Chat model
                    </span>
                    <Input
                      value={aiModel}
                      onChange={(event) => setAiModel(event.target.value)}
                      placeholder="gpt-4.1-mini"
                      className="h-8 rounded-md font-mono text-[10px]"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                      Embedding model
                    </span>
                    <Input
                      value={aiEmbeddingModel}
                      onChange={(event) => setAiEmbeddingModel(event.target.value)}
                      placeholder="text-embedding-3-small"
                      className="h-8 rounded-md font-mono text-[10px]"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                      Transcription model
                    </span>
                    <Input
                      value={aiTranscribeModel}
                      onChange={(event) => setAiTranscribeModel(event.target.value)}
                      placeholder="whisper-1"
                      className="h-8 rounded-md font-mono text-[10px]"
                    />
                  </label>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button size="sm" className="h-8 rounded-lg text-[10px]" onClick={() => void saveAiProvider()}>
                    Save credentials
                  </Button>
                  {aiConfig.data?.configured ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg text-[10px] text-destructive"
                      onClick={() => void removeAiProvider()}
                    >
                      Remove
                    </Button>
                  ) : null}
                  <span className="text-[8px] text-muted-foreground">
                    Workspace credentials win over the deployment configuration.
                  </span>
                </div>
              </SettingsCard>
            ) : null}

            <SettingsCard
              title="Semantic index"
              description="Embeds pages so Ask can retrieve by meaning, not just shared words."
            >
              {!online ? (
                <OfflineNotice />
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[10px]">
                    <span
                      className={cn(
                        "status-dot",
                        embeddingStatus.data?.count ? "bg-moss" : "bg-saffron",
                      )}
                    />
                    {embeddingStatus.data?.count
                      ? `${embeddingStatus.data.count} pages indexed · ${embeddingStatus.data.model}`
                      : "No pages indexed yet"}
                  </div>
                  {embeddingStatus.data?.lastIndexedAt ? (
                    <p className="text-[8px] text-muted-foreground">
                      Last indexed{" "}
                      {new Date(embeddingStatus.data.lastIndexedAt).toLocaleString()}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-md text-[9px]"
                      disabled={indexing || !embeddingStatus.data?.enabled}
                      onClick={() => void buildEmbeddingIndex()}
                    >
                      {indexing ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Sparkles className="size-3" />
                      )}{" "}
                      {embeddingStatus.data?.count ? "Rebuild index" : "Build index"}
                    </Button>
                    <span className="text-[8px] text-muted-foreground">
                      {embeddingStatus.data?.enabled
                        ? "Uses AI_EMBEDDING_MODEL on the server."
                        : "ChatGPT plan usage can't create embeddings — add a workspace API key to enable this."}
                    </span>
                  </div>
                  <p className="text-[8px] leading-relaxed text-muted-foreground">
                    Ask uses the vector index when it exists and the provider can embed the question;
                    otherwise it falls back to token retrieval. Rebuild after large imports or
                    provider changes.
                  </p>
                </div>
              )}
            </SettingsCard>
          </section>
        ) : null}

        {tab === "reviews" ? <ReviewQueue /> : null}

        {tab === "types" ? <ObjectTypeManager /> : null}

        {tab === "webhooks" ? <WebhookManager /> : null}

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
                      className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive tap-target"
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

        {tab === "legal" ? (
          <section className="space-y-4">
            <SettingsCard
              title="Legal hold"
              description="An active hold outranks retention: the purge never removes content a hold covers. Deletes are the only path that removes rows, so a hold preserves them until it is released."
            >
              {!online ? (
                <OfflineNotice />
              ) : (
                <>
                  <p className="text-[9px] text-muted-foreground">
                    {legalHolds.data?.summary ?? "Loading…"}
                  </p>
                  <div className="mt-2 space-y-1">
                    {(legalHolds.data?.holds ?? []).map((hold) => (
                      <div
                        key={hold.id}
                        className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-1.5 text-[9px]"
                      >
                        <span className="rounded border border-border px-1.5 py-0.5 text-[7px] uppercase tracking-wide">
                          {hold.scope.toLowerCase()}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{hold.targetLabel}</span>
                        <span className="truncate text-muted-foreground" title={hold.reason}>
                          {hold.reason}
                        </span>
                        <span className="text-muted-foreground">
                          {hold.releasedAt
                            ? `released ${formatRelative(hold.releasedAt)}`
                            : `since ${formatRelative(hold.createdAt)}`}
                        </span>
                        {hold.releasedAt ? null : (
                          <button
                            type="button"
                            aria-label={`Release hold on ${hold.targetLabel}`}
                            onClick={() => void releaseLegalHold(hold.id)}
                            className="grid size-7 place-items-center rounded text-muted-foreground/50 hover:bg-muted hover:text-foreground tap-target"
                          >
                            <RotateCcw className="size-2.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    {legalHolds.data && !legalHolds.data.holds.length ? (
                      <p className="text-[9px] text-muted-foreground">
                        No holds. Expired trash is purged on the workspace schedule.
                      </p>
                    ) : null}
                  </div>

                  {["OWNER", "ADMIN"].includes(role ?? "") ? (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <label className="block">
                        <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                          Scope
                        </span>
                        <select
                          value={holdScope}
                          onChange={(event) => {
                            setHoldScope(event.target.value as typeof holdScope);
                            setHoldTarget("");
                          }}
                          className="h-8 rounded-md border border-border bg-background px-1.5 text-[10px]"
                        >
                          <option value="WORKSPACE">Workspace</option>
                          <option value="NOTEBOOK">Notebook</option>
                          <option value="PAGE">Page</option>
                        </select>
                      </label>
                      {holdScope !== "WORKSPACE" ? (
                        <label className="block min-w-40 flex-1">
                          <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                            Target
                          </span>
                          <select
                            value={holdTarget}
                            onChange={(event) => setHoldTarget(event.target.value)}
                            className="h-8 w-full rounded-md border border-border bg-background px-1.5 text-[10px]"
                          >
                            <option value="">Choose…</option>
                            {(holdScope === "NOTEBOOK"
                              ? legalNotebooks
                                  .filter((notebook) => !notebook.deletedAt)
                                  .map((notebook) => ({ id: notebook.id, label: notebook.name }))
                              : legalPages
                                  .filter((page) => !page.deletedAt)
                                  .map((page) => ({ id: page.id, label: page.title }))
                            ).map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <label className="block min-w-48 flex-[2]">
                        <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                          Reason
                        </span>
                        <Input
                          value={holdReason}
                          onChange={(event) => setHoldReason(event.target.value)}
                          placeholder="Matter reference or request"
                          className="h-8 rounded-md text-[10px]"
                        />
                      </label>
                      <Button
                        size="sm"
                        className="h-8 rounded-lg text-[10px]"
                        onClick={() => void createLegalHold()}
                      >
                        Place hold
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </SettingsCard>

            <SettingsCard
              title="Export on demand"
              description="A self-contained JSON bundle for a legal request: every record in the workspace including soft-deleted rows, plus the audit log and holds. Credentials, SSO secrets, and token hashes are never included."
            >
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="h-8 rounded-lg text-[10px]"
                  onClick={() => void downloadLegalExport()}
                >
                  Download legal export
                </Button>
                <span className="text-[8px] leading-relaxed text-muted-foreground">
                  Capped at 5,000 pages, 5,000 versions, 10,000 comments, and 5,000 audit entries;
                  truncation is reported inside the file.
                </span>
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
