# Atrium 기능 전수조사

2026-11-22 기준. Atrium 0.3.1의 `f4780b2` 소스와 Paseo 0.17.1을 대조했다. 마켓플레이스 등록 정보와 지원 하한은 `paseo-plugin.json`, 개발 SDK 핀은 `package.json`에 있으며 둘 다 0.16.1이다. 기능의 출시 이력과 현행 설명은 `CHANGELOG.md`, `README.md`, `OVERVIEW.md`를, 검증 환경은 `RELEASING.md`를 기준으로 삼았다.

- GitHub의 최신 안정 릴리스는 2026-11-21 공개된 **v0.17.1**이다. 이 컴퓨터에서도 앱 번들의 버전, 번들 CLI의 `--version`, 실행 중인 데몬의 `daemonVersion`이 모두 **0.17.1**이었다. [릴리스](https://github.com/getpaseo/paseo/releases/tag/v0.17.1) · [태그 고정 변경 이력](https://github.com/getpaseo/paseo/blob/v0.17.1/CHANGELOG.md)
- `npm view @getpaseo/plugin versions --json`에서 0.16.1 이후 0.16.2, 0.17.0-beta.1, 0.17.0, 0.17.1을 확인했다. npm의 `latest`와 `beta`는 둘 다 0.17.1이었다. 두 버전의 npm 배포본을 임시 디렉터리에 풀어 `dist/**/*.d.ts`를 비교하고, 같은 버전의 `@getpaseo/client`와 `@getpaseo/protocol` 선언을 함께 확인했다. [npm 메타데이터](https://registry.npmjs.org/@getpaseo%2fplugin) · [태그 고정 플러그인 API](https://github.com/getpaseo/paseo/blob/v0.17.1/public-docs/plugins/reference.md)
- 변경 권고의 우선순위는 호스트를 잘못 지정했을 때의 영향, 네이티브와 겹치는 코드의 유지 비용, 기존 사용자가 잃는 기능을 기준으로 잡았다. 네이티브 동작은 태그 소스로 조사했다. 실사용 데몬에는 플러그인을 설치하거나 데이터를 변경하지 않았으며 UI 재현은 후속 검증에 포함했다.

## Atrium 기능 목록

| 기능 | 파일 | 동작 |
| --- | --- | --- |
| 진입점과 기여 등록 | `index.client.tsx:6`, `index.server.ts:8`, `paseo-plugin.json` | 선택형 사이드바를 등록하고 Toolbox·Panes의 클라이언트 기여를 해제한다. 서버는 Toolbox, 채팅, 프로젝트, 순서 RPC와 Usage 소스를 등록한다. 설치 목록에는 아이콘, 스크린샷, 중국어 메타데이터를 제공한다. |
| 프로젝트·워크스페이스·에이전트 트리 | `client/nested-sidebar.tsx:226`, `shared/tree.ts:44` | SDK 스냅샷을 호스트별 ref로 연결한다. 부모 에이전트가 만든 별도 워크스페이스와 그 세션을 해당 부모 아래 배치하고, 고아나 순환 연결이 있어도 행을 노출한다. 행 접기, 연결선, 활성 행과 기본 열기 동작을 포함한다. |
| 상태, 승인 대기, 변경량 | `client/nested-sidebar.tsx:1052`, `client/nested-sidebar.tsx:1419`, `client/marks.tsx:42`, `client/pending-permissions.ts:5`, `client/provider-icons.ts` | 실행 수, 에이전트 상태와 제공자 아이콘, 접힌 하위 트리의 긴급 상태, 워크스페이스 diff 통계를 보여 준다. 온라인 호스트별 에이전트 구독으로 승인 대기 여부를 판정하고 실행 수에서 제외한다. |
| Git worktree 배지 | `client/nested-sidebar.tsx:152`, `client/look.ts:56`, `client/marks.tsx:118`, `shared/project-rpc.ts:11`, `server/project.ts:9`, `server/core/worktree.ts:70`, `server/core/host-id.ts:54` | 세션과 단일 에이전트 워크스페이스에 브랜치와 연결 worktree의 폴더명 및 경로 기반 색을 표시한다. 기본 브랜치의 메인 체크아웃은 배지를 생략한다. 데몬이 Git 위치, 기본 브랜치와 detached HEAD를 찾고, 구버전 Git 출력도 처리한다. 호스트와 cwd로 캐시 키를 나누고 현재 RPC 호스트의 행만 조회한다. |
| 이름 변경 | `client/rename.tsx:39`, `client/nested-sidebar.tsx:1181` | Atrium 행에서 워크스페이스 이름을 편집하고 Paseo의 `setTitle`을 호출한다. |
| 세션·워크스페이스 보관 | `client/archive.tsx:42`, `client/nested-sidebar.tsx:1101`, `shared/tree.ts:180` | 에이전트 또는 워크스페이스 단위로 보관한다. 영향받는 하위 세션, 실행 중인 작업 및 worktree를 확인 화면에 보여 주고, 선택한 트리 때문에 비게 되는 관련 워크스페이스도 SDK로 보관한다. |
| 프로젝트 제거 | `client/remove-project.tsx:11`, `shared/project-rpc.ts:5`, `server/project.ts:24`, `server/core/paseo-bin.ts` | 현재 RPC 데몬에서 `project ls --json`으로 ID를 확인한 다음 `project delete`를 호출한다. 프로젝트 폴더는 유지되며 소속 워크스페이스를 보관하는 처리는 Paseo가 담당한다. |
| 프로젝트·세션 순서 | `client/nested-sidebar.tsx:303`, `client/nested-sidebar.tsx:539`, `client/project-order.tsx:30`, `shared/project-order.ts:13`, `server/project-order.ts:91` | 데스크톱 드래그와 자동 스크롤, 모바일 길게 누르기 메뉴, 그룹별 노드 순서와 낙관적 갱신을 지원한다. 데몬의 `atrium/project-order.json`에 기록하고 이전 `nested-agents` 순서를 최초 1회 가져온다. |
| General 채팅 | `client/chat.tsx:32`, `client/chat.tsx:43`, `shared/chat/rpc.ts:6`, `server/chat.ts:177` | 데몬 사용자 홈의 `~/.paseo-chat`을 준비해 별도 프로젝트 없이 시작하는 채팅을 한 구역에 노출한다. 기존 채팅 선택·보관 및 신규 세션 흐름에 연결한다. |
| Panes 열기와 드롭 | `client/panes/index.tsx:26`, `client/nested-sidebar.tsx:380`, `client/panes/drop-bus.ts:116`, `client/panes/screen.tsx:68` | 사이드바 헤더, Command Center, 행 버튼·모바일 메뉴, 사이드바 바깥으로의 드래그로 에이전트 열을 연다. 드롭 지점을 측정하고 놓을 위치를 표시한다. |
| Panes 배치·저장 | `client/panes/layout.ts:107`, `client/panes/layout.ts:206`, `client/panes/screen.tsx:156`, `client/panes/store.ts:6` | 부모·자식 묶음에 색과 연결선을 주고, 빠진 자식을 한꺼번에 여는 선택지를 제공한다. 묶음을 이동하고 열 너비를 조절·초기화하며 가까운 열만 마운트한다. Web·Electron의 `localStorage`에서 열 목록과 폭을 복구하고 창 간 변경을 반영한다. |
| Panes 채팅·기록·복구 | `client/panes/pane.tsx:328`, `client/panes/pane.tsx:501`, `client/panes/timeline.ts:40`, `shared/chat/convert.ts:51`, `shared/chat/rpc.ts:42`, `server/chat.ts:30`, `server/chat.ts:183` | 타임라인 tail과 live 이벤트를 병합하고 이전 기록의 epoch·커서를 관리한다. 재연결·재시도 중 기록을 보존한다. 확정·스트리밍 메시지와 도구·생각·압축 표시를 간소화해 렌더링한다. 각 열에서 IME를 고려한 텍스트 전송과 원본 채팅 열기를 지원한다. |
| Panes 가족 관계 보완 | `client/panes/screen.tsx:85`, `shared/chat/convert.ts:114`, `server/chat.ts:209` | SDK 목록에 빠진 에이전트의 부모 관계를 `chat.links`로 조회한다. 서버는 보관·백그라운드 항목을 포함해 커서 페이지를 읽고 필요한 관계를 계산한다. 화면 호스트가 아닌 열은 원본으로 이동하는 경로를 제공한다. |
| Toolbox 진입·프로필 | `client/toolbox/index.tsx:34`, `client/toolbox/queries.ts:21`, `server/toolbox.ts:155`, `server/core/profiles.ts:36`, `server/core/run-profile.ts` | `/mcp`, `/plugins`, `/plugin` 및 Command Center에서 현재 에이전트 문맥 또는 전역 화면을 연다. 내장 제공자와 그 파생 프로필의 CLI, 환경변수, 작업 경로와 인증·가용성을 반영한다. |
| MCP 관리 | `client/toolbox/mcp-screen.tsx:125`, `client/toolbox/mcp-screen.tsx:351`, `server/toolbox.ts:163`, `shared/toolbox/rpc.ts:29`, `shared/toolbox/types.ts:48` | Claude Code·Codex·Antigravity MCP를 프로필·범위별로 검색, 추가, 제거하고 가능한 다중 프로필 작업을 제공한다. 추가는 실행 내용을 확인하고, 제거는 영향 범위를 확인한다. 로그인은 각 CLI의 안내로 연결한다. |
| 플러그인 카탈로그·설치 관리 | `client/toolbox/plugins-screen.tsx`, `client/toolbox/source-form.tsx`, `client/toolbox/store-logic.ts`, `server/toolbox.ts:192`, `shared/toolbox/rpc.ts:73` | Paseo·Claude Code·Codex·Antigravity 카탈로그 및 설치 상태를 통합한다. 지원되는 검색·정렬·필터·상세 정보, 설치·제거·활성화·업데이트, Claude 범위, 마켓 관리, git/npm/local/marketplace 소스 입력을 제공자별로 제공한다. |
| 확인·진행 상태·실행 공통 정책 | `client/toolbox/action-flow.tsx`, `client/toolbox/store.tsx`, `client/toolbox/diagnostics.ts`, `server/toolbox.ts:235`, `server/core/exec.ts`, `server/core/cwd.ts`, `server/core/source.ts`, `shared/toolbox/warnings.ts` | 실행 전 명령 또는 경고를 표시하고 프로필별 결과, 진행 중 닫기, 재시도, 오류 표시를 관리한다. 서버에서 입력과 소스를 검사하고 별도 argv, 실행 시간·출력 제한 및 출력 마스킹을 적용한다. Paseo 직접 설치는 미리보기에서 정한 commit 또는 npm 버전과 만료되는 1회 계획을 사용한다. |
| Claude Code 어댑터 | `server/adapters/claude/index.ts:236`, `server/adapters/claude/parsers.ts` | CLI 인증, MCP 목록과 명령, 마켓 검색·추가·제거·갱신, 플러그인 상태와 범위별 변경을 처리한다. 설치 목록은 사용자 범위와 현재 프로젝트의 project/local 범위를 합친다. |
| Codex 어댑터 | `server/adapters/codex/index.ts:143`, `server/adapters/codex/cli.ts`, `server/adapters/codex/plugins.ts` | 인증과 MCP JSON 및 CLI 결과, Codex 마켓과 플러그인 추가·제거, 지원되는 마켓 변경을 처리한다. |
| Antigravity 어댑터 | `server/adapters/antigravity/index.ts:111`, `server/adapters/antigravity/files.ts`, `server/adapters/antigravity/parse.ts` | `agy` 가용성과 플러그인 작업, 공식 카탈로그 및 직접 소스 설치를 처리한다. MCP 설정은 사용자·프로젝트 파일을 해석하고 파일 잠금·경로 확인·안전한 쓰기로 변경한다. |
| Paseo 어댑터 | `server/adapters/paseo/index.ts:446`, `server/adapters/paseo/index.ts:472`, `server/adapters/paseo/index.ts:535`, `server/adapters/paseo/index.ts:573` | 공개 레지스트리를 캐시하고 CLI로 설정된 플러그인과 리비전을 대조한다. 레지스트리와 직접 소스 설치, 제거·활성화·업데이트 확인·실행을 감싼다. 대화형 검토가 필요한 레지스트리 업데이트는 터미널 안내로 돌린다. |
| Usage 소스·계정 식별 | `server/usage/index.ts:4`, `server/usage/source.ts:160`, `server/usage/accounts.ts:73`, `server/usage/accounts.ts:147`, `shared/usage/types.ts` | `claude-profiles`, `codex-profiles`를 Paseo Usage에 등록한다. 설정된 추가 계정의 홈을 정규화하고 기본 탐색 경로와 중복 홈을 제외한다. 전역 카드에 계정·플랜·사용량을 제공하며 조회 때 활성 설정을 재검증한다. |
| Claude 쿼터·로컬 토큰 | `server/usage/rate-limits.ts:178`, `server/usage/local-usage.ts:68`, `server/usage/service.ts:30`, `server/usage/json.ts` | 파일 또는 macOS Keychain의 로컬 자격 증명으로 공급자 API 쿼터를 읽고 갱신 간격과 429 재시도를 관리한다. 로컬 JSONL에서 당일·최근 7일 토큰을 집계한다. |
| Codex 쿼터·로컬 토큰 | `server/usage/codex-usage.ts:54`, `server/usage/codex-usage.ts:92`, `server/usage/codex-usage.ts:195`, `server/usage/source.ts:100` | rollout JSONL의 토큰 이벤트와 마지막 쿼터 관측값을 읽는다. 관측·리셋 시각 및 단기·주간·rolling 창을 해석하고, 토큰 누적값에서 중복을 제거해 집계한다. |
| 공통 UI·현지화 | `client/look.ts`, `client/chat-strings.ts`, `client/sidebar-strings.ts`, `client/toolbox/ui.tsx`, `client/toolbox/strings.ts`, `client/toolbox/locales/` | 호스트 테마와 compact 레이아웃에 맞춘다. 사이드바·Panes·Toolbox가 영어, 한국어, 일본어, 중국어 간체, 스페인어, 프랑스어, 브라질 포르투갈어, 러시아어, 아랍어를 지원한다. |

## 네이티브 중복과 권고

| Atrium 기능 | Paseo 0.17.1에 있는 기능과 차이 | 권고 |
| --- | --- | --- |
| 사이드바 트리와 상태 | 기본 사이드바는 프로젝트·워크스페이스와 상태를 표시한다. Subagents 트랙은 에이전트 문맥에서 자식을 탐색한다. 공식 Nested agents 예제는 같은 워크스페이스의 부모·자식으로 재귀 범위를 제한한다. Atrium은 별도 worktree에 있는 자식 워크스페이스까지 전체 트리에 편입한다. [기본 사이드바](https://github.com/getpaseo/paseo/blob/v0.17.1/packages/app/src/components/sidebar-workspace-list.tsx) · [Subagents 트랙](https://github.com/getpaseo/paseo/blob/v0.17.1/packages/app/src/subagents/track.tsx) · [공식 예제](https://github.com/getpaseo/paseo/blob/v0.17.1/plugin-examples/sidebar-views/client/nested.tsx) | **유지.** 호스트 전체에서 가족을 찾는 흐름과 접힌 가지의 상태를 보존한다. |
| 기본 정렬, 이름 변경, 보관, 프로젝트 제거 | 기본 사이드바에서 프로젝트·워크스페이스 드래그 순서, 워크스페이스 이름 변경·보관 및 프로젝트 제거를 제공한다. Atrium은 교차 워크스페이스 트리의 노드 순서, 보관으로 비는 워크스페이스 계산과 확인 UI를 더한다. 기본 프로젝트 제거는 프로젝트의 호스트별 대상을 검사한다. [기본 사이드바](https://github.com/getpaseo/paseo/blob/v0.17.1/packages/app/src/components/sidebar-workspace-list.tsx) · [프로젝트 제거](https://github.com/getpaseo/paseo/blob/v0.17.1/packages/app/src/projects/project-remove.ts) | **부분 위임.** 트리 순서와 하위 보관 확인은 유지한다. 이름·보관은 기존 SDK 호출을 계속 쓰고, 프로젝트 제거는 대상 호스트 확인을 추가한다. 공개 SDK에 제거 메서드가 생기기 전에는 현재 데몬에서만 호출하거나 네이티브 메뉴를 안내한다. |
| 분할 보기와 채팅 | Paseo는 워크스페이스 안에서 에이전트·파일·터미널 등을 분할하고 네이티브 채팅의 승인, 첨부, 설정과 기록을 제공한다. Atrium은 여러 워크스페이스 에이전트를 가족별로 모으는 전역 화면이다. [워크스페이스 모델](https://paseo.sh/docs/workspaces.md) · [레이아웃 소스](https://github.com/getpaseo/paseo/blob/v0.17.1/packages/app/src/stores/workspace-layout-store.ts) | **부분 위임.** 워크스페이스 내부의 일반 분할과 복합 채팅은 네이티브에 맡기고, Panes는 워크스페이스 경계를 넘는 배치와 빠른 전송을 유지한다. |
| General | 기본 워크스페이스 만들기, 프로젝트·세션 열기, 보관은 네이티브가 처리한다. Atrium은 고정된 스크래치 디렉터리의 대화를 사이드바 한 구역에서 회수한다. [워크스페이스](https://paseo.sh/docs/workspaces.md) | **유지.** 기존 채팅 경로와 묶음을 보존한다. |
| Worktree | 0.17.1은 네이티브 생성 화면에서 외부 Git worktree 선택을 지원한다. 플러그인의 워크스페이스 스냅샷은 이미 branch·kind를 제공한다. Atrium은 연결 worktree 경로와 메인 체크아웃 기본 브랜치 여부를 행에 표시한다. [릴리스](https://github.com/getpaseo/paseo/releases/tag/v0.17.1) · [사이드바 스냅샷](https://github.com/getpaseo/paseo/blob/v0.17.1/public-docs/plugins/sidebar-views.md) | **부분 위임.** 생성·복원·제거는 호스트 동작을 따른다. 한눈에 구별하는 배지는 유지하고, 공개 스냅샷이 충당하는 표시부터 정리한다. |
| Paseo 플러그인 카탈로그·설치 | 네이티브 Settings → Plugins에 Browse, Installed, 상세, 소스 설치, 업데이트 검토와 수명주기 작업이 있다. Atrium에도 같은 레지스트리와 동작이 있고 고정된 버전이 포함된 명령 미리보기를 제공한다. 공개 플러그인 탐색 API의 화면 열기는 자기 플러그인의 화면·설정 범위다. [네이티브 갤러리](https://github.com/getpaseo/paseo/tree/v0.17.1/packages/app/src/plugins/gallery) · [플러그인 탐색 계약](https://github.com/getpaseo/paseo/blob/v0.17.1/public-docs/plugins/reference.md) | **위임 후 중복 제거.** Paseo 항목은 설치 대상 호스트의 네이티브 메뉴를 안내한다. 소스 고정/미리보기와 multi-host 경로를 비교한 뒤 Paseo 전용 카탈로그·CLI 래퍼를 정리한다. |
| Claude·Codex·Antigravity 플러그인 및 MCP | 0.17.1의 제공자 설정은 CLI 설치 상태·버전·업데이트를 다루고, 세션 시작 훅이 MCP를 주입할 수 있다. Toolbox는 각 CLI의 사용자·프로젝트 설정과 별도 계정에 공급자 플러그인·MCP를 영구 관리한다. Antigravity 세션 승인·기록은 네이티브에 있다. [제공자 설치 계약](https://github.com/getpaseo/paseo/blob/v0.17.1/public-docs/plugins/reference.md#provider-installation) · [릴리스](https://github.com/getpaseo/paseo/releases/tag/v0.17.1) | **유지.** CLI 자체의 설치·업데이트와 대화 승인·기록은 네이티브에 맡긴다. 프로필별 외부 도구 설정과 일괄 적용은 Toolbox에 둔다. |
| Usage 쿼터·토큰 | 기본 Claude·Codex 소스가 전역 경로 및 세션 문맥에 따라 계정을 찾는다. 전역 탐색 경로는 daemon 환경과 기본 경로 등이 중심이며, 소스의 전역 탐색이 Paseo 설정의 모든 사용자 정의 프로필을 열거하지 않는다. 0.17.1에는 네이티브 예측, Antigravity 쿼터, OpenRouter 잔액도 있다. [Claude 소스](https://github.com/getpaseo/paseo/blob/v0.17.1/plugins/claude-usage-source/server/usage.ts) · [Codex 소스](https://github.com/getpaseo/paseo/blob/v0.17.1/plugins/codex-usage-source/server/usage.ts) · [릴리스](https://github.com/getpaseo/paseo/releases/tag/v0.17.1) | **부분 위임.** 추가 프로필의 전역 카드와 로컬 토큰을 유지하고 기본 쿼터 및 예측 표시를 네이티브에 맡긴다. 같은 로그인이 다른 홈이나 세션 경로로 발견될 때 카드 중복을 검증한다. |

## 0.16.1 → 0.17.1 API 차이

**Atrium이 사용하는 공개 API에서 제거되거나 새로 deprecated 된 호출은 확인되지 않았다.** 0.17.1 배포본과 같은 버전의 client·protocol을 넣은 임시 복제본에서 앱 및 테스트 타입 검사도 통과했다. 아래의 사용 지점 중 필수 API 교체는 없으며, 앱이나 데몬의 동작 차이를 확인할 항목을 함께 적었다. 0.7 이하를 위한 런타임 엔트리 마이그레이션은 Atrium이 이미 채택한 구조다. [공개 API](https://github.com/getpaseo/paseo/blob/v0.17.1/public-docs/plugins/reference.md) · [마이그레이션 범위](https://github.com/getpaseo/paseo/blob/v0.17.1/public-docs/plugins/migration.md)

| 공개 계약 또는 런타임 차이 | Atrium 사용 위치 | 필요한 대응 |
| --- | --- | --- |
| 화면 `PluginNavigableHostProps.navigation`에 `supportsFocusHost?`, `openAgent/openWorkspace` 입력에 `focusHost?` 추가. `PluginSidebarViewProps.navigation.openAgent(ref)`는 기존과 같다. | `client/panes/screen.tsx:220`, `client/toolbox/ui.tsx:540`. 사이드바 별도 계약은 `client/nested-sidebar.tsx:1186`, `client/chat.tsx:237`. | 필수 변경 없음. 호스트가 다른 원본 채팅을 명시적으로 열 때만 지원 여부를 확인해 옵션을 넣는다. 현재 호스트의 필터를 지우는 부작용을 피한다. [탐색 옵션](https://github.com/getpaseo/paseo/blob/v0.17.1/public-docs/plugins/reference.md) |
| `UsageWindow.durationSeconds?`, `UsageReport.observedAt?`, `UsageScope.launch?`, `UsageSourceRegistration.provider?` 추가. 네이티브 예측은 창 길이와 관측 시점을 사용한다. | `server/usage/source.ts:100`, `server/usage/source.ts:129`, `server/usage/source.ts:181`, `server/usage/codex-usage.ts:92`. | 필수 변경 없음. 창 길이와 실제 관측 시각을 보내 예측을 지원한다. 기존 코드가 Codex 관측값을 표시용 detail에만 넣는 부분을 보완한다. 만료한 마지막 로그와 새 쿼터 샘플을 구별한다. [Usage API](https://github.com/getpaseo/paseo/blob/v0.17.1/packages/plugin/src/server/usage.ts) · [예측 계산](https://github.com/getpaseo/paseo/blob/v0.17.1/packages/app/src/usage/pace.ts) |
| 에이전트 발신 메시지의 대기·전달 정책 변경. 사람 메시지 경로의 기본값은 interrupt이고, 명시한 steer 입력은 유효하다. 타임라인의 refetch·subscribe 계약 유지. | `client/panes/pane.tsx:518`, `client/panes/pane.tsx:367`, `server/chat.ts:86`, `server/chat.ts:124`, `server/chat.ts:187`, `client/pending-permissions.ts:29`. | 명시적 steer를 유지한다. 실행 중 사람 프롬프트, 큐에 있는 에이전트 메시지, reconnect·rewind 때의 중복/누락과 승인 상태를 격리 데몬에서 확인한다. [전달 분기](https://github.com/getpaseo/paseo/blob/v0.17.1/packages/server/src/server/session.ts) · [릴리스](https://github.com/getpaseo/paseo/releases/tag/v0.17.1) |
| 0.16.2의 detached 커밋 보존과 0.17.1의 teardown timeout 보존, 외부 worktree 선택·공유가 보관 결과에 영향을 준다. 기존 `archive`·`setTitle` 호출은 유지됐다. | `client/archive.tsx:54`, `client/archive.tsx:65`, `client/archive.tsx:141`, `client/sidebar-strings.ts:30`, `client/rename.tsx:39`. | 호출 교체 없음. 현재 문구는 worktree 폴더가 삭제된다고 단정한다. 외부·공유 worktree 보존과 teardown 실패를 반영해 보관과 폴더 제거를 구별하고, 부분 성공 안내를 점검한다. [보관 동작](https://paseo.sh/docs/workspaces.md) · [변경 이력](https://github.com/getpaseo/paseo/blob/v0.17.1/CHANGELOG.md) |
| 네이티브 `DaemonClient.removeProject`와 새 `listCheckoutWorktrees`는 내부 경로에 있다. 공개 `getPaseoClient(serverId)`는 `PaseoApi`를 반환하고, `PaseoProjectActions`는 list/subscribe만 노출한다. | `client/remove-project.tsx:12`, `client/remove-project.tsx:20`, `shared/project-rpc.ts:5`, `server/project.ts:9`, `server/project.ts:24`. | 내부 import 도입 없이 현재 RPC의 서버·대상 호스트 불일치를 차단한다. 같은 project ID가 두 호스트에 있을 때 체크하는 것이 우선이다. 내부 worktree 목록의 필드는 path/branch/head/containsCwd 등이며 Atrium의 기본 브랜치 판정까지 충당하지 않는다. [공개 클라이언트](https://github.com/getpaseo/paseo/blob/v0.17.1/packages/client/src/index.ts) · [내부 클라이언트](https://github.com/getpaseo/paseo/blob/v0.17.1/packages/client/src/daemon-client.ts) |
| `usePaseo`, `useRpc/useSubscription`, `defineRpc/defineSubscription`, 상태 훅, 화면·사이드바·명령 등록, `config.get` 및 `providers.listAvailable`의 사용 계약 유지. SDK peer의 client·protocol은 배포 버전에 맞춰 바뀐다. | `index.client.tsx:7`, `index.server.ts:8`, `client/panes/index.tsx:26`, `client/toolbox/index.tsx:34`, `server/core/profiles.ts:40`, `shared/chat/rpc.ts:42`, `shared/toolbox/rpc.ts:21`. | 개발 핀과 lockfile을 함께 갱신하고 두 호스트 버전에서 확인한다. 0.17.1 전용 필수 호출이 추가될 때만 manifest 하한을 올리거나 명시적으로 분기한다. [플러그인 API](https://github.com/getpaseo/paseo/blob/v0.17.1/public-docs/plugins/reference.md) |

프로젝트 제거는 업그레이드로 생긴 결함이 아니다. 현재 클라이언트는 `ProjectRef.hostId`를 계약에 싣지 않고, 서버는 고정된 CLI 데몬에서 ID만 재확인한다. 같은 저장소를 여러 호스트에서 열면 같은 프로젝트 ID가 있을 수 있으므로, 코드에서 확인한 위험을 통합 검증에서 재현할 대상으로 분류했다.

## 채택할 API와 적용 조건

| API | 구체적인 적용 |
| --- | --- |
| **0.17.1** `navigation.supportsFocusHost`, `focusHost` | Panes의 다른 호스트 열에서 원본 채팅을 열 때만 목적 호스트 선택을 요청한다. Toolbox의 돌아가기와 이미 같은 호스트에서 열리는 동작은 기존 탐색으로 둔다. 커스텀 사이드바의 ref 기반 탐색과는 별도다. [탐색 계약](https://github.com/getpaseo/paseo/blob/v0.17.1/public-docs/plugins/reference.md) |
| **0.17.1** `UsageWindow.durationSeconds`, `UsageReport.observedAt` | `toUsageWindow`에서 Claude의 5시간·7일·모델별 주간 창과 Codex가 관측한 창 길이를 전달한다. `toUsageReport`에서 Codex 로그 시각을 사용하고, Claude 캐시에서도 실제 수집 시각이 보존되는지 검사한다. native Usage가 소진 예측을 그리게 한다. [SDK Usage](https://github.com/getpaseo/paseo/blob/v0.17.1/packages/plugin/src/server/usage.ts) |
| **0.17.1** `UsageScope.launch`와 소스의 `provider` | Atrium은 등록한 제공자가 없으므로 현재 내장 Claude/Codex로 `provider`를 지정하면 Paseo가 거부한다. 별도 제공자를 소유하게 되는 경우에 그 제공자의 launch를 이용한다. 현 구조에서는 `scope.env`를 사용하는 세션 discovery를 선택적으로 시험하고, 같은 Account key 유지와 타 소스 중복 제거를 먼저 검증한다. [등록 검증](https://github.com/getpaseo/paseo/blob/v0.17.1/packages/server/src/server/plugins/index.ts) |
| **0.17.1** `registerWorktreeManager`, worktree create 입력의 `startPoint` | 사용자 지정 worktree 위치·수명주기를 지원하는 별도 요구가 생길 때 create/remove/restore 핸들러로 확장할 수 있다. 현행 배지는 읽기 전용이므로 도입하지 않는다. fork의 `untrusted`, 보관·롤백, 지정 경로 복원이 적용의 전제다. [Worktree managers](https://github.com/getpaseo/paseo/blob/v0.17.1/public-docs/plugins/reference.md#worktree-managers) |
| **0.17.1** `ProviderRegistration.installation`, `agent.session_open.appendSystemPrompt` | 직접 제공자를 등록하는 기능이 생길 때 설치 문서 링크·버전 상태·사용자 요청에 따른 업데이트를 네이티브 설정에 제공한다. Atrium에서 사용자가 명시적으로 선택한 워크스페이스 지침이 필요해질 경우에만 세션 열기마다 프롬프트를 추가한다. 현재 CLI 관리 및 MCP 편집에는 새 훅이 필요하지 않다. [Provider installation](https://github.com/getpaseo/paseo/blob/v0.17.1/public-docs/plugins/reference.md#provider-installation) · [세션 훅 타입](https://github.com/getpaseo/paseo/blob/v0.17.1/packages/plugin/src/server/lifecycle.ts) |
| **기존 API, 0.17.1 관련 수정 포함** `addWorkspaceRowBadgeItem`, `addSettingsScreen`·`useSettings` | 기본 사이드바를 쓰는 사람에게도 workspace branch/worktree 배지를 제공할 수 있다. 네이티브 앱이 소유하는 설정 화면에서 배지 표시나 Panes 원본 열기 동작을 제어하는 경우에 기존 로컬 데이터를 마이그레이션한다. 해당 버전의 플러그인 화면·설정 상태 훅 수정과 함께 검증한다. [배지·설정 API](https://github.com/getpaseo/paseo/blob/v0.17.1/public-docs/plugins/reference.md) · [수정 이력](https://github.com/getpaseo/paseo/blob/v0.17.1/CHANGELOG.md) |

## 작업 목록

P0는 잘못된 대상에 상태를 변경할 수 있는 경로와 호환성 검증이다. P1은 현 사용 흐름을 보존하며 중복을 줄이는 변경이다. P2는 선택 기능과 구조 정리다.

### Client

| ID | 우선순위 | 작업과 완료 기준 |
| --- | --- | --- |
| A-1 | P0 | `client/remove-project.tsx:20`에서 ref의 호스트를 비교·전달한다. 현재 RPC 호스트가 일치하고 확인이 끝난 경우에만 제거를 호출한다. 다른 호스트 또는 식별 불가일 때는 해당 호스트의 기본 프로젝트 제거 메뉴를 안내한다. A-5와 함께 배포한다. |
| A-2 | P1 | `client/toolbox/plugins-screen.tsx`의 Paseo 탭을 호스트별 네이티브 Gallery 안내로 바꾼다. 네이티브 직접 소스·미리보기의 차이를 재현하고 안내 경로를 확인한 뒤 A-7을 진행한다. 나머지 세 생태계와 `/plugins` 진입을 유지한다. |
| A-3 | P1 | `client/panes/screen.tsx:220`에서 타 호스트를 명시적으로 열 때 capability가 있으면 `focusHost`를 전달한다. 가족 배치와 현재 창의 순서를 유지하며, 승인·첨부 등이 필요한 경우 원본 채팅으로 이동할 수 있게 한다. |
| A-4 | P2 | `client/nested-sidebar.tsx:152`의 Git 조회와 워크스페이스 스냅샷 사용을 나눠 검토한다. 기본 뷰에서도 배지가 필요하면 `addWorkspaceRowBadgeItem`으로 행 표시를 공유하고, detached·외부 worktree·기본 브랜치에서 현재 의미를 유지한다. |

### Server + shared

| ID | 우선순위 | 작업과 완료 기준 |
| --- | --- | --- |
| A-5 | P0 | `shared/project-rpc.ts:5`와 `server/project.ts:24`에 대상 호스트를 검증하는 계약을 추가한다. 식별 실패·불일치 요청은 CLI 조회나 삭제 전에 거부한다. 대상 데몬에서의 프로젝트 존재 검증과 argv 처리는 유지한다. |
| A-6 | P1 | `server/usage/source.ts:100`과 `server/usage/source.ts:129`에서 창 길이·관측 시각을 SDK 필드로 매핑한다. 기한이 지난 Codex 캐시, Claude 캐시 시각, 기본·추가 계정과 별칭의 중복을 검증한다. 지원 하한을 유지할 경우 0.16.1에서도 기존 카드와 상세 정보가 표시돼야 한다. |
| A-7 | P1 | A-2로 네이티브 위임을 확인한 뒤 `server/adapters/paseo/index.ts`와 `server/toolbox.ts:192`, `shared/toolbox/types.ts`의 Paseo 전용 경로를 정리한다. Claude·Codex·Antigravity가 공유하는 소스 검증, 명령 미리보기, 프로필별 로직은 유지한다. |
| A-8 | P2 | `server/project.ts:9`와 `server/core/worktree.ts:70`에서 같은 Git 저장소를 가리키는 cwd가 많을 때 배치 비용을 측정한다. 공개 스냅샷 이상의 정보에 Git 조회를 쓰고, 내부 `listCheckoutWorktrees`는 공개 SDK로 노출될 때 후보로 다시 본다. |

### Tests

| ID | 우선순위 | 작업과 완료 기준 |
| --- | --- | --- |
| A-9 | P0 | SDK 0.17.1과 맞춤 peer로 타입 검사·테스트를 재현 가능하게 한다. `tests/runtime-imports.test.ts`를 유지하고 `RELEASING.md`의 격리 환경에서 0.16.1과 0.17.1 관리 설치가 모두 `running`인지 확인한다. |
| A-10 | P0 | `tests/project-host-id.test.ts` 계열에 동일 프로젝트 ID를 가진 두 호스트, 식별 실패, 다른 호스트 거부를 추가한다. 보관은 `tests/tree.test.ts`와 격리 UI에서 외부·공유 worktree, 활성 하위 세션, 일부 보관 실패를 확인한다. |
| A-11 | P1 | `tests/usage-source.test.ts`, `tests/usage-codex.test.ts`, `tests/usage-service.test.ts`에서 5시간·주간·모델 창 길이, 실제 관측 시각, reset을 넘긴 로그, 복수 프로필과 동일 계정 중복을 확인한다. 네이티브와 Atrium 카드가 한 패널에서 표시되는지도 확인한다. |
| A-12 | P1 | `tests/panes-timeline.test.ts`, `tests/pane-drag.test.ts`, `tests/panes-drop-bus.test.ts`, `tests/toolbox-install.test.ts` 기반으로 재연결·rewind·IME·명시적 steer, 타 호스트 원본 열기, 플러그인 미리보기·버전 고정·대상 호스트, 제공자 MCP 범위를 검증한다. 네이티브 위임으로 삭제할 테스트는 동등한 사용자 흐름의 격리 확인으로 대체한다. |

## 이번 감사에서 실행한 검증

- 임시 복제본에 공개 npm 배포본의 `plugin`, `client`, `protocol` 0.17.1을 배치하고 `tsc --noEmit` 및 `tsc -p tsconfig.tests.json --noEmit`을 실행했다. 둘 다 통과했다.
- 같은 복제본에서 기존 테스트 스위트를 두 번 실행했다. `PASEO_HOME`을 해제했을 때와 임시 홈을 지정했을 때 각각 473개가 통과했다. 데몬 두 버전의 실제 설치와 브라우저·모바일 조작은 A-9~A-12의 후속 검증 범위다.
