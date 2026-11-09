import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Input, Spinner, useThemeColor, useToast } from "heroui-native";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { Container } from "@/components/container";
import { Sheet } from "@/components/ui/sheet";
import { ScreenHeader } from "@/components/ui/screen-header";
import { useAppTheme } from "@/contexts/app-theme-context";
import { useOutbox } from "@/contexts/outbox-context";
import { useWorkspace } from "@/contexts/workspace-context";
import { authClient } from "@/lib/auth-client";
import { inviteLink } from "@/lib/config";
import { copyText, shareUrl } from "@/lib/files";
import { SERVER_URL } from "@/lib/server-url";
import { client } from "@/utils/orpc";

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mt-4 rounded-2xl border border-border bg-surface p-3.5">
      <Text className="text-[12px] font-semibold text-foreground">{title}</Text>
      {description ? (
        <Text className="mt-0.5 text-[10px] leading-4 text-muted">{description}</Text>
      ) : null}
      <View className="mt-3 gap-2">{children}</View>
    </View>
  );
}

function Row({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: React.ReactNode;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <Text className="min-w-0 flex-1 text-[12px] text-foreground">{label}</Text>
      <Text numberOfLines={1} className="max-w-[45%] text-right text-[10px] text-muted">
        {value}
      </Text>
      {action}
    </View>
  );
}

