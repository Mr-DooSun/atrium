// Hide a project from the Atrium sidebar, and show it again. Only this sidebar's view changes: the
// Paseo project, its sessions and its files stay as they are, and Paseo's own sidebar still lists
// it. The daemon keeps the hidden list with the project order (project.hide / project.unhide).
//
// The list lives on this plugin's own daemon, whichever host the project is on: a project of any
// host can be hidden, even while that host is offline. Each entry names the project's own host.
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useHosts, useProjects, useRpc, useTranslation, type ProjectRef } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { hideProject, unhideProject, type HiddenProject } from "../shared/project-rpc";
import { ArchiveModal, type ArchiveState } from "./archive";
import { ROW, type Palette } from "./look";
import { PROJECT_ORDER_KEY, type Saved } from "./project-order";
import { sidebarText } from "./sidebar-strings";

export interface HideProjectState extends ArchiveState {
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
  const applyHidden = useApplyHidden();
  const { t } = useTranslation(sidebarText);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useCallback(() => {
    if (pending) return;
    // The entry is kept by the project's own host id; without one there is nothing to name it by.
    if (!reference.hostId) {
      setError(t("hideFailed"));
      return;
    }
    setPending(true);
    setError(null);
    hide({ projectId: reference.id, hostId: reference.hostId })
      .then(({ hiddenProjects }) => {
        applyHidden(hiddenProjects);
        setConfirming(false);
      })
      .catch((failure: unknown) => {
        setError(failure instanceof Error && failure.message ? failure.message : t("hideFailed"));
      })
      .finally(() => setPending(false));
  }, [hide, applyHidden, reference.id, reference.hostId, pending, t]);
  return {
    confirming,
    pending,
    error,
    begin: useCallback(() => {
      setError(null);
      setConfirming(true);
    }, []),
    cancel: useCallback(() => setConfirming(false), []),
    confirm,
  };
}

/** The confirmation: what hiding does and does not touch. */
export function HideProjectModal({
  name,
  state,
  p,
}: {
  name: string;
  state: HideProjectState;
  p: Palette;
}) {
  const { t } = useTranslation(sidebarText);
  return (
    <ArchiveModal
      state={state}
      title={name}
      warning={t("hideBody")}
      error={state.error}
      confirmHidden={false}
      danger={false}
      p={p}
      labels={{
        heading: t("hideTitle"),
        icon: "EyeOff",
        confirm: t("hideConfirm"),
        pending: t("hiding"),
        cancel: t("cancel"),
      }}
    />
  );
}

/**
 * At the bottom of the sidebar: how many projects are hidden, unfolding to each with "Show
 * again". Hidden projects can be on any host; with more than one host, each row names its host.
 */
export function HiddenProjects({ hidden, p }: { hidden: readonly HiddenProject[]; p: Palette }) {
  const { t } = useTranslation(sidebarText);
  const hosts = useHosts();
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
      {open
        ? hidden.map((entry) => (
            <HiddenProjectRow
              key={`${entry.hostId}\u0000${entry.projectId}`}
              entry={entry}
              host={hosts.length > 1 ? hosts.find((h) => h.serverId === entry.hostId)?.label || entry.hostId : null}
              p={p}
            />
          ))
        : null}
    </View>
  );
}

/** `host` is the project's host name, shown when the sidebar has more than one host; else null. */
function HiddenProjectRow({ entry, host, p }: { entry: HiddenProject; host: string | null; p: Palette }) {
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
      {host ? (
        <Text numberOfLines={1} style={{ flexShrink: 1, maxWidth: "40%", color: p.muted, fontSize: 11, textAlign: "right" }}>
          {host}
        </Text>
      ) : null}
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
