// Hide a project from the Atrium sidebar, and show it again. Only this sidebar's view changes: the
// Paseo project, its sessions and its files stay as they are, and Paseo's own sidebar still lists
// it. The daemon keeps the hidden list with the project order (project.hide / project.unhide).
//
// The list lives on this plugin's own daemon and the server only takes projects of its own host,
// so a project on another host (or a daemon that cannot name itself) is never sent there.
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useHosts, useProjects, useRpc, useTranslation, type ProjectRef } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { hideProject, projectWorktrees, unhideProject, type HiddenProject } from "../shared/project-rpc";
import { ArchiveModal, type ArchiveState } from "./archive";
import { ROW, type Palette } from "./look";
import { OWN_HOST_KEY, projectRemovalTarget, useNamedOwnHost, type RemovalTarget } from "./own-host";
import { PROJECT_ORDER_KEY, type Saved } from "./project-order";
import { sidebarText } from "./sidebar-strings";

export interface HideProjectState extends ArchiveState {
  /** Where the project is as far as is known now; undefined while the daemon has not answered. */
  target: RemovalTarget | undefined;
  /** Why the last attempt failed; shown in the dialog, which stays open. */
  error: string | null;
}

/** Puts the daemon's answer in the order query at once, then refetches it. */
function useApplyHidden() {
  const queryClient = useQueryClient();
  return useCallback(
    (hiddenProjects: readonly HiddenProject[]) => {
      const current = queryClient.getQueryData<Saved>(PROJECT_ORDER_KEY);
      if (current) queryClient.setQueryData<Saved>(PROJECT_ORDER_KEY, { ...current, hiddenProjects: [...hiddenProjects] });
      void queryClient.invalidateQueries({ queryKey: PROJECT_ORDER_KEY });
    },
    [queryClient],
  );
}

export function useHideProject(reference: ProjectRef): HideProjectState {
  const hide = useRpc(hideProject);
  const fetchWorktrees = useRpc(projectWorktrees);
  const queryClient = useQueryClient();
  const applyHidden = useApplyHidden();
  const { t } = useTranslation(sidebarText);
  const ownHost = useNamedOwnHost();
  const target = ownHost === undefined ? undefined : projectRemovalTarget(reference.hostId, ownHost);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useCallback(() => {
    if (pending) return;
    setPending(true);
    setError(null);
    const run = async () => {
      // Asked again right before writing: the answer the dialog showed may be stale or a guess.
      const { hostId } = await fetchWorktrees({ cwds: [] });
      if (hostId) queryClient.setQueryData(OWN_HOST_KEY, hostId);
      if (projectRemovalTarget(reference.hostId, hostId) !== "own") return false;
      const { hiddenProjects } = await hide({ projectId: reference.id, hostId: reference.hostId });
      applyHidden(hiddenProjects);
      return true;
    };
    run()
      .then((hidden) => {
        // Not hidden: the dialog now shows the other host's notice from the refreshed answer.
        if (hidden) setConfirming(false);
      })
      .catch((failure: unknown) => {
        setError(failure instanceof Error && failure.message ? failure.message : t("hideFailed"));
      })
      .finally(() => setPending(false));
  }, [hide, fetchWorktrees, queryClient, applyHidden, reference.id, reference.hostId, pending, t]);
  return {
    confirming,
    pending,
    target,
    error,
    begin: useCallback(() => {
      setError(null);
      setConfirming(true);
    }, []),
    cancel: useCallback(() => setConfirming(false), []),
    confirm,
  };
}

/** The confirmation: what hiding does and does not touch, or why it can't be done from here. */
export function HideProjectModal({
  reference,
  name,
  state,
  p,
}: {
  reference: ProjectRef;
  name: string;
  state: HideProjectState;
  p: Palette;
}) {
  const { t } = useTranslation(sidebarText);
  const hosts = useHosts();
  const elsewhere = state.target === "other" || state.target === "unknown";
  let warning: string;
  if (state.target === "other") {
    const host = hosts.find((h) => h.serverId === reference.hostId)?.label ?? reference.hostId;
    warning = t("hideOtherHost", { host });
  } else if (state.target === "unknown") {
    warning = t("hideHostUnknown");
  } else {
    warning = t("hideBody");
  }
  return (
    <ArchiveModal
      state={state}
      title={name}
      warning={warning}
      error={state.error}
      confirmHidden={elsewhere}
      danger={false}
      p={p}
      labels={{
        heading: t("hideTitle"),
        icon: "EyeOff",
        confirm: t("hideConfirm"),
        pending: t("hiding"),
        cancel: elsewhere ? t("close") : t("cancel"),
      }}
    />
  );
}

/**
 * At the bottom of the sidebar: how many projects are hidden, unfolding to each with "Show
 * again". Only the plugin's own host can have hidden projects (the server takes no others).
 */
export function HiddenProjects({ hidden, p }: { hidden: readonly HiddenProject[]; p: Palette }) {
  const { t } = useTranslation(sidebarText);
  const [open, setOpen] = useState(false);
  if (hidden.length === 0) return null;
  return (
    <View style={{ marginTop: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t("hiddenProjects", { n: hidden.length })}
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => ({
          minHeight: ROW.minHeight,
          paddingVertical: ROW.paddingVertical,
          paddingHorizontal: 8,
          borderRadius: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: pressed ? p.pressed : "transparent",
        })}
      >
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={p.muted} />
        <Icon name="EyeOff" size={13} color={p.muted} />
        <Text numberOfLines={1} style={{ flex: 1, color: p.muted, fontSize: 13, textAlign: "left" }}>
          {t("hiddenProjects", { n: hidden.length })}
        </Text>
      </Pressable>
      {open ? hidden.map((entry) => <HiddenProjectRow key={`${entry.hostId}\u0000${entry.projectId}`} entry={entry} p={p} />) : null}
    </View>
  );
}

function HiddenProjectRow({ entry, p }: { entry: HiddenProject; p: Palette }) {
  const { t } = useTranslation(sidebarText);
  const toast = useToast();
  const unhide = useRpc(unhideProject);
  const applyHidden = useApplyHidden();
  const [pending, setPending] = useState(false);
  // The name, when the project is still on that host; it may have been removed in Paseo since.
  const name = useProjects({
    where: (pr) => pr.ref.hostId === entry.hostId && pr.ref.id === entry.projectId,
    groupBy: (pr) => pr.displayName,
  })[0]?.key;
  const show = () => {
    if (pending) return;
    setPending(true);
    unhide({ projectId: entry.projectId, hostId: entry.hostId })
      .then(({ hiddenProjects }) => applyHidden(hiddenProjects))
      .catch((error: unknown) => toast.error(error instanceof Error && error.message ? error.message : t("unhideFailed")))
      .finally(() => setPending(false));
  };
  return (
    <View style={{ minHeight: ROW.minHeight, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 30, paddingRight: 4 }}>
      <Text numberOfLines={1} style={{ flex: 1, color: p.muted, fontSize: 13, textAlign: "left" }}>
        {typeof name === "string" && name ? name : t("hiddenMissing", { id: entry.projectId })}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("unhide")}
        disabled={pending}
        onPress={show}
        hitSlop={4}
        style={({ pressed }) => ({
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: 6,
          backgroundColor: pressed ? p.pressed : p.hover,
          opacity: pending ? 0.6 : 1,
        })}
      >
        <Text style={{ color: p.foreground, fontSize: 12 }}>{t("unhide")}</Text>
      </Pressable>
    </View>
  );
}
