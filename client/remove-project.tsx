// Remove a project from Paseo, like Paseo's own "remove project": its sessions are archived and
// its files stay on disk. Adding the folder again brings it back as a new project.
import { useCallback, useMemo, useState } from "react";
import { useAgents, useRpc, useTranslation, useWorkspaces, type ProjectRef } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import { removeProject } from "../shared/project-rpc";
import { ArchiveModal, type ArchiveState } from "./archive";
import type { Palette } from "./look";
import { sidebarText } from "./sidebar-strings";

export function useRemoveProject(reference: ProjectRef): ArchiveState {
  const remove = useRpc(removeProject);
  const toast = useToast();
  const { t } = useTranslation(sidebarText);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const confirm = useCallback(() => {
    if (pending) return;
    setPending(true);
    remove({ projectId: reference.id })
      .catch((error: unknown) => {
        toast.error(error instanceof Error && error.message ? error.message : t("removeFailed"));
      })
      .finally(() => {
        setPending(false);
        setConfirming(false);
      });
  }, [remove, reference.id, pending, toast, t]);
  return {
    confirming,
    pending,
    begin: useCallback(() => setConfirming(true), []),
    cancel: useCallback(() => setConfirming(false), []),
    confirm,
  };
}

/** The confirmation, saying how many sessions go and whether any are stopped mid-run. */
export function RemoveProjectModal({
  reference,
  name,
  state,
  p,
}: {
  reference: ProjectRef;
  name: string;
  state: ArchiveState;
  p: Palette;
}) {
  const { t } = useTranslation(sidebarText);
  // Counted only while the dialog is open.
  const workspaces = useWorkspaces({ where: (w) => state.confirming && w.project.key === reference.key });
  const keys = useMemo(() => new Set(workspaces.map((w) => w.key)), [workspaces]);
  const sessions = useAgents({ where: (a) => keys.has(a.workspace.key) && !a.background });
  const running = useAgents({
    where: (a) =>
      keys.has(a.workspace.key) && !a.background && (a.status === "running" || a.status === "initializing"),
  });
  const parts = [sessions.length > 0 ? t("removeBody", { n: sessions.length }) : t("removeBodyEmpty")];
  if (running.length > 0) parts.push(t("removeRunning", { n: running.length }));
  return (
    <ArchiveModal
      state={state}
      title={name}
      warning={parts.join(" ")}
      danger={running.length > 0}
      p={p}
      labels={{
        heading: t("removeTitle"),
        icon: "FolderX",
        confirm: t("removeConfirm"),
        pending: t("removing"),
        cancel: t("cancel"),
      }}
    />
  );
}
