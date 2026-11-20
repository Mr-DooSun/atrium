// "Install from source": a git repo, npm package, local folder or a marketplace plus plugin name,
// for plugins the catalog does not list. The form only collects; the preview → confirm → run flow
// shows the exact command before anything is fetched.
import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/ui";
import { ECOSYSTEM_CAPS, type Ecosystem, type PluginSourceInput, type PluginSourceKind } from "../../shared/toolbox/types";
import { PROJECT_SCOPES, takesExtras, toInput, valueOk, type SourceForm } from "./store-logic";
import { useToolboxText } from "./strings";
import { Button, MONO, Notice, RADIUS, Segmented, pluginScopeLabel, useLook } from "./ui";

export function SourceInstallModal({
  ecosystem,
  cwd,
  where,
  onClose,
  onSubmit,
}: {
  ecosystem: Ecosystem;
  cwd: string | null;
  /** Profile label or "Paseo", shown under the title. */
  where: string;
  onClose(): void;
  onSubmit(source: PluginSourceInput): void;
}) {
  const t = useToolboxText();
  const { p } = useLook();
  const caps = ECOSYSTEM_CAPS[ecosystem];
  const kinds = caps.sources;
  const scopes = caps.scopes;
  const [form, setForm] = useState<SourceForm>({
    kind: kinds[0] ?? "git",
    value: "",
    ref: "",
    version: "",
    path: "",
    plugin: "",
    scope: scopes[0] ?? null,
  });
  const set = <K extends keyof SourceForm>(key: K, value: SourceForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const scopeBlocked = form.scope !== null && PROJECT_SCOPES.includes(form.scope) && !cwd;
  const ok = valueOk(form.kind, form.value) && (form.kind !== "marketplace" || !!form.plugin.trim()) && !scopeBlocked;
  const f = t.plugins.source;
  const extras = takesExtras(ecosystem);

  return (
    <Modal
      title={f.title}
      icon={<Icon name="PackagePlus" size={16} color={p.foreground} />}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Content>
        <Text style={{ color: p.muted, fontSize: 12 }}>{where}</Text>
        {kinds.length > 1 ? (
          <Field label={f.kind}>
            <Segmented<PluginSourceKind>
              value={form.kind}
              options={kinds.map((k) => ({ value: k, label: f.kinds[k] }))}
              onChange={(k) => set("kind", k)}
            />
          </Field>
        ) : null}
        <Field label={f.valueLabel[form.kind]}>
          <Input value={form.value} onChangeText={(v) => set("value", v)} placeholder={f.valuePlaceholder[form.kind]} />
          {form.value.trim() && !valueOk(form.kind, form.value) ? (
            <Text style={{ color: p.danger, fontSize: 12 }}>{f.invalidValue[form.kind]}</Text>
          ) : null}
        </Field>
        {form.kind === "marketplace" ? (
          <Field label={f.plugin}>
            <Input value={form.plugin} onChangeText={(v) => set("plugin", v)} placeholder={f.pluginPlaceholder} />
          </Field>
        ) : null}
        {extras && form.kind === "git" ? (
          <Field label={f.ref}>
            <Input value={form.ref} onChangeText={(v) => set("ref", v)} placeholder={f.refPlaceholder} />
            <Text style={{ color: p.muted, fontSize: 11 }}>{f.refNote}</Text>
          </Field>
        ) : null}
        {extras && form.kind === "npm" ? (
          <Field label={f.version}>
            <Input value={form.version} onChangeText={(v) => set("version", v)} placeholder={f.versionPlaceholder} />
          </Field>
        ) : null}
        {extras && (form.kind === "git" || form.kind === "npm") ? (
          <Field label={f.path}>
            <Input value={form.path} onChangeText={(v) => set("path", v)} placeholder={f.pathPlaceholder} />
          </Field>
        ) : null}
        {scopes.length > 0 ? (
          <Field label={t.plugins.installScope}>
            <Segmented<string>
              value={form.scope ?? scopes[0] ?? ""}
              options={scopes.map((s) => ({ value: s, label: pluginScopeLabel(t, ecosystem, s), disabled: PROJECT_SCOPES.includes(s) && !cwd }))}
              onChange={(s) => set("scope", s)}
            />
            {!cwd ? <Text style={{ color: p.muted, fontSize: 11 }}>{t.plugins.scopeNeedsProject}</Text> : null}
          </Field>
        ) : null}
        <Notice tone="warning" text={t.flow.unsandboxed} />
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <Button label={t.common.cancel} onPress={onClose} />
          <Button label={f.review} tone="primary" onPress={() => onSubmit(toInput(form, extras))} disabled={!ok} />
        </View>
      </Modal.Content>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const { p } = useLook();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: p.muted, fontSize: 12, fontWeight: "500" }}>{label}</Text>
      {children}
    </View>
  );
}

function Input({ value, onChangeText, placeholder }: { value: string; onChangeText(v: string): void; placeholder?: string }) {
  const { p } = useLook();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={p.idle}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      style={{
        height: 36,
        paddingHorizontal: 10,
        borderRadius: RADIUS,
        borderWidth: 1,
        borderColor: p.guide,
        color: p.foreground,
        fontSize: 13,
        fontFamily: MONO,
      }}
    />
  );
}
