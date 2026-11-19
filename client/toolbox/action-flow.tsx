// Every mutation runs the same flow: (pick target profiles) -> preview per profile (or a local
// confirm) -> one confirmation modal with each profile's exact command, source and warnings ->
// run the profiles one after another, past failures -> per-profile results and, when needed, a
// reload of each touched profile's idle sessions.
import { Fragment, useCallback, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { usePaseo } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/ui";
import type { ActionPreview, CommandResult } from "../../shared/toolbox/types";
import { t } from "./strings";
import { Button, CodeBlock, LoadingLine, Notice, ProviderGlyph, TargetPicker, errorText, useLook } from "./ui";

interface ActionBase {
  title: string;
  /** What the action is about: a server, plugin or marketplace name. */
  subject: string;
  destructive?: boolean;
  /** Installs or adds code that will run on this machine. Shows the unsandboxed warning. */
  bringsCode?: boolean;
  localWarnings?: readonly string[];
  /** Query key prefixes refetched after the action ran, ok or not. */
  invalidate: readonly QueryKey[];
  /** Values never shown on screen (env and header values), masked in every profile's output. */
  secrets?: readonly string[];
}

/** One action on one profile (or on Paseo). */
export interface ToolboxAction extends ActionBase {
  /** Preview RPC. Null: no preview contract, so the modal confirms with `localWarnings`. */
  preview: (() => Promise<ActionPreview>) | null;
  run(): Promise<CommandResult>;
  /** Provider id whose idle sessions may reload; null for Paseo plugins. */
  reloadProvider: string | null;
  onResult?(result: CommandResult): void;
}

/** The same action for one profile of a bulk run. */
export interface ActionTarget {
  /** Profile id; unique within one action. */
  id: string;
  label: string;
  /** Can be picked; false for logged-out / not-installed profiles. */
  selectable: boolean;
  /** Picked when the target step opens. */
  preselected: boolean;
  /** Short state shown next to the profile in the target step. */
  note?: string | null;
  preview: (() => Promise<ActionPreview>) | null;
  run(): Promise<CommandResult>;
  /** Provider id whose idle sessions may reload. */
  reloadProvider: string | null;
}

export interface BulkAction extends ActionBase {
  targets: readonly ActionTarget[];
  /** Ask which targets to run on before previewing. False: run on every selectable target. */
  pick: boolean;
  onResults?(results: readonly TargetResult[]): void;
}

export interface TargetResult {
  target: ActionTarget;
  result: CommandResult;
}

interface Planned {
  target: ActionTarget;
  preview: ActionPreview | null;
  error: string | null;
}

/** Internal: a single action is a bulk action with one target and no profile headers. */
interface Flow extends BulkAction {
  single: boolean;
}

type Phase =
  | { kind: "closed" }
  | { kind: "pick"; action: Flow; selected: string[] }
  | { kind: "checking"; action: Flow }
  | { kind: "confirm"; action: Flow; items: Planned[] }
  | { kind: "running"; action: Flow; items: Planned[]; done: TargetResult[] }
  | { kind: "result"; action: Flow; results: TargetResult[]; skipped: Planned[] };

export interface ActionFlow {
  start(action: ToolboxAction): void;
  startBulk(action: BulkAction): void;
  busy: boolean;
  element: ReactNode;
}

const runnable = (item: Planned) => !item.error && (item.preview ? item.preview.supported : true);

function fromSingle(action: ToolboxAction): Flow {
  const { preview, run, reloadProvider, onResult, ...base } = action;
  return {
    ...base,
    single: true,
    pick: false,
    targets: [{ id: reloadProvider ?? "paseo", label: "", selectable: true, preselected: true, preview, run, reloadProvider }],
    onResults: onResult ? (results) => results[0] && onResult(results[0].result) : undefined,
  };
}

export function useActionFlow(hostId: string): ActionFlow {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: "closed" });
  // Bumped on every start/close so a late preview answer never reopens a closed modal.
  const token = useRef(0);

  const check = useCallback((action: Flow, targets: readonly ActionTarget[]) => {
    const mine = ++token.current;
    if (targets.every((target) => !target.preview)) {
      setPhase({ kind: "confirm", action, items: targets.map((target) => ({ target, preview: null, error: null })) });
      return;
    }
    setPhase({ kind: "checking", action });
    // Previews only read; they run side by side.
    void Promise.all(
      targets.map(
        (target): Promise<Planned> =>
          target.preview
            ? target.preview().then(
                (preview) => ({ target, preview, error: null }),
                (error: unknown) => ({ target, preview: null, error: errorText(error) }),
              )
            : Promise.resolve({ target, preview: null, error: null }),
      ),
    ).then((items) => {
      if (token.current === mine) setPhase({ kind: "confirm", action, items });
    });
  }, []);

  const begin = useCallback(
    (action: Flow) => {
      if (action.pick) {
        ++token.current;
        const selected = action.targets.filter((x) => x.selectable && x.preselected).map((x) => x.id);
        setPhase({ kind: "pick", action, selected });
        return;
      }
      check(action, action.targets.filter((x) => x.selectable));
    },
    [check],
  );

  const start = useCallback((action: ToolboxAction) => begin(fromSingle(action)), [begin]);
  const startBulk = useCallback((action: BulkAction) => begin({ ...action, single: false }), [begin]);

  const close = useCallback(() => {
    token.current++;
    setPhase((current) => (current.kind === "running" ? current : { kind: "closed" }));
  }, []);

  const picked = useCallback(() => {
    if (phase.kind !== "pick") return;
    const targets = phase.action.targets.filter((x) => x.selectable && phase.selected.includes(x.id));
    if (targets.length > 0) check(phase.action, targets);
  }, [phase, check]);

  const confirm = useCallback(() => {
    if (phase.kind !== "confirm") return;
    const { action, items } = phase;
    const toRun = items.filter(runnable);
    const skipped = items.filter((item) => !runnable(item));
    if (toRun.length === 0) return;
    const mine = ++token.current;
    setPhase({ kind: "running", action, items, done: [] });
    (async () => {
      const done: TargetResult[] = [];
      // One after another: CLIs of one kind share caches and lock files; a failure stops nothing.
      for (const item of toRun) {
        const result = await item.target.run().catch(
          (error: unknown): CommandResult => ({
            ok: false,
            command: item.preview?.command ?? [],
            output: "",
            error: errorText(error),
            needsReload: false,
          }),
        );
        done.push({ target: item.target, result });
        if (token.current === mine) setPhase({ kind: "running", action, items, done: [...done] });
      }
      await Promise.all(action.invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).catch(() => {});
      action.onResults?.(done);
      if (token.current === mine) setPhase({ kind: "result", action, results: done, skipped });
    })();
  }, [phase, queryClient]);

  const element =
    phase.kind === "closed" ? null : (
      <FlowModal
        phase={phase}
        hostId={hostId}
        onClose={close}
        onConfirm={confirm}
        onPicked={picked}
        onPick={(selected) => setPhase((cur) => (cur.kind === "pick" ? { ...cur, selected } : cur))}
      />
    );

  return {
    start,
    startBulk,
    busy: phase.kind === "checking" || phase.kind === "running",
    element,
  };
}

