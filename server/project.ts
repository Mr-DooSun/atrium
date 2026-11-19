import type { PluginServerContext } from "@getpaseo/plugin/server";
import { removeProject } from "../shared/project-rpc";
import { failure, run } from "./core/exec.ts";
import { resolvePaseoCommand } from "./core/paseo-bin.ts";

export function registerProject(server: PluginServerContext) {
  server.handle(removeProject, async ({ projectId }) => {
    const paseo = await resolvePaseoCommand();
    // Same daemon home as this plugin's daemon when Paseo sets one; the CLI default otherwise.
    const home = process.env.PASEO_HOME ? ["--home", process.env.PASEO_HOME] : [];

    // `project delete` reports success for an id it does not know, so check the id first:
    // otherwise a wrong id would look removed while nothing changed.
    const list = await run(paseo, ["project", "ls", "--json", ...home], { timeoutMs: 30_000 });
    const listError = failure(list);
    if (listError) throw new Error(listError);
    const projects = JSON.parse(list.stdout) as { projectId?: string }[];
    if (!projects.some((p) => p.projectId === projectId)) {
      throw new Error(`Project ${projectId} is not registered on this daemon`);
    }

    // argv only, and "--" so an id can never be read as an option.
    const result = await run(paseo, ["project", "delete", ...home, "--", projectId], { timeoutMs: 60_000 });
    const error = failure(result);
    if (error) {
      console.error("project delete failed", { projectId, error });
      throw new Error(error);
    }
    return { ok: true as const };
  });
}
