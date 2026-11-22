// Loads a client module (which imports react-native, the Paseo client SDK, ...) into a vm sandbox with
// those imports stubbed, and renders its components with a tiny synchronous hook runtime. Lets tests
// reach logic that lives inside components, including non-exported ones, without a React renderer.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface El { type: unknown; props: Record<string, Any> }

/** Any named import resolves to a no-op function carrying its name; strings stand in for RN components. */
export function stubModule(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, {
    get(target, key) {
      if (key in target) return target[key as string];
      if (key === "__esModule") return true;
      if (typeof key === "symbol") return undefined;
      return { [key]: () => null }[key];
    },
  });
}

export const reactNativeStub = new Proxy({} as Record<string, unknown>, {
  get: (_t, key) => (key === "__esModule" ? true : typeof key === "string" ? key : undefined),
});

export const jsxRuntime = {
  jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
  jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
  Fragment: "Fragment",
};

export interface Mounted<P> {
  /** The element tree of the latest render. */
  tree(): Any;
  /** Renders again with new props. */
  update(props: P): Any;
  renders(): number;
}

/** A synchronous hook runtime: state setters re-render at once; effects are recorded, never run. */
export function createReact() {
  let slots: unknown[] = [];
  let index = 0;
  let rerender: (() => void) | null = null;
  const react = {
    useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
      const i = index++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? (initial as () => T)() : initial;
      const set = (next: T | ((prev: T) => T)) => {
        const value = typeof next === "function" ? (next as (prev: T) => T)(slots[i] as T) : next;
        if (Object.is(value, slots[i])) return;
        slots[i] = value;
        rerender?.();
      };
      return [slots[i] as T, set];
    },
    useRef<T>(initial: T) {
      const i = index++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i] as { current: T };
    },
    useMemo<T>(factory: () => T) { index++; return factory(); },
    useCallback<T>(fn: T) { index++; return fn; },
    useEffect() { index++; },
    useLayoutEffect() { index++; },
    useSyncExternalStore<T>(_subscribe: unknown, getSnapshot: () => T) { index++; return getSnapshot(); },
    createContext: () => ({ Provider: "Provider" }),
    memo: <T>(component: T) => component,
  };
  function mount<P>(component: (props: P) => Any, props: P): Mounted<P> {
    let current = props;
    let tree: Any;
    let renders = 0;
    const render = () => {
      index = 0;
      renders++;
      tree = component(current);
    };
    slots = [];
    rerender = render;
    render();
    return { tree: () => tree, update: (next) => { current = next; render(); return tree; }, renders: () => renders };
  }
  return { react, mount };
}

/** Objects built inside the sandbox have the sandbox's prototypes; compare them through JSON. */
export const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null));

/** Every element in a tree, parents first. */
export function walk(node: Any, visit: (el: El) => void): void {
  if (node === null || node === undefined || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return; }
  if ("type" in node && "props" in node) {
    visit(node as El);
    walk((node as El).props.children, visit);
  }
}
export function findAll(tree: Any, test: (el: El) => boolean): El[] {
  const found: El[] = [];
  walk(tree, (el) => { if (test(el)) found.push(el); });
  return found;
}
export const typeName = (el: El): string => typeof el.type === "string" ? el.type : (el.type as { name?: string })?.name ?? "";
/** All text of a tree, children of Text elements joined. */
export function textOf(tree: Any): string {
  const parts: string[] = [];
  const visit = (node: Any) => {
    if (typeof node === "string" || typeof node === "number") parts.push(String(node));
    else if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object" && "props" in node) visit(node.props.children);
  };
  visit(tree);
  return parts.join("");
}

export interface LoadOptions {
  /** Module id → replacement exports (matched as written in the import). */
  modules?: Record<string, unknown>;
  /** Extra globals of the sandbox (localStorage, console, ...). */
  globals?: Record<string, unknown>;
  /** Replacement for `react`; defaults to a throwaway runtime. */
  react?: unknown;
}

/** Transpiles `file` (relative to the repo root) and returns its exports plus the named internals in `expose`. */
export function loadClient<T = Record<string, Any>>(file: string, expose: string[] = [], options: LoadOptions = {}): T {
  const source = readFileSync(join(process.cwd(), file), "utf8")
    + (expose.length ? `\n;Object.assign(exports, { ${expose.join(", ")} });\n` : "");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const require = (id: string) => {
    if (options.modules && id in options.modules) return options.modules[id];
    if (id === "react") return options.react ?? createReact().react;
    if (id === "react/jsx-runtime") return jsxRuntime;
    if (id === "react-native") return reactNativeStub;
    return stubModule();
  };
  runInNewContext(js, { exports, require, console, Intl, URL, setTimeout, clearTimeout, Object, Error, ...options.globals });
  return exports as T;
}