function FlowModal({
  phase,
  hostId,
  onClose,
  onConfirm,
  onPicked,
  onPick,
}: {
  phase: Exclude<Phase, { kind: "closed" }>;
  hostId: string;
  onClose(): void;
  onConfirm(): void;
  onPicked(): void;
  onPick(selected: string[]): void;
}) {
  const { p } = useLook();
  const { action } = phase;
  const secrets = action.secrets ?? [];
  const allOk = phase.kind === "result" && phase.results.length > 0 && phase.results.every((r) => r.result.ok);
  const icon =
    phase.kind === "result" ? (
      <Icon name={allOk ? "CircleCheck" : "CircleX"} size={16} color={allOk ? p.success : p.danger} />
    ) : (
      <Icon name={action.destructive ? "TriangleAlert" : "Terminal"} size={16} color={action.destructive ? p.danger : p.foreground} />
    );

  return (
    <Modal
      title={action.title}
      icon={icon}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Content>
        <Text numberOfLines={2} style={{ color: p.foreground, fontSize: 14, fontWeight: "600" }}>
          {action.subject}
        </Text>

        {phase.kind === "pick" ? (
          <>
            <Field label={t.targets.label}>
              <TargetPicker
                options={action.targets.map((x) => ({
                  id: x.id,
                  label: x.label,
                  provider: x.id,
                  disabled: !x.selectable,
                  note: x.note ?? null,
                }))}
                selected={phase.selected}
                onChange={onPick}
              />
            </Field>
            {phase.selected.length === 0 ? <Text style={{ color: p.muted, fontSize: 12 }}>{t.targets.none}</Text> : null}
            <Footer>
              <Button label={t.common.cancel} onPress={onClose} />
              <Button label={t.targets.next} tone="primary" onPress={onPicked} disabled={phase.selected.length === 0} />
            </Footer>
          </>
        ) : null}

        {phase.kind === "checking" ? <LoadingLine label={t.flow.checking} /> : null}

        {phase.kind === "confirm" || phase.kind === "running" ? (
          <ConfirmBody
            action={action}
            items={phase.items}
            done={phase.kind === "running" ? phase.done : null}
            onClose={onClose}
            onConfirm={onConfirm}
          />
        ) : null}

        {phase.kind === "result" ? (
          <ResultBody action={action} results={phase.results} skipped={phase.skipped} hostId={hostId} onClose={onClose} secrets={secrets} />
        ) : null}
      </Modal.Content>
    </Modal>
  );
}

