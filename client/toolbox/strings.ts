import { createContext, useContext, useMemo } from "react";
import { defineTranslations, useTranslation } from "@getpaseo/plugin/client";
import { localizeDiagnostic } from "./diagnostics";
import en from "./locales/en";
import ja from "./locales/ja";
import zhCN from "./locales/zh-CN";
import es from "./locales/es";
import fr from "./locales/fr";
import ptBR from "./locales/pt-BR";
import ru from "./locales/ru";
import ar from "./locales/ar";
import ko from "./locales/ko";

export const toolboxText = defineTranslations({
  resources: { en, ko, ja, "zh-CN": zhCN, zh: zhCN, es, fr, "pt-BR": ptBR, pt: ptBR, ru, ar },
});

const ToolboxTextContext = createContext<Strings | null>(null);
export const ToolboxTextProvider = ToolboxTextContext.Provider;

export function useToolboxText(): Strings {
  const strings = useContext(ToolboxTextContext);
  if (!strings) throw new Error("toolbox: ToolboxTextProvider missing");
  return strings;
}

export function useToolboxStrings() {
  const { t, locale } = useTranslation(toolboxText);
  return useMemo(() => toolboxStrings(t, new Intl.NumberFormat(locale)), [t, locale]);
}

export type Strings = ReturnType<typeof toolboxStrings>;
type Translate = ReturnType<typeof useTranslation<typeof en>>["t"];

