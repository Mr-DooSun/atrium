// Pure tree building: no React, no Paseo runtime. Keys are entity ref keys.
//
// Depth means parentage and nothing else: an agent sits directly under the agent that started
// it, wherever it runs inside the same project; a parent in another project makes it a root of its own. Where it runs (a worktree workspace) is an attribute of its row, not a
// level of the tree. Top-level rows are workspaces whose agents have no parent, as in Paseo's
// own sidebar.

/** Public workspace snapshot fields, keyed by the host-qualified workspace ref key. */
export interface WorkspaceContext {
  readonly id: string;
  readonly hostId: string;
  readonly directory: string;
  readonly name: string;
  readonly branch: string | null;
}

export interface ParentWorktree {
  readonly name: string;
  readonly branch: string | null;
  readonly differs: boolean;
}

export interface TreeInput {
  /** Workspace keys in display order. */
  readonly workspaces: readonly string[];
  /** Agent keys in display order. */
  readonly agents: readonly string[];
  readonly workspaceProject: ReadonlyMap<string, string>;
  /** The agent that created the workspace, when Paseo recorded one. */
  readonly workspaceParentAgent: ReadonlyMap<string, string | null>;
  /** May include agents outside the display list, so their children retain parent context. */
  readonly agentWorkspace: ReadonlyMap<string, string>;
  readonly agentParent: ReadonlyMap<string, string | null>;
  /** Global public workspace snapshots; omission keeps parent context unavailable. */
  readonly workspaceContext?: ReadonlyMap<string, WorkspaceContext>;
}

export type TreeNode =
  | {
      readonly kind: "workspace";
      readonly key: string;
      /** Set when the workspace has exactly one root agent; its row stands for that agent. */
      readonly agentKey: string | null;
      /** Parent context of the single root agent represented by this workspace row. */
      readonly parentWorktree: ParentWorktree | null;
      readonly children: readonly TreeNode[];
    }
  | {
      readonly kind: "agent";
      readonly key: string;
      /**
       * True for the first agent (by display order) in its workspace. A workspace's diff is one
       * number for the whole worktree, so only this agent's row carries it.
       */
      readonly ownsWorkspace: boolean;
      /** The actual parent's workspace, even when that parent belongs to another project. */
      readonly parentWorktree: ParentWorktree | null;
      readonly children: readonly TreeNode[];
    };

export interface ProjectTree {
  readonly projectKey: string;
  readonly roots: readonly TreeNode[];
}