export default function SettingsScreen() {
  const { workspace, role, memberships, switchWorkspace, refresh, signOut } = useWorkspace();
  const { currentTheme, setTheme } = useAppTheme();
  const { online, pending, flushing, conflicts, flush } = useOutbox();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();
  const muted = useThemeColor("muted");
  const { data: session } = authClient.useSession();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"EDITOR" | "VIEWER" | "MEMBER" | "ADMIN">("EDITOR");
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newWorkspace, setNewWorkspace] = useState("");
  const [newWorkspaceType, setNewWorkspaceType] = useState<"PERSONAL" | "ORGANIZATION">("PERSONAL");
  const [nameDraft, setNameDraft] = useState(workspace?.name ?? "");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [retentionDraft, setRetentionDraft] = useState("30");
  const [savingWorkspace, setSavingWorkspace] = useState(false);

  const detail = useQuery({
    queryKey: ["native-workspace-detail", workspace?.id],
    queryFn: async () => client.workspace.get(),
    enabled: Boolean(workspace),
  });
  const members = useQuery({
    queryKey: ["native-members", workspace?.id],
    queryFn: async () => client.workspace.members(),
    enabled: Boolean(workspace),
  });
  const devices = useQuery({
    queryKey: ["native-devices"],
    queryFn: async () => client.device.list(),
    enabled: Boolean(workspace),
  });
  const syncConflicts = useQuery({
    queryKey: ["native-conflicts", workspace?.id],
    queryFn: async () => client.sync.conflicts(),
    enabled: Boolean(workspace),
  });
  const aiStatus = useQuery({
    queryKey: ["native-ai-status", workspace?.id],
    queryFn: async () => client.ai.status(),
    enabled: Boolean(workspace),
  });
  const embedding = useQuery({
    queryKey: ["native-ai-embedding", workspace?.id],
    queryFn: async () => client.ai.embeddingStatus(),
    enabled: Boolean(workspace),
  });

  const isAdmin = role === "OWNER" || role === "ADMIN";

  useEffect(() => {
    const current = detail.data?.workspace;
    if (!current) return;
    setNameDraft((value) => value || current.name);
    setDescriptionDraft(current.description ?? "");
    setRetentionDraft(String(current.trashRetentionDays));
  }, [detail.data?.workspace]);

  const saveWorkspace = async () => {
    if (!isAdmin) return;
    setSavingWorkspace(true);
    try {
      await client.workspace.update({
        name: nameDraft.trim() || undefined,
        description: descriptionDraft.trim() || undefined,
        trashRetentionDays: Number.isFinite(Number(retentionDraft))
          ? Math.max(0, Math.min(3650, Number(retentionDraft)))
          : undefined,
      });
      await Promise.all([
        detail.refetch(),
        refresh(),
        queryClient.invalidateQueries({ queryKey: ["native-workspace-detail", workspace?.id] }),
      ]);
      toast.show({ variant: "success", label: "Workspace updated" });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not update the workspace",
      });
    } finally {
      setSavingWorkspace(false);
    }
  };

  const invite = async () => {
    if (!inviteEmail.trim()) return;
    try {
      const result = await client.workspace.invite({
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setInviteResult(inviteLink(result.token));
      setInviteEmail("");
      await members.refetch();
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not create the invite",
      });
    }
  };

  const createWorkspace = async () => {
    if (!newWorkspace.trim()) return;
    try {
      await client.workspace.create({
        name: newWorkspace.trim(),
        type: newWorkspaceType,
      });
      setNewWorkspace("");
      setCreateOpen(false);
      await refresh();
      await queryClient.invalidateQueries();
      toast.show({ variant: "success", label: "Workspace created" });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not create the workspace",
      });
    }
  };

  const removeMember = (memberId: string, name: string) => {
    Alert.alert(`Remove ${name}?`, "They lose access to this workspace immediately.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await client.workspace.removeMember({ memberId });
            await members.refetch();
          } catch (error) {
            toast.show({
              variant: "danger",
              label: error instanceof Error ? error.message : "Could not remove the member",
            });
          }
        },
      },
    ]);
  };

  const revokeDevice = async (deviceId: string) => {
    try {
      await client.device.remove({ deviceId });
      await devices.refetch();
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not revoke the device",
      });
    }
  };

  const resolveConflict = async (conflictId: string, resolution: "KEEP_LOCAL" | "KEEP_REMOTE") => {
    try {
      await client.sync.resolveConflict({ conflictId, resolution });
      await Promise.all([syncConflicts.refetch(), queryClient.invalidateQueries()]);
      toast.show({ variant: "success", label: "Conflict resolved" });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not resolve the conflict",
      });
    }
  };

  const reindex = async () => {
    try {
      const result = await client.ai.reindex();
      await embedding.refetch();
      toast.show({
        variant: result.ok ? "success" : "default",
        label: result.ok ? `Indexed ${result.indexed} pages` : result.reason ?? "Unavailable",
      });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Reindex failed",
      });
    }
  };

  const workspaceDetail = detail.data?.workspace;
  const effectiveName = nameDraft || workspaceDetail?.name || workspace?.name || "";

  return (
    <Container>
      <ScreenHeader title="Settings" subtitle={workspace?.name} large />
      <View className="px-5 pb-12">
        <Card title="Account" description="Your identity on every device.">
          <Row label={session?.user?.name ?? "Signed in"} value={session?.user?.email ?? ""} />
          <Pressable
            onPress={() => void signOut()}
            className="items-center rounded-xl border border-rose-300 bg-rose-50 py-2"
          >
            <Text className="text-[11px] font-semibold text-rose-600">Sign out</Text>
          </Pressable>
        </Card>

        <Card title="Appearance" description="Applies instantly on this device.">
          <View className="flex-row gap-1.5">
            {(
              [
                ["system", "System"],
                ["light", "Light"],
                ["dark", "Dark"],
              ] as const
            ).map(([value, label]) => (
              <Pressable
                key={value}
                onPress={() => setTheme(value)}
                className={`flex-1 items-center rounded-xl border py-2 ${
                  currentTheme === value
                    ? "border-amber-500/50 bg-amber-100"
                    : "border-border bg-surface"
                }`}
              >
                <Text
                  className={`text-[10px] font-medium ${
                    currentTheme === value ? "text-neutral-900" : "text-muted"
                  }`}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>

        <Card title="Workspaces" description="Switch context or start another workspace.">
          <View className="gap-1">
            {memberships.map((membership) => (
              <Pressable
                key={membership.workspace.id}
                onPress={() => void switchWorkspace(membership.workspace.id)}
                className={`flex-row items-center gap-2 rounded-xl border px-3 py-2 ${
                  membership.workspace.id === workspace?.id
                    ? "border-amber-500/50 bg-amber-100"
                    : "border-border bg-surface"
                }`}
              >
                <Text className="text-sm">{membership.workspace.icon ?? "◇"}</Text>
                <Text className="min-w-0 flex-1 text-[12px] text-foreground">
                  {membership.workspace.name}
                </Text>
                <Text className="text-[9px] uppercase text-muted">{membership.role}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={() => setCreateOpen(true)}
            className="items-center rounded-xl border border-border py-2"
          >
            <Text className="text-[11px] text-foreground">Create workspace</Text>
          </Pressable>
        </Card>

        <Card
          title="Workspace"
          description={
            isAdmin
              ? "Name, description, and how long deleted items stay recoverable."
              : "Only owners and admins can change these."
          }
        >
          <Input value={effectiveName} onChangeText={setNameDraft} placeholder="Workspace name" />
          <TextInput
            value={descriptionDraft}
            onChangeText={setDescriptionDraft}
            placeholder={workspaceDetail?.description ?? "Description"}
            multiline
            className="min-h-[60px] rounded-xl border border-border bg-background px-3 py-2 text-[12px] text-foreground"
            textAlignVertical="top"
          />
          <View className="flex-row items-center gap-2">
            <Text className="text-[11px] text-foreground">Trash retention (days)</Text>
            <TextInput
              value={retentionDraft}
              onChangeText={setRetentionDraft}
              keyboardType="number-pad"
              className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-center text-[12px] text-foreground"
            />
          </View>
          <Pressable
            onPress={() => void saveWorkspace()}
            disabled={!isAdmin || savingWorkspace}
            className={`items-center rounded-xl py-2 ${
              isAdmin ? "bg-accent" : "bg-surface-secondary"
            }`}
          >
            <Text className={`text-[11px] font-semibold ${isAdmin ? "text-neutral-900" : "text-muted"}`}>
              {savingWorkspace ? "Saving…" : "Save workspace"}
            </Text>
          </Pressable>
        </Card>

        <Card title={`Members · ${members.data?.length ?? 0}`} description="Roles are enforced by the server.">
          {members.isLoading ? (
            <Spinner size="sm" color="default" />
          ) : (
            <View className="gap-1">
              {(members.data ?? []).map((member) => (
                <View
                  key={member.id}
                  className="flex-row items-center gap-2 rounded-xl border border-border bg-surface px-2.5 py-2"
                >
                  <View className="h-7 w-7 items-center justify-center rounded-full bg-surface-secondary">
                    <Text className="text-[10px] text-foreground">
                      {member.user.name.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text numberOfLines={1} className="text-[11px] text-foreground">
                      {member.user.name}
                    </Text>
                    <Text numberOfLines={1} className="text-[9px] text-muted">
                      {member.user.email}
                    </Text>
                  </View>
                  <Text className="text-[9px] uppercase text-muted">{member.role}</Text>
                  {isAdmin && member.role !== "OWNER" ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Remove member"
                      hitSlop={8}
                      onPress={() => removeMember(member.id, member.user.name)}
                    >
                      <Ionicons name="close-circle-outline" size={14} color={muted} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          )}
          {isAdmin ? (
            <Pressable
              onPress={() => {
                setInviteResult(null);
                setInviteOpen(true);
              }}
              className="items-center rounded-xl border border-border py-2"
            >
              <Text className="text-[11px] text-foreground">Invite someone</Text>
            </Pressable>
          ) : null}
        </Card>

        <Card title="Sync" description="Local edits queue here when the network drops.">
          <Row label="Connection" value={online ? "Online" : "Offline"} />
          <Row label="Pending edits" value={String(pending)} />
          <Row label="Conflicts" value={String(syncConflicts.data?.length ?? 0)} />
          <Pressable
            onPress={() => void flush()}
            disabled={flushing || !pending}
            className="items-center rounded-xl border border-border py-2"
          >
            <Text className="text-[11px] text-foreground">
              {flushing ? "Flushing…" : "Flush now"}
            </Text>
          </Pressable>
          {(syncConflicts.data ?? []).length ? (
            <View className="gap-1">
              {syncConflicts.data?.map((conflict) => (
                <View key={conflict.id} className="rounded-xl border border-amber-300/60 bg-amber-50 p-2.5">
                  <Text className="text-[11px] text-foreground">
                    {conflict.entity} · {conflict.entityId.slice(0, 10)}
                  </Text>
                  <Text className="text-[9px] text-muted">
                    local rev {conflict.baseRev} vs remote {conflict.remoteRev}
                  </Text>
                  <View className="mt-1.5 flex-row gap-1.5">
                    <Pressable
                      onPress={() => void resolveConflict(conflict.id, "KEEP_LOCAL")}
                      className="rounded-lg border border-border bg-surface px-2 py-1"
                    >
                      <Text className="text-[10px] text-foreground">Keep local</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void resolveConflict(conflict.id, "KEEP_REMOTE")}
                      className="rounded-lg border border-border bg-surface px-2 py-1"
                    >
                      <Text className="text-[10px] text-foreground">Keep remote</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
          {conflicts.length ? (
            <Text className="text-[9px] text-muted">
              {conflicts.length} conflict(s) surfaced by this device's outbox.
            </Text>
          ) : null}
        </Card>

        <Card title="Assistant" description="Optional. Local retrieval works without a provider.">
          <Row label="Mode" value={aiStatus.data?.enabled ? "Provider" : "Local"} />
          <Row label="Model" value={aiStatus.data?.model ?? "None"} />
          <Row
            label="Embeddings"
            value={`${embedding.data?.count ?? 0} pages indexed`}
          />
          <Pressable
            onPress={() => void reindex()}
            className="items-center rounded-xl border border-border py-2"
          >
            <Text className="text-[11px] text-foreground">Rebuild semantic index</Text>
          </Pressable>
        </Card>

        <Card title="Devices" description="Sessions that can push sync operations.">
          {devices.isLoading ? (
            <Spinner size="sm" color="default" />
          ) : (
            <View className="gap-1">
              {(devices.data ?? []).map((device) => (
                <View
                  key={device.id}
                  className="flex-row items-center gap-2 rounded-xl border border-border bg-surface px-2.5 py-2"
                >
                  <Ionicons name="phone-portrait-outline" size={14} color={muted} />
                  <View className="min-w-0 flex-1">
                    <Text numberOfLines={1} className="text-[11px] text-foreground">
                      {device.name}
                    </Text>
                    <Text className="text-[9px] text-muted">{device.platform}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Revoke device"
                    hitSlop={8}
                    onPress={() => void revokeDevice(device.id)}
                  >
                    <Ionicons name="close-circle-outline" size={14} color={muted} />
                  </Pressable>
                </View>
              ))}
              {!devices.data?.length ? (
                <Text className="text-[10px] text-muted">No devices registered yet.</Text>
              ) : null}
            </View>
          )}
        </Card>

        <Card title="About" description="Lattice mobile">
          <Row label="App" value="iOS · iPad · Android" />
          <Row label="Server" value={SERVER_URL} />
          <Pressable
            onPress={() => router.push("/notifications" as never)}
            className="items-center rounded-xl border border-border py-2"
          >
            <Text className="text-[11px] text-foreground">Notifications</Text>
          </Pressable>
        </Card>
      </View>

      <Sheet
        open={inviteOpen}
        onOpenChange={(open) => {
          setInviteOpen(open);
          if (!open) setInviteResult(null);
        }}
        title="Invite someone"
      >
        <View className="mt-2 gap-2">
          {inviteResult ? (
            <>
              <Text className="text-[11px] text-muted">Share this single-use invite link:</Text>
              <Text selectable className="rounded-xl border border-border bg-surface px-3 py-2 text-[10px] text-foreground">
                {inviteResult}
              </Text>
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => void copyText(inviteResult)}
                  className="flex-1 items-center rounded-xl border border-border py-2"
                >
                  <Text className="text-[11px] text-foreground">Copy</Text>
                </Pressable>
                <Pressable
                  onPress={() => void shareUrl(inviteResult, "Join my Lattice workspace")}
                  className="flex-1 items-center rounded-xl bg-accent py-2"
                >
                  <Text className="text-[11px] font-semibold text-neutral-900">Share</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Input
                value={inviteEmail}
                onChangeText={setInviteEmail}
                placeholder="name@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <View className="flex-row flex-wrap gap-1">
                {(["EDITOR", "VIEWER", "MEMBER", "ADMIN"] as const).map((value) => (
                  <Pressable
                    key={value}
                    onPress={() => setInviteRole(value)}
                    className={`rounded-full border px-2.5 py-1 ${
                      inviteRole === value
                        ? "border-amber-500/50 bg-amber-100"
                        : "border-border bg-surface"
                    }`}
                  >
                    <Text
                      className={`text-[10px] ${
                        inviteRole === value ? "text-neutral-900" : "text-muted"
                      }`}
                    >
                      {value}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                onPress={() => void invite()}
                className="items-center rounded-xl bg-accent py-2.5"
              >
                <Text className="text-[12px] font-semibold text-neutral-900">Create invite</Text>
              </Pressable>
            </>
          )}
        </View>
      </Sheet>

      <Sheet open={createOpen} onOpenChange={setCreateOpen} title="New workspace">
        <View className="mt-2 gap-2">
          <Input value={newWorkspace} onChangeText={setNewWorkspace} placeholder="Workspace name" />
          <View className="flex-row gap-1">
            {(
              [
                ["PERSONAL", "Personal"],
                ["ORGANIZATION", "Organization"],
              ] as const
            ).map(([value, label]) => (
              <Pressable
                key={value}
                onPress={() => setNewWorkspaceType(value)}
                className={`flex-1 items-center rounded-xl border py-2 ${
                  newWorkspaceType === value
                    ? "border-amber-500/50 bg-amber-100"
                    : "border-border bg-surface"
                }`}
              >
                <Text
                  className={`text-[11px] ${
                    newWorkspaceType === value ? "text-neutral-900" : "text-muted"
                  }`}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={() => void createWorkspace()}
            className="items-center rounded-xl bg-accent py-2.5"
          >
            <Text className="text-[12px] font-semibold text-neutral-900">Create</Text>
          </Pressable>
        </View>
      </Sheet>
    </Container>
  );
}