function toolboxStrings(t: Translate, numbers: Intl.NumberFormat) {
  return {
    diagnostic: (text: string) => localizeDiagnostic(t, text),
    back: {
      label: t("back.label"),
      toChat: (title: string) => t("back.toChat", { title }),
    },
    common: {
      refresh: t("common.refresh"),
      cancel: t("common.cancel"),
      close: t("common.close"),
      run: t("common.run"),
      running: t("common.running"),
      loading: t("common.loading"),
      retry: t("common.retry"),
      none: t("common.none"),
      default: t("common.default"),
    },
    auth: {
      logged_in: t("auth.logged_in"),
      logged_out: t("auth.logged_out"),
      not_installed: t("auth.not_installed"),
      unknown: t("auth.unknown"),
      disabledProfile: t("auth.disabledProfile"),
    },
    profile: {
      label: t("profile.label"),
      all: t("profile.all"),
      kindHeader: (kind: string, n: number) => t("profile.kindHeader", { kind, n }),
      notListed: (labels: string) => t("profile.notListed", { labels }),
      skippedProfiles: (labels: string) => t("profile.skippedProfiles", { labels }),
      loadingProfiles: (labels: string) => t("profile.loadingProfiles", { labels }),
      none: t("profile.none"),
      noneOfKind: (kind: string) => t("profile.noneOfKind", { kind }),
      notInstalledTitle: t("profile.notInstalledTitle"),
      notInstalledBody: (command: string) => t("profile.notInstalledBody", { command }),
      loggedOutTitle: t("profile.loggedOutTitle"),
      loggedOutBody: t("profile.loggedOutBody"),
      loadError: t("profile.loadError"),
      unmanaged: (id: string) => t("profile.unmanaged", { id }),
    },
    scope: {
      account: t("scope.account"),
      projectOwn: t("scope.projectOwn"),
      projectShared: t("scope.projectShared"),
      project: t("scope.project"),
      plugin: t("scope.plugin"),
      unknown: t("scope.unknown"),
      paseo: t("scope.paseo"),
      connector: t("scope.connector"),
      synced: t("scope.synced"),
      basis: (name: string) => t("scope.basis", { name }),
      noProject: t("scope.noProject"),
      sharedOnce: (label: string) => t("scope.sharedOnce", { label }),
      sharedOnceForm: t("scope.sharedOnceForm"),
    },
    strip: {
      absent: t("strip.absent"),
      loading: t("strip.loading"),
      unlisted: t("strip.unlisted"),
      error: t("strip.error"),
    },
    targets: {
      label: t("targets.label"),
      pickTitle: t("targets.pickTitle"),
      next: t("targets.next"),
      none: t("targets.none"),
      noteLoggedOut: t("targets.noteLoggedOut"),
      noteNotInstalled: t("targets.noteNotInstalled"),
      noteHas: t("targets.noteHas"),
      noteMissing: t("targets.noteMissing"),
    },
    mcp: {
      servers: t("mcp.servers"),
      count: (n: number) => t("mcp.count", { n }),
      searchPlaceholder: t("mcp.searchPlaceholder"),
      noMatch: t("mcp.noMatch"),
      needsLoginGroup: (n: number) => t("mcp.needsLoginGroup", { n }),
      otherGroup: (n: number) => t("mcp.otherGroup", { n }),
      empty: t("mcp.empty"),
      add: t("mcp.add"),
      remove: t("mcp.remove"),
      login: t("mcp.login"),
      loadError: t("mcp.loadError"),
      status: {
        connected: t("mcp.status.connected"),
        failed: t("mcp.status.failed"),
        needs_auth: t("mcp.status.needs_auth"),
        pending: t("mcp.status.pending"),
        disabled: t("mcp.status.disabled"),
        unknown: t("mcp.status.unknown"),
      },
      form: {
        title: t("mcp.form.title"),
        name: t("mcp.form.name"),
        namePlaceholder: t("mcp.form.namePlaceholder"),
        scope: t("mcp.form.scope"),
        transport: t("mcp.form.transport"),
        command: t("mcp.form.command"),
        commandPlaceholder: t("mcp.form.commandPlaceholder"),
        url: t("mcp.form.url"),
        urlPlaceholder: t("mcp.form.urlPlaceholder"),
        args: t("mcp.form.args"),
        argsPlaceholder: t("mcp.form.argsPlaceholder"),
        env: t("mcp.form.env"),
        headers: t("mcp.form.headers"),
        key: t("mcp.form.key"),
        value: t("mcp.form.value"),
        addRow: t("mcp.form.addRow"),
        removeRow: t("mcp.form.removeRow"),
        scopeNeedsProject: t("mcp.form.scopeNeedsProject"),
        project: (path: string) => t("mcp.form.project", { path }),
        secretNote: t("mcp.form.secretNote"),
        next: t("mcp.form.next"),
        invalidName: t("mcp.form.invalidName"),
        invalidTarget: t("mcp.form.invalidTarget"),
      },
      removeTitle: t("mcp.removeTitle"),
      loginTitle: t("mcp.loginTitle"),
      removeWarning: t("mcp.removeWarning"),
      removeUserLevel: t("mcp.removeUserLevel"),
      loginWarning: t("mcp.loginWarning"),
      shared: t("mcp.shared"),
      sharedRemoveWarning: t("mcp.sharedRemoveWarning"),
      addToRest: t("mcp.addToRest"),
      loginIn: (label: string) => t("mcp.loginIn", { label }),
      copyNote: t("mcp.copyNote"),
      profilesHaving: (n: number, total: number) => t("mcp.profilesHaving", { n, total }),
    },
    plugins: {
      tabs: {
        paseo: t("plugins.tabs.paseo"),
        claude: t("plugins.tabs.claude"),
        codex: t("plugins.tabs.codex"),
        antigravity: t("plugins.tabs.antigravity"),
      },
      sections: {
        installed: t("plugins.sections.installed"),
        browse: t("plugins.sections.browse"),
        marketplaces: t("plugins.sections.marketplaces"),
      },
      installedEmpty: t("plugins.installedEmpty"),
      browseEmpty: t("plugins.browseEmpty"),
      marketplacesEmpty: t("plugins.marketplacesEmpty"),
      searchPlaceholder: t("plugins.searchPlaceholder"),
      installedBadge: t("plugins.installedBadge"),
      enabled: t("plugins.enabled"),
      disabled: t("plugins.disabled"),
      loadError: t("plugins.loadError"),
      pluginCount: (n: number) => t("plugins.pluginCount", { n }),
      marketplaceSourcePlaceholder: t("plugins.marketplaceSourcePlaceholder"),
      updateAvailable: t("plugins.updateAvailable"),
      actions: {
        install: t("plugins.actions.install"),
        uninstall: t("plugins.actions.uninstall"),
        enable: t("plugins.actions.enable"),
        disable: t("plugins.actions.disable"),
        update: t("plugins.actions.update"),
        add: t("plugins.actions.add"),
        remove: t("plugins.actions.remove"),
      },
      titles: {
        install: t("plugins.titles.install"),
        uninstall: t("plugins.titles.uninstall"),
        enable: t("plugins.titles.enable"),
        disable: t("plugins.titles.disable"),
        update: t("plugins.titles.update"),
        marketplaceAdd: t("plugins.titles.marketplaceAdd"),
        marketplaceRemove: t("plugins.titles.marketplaceRemove"),
        marketplaceUpdate: t("plugins.titles.marketplaceUpdate"),
      },
      catalogShown: (shown: number, total: number) => t("plugins.catalogShown", { shown: numbers.format(shown), total: numbers.format(total) }),
      loadMore: (n: number) => t("plugins.loadMore", { n }),
      antigravityBrowseNote: t("plugins.antigravityBrowseNote"),
      marketplaceAddWarning: t("plugins.marketplaceAddWarning"),
      marketplaceRemoveWarning: t("plugins.marketplaceRemoveWarning"),
      marketplaceUpdateWarning: t("plugins.marketplaceUpdateWarning"),
      installToRest: t("plugins.installToRest"),
      installedIn: (n: number, total: number) => t("plugins.installedIn", { n, total }),
      catalogFrom: (label: string) => t("plugins.catalogFrom", { label }),
      catalogNoProfile: t("plugins.catalogNoProfile"),
      marketplacesPerProfile: t("plugins.marketplacesPerProfile"),
    },
    flow: {
      checking: t("flow.checking"),
      previewFailed: t("flow.previewFailed"),
      command: t("flow.command"),
      writesFile: (path: string) => t("flow.writesFile", { path }),
      commandUnknown: t("flow.commandUnknown"),
      source: t("flow.source"),
      warnings: t("flow.warnings"),
      unsandboxed: t("flow.unsandboxed"),
      unsupported: t("flow.unsupported"),
      succeeded: t("flow.succeeded"),
      failed: t("flow.failed"),
      ran: t("flow.ran"),
      output: t("flow.output"),
      noOutput: t("flow.noOutput"),
      error: t("flow.error"),
      reloadNeeded: t("flow.reloadNeeded"),
      reloadNeededPaseo: t("flow.reloadNeededPaseo"),
      reloadIdle: (n: number) => t("flow.reloadIdle", { n }),
      reloadNoIdle: t("flow.reloadNoIdle"),
      reloadBusy: (n: number) => t("flow.reloadBusy", { n }),
      reloadRace: t("flow.reloadRace"),
      reloading: t("flow.reloading"),
      reloaded: (n: number) => t("flow.reloaded", { n }),
      reloadSkipped: (n: number) => t("flow.reloadSkipped", { n }),
      reloadFailed: t("flow.reloadFailed"),
      runOn: (n: number) => t("flow.runOn", { n }),
      sequential: t("flow.sequential"),
      skipped: t("flow.skipped"),
      waiting: t("flow.waiting"),
      nowRunning: t("flow.nowRunning"),
      summary: (ok: number, failed: number, skipped: number) =>
        skipped > 0 ? t("flow.summarySkipped", { ok, failed, skipped }) : t("flow.summary", { ok, failed }),
      reloadFor: (label: string) => t("flow.reloadFor", { label }),
    },
  };
}