function TargetHeader({ target, trailing }: { target: ActionTarget; trailing?: ReactNode }) {
  const { p } = useLook();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 22 }}>
      <ProviderGlyph provider={target.id} size={13} />
      <Text numberOfLines={1} style={{ flexShrink: 1, color: p.foreground, fontSize: 13, fontWeight: "600" }}>
        {target.label}
      </Text>
      {trailing}
    </View>
  );
}

function ConfirmBody({
  action,
  items,
  done,
  onClose,
  onConfirm,
}: {
  action: Flow;
  items: Planned[];
  /** Non-null while running. */
  done: TargetResult[] | null;
  onClose(): void;
  onConfirm(): void;
}) {
  const { p } = useLook();
  const secrets = action.secrets ?? [];
  const running = done !== null;
  const toRun = items.filter(runnable);
  const localWarnings = action.localWarnings ?? [];
  const sharedWarnings = action.single ? [...(items[0]?.preview?.warnings ?? []), ...localWarnings] : localWarnings;

  const plan = (item: Planned) => {
    const { preview } = item;
    return (
      <>
        {item.error ? <Notice tone="danger" text={`${t.flow.previewFailed}: ${mask(item.error, secrets)}`} /> : null}
        {!item.error ? (
          <Field label={t.flow.command}>
            {preview && preview.command.length > 0 ? (
              <CommandView command={preview.command} secrets={secrets} />
            ) : (
              <Text style={{ color: p.muted, fontSize: 13 }}>{t.flow.commandUnknown}</Text>
            )}
          </Field>
        ) : null}
        {preview?.source ? (
          <Field label={t.flow.source}>
            <Text selectable style={{ color: p.foreground, fontSize: 13 }}>
              {preview.source}
            </Text>
          </Field>
        ) : null}
        {!action.single && preview && preview.warnings.length > 0 ? (
          <View style={{ gap: 6 }}>
            {preview.warnings.map((w, i) => (
              <Notice key={i} tone="warning" text={mask(w, secrets)} />
            ))}
          </View>
        ) : null}
        {preview && !preview.supported ? <Notice tone="danger" text={t.flow.unsupported} /> : null}
      </>
    );
  };

  const stateOf = (item: Planned): string | null => {
    if (!runnable(item)) return t.flow.skipped;
    if (!done) return null;
    const finished = done.find((d) => d.target.id === item.target.id);
    if (finished) return finished.result.ok ? t.flow.succeeded : t.flow.failed;
    return done.length === toRun.indexOf(item) ? t.flow.nowRunning : t.flow.waiting;
  };

  return (
    <>
      {action.single ? (
        items[0] ? plan(items[0]) : null
      ) : (
        <View style={{ gap: 14 }}>
          {items.map((item) => {
            const state = stateOf(item);
            return (
              <View key={item.target.id} style={{ gap: 6 }}>
                <TargetHeader
                  target={item.target}
                  trailing={state ? <Text style={{ color: p.muted, fontSize: 12 }}>{state}</Text> : null}
                />
                {plan(item)}
              </View>
            );
          })}
        </View>
      )}
      {sharedWarnings.length > 0 ? (
        <Field label={t.flow.warnings}>
          <View style={{ gap: 6 }}>
            {sharedWarnings.map((w, i) => (
              <Notice key={i} tone="warning" text={mask(w, secrets)} />
            ))}
          </View>
        </Field>
      ) : null}
      {!action.single && toRun.length > 1 ? <Text style={{ color: p.muted, fontSize: 12 }}>{t.flow.sequential}</Text> : null}
      {action.bringsCode ? <Notice tone="warning" text={t.flow.unsandboxed} /> : null}
      <Footer>
        <Button label={t.common.cancel} onPress={onClose} disabled={running} />
        <Button
          label={running ? t.common.running : action.single ? t.common.run : t.flow.runOn(toRun.length)}
          tone={action.destructive ? "danger" : "primary"}
          onPress={onConfirm}
          disabled={running || toRun.length === 0}
        />
      </Footer>
    </>
  );
}