export function buildTree(input: TreeInput): ProjectTree[] {
  const { workspaces, agents, agentWorkspace, agentParent, workspaceParentAgent } = input;
  const displayedWorkspaces = new Set(workspaces);
  // Global context can include hidden workspaces; their agents must not capture visible rows.
  const known = new Set(agents.filter((a) => displayedWorkspaces.has(agentWorkspace.get(a) ?? "")));
  const projectOfWorkspace = (workspace: string | undefined) =>
    workspace ? (input.workspaceProject.get(workspace) ?? null) : null;
  const projectOfAgent = (agent: string) => projectOfWorkspace(agentWorkspace.get(agent));
  const sameProject = (a: string, b: string) => {
    const pa = projectOfAgent(a);
    return pa !== null && pa === projectOfAgent(b);
  };

  // Parent links that point at a known agent, with cycles cut.
  const parentOf = new Map<string, string>();
  for (const agent of known) {
    const parent = agentParent.get(agent) ?? null;
    // Parentage only counts inside one project: an agent started from another project's session
    // is a root of its own project, so every project shows its own sessions.
    if (parent && known.has(parent) && parent !== agent && sameProject(agent, parent)) parentOf.set(agent, parent);
  }
  for (const agent of known) {
    const seen = new Set<string>([agent]);
    let current = parentOf.get(agent);
    while (current) {
      if (seen.has(current)) {
        parentOf.delete(agent);
        break;
      }
      seen.add(current);
      current = parentOf.get(current);
    }
  }

  const childAgents = new Map<string, string[]>();
  const rootAgentsOf = new Map<string, string[]>();
  const agentCount = new Map<string, number>();
  for (const agent of agents) {
    if (!known.has(agent)) continue;
    const workspace = agentWorkspace.get(agent)!;
    agentCount.set(workspace, (agentCount.get(workspace) ?? 0) + 1);
    const parent = parentOf.get(agent);
    if (parent) push(childAgents, parent, agent);
    else push(rootAgentsOf, workspace, agent);
  }

  // A workspace with no agent of its own yet still belongs under the agent that created it.
  const emptyCreated = new Map<string, string[]>();
  const placedUnderAgent = new Set<string>();
  for (const workspace of workspaces) {
    if (agentCount.has(workspace)) continue;
    const creator = workspaceParentAgent.get(workspace) ?? null;
    if (creator && known.has(creator) && projectOfWorkspace(workspace) === projectOfAgent(creator)) {
      push(emptyCreated, creator, workspace);
      placedUnderAgent.add(workspace);
    }
  }

  const firstInWorkspace = new Map<string, string>();
  for (const agent of agents) {
    const workspace = agentWorkspace.get(agent);
    if (workspace && known.has(agent) && !firstInWorkspace.has(workspace)) {
      firstInWorkspace.set(workspace, agent);
    }
  }
  function parentWorktree(agent: string): ParentWorktree | null {
    const parent = agentParent.get(agent);
    if (!parent || parent === agent) return null;
    // For displayed parents in the same project, respect the exact edge the nesting guards kept.
    if (known.has(parent) && sameProject(agent, parent)) {
      if (parentOf.get(agent) !== parent) return null;
    } else {
      // Context may cross project/display boundaries; reject cycles there without adding rows.
      const seen = new Set([agent]);
      let current: string | null | undefined = parent;
      while (current) {
        if (seen.has(current)) return null;
        seen.add(current);
        current = agentParent.get(current);
      }
    }
    const parentWorkspace = agentWorkspace.get(parent);
    const childWorkspace = agentWorkspace.get(agent);
    if (!parentWorkspace || !childWorkspace) return null;
    const context = input.workspaceContext?.get(parentWorkspace);
    if (!context) return null;
    const childContext = input.workspaceContext?.get(childWorkspace);
    // Names and branches can coincide across different checkouts. Identity and paths decide.
    const same = parentWorkspace === childWorkspace || (childContext !== undefined &&
      context.hostId === childContext.hostId && (context.id === childContext.id ||
        (context.directory.length > 0 && childContext.directory.length > 0 &&
          directoryKey(context.directory) === directoryKey(childContext.directory))));
    return { name: context.name, branch: context.branch, differs: !same };
  }

  const agentNode = (agent: string): TreeNode => ({
    kind: "agent",
    key: agent,
    ownsWorkspace: firstInWorkspace.get(agentWorkspace.get(agent)!) === agent,
    parentWorktree: parentWorktree(agent),
    children: childrenOfAgent(agent),
  });

  // Siblings that share a workspace sit together, in order of that workspace's first sibling.
  function groupByWorkspace(siblings: readonly string[]): string[] {
    const groups = new Map<string, string[]>();
    for (const agent of siblings) push(groups, agentWorkspace.get(agent)!, agent);
    return [...groups.values()].flat();
  }

  const visiting = new Set<string>();
  function childrenOfAgent(agent: string): TreeNode[] {
    if (visiting.has(agent)) return [];
    visiting.add(agent);
    const nodes: TreeNode[] = [
      ...groupByWorkspace(childAgents.get(agent) ?? []).map(agentNode),
      ...(emptyCreated.get(agent) ?? []).map(workspaceNode),
    ];
    visiting.delete(agent);
    return nodes;
  }

  function workspaceNode(workspace: string): TreeNode {
    const roots = rootAgentsOf.get(workspace) ?? [];
    if (roots.length === 1) {
      return {
        kind: "workspace",
        key: workspace,
        agentKey: roots[0],
        parentWorktree: parentWorktree(roots[0]),
        children: childrenOfAgent(roots[0]),
      };
    }
    return {
      kind: "workspace",
      key: workspace,
      agentKey: null,
      parentWorktree: null,
      children: groupByWorkspace(roots).map(agentNode),
    };
  }

  // Top level: workspaces holding a root agent, or holding nothing and claimed by no agent.
  // A workspace whose agents all have parents elsewhere appears only through those agents.
  const byProject = new Map<string, string[]>();
  for (const workspace of workspaces) {
    if (placedUnderAgent.has(workspace)) continue;
    const hasAgents = agentCount.has(workspace);
    if (hasAgents && !rootAgentsOf.has(workspace)) continue;
    const project = input.workspaceProject.get(workspace);
    if (project) push(byProject, project, workspace);
  }
  return [...byProject].map(([projectKey, roots]) => ({
    projectKey,
    roots: roots.map(workspaceNode),
  }));
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** SDK directory paths are absolute; trailing separators do not create a different checkout. */
function directoryKey(directory: string): string {
  return directory.replace(/\/+$/, "") || "/";
}
