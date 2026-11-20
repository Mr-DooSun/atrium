import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { usePaseo, useTranslation, type WorkspaceRef } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { TITLE_LINE, type Palette } from "./look";
import { sidebarText } from "./sidebar-strings";

export interface RenameState {
  editing: boolean;
  pending: boolean;
  draft: string;
  setDraft(value: string): void;
  begin(): void;
  cancel(): void;
  save(): void;
}

/**
 * A workspace's display name is its Paseo title, stored by the daemon, so Paseo's own sidebar
 * and every other client show the same name. An empty name clears the title and the row falls
 * back to the folder name.
 */
export function useRename(ref: WorkspaceRef | null, current: string | null): RenameState {
  const paseo = usePaseo();
  const toast = useToast();
  const { t } = useTranslation(sidebarText);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState("");

  const save = useCallback(() => {
    if (!ref || pending) return;
    const next = draft.trim() || null;
    if (next === current) {
      setEditing(false);
      return;
    }
    setPending(true);
    paseo.workspaces
      .ref(ref)
      .setTitle(next)
      .then(() => setEditing(false))
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : t("renameFailed"));
      })
      .finally(() => setPending(false));
  }, [paseo, ref, current, draft, pending, toast, t]);

  return {
    editing,
    pending,
    draft,
    setDraft,
    begin: useCallback(() => {
      if (!ref) return;
      setDraft(current ?? "");
      setEditing(true);
    }, [ref, current]),
    cancel: useCallback(() => setEditing(false), []),
    save,
  };
}

/** Trailing button shown on hover, before the archive button. */
export function RenameButton({ onPress, p }: { onPress(): void; p: Palette }) {
  const [hovered, setHovered] = useState(false);
  const { t } = useTranslation(sidebarText);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("rename")}
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
      <Icon name="Pencil" size={13} color={hovered ? p.foreground : p.muted} />
    </Pressable>
  );
}

/** Rendered beside the row, like the archive dialog, so its presses never reach the row. */
export function RenameModal({
  state,
  folder,
  p,
}: {
  state: RenameState;
  /** The workspace's folder name: the placeholder, and what an empty name falls back to. */
  folder: string;
  p: Palette;
}) {
  const { t } = useTranslation(sidebarText);
  return (
    <Modal
      title={t("displayName")}
      icon={<Icon name="Pencil" size={16} color={p.foreground} />}
      open={state.editing}
      onOpenChange={(open) => {
        if (!open && !state.pending) state.cancel();
      }}
    >
      <Modal.Content>
        <TextInput
          autoFocus
          value={state.draft}
          onChangeText={state.setDraft}
          onSubmitEditing={state.save}
          placeholder={folder}
          placeholderTextColor={p.muted}
          editable={!state.pending}
          returnKeyType="done"
          style={{
            color: p.foreground,
            fontSize: 14,
            paddingHorizontal: 10,
            paddingVertical: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: p.guide,
          }}
        />
        <Text style={{ color: p.muted, fontSize: 12, lineHeight: 17 }}>
          {t("renameFallback", { folder })}
        </Text>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("cancel")}
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
            <Text style={{ color: p.foreground, fontSize: 13 }}>{t("cancel")}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("save")}
            disabled={state.pending}
            onPress={state.save}
            style={({ pressed }) => ({
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor: p.foreground,
              opacity: state.pending ? 0.6 : pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ color: p.background, fontSize: 13, fontWeight: "600" }}>
              {t(state.pending ? "saving" : "save")}
            </Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}