function ResultBody({
  action,
  results,
  skipped,
  hostId,
  onClose,
  secrets,
}: {
  action: Flow;
  results: TargetResult[];
  skipped: Planned[];
  hostId: string;
  onClose(): void;
  secrets: readonly string[];
}) {
  const { p } = useLook();
  const okCount = results.filter((r) => r.result.ok).length;
  // Every touched profile that asks for a reload, once each.
  const reloads = new Map<string, string>();
  let paseoReload = false;
  for (const { target, result } of results) {
    if (!result.needsReload) continue;
    if (target.reloadProvider) reloads.set(target.reloadProvider, target.label);
    else paseoReload = true;
  }

  const one = ({ result }: TargetResult) => {
    const output = result.output.trim();
    return (
      <>
        {action.single ? (
          <Text style={{ color: result.ok ? p.success : p.danger, fontSize: 13, fontWeight: "600" }}>
            {result.ok ? t.flow.succeeded : t.flow.failed}
          </Text>
        ) : null}
        {result.command.length > 0 ? (
          <Field label={t.flow.ran}>
            <CommandView command={result.command} secrets={secrets} />
          </Field>
        ) : null}
        {result.error ? (
          <Field label={t.flow.error}>
            <Notice tone="danger" text={mask(result.error, secrets)} />
          </Field>
        ) : null}
        <Field label={t.flow.output}>
          {output ? (
            <CodeBlock text={mask(output, secrets)} />
          ) : (
            <Text style={{ color: p.muted, fontSize: 13 }}>{t.flow.noOutput}</Text>
          )}
        </Field>
      </>
    );
  };

  return (
    <>
      {action.single ? (
        results[0] ? one(results[0]) : null
      ) : (
        <View style={{ gap: 14 }}>
          <Text style={{ color: okCount === results.length ? p.success : p.danger, fontSize: 13, fontWeight: "600" }}>
            {t.flow.summary(okCount, results.length - okCount, skipped.length)}
          </Text>
          {results.map((r) => (
            <View key={r.target.id} style={{ gap: 6 }}>
              <TargetHeader
                target={r.target}
                trailing={
                  <Icon name={r.result.ok ? "CircleCheck" : "CircleX"} size={13} color={r.result.ok ? p.success : p.danger} />
                }
              />
              {one(r)}
            </View>
          ))}
          {skipped.map((item) => (
            <TargetHeader
              key={item.target.id}
              target={item.target}
              trailing={<Text style={{ color: p.muted, fontSize: 12 }}>{t.flow.skipped}</Text>}
            />
          ))}
        </View>
      )}
      {[...reloads].map(([provider, label]) => (
        <Fragment key={provider}>
          <ReloadIdle provider={provider} hostId={hostId} label={action.single ? null : label} />
        </Fragment>
      ))}
      {paseoReload ? <Notice tone="warning" text={t.flow.reloadNeededPaseo} /> : null}
      <Footer>
        <Button label={t.common.close} onPress={onClose} />
      </Footer>
    </>
  );
}

