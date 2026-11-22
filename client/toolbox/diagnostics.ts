import type { useTranslation } from "@getpaseo/plugin/client";
import { PASEO_NATIVE_GALLERY_NOTICE } from "../../shared/toolbox/warnings";
import type en from "./locales/en";

type Translate = ReturnType<typeof useTranslation<typeof en>>["t"];
type Diagnostic = typeof en.diagnostic;
type StaticKey = { [K in keyof Diagnostic]: Diagnostic[K] extends `${string}{{${string}` ? never : K }[keyof Diagnostic];

// Adapters and older clients use plain strings on the wire. Match only diagnostics we own;
// preserve provider output, IPC errors, and already-redacted values as written.
const exact = {
  "agy documents no plugin update command": "agyUpdate",
  "mcpServers is not an object": "invalidMcpServers",
  "This marketplace source or name is not supported by this CLI": "invalidMarketplace",
  "프로젝트 디렉터리를 선택하거나 user 범위를 지정하세요.": "projectRequired",
  "project scope needs a workspace directory": "projectRequired",
  "timed out": "timeout",
  "Claude CLI 응답 시간이 초과되었습니다.": "timeout",
  "output exceeded the size limit": "outputLimit",
  "Claude CLI 출력이 크기 제한을 초과했습니다.": "outputLimit",
  "Use a valid Codex MCP server name.": "invalidName",
  "This MCP name is not supported by this CLI": "invalidName",
  "This MCP name or scope is not supported by this CLI": "invalidNameOrScope",
  "Codex MCP changes apply to this profile's global configuration.": "codexScope",
  "Codex supports stdio and streamable HTTP.": "codexTransport",
  "The Codex MCP add CLI cannot set custom headers.": "codexHeaders",
  "Streamable HTTP requires an HTTP(S) URL and accepts no stdio arguments or environment values.": "httpTarget",
  "Use valid environment variable names.": "invalidEnv",
  "MCP OAuth requires a terminal that can keep the login process open and accept callback input.": "codexOAuth",
  "Run the displayed command in a terminal on the daemon host with this profile's environment. Open the authorization URL and paste the callback URL into that terminal.": "codexTerminal",
  "agy has no CLI command for MCP login: OAuth runs in the browser automatically when the server connects. Open /mcp inside agy to reconnect.": "agyOAuth",
  "Antigravity supports Streamable HTTP only; legacy SSE is not supported": "agyTransport",
  "Choose a Codex plugin and its marketplace.": "choosePlugin",
  "invalid plugin id": "choosePlugin",
  "env values and headers are stored in plain text in the config file.": "plainSecrets",
  "Stdio environment values are passed as process arguments and can be visible to other local processes while Codex runs.": "processSecrets",
  "agy has no `mcp add` command in its docs; this edits the documented config file directly.": "agyFile",
  "Marketplace installs need an active agy sign-in. Plugins with required variables install disabled.": "agyLoginNeeded",
  "Installs third-party code from a GitHub repository.": "thirdParty",
  [PASEO_NATIVE_GALLERY_NOTICE]: "paseoNative",
  "agy is not installed (or not on PATH)": "agyMissing",
  "This plugin source is not a marketplace you added. Install it only if you trust the source.": "untrustedMarketplace",
  "Claude installs plugins from marketplace sources only.": "claudeMarketplaceOnly",
  "A marketplace that is not added yet is also added to the user settings.": "marketplaceAutoAdd",
  "Could not read the login status.": "authUnknown",
  // Korean text sent by daemons before the Claude adapter switched to English (0.3.1 and older).
  // Keep for one release, then remove with the Korean entries above and in localizeDiagnostic.
  "마켓플레이스에 등록되지 않은 출처의 플러그인입니다. 신뢰하는 출처인지 확인하세요.": "untrustedMarketplace",
  "Claude는 마켓플레이스 출처만 지원합니다.": "claudeMarketplaceOnly",
  "아직 추가되지 않은 마켓플레이스는 user 설정에 함께 추가됩니다.": "marketplaceAutoAdd",
  "인증 상태를 읽을 수 없습니다.": "authUnknown",
  // Source validation (server/core/source.ts), shown when a source install preview is refused.
  "Git source must be an https URL, git@host:owner/repo, or owner/repo.": "sourceGitForm",
  "Git source path is invalid.": "sourceGitPath",
  "Git URLs must use https.": "sourceHttps",
  "Marketplace URLs must use https.": "sourceHttps",
  "Remove credentials from the Git URL.": "sourceCredentials",
  "Remove credentials from the marketplace URL.": "sourceCredentials",
  "Git URLs must not have a query or fragment.": "sourceGitQuery",
  "Git URL needs a valid host and repository path.": "sourceGitHost",
  "Git ref is invalid.": "sourceRef",
  "Plugin path must be a relative path inside the source.": "sourcePath",
  "Give the version once.": "sourceVersionTwice",
  "npm package name is invalid.": "sourceNpmName",
  "npm version must be an exact version or a dist-tag.": "sourceNpmVersion",
  "Directory must be an absolute path.": "sourceAbsolute",
  "Path is not a directory.": "sourceNotDir",
  "Directory does not exist.": "sourceNoDir",
  "Marketplace URL must not have a fragment.": "sourceMarketFragment",
  "Marketplace URL host is invalid.": "sourceMarketHost",
  "Marketplace URL is invalid.": "sourceMarketUrl",
  "Marketplace source must be owner/repo, an https URL, or an absolute path.": "sourceMarketForm",
} satisfies Record<string, StaticKey>;

