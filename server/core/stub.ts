// Placeholder adapter used until a worker implements the real one. Owned by the orchestrator.
import type { ProviderAdapter } from "./adapter";
import { unsupported } from "./adapter";

export function stubAdapter(name: string, defaultCommand: string, configHomeEnv: string | null): ProviderAdapter {
  const notYet = async () => unsupported([defaultCommand], `${name} (not implemented yet)`);
  return {
    defaultCommand,
    configHomeEnv,
    auth: async () => ({ state: "unknown", method: null, account: null, detail: "not implemented yet" }),
    listMcp: async () => [],
    previewMcpAdd: async () => ({ command: [], source: null, warnings: ["not implemented yet"], supported: false }),
    addMcp: notYet,
    removeMcp: notYet,
    loginMcp: notYet,
    listInstalled: async () => [],
    listCatalog: async () => ({ plugins: [], marketplaces: [] }),
    previewAction: async () => ({ command: [], source: null, warnings: ["not implemented yet"], supported: false }),
    runAction: notYet,
    runMarketplaceAction: notYet,
  };
}