/**
 * Reloads this provider's idle agents. `reload()` interrupts a running turn, so each agent is
 * refetched right before and skipped unless it is still idle.
 */
function ReloadIdle({ provider, hostId, label }: { provider: string; hostId: string; label: string | null }) {
  const { p } = useLook();
  const paseo = usePaseo();
  const toast = useToast();
  // Screens get no plugin state host, so state hooks (useAgents) throw here: read through the SDK.
  void hostId;
  const agents = useQuery({
    queryKey: ["toolbox", "reload-agents", provider],
    queryFn: async () => (await paseo.agents.list()).entries.map((e) => e.agent),
    staleTime: 5_000,
  });
  const list = agents.data ?? [];
  const idle = list.filter((a) => a.provider === provider && a.status === "idle").map((a) => a.id);
  const busy = list.filter((a) => a.provider === provider && (a.status === "running" || a.status === "initializing"));
  const [pending, setPending] = useState(false);

  const reload = useCallback(() => {
    if (pending) return;
    setPending(true);
    const refs: readonly string[] = idle;
    (async () => {
      let done = 0;
      let skipped = 0;
      for (const ref of refs) {
        const handle = paseo.agents.ref(ref);
        const fresh = await handle.refresh();
        if (fresh?.agent.status !== "idle") {
          skipped++;
          continue;
        }
        await handle.reload();
        done++;
      }
      toast.show(t.flow.reloaded(done), { variant: "success" });
      if (skipped > 0) toast.show(t.flow.reloadSkipped(skipped), { variant: "warning" });
    })()
      .catch((error: unknown) => toast.error(`${t.flow.reloadFailed}: ${errorText(error)}`))
      .finally(() => setPending(false));
  }, [idle, paseo, pending, toast]);

  return (
    <View style={{ gap: 8 }}>
      <Notice tone="warning" text={label ? t.flow.reloadFor(label) : t.flow.reloadNeeded} />
      <Text style={{ color: p.muted, fontSize: 12 }}>{t.flow.reloadRace}</Text>
      {busy.length > 0 ? <Text style={{ color: p.muted, fontSize: 12 }}>{t.flow.reloadBusy(busy.length)}</Text> : null}
      <View style={{ flexDirection: "row" }}>
        <Button
          icon="RotateCw"
          label={pending ? t.flow.reloading : idle.length > 0 ? t.flow.reloadIdle(idle.length) : t.flow.reloadNoIdle}
          onPress={reload}
          disabled={pending || idle.length === 0}
        />
      </View>
    </View>
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

function Footer({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>{children}</View>;
}

/** argv as a shell-like line; a file-edit action (`["write-file", path]`) as a sentence. */
function CommandView({ command, secrets }: { command: readonly string[]; secrets: readonly string[] }) {
  const { p } = useLook();
  if (command[0] === "write-file" && command.length === 2) {
    return (
      <Text selectable style={{ color: p.foreground, fontSize: 13 }}>
        {t.flow.writesFile(command[1])}
      </Text>
    );
  }
  return <CodeBlock text={mask(formatArgv(command), secrets)} />;
}

export function formatArgv(argv: readonly string[]): string {
  return argv.map((arg) => (arg === "" || /[\s"'$`\\|&;<>(){}*?!#~]/.test(arg) ? `'${arg.replace(/'/g, `'\\''`)}'` : arg)).join(" ");
}

function mask(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 3) out = out.split(secret).join("••••");
  }
  return out;
}
