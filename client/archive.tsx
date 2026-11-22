import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { usePaseo, useTranslation, type AgentRef, type WorkspaceRef } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/ui";
import { TITLE_LINE, type Palette } from "./look";
import { sidebarText } from "./sidebar-strings";

/** Workspaces the archive leaves with no agent; archived right after it. */
export interface EmptiedWorkspaces {
  refs: readonly WorkspaceRef[];
  /** How many of them are worktrees, whose folders the host removes. */
  worktrees: number;
}

export const NO_EMPTIED: EmptiedWorkspaces = { refs: [], worktrees: 0 };

export type ArchiveTarget = (
  | {
      kind: "workspace";
      ref: WorkspaceRef;
      /** The root agent the row stands for; archived first so its sub-sessions go with it. */
      rootAgent: AgentRef | null;
      worktree: boolean;
      hasChanges: boolean;
    }
  | { kind: "agent"; ref: AgentRef }
) & { emptied: EmptiedWorkspaces };

export interface ArchiveState {
  confirming: boolean;
  pending: boolean;
  begin(): void;
  cancel(): void;
  confirm(): void;
}

/**
 * Archive is two steps: the row first asks, then archives. Paseo's own sidebar confirms risky
 * worktree archives because the host removes the worktree, uncommitted work included; here
 * every archive asks, and the question says what goes with it.
 */
export function useArchive(target: ArchiveTarget | null): ArchiveState {
  const paseo = usePaseo();
  const toast = useToast();
  const { t } = useTranslation(sidebarText);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  const confirm = useCallback(() => {
    if (!target || pending) return;
    setPending(true);
    const run = async () => {
      if (target.kind === "workspace") {
        if (target.rootAgent) await paseo.agents.ref(target.rootAgent).archive();
        const result = await paseo.workspaces.ref(target.ref).archive();
        if (result.error) throw new Error(result.error);
      } else {
        await paseo.agents.ref(target.ref).archive();
      }
      // Paseo archives the sub-sessions with their parent but leaves the workspaces they ran
      // in; without this they would stay in the sidebar as empty rows. The row itself is already
      // archived here, so a failure on one of these is reported apart and the rest still go.
      let failed = 0;
      for (const ref of target.emptied.refs) {
        const result = await paseo.workspaces.ref(ref).archive().catch(() => ({ error: "failed" }));
        if (result.error) failed += 1;
      }
      if (failed > 0) toast.error(t("archiveEmptiedFailed", { n: failed }));
      // The row just vanishes otherwise; say where it went.
      else toast.show(t("archiveDone"));
    };
    run()
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : t("archiveFailed"));
      })
      .finally(() => {
        setPending(false);
        setConfirming(false);
      });
  }, [paseo, target, pending, toast, t]);

  return {
    confirming,
    pending,
    begin: useCallback(() => target && setConfirming(true), [target]),
    cancel: useCallback(() => setConfirming(false), []),
    confirm,
  };
}

/** Trailing button shown on hover in place of the status mark. */
export function ArchiveButton({ onPress, p }: { onPress(): void; p: Palette }) {
  const [hovered, setHovered] = useState(false);
  const { t } = useTranslation(sidebarText);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("archive")}
      hitSlop={6}
      onPress={onPress}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{
        width: 20,
        height: TITLE_LINE,
        borderRadius: 5,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: hovered ? p.pressed : "transparent",
      }}
    >
      <Icon name="Archive" size={13} color={hovered ? p.foreground : p.muted} />
    </Pressable>
  );
}

/** Confirmation dialog. Rendered beside the row, not inside it, so presses in the dialog never
 *  reach the row's own press handler through the portal. */
export function ArchiveModal({
  state,
  title,
  danger,
  p,
  labels,
  error,
  confirmHidden,
  ...content
}: {
  state: ArchiveState;
  title: string;
  danger: boolean;
  p: Palette;
  /** Why the last attempt failed, under the warning. The dialog stays open to show it. */
  error?: string | null;
  /** Nothing to confirm (the action cannot run from here): only the cancel button is shown. */
  confirmHidden?: boolean;
  /** Overrides for dialogs other than archive, such as removing a project. */
  labels?: { heading: string; icon: string; confirm: string; pending: string; cancel: string };
} & ({ warning: string } | { target: ArchiveTarget; descendants: number })) {
  const { t } = useTranslation(sidebarText);
  const l = labels ?? { heading: t("archiveTitle"), icon: "Archive", confirm: t("archive"), pending: t("archiving"), cancel: t("cancel") };
  let warning: string;
  if ("warning" in content) {
    warning = content.warning;
  } else {
    const { target, descendants } = content;
    const { refs, worktrees } = target.emptied;
    const parts: string[] = [];
    if (target.kind === "workspace" && target.worktree) {
      parts.push(t(target.hasChanges ? "archiveWorktreeChanges" : "archiveWorktree"));
    }
    if (worktrees > 0) parts.push(t("archiveAdditionalWorktrees", { n: worktrees }));
    if (descendants > 0) parts.push(t("archiveDescendants", { n: descendants }));
    if (refs.length > 0) parts.push(t("archiveEmptied", { n: refs.length }));
    // One line per consequence: run together, the folder warnings got lost among the counts.
    warning = parts.length ? parts.map((part) => `• ${part}`).join("\n") : t("archiveMove");
  }
  return (
    <Modal
      title={l.heading}
      icon={<Icon name={l.icon} size={16} color={danger ? p.danger : p.foreground} />}
      open={state.confirming}
      onOpenChange={(open) => {
        if (!open && !state.pending) state.cancel();
      }}
    >
      <Modal.Content>
        <Text numberOfLines={2} style={{ color: p.foreground, fontSize: 14, fontWeight: "600" }}>
          {title}
        </Text>
        <Text style={{ color: danger ? p.danger : p.muted, fontSize: 13, lineHeight: 19 }}>
          {warning}
        </Text>
        {error ? (
          <Text selectable style={{ color: p.danger, fontSize: 13, lineHeight: 19 }}>
            {error}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={l.cancel}
            disabled={state.pending}
            onPress={state.cancel}
            style={({ pressed }) => ({
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: p.guide,
              backgroundColor: pressed ? p.pressed : "transparent",
            })}
          >
            <Text style={{ color: p.foreground, fontSize: 13 }}>{l.cancel}</Text>
          </Pressable>
          {confirmHidden ? null : <Pressable
            accessibilityRole="button"
            accessibilityLabel={l.confirm}
            disabled={state.pending}
            onPress={state.confirm}
            style={({ pressed }) => ({
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor: danger ? p.danger : p.foreground,
              opacity: state.pending ? 0.6 : pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ color: danger ? "#ffffff" : p.background, fontSize: 13, fontWeight: "600" }}>
              {state.pending ? l.pending : l.confirm}
            </Text>
          </Pressable>}
        </View>
      </Modal.Content>
    </Modal>
  );
}