// Source checks name the field first ("Git source is empty."); the field is clear from the form.
const staticPatterns: readonly (readonly [StaticKey, RegExp])[] = [
  ["sourceEmpty", /^.+ is empty\.$/],
  ["sourceTooLong", /^.+ is too long\.$/],
  ["sourceControl", /^.+ contains control characters\.$/],
  ["sourceDash", /^.+ must not start with "-"\.$/],
];

type DetailKey = { [K in keyof Diagnostic]: Diagnostic[K] extends `${string}{{detail}}${string}` ? K : never }[keyof Diagnostic];
const details: readonly (readonly [DetailKey, RegExp])[] = [
  ["unknownProfile", /^Unknown profile: (.+)$/],
  ["requiresProfile", /^(claude|codex|antigravity) plugins need a profile$/],
  ["requiresProfile", /^(Codex) plugins require a profile\.$/],
  ["absolutePath", /^Project path must be absolute: (.+)$/],
  ["missingPath", /^Project directory does not exist: (.+)$/],
  ["unknownScope", /^unknown scope "(.+)"$/],
  ["unsupportedCli", /^(.+) is not supported by this CLI$/],
  ["exitCode", /^(?:exit |Claude CLI 종료 코드: )(-?\d+)$/],
  ["exitCode", /^Codex failed during .+ \(exit (.+)\)\.$/],
  ["invalidResponse", /^(Codex) returned (?:an invalid MCP list|invalid JSON for .+)\.$/],
  ["invalidResponse", /^(Claude CLI) returned incomplete JSON\. Check the output size limit\.$/],
  // "project scope ..." is an exact match (projectRequired); other scopes name themselves.
  ["scopeNeedsWorkspace", /^(local) scope needs a workspace directory$/],
  ["scopeNeedsWorkspace", /^프로젝트 디렉터리를 선택해야 (local|project) 범위에 설치할 수 있습니다\.$/],
  ["writeFailed", /^write failed: ([\s\S]+)$/],
  ["badConfig", /^(.+): mcp_config\.json is (?:not a JSON object|not valid JSON:[\s\S]+); not modified$/],
  ["outsideProject", /^project (\.agents directory|mcp_config\.json) resolves outside the project; refusing$/],
  ["missingServer", /^MCP server "(.+)" not found(?: in agy config files)?$/],
  ["existingServer", /^MCP server "(.+)" already exists$/],
  ["ambiguousServer", /^"(.+)" exists in both project and user config; pass a scope$/],
  ["codexBrowser", /^Codex HTTP add can launch OAuth in a browser\..+ run codex mcp login (.+) --no-browser\.$/],
];

export function localizeDiagnostic(t: Translate, text: string): string {
  if (Object.hasOwn(exact, text)) return t(`diagnostic.${exact[text as keyof typeof exact]}`);
  const wrongProfile = /^Profile (.+) is not a (claude|codex|antigravity) profile$/.exec(text);
  if (wrongProfile) return t("diagnostic.wrongProfile", { id: wrongProfile[1], ecosystem: wrongProfile[2] });
  const claudeOAuth =
    /^Open Claude in a terminal with profile (.+) and authenticate (.+) in \/mcp\. mcp login --no-browser needs the redirect URL entered\.$/.exec(text) ??
    // Korean form from daemons 0.3.1 and older; remove with the other Korean entries.
    /^(.+) 프로필로 Claude 터미널을 열고 \/mcp에서 (.+) 인증을 완료하세요\. mcp login --no-browser는 리디렉션 URL 입력이 필요합니다\.$/.exec(text);
  if (claudeOAuth) return t("diagnostic.claudeOAuth", { id: claudeOAuth[1], name: claudeOAuth[2] });
  if (text === "Claude 프로필이 필요합니다.") return t("diagnostic.requiresProfile", { detail: "Claude" });
  if (text === "Claude CLI의 JSON 응답이 불완전합니다. 출력 크기 제한을 확인하세요.") {
    return t("diagnostic.invalidResponse", { detail: "Claude CLI" });
  }
  if (/^Codex timed out during .+\.$/.test(text)) return t("diagnostic.timeout");
  if (/^Codex output exceeded the limit during .+\.$/.test(text)) return t("diagnostic.outputLimit");
  if (text.startsWith("agy is not installed (or not on PATH): ")) {
    return `${t("diagnostic.agyMissing")} ${text.slice("agy is not installed (or not on PATH): ".length)}`;
  }
  for (const [key, pattern] of staticPatterns) if (pattern.test(text)) return t(`diagnostic.${key}`);
  for (const [key, pattern] of details) {
    const match = pattern.exec(text);
    if (match) return t(`diagnostic.${key}`, { detail: match[1] });
  }
  return text;
}
