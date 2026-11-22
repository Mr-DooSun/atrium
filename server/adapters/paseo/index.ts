// Compatibility tombstone for older imports. Toolbox no longer registers this adapter.
// Native Paseo management owns discovery, previews, installs and plugin lifecycle actions.
import type { PluginEcosystemAdapter } from "../../core/adapter";
import { PASEO_NATIVE_GALLERY_NOTICE } from "../../../shared/toolbox/warnings";

const preview = async () => ({ command: [], source: null, warnings: [PASEO_NATIVE_GALLERY_NOTICE], supported: false });
const refused = async () => ({ ok: false, command: [], output: "", error: PASEO_NATIVE_GALLERY_NOTICE, needsReload: false });

/** @deprecated Use the target host's native Settings > Plugins. Performs no I/O. */
export const paseoPluginsAdapter: PluginEcosystemAdapter = {
  async listInstalled() { throw new Error(PASEO_NATIVE_GALLERY_NOTICE); },
  async listCatalog() { throw new Error(PASEO_NATIVE_GALLERY_NOTICE); },
  previewAction: preview,
  runAction: refused,
  previewSource: preview,
  installSource: refused,
  previewMarketplaceAction: preview,
  runMarketplaceAction: refused,
  async checkUpdates() { return new Map(); },
};
