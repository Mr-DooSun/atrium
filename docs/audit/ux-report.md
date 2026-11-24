# Atrium UX 전수조사 보고서 (uxtester)

> 스크린샷은 로컬에 보관했으며 저장소에는 포함하지 않았다.

- 대상: 작업 트리의 Atrium 0.3.1 (`main`, 로컬 폴더 설치)
- 환경: 격리 Paseo 데몬 0.17.1 (별도 `PASEO_HOME`, 포트 6791) + 앱 내장 웹 클라이언트(`app-dist`를 6792에서 정적 서빙). 실사용 데몬(6767)은 건드리지 않았다.
- 화면: 1280x800 데스크톱, 420x800 compact, 한국어(시스템) / 아랍어 + 라이트 테마
- 조사일: 2026-11-22

## 조사 방법과 한계

- 픽스처: git 프로젝트 3개(영문, 한글 이름, 95자 이름) + 비 git 폴더 1개, 같은 브랜치(`main`) 워크스페이스 5개, worktree 워크스페이스 2개, 부모 → 자식 → 손자 에이전트, 다른 worktree에서 도는 자식 에이전트, 일반(General) 채팅 2개. 에이전트는 Claude Haiku로 한 줄 응답만 시켰다.
- 클릭, 호버, 길게 누르기, 드래그는 페이지 안에서 포인터/마우스 이벤트를 단계별로 보내 재현했다. `browser_drag` 도구는 중간 이동 없이 한 번에 놓기 때문에 Atrium의 PanResponder 드래그를 시작시키지 못했다(도구 한계이며 제품 결함으로 보지 않았다).
- 격리 데몬도 호스트의 실제 `claude`/`codex` CLI와 계정을 쓴다. 그래서 `/mcp`, `/plugins`의 Claude/Codex 변경 작업은 **확인 창까지만** 열고 모두 취소했다. 이 경로의 "실행 후 결과 화면"은 검증하지 못했다.
- Antigravity(`agy`)는 미설치 상태만 확인했다. 다중 호스트, 네이티브 모바일 앱은 조사하지 못했다(compact는 웹 420px로 대체).
- Command Center(⌘K)는 화면에서 열지 못해 등록 코드로만 확인했다.
- 스크린샷의 이메일과 요금제 이름은 캡처 전에 DOM에서 가렸다. 호스트 이름이 보이는 캡처 1장은 지웠다.

## 요약

| 등급 | 건수 | 대표 항목 |
|---|---|---|
| P0 | 1 | 프로젝트 제거 시 세션이 "보관"되지 않고 어디에서도 안 보이게 됨 |
| P1 | 3 | 하위 에이전트 패널에 부모가 준 지시가 안 보임, compact에서 이름 바꾸기 불가, 제거된 프로젝트의 패널이 살아서 메시지를 보냄 |
| P2 | 8 | 같은 브랜치 워크스페이스가 전부 `main`으로 보임, 패널에서 권한 요청을 알 수 없음, 접힘 상태가 새로고침에 날아감 등 |
| P3 | 12 | 문구, 접근성 레이블, RTL 정렬 등 |

정상 동작을 확인한 것: 트리 중첩(3단계, 다른 worktree의 자식 포함), worktree 배지, 프로젝트/세션 드래그 순서 변경과 `project-order.json` 저장, 이름 바꾸기(Enter 저장, 한글/이모지/150자), 보관 확인 창, 패널 추가(행 버튼, 드래그), 가족 묶음, 패널 너비 조절/이동/닫기/모두 닫기, 패널에서 메시지 전송, 새로고침 후 패널 복원, 데몬 재시작 후 패널 자동 재연결, `/mcp`와 `/plugins` 진입, 카탈로그 검색/빈 결과/더 보기/상세, 출처 설치 입력 검증, 추가 계정 사용량 카드, 420px compact 레이아웃.

---

## P0

### U-1. 프로젝트를 제거하면 세션이 "보관"되지 않고 모든 목록에서 사라진다

- 재현
  1. 세션이 1개 있는 프로젝트 헤더에 마우스를 올리고 "사이드바에서 제거"를 누른다.
  2. 확인 창 문구: "세션 1개가 보관됩니다. 디스크의 파일은 그대로 남습니다. Paseo에서 폴더를 다시 추가하면 돌아옵니다." → "제거".
  3. Paseo "기록" 화면, `paseo ls -a -g`를 확인한다. 같은 폴더를 다시 프로젝트로 추가한다.
- 기대: 세션이 보관함(기록의 "보관됨")에 남고, 폴더를 다시 추가하면 되찾을 수 있다.
- 실제: 그 세션은 기록 화면에도, `paseo ls -a -g`에도 나오지 않는다. 같은 세션에서 직접 보관한 다른 에이전트("B solo")는 기록에 "보관됨"으로 남아 있어 차이가 분명하다. 폴더를 다시 추가하면 빈 프로젝트만 돌아온다. `paseo inspect <id>`로는 레코드가 남아 있고 `Archived false`라서, 실제로는 보관이 아니라 워크스페이스가 지워져 고아가 된 상태다. UI로 되찾을 방법이 없다.
- 영향: 확인 창이 약속한 것과 결과가 다르다. 사용자는 대화를 잃은 것으로 경험한다.
- 스크린샷: `screenshots/12-ghost-pane-replies-after-project-removed.png` (제거 후 사이드바에 프로젝트가 없고 패널만 남은 상태)
- 의심 위치: `server/project.ts`의 `removeProject`(`paseo project delete` 호출만 한다), `client/remove-project.tsx`, `client/sidebar-strings.ts`의 제거 문구
- 제안: 삭제 전에 세션을 실제로 보관하거나, 문구를 실제 동작("세션이 목록에서 사라지며 되돌릴 수 없습니다")에 맞추고 버튼 이름도 "사이드바에서 제거" 대신 "프로젝트 삭제" 수준으로 바꾼다.

---

## P1

### U-2. 하위 에이전트 패널에 부모가 보낸 지시가 보이지 않는다

- 재현: 부모 에이전트가 만든 하위 에이전트를 패널로 연다.
- 기대: 하위 에이전트가 받은 지시(부모의 메시지)가 대화 맨 위에 보인다.
- 실제: `agent_message 완료`라는 도구 행 한 줄만 보이고 지시 내용은 없다. 타임라인 원본에는 `tool_call`(name `agent_message`)의 `detail.text` / `agentMessage.text`에 본문과 보낸 에이전트 이름이 들어 있다. Paseo 기본 채팅 화면은 "[Message received] Root orchestrator" + 본문으로 보여 준다.
- 영향: "부모와 하위 에이전트를 나란히 본다"는 패널의 핵심 용도에서, 하위 에이전트가 무슨 일을 맡았는지 알 수 없다. 에이전트 사이의 모든 메시지가 같은 식으로 가려진다.
- 스크린샷: `screenshots/06-panes-three-group.png`
- 의심 위치: `shared/chat/convert.ts`의 `tool_call` 분기(이름과 상태만 꺼낸다), `client/panes/timeline.ts`

### U-3. compact(모바일) 화면에서 워크스페이스 이름을 바꿀 수 없다

- 재현: 창 너비 420px → 메뉴 열기 → 워크스페이스 행을 길게 누른다.
- 기대: "패널에서 열기", "이름 바꾸기", "보관".
- 실제: 메뉴에 "패널에서 열기"와 "보관"만 있다. 이름 바꾸기는 데스크톱의 호버 버튼으로만 열리므로 호버가 없는 화면에서는 기능에 닿을 방법이 없다.
- 스크린샷: `screenshots/09-compact-longpress-menu-no-rename.png`
- 의심 위치: `client/project-order.tsx`의 `SessionMenu`(항목 2개뿐), `client/nested-sidebar.tsx`의 워크스페이스 행(`rename.begin`을 메뉴에 넘기지 않는다)

### U-4. 제거(보관)된 세션의 패널이 그대로 남아 메시지를 보낼 수 있다

- 재현: 세션을 패널에 열어 둔 채 U-1처럼 프로젝트를 제거한다 → 패널 화면으로 간다 → 그 패널에 메시지를 보낸다.
- 기대: 패널이 닫히거나, "보관됨/삭제됨"으로 표시되고 입력이 막힌다.
- 실제: 패널이 "제목 없음"과 일반 아이콘으로 남고 입력창이 그대로 열려 있다. 메시지를 보내면 에이전트가 실제로 실행되어 답한다(지워진 프로젝트의 폴더에서 돈다). 이 에이전트는 사이드바, 기록, `paseo ls` 어디에도 없어서 이 패널 말고는 볼 수도 멈출 수도 없다.
- 스크린샷: `screenshots/11-pane-of-archived-agent-untitled.png`, `screenshots/12-ghost-pane-replies-after-project-removed.png`
- 의심 위치: `client/panes/store.ts`(에이전트가 사라져도 패널 유지), `client/panes/pane.tsx`(`info`가 없을 때 `untitled`만 표시), `server/chat.ts`의 전송 처리

---

## P2

### U-5. 같은 브랜치의 워크스페이스가 전부 `main`으로 보여 구분할 수 없다

- 재현: 한 저장소에 제목 없는 local 워크스페이스를 3개 만들고 각각 에이전트를 하나씩 돌린다.
- 기대: 행마다 구분할 단서(에이전트 제목, 순번, 마지막 메시지 등)가 있다.
- 실제: 세 행이 모두 `main`이다. 에이전트가 하나뿐인 워크스페이스는 행 하나로 합쳐지면서 에이전트 제목("Reply with exactly: ok1" 등)이 숨는다. 에이전트가 둘 이상이 되면 그때서야 제목이 하위 행으로 보인다. 일반(General) 영역은 반대로 에이전트 제목을 보여 준다.
- 스크린샷: `screenshots/10-same-branch-three-main-rows.png`
- 의심 위치: `client/nested-sidebar.tsx`의 워크스페이스 행(`label={ws.label}`), `shared/tree.ts`
- 제안: 제목이 브랜치 이름과 같은(직접 지은 이름이 없는) 워크스페이스는 에이전트 제목을 본문으로 쓰거나 둘째 줄에 붙인다.

### U-6. 패널에서는 권한 요청을 알 수도, 답할 수도 없다

- 재현: "Always ask" 모드 에이전트를 패널에 열고 파일 쓰기를 시킨다.
- 기대: 패널에 "권한 대기"가 분명히 보이고, 가능하면 그 자리에서 허용/거부한다.
- 실제: 패널에는 `Write 실행 중`과 "에이전트가 작업 중입니다 — 메시지는 진행 중인 턴에 추가됩니다"만 나온다. 권한 대기를 알리는 것은 헤더의 작은 파란 고리 점뿐이고 설명 문구가 없다. 사이드바는 같은 상태를 주황색 경고 아이콘으로 표시해서 두 화면의 표시도 서로 다르다. 허용하려면 "Paseo에서 열기"로 나가야 한다.
- 스크린샷: `screenshots/21-pane-permission-waiting-shows-running.png`
- 의심 위치: `client/panes/pane.tsx`(상태 표시, 입력창 안내), `client/pending-permissions.ts`(사이드바만 사용)

### U-7. 접어 둔 프로젝트/하위 트리/일반 영역이 새로고침하면 전부 펼쳐진다

- 재현: 프로젝트, 부모 행, "일반"을 접는다 → 새로고침.
- 기대: 접힘 상태 유지(프로젝트/세션 순서는 서버에 저장된다).
- 실제: 모두 펼쳐진다. 프로젝트가 많을수록 매번 다시 접어야 한다.
- 의심 위치: `client/nested-sidebar.tsx:592`(`collapsed`가 `useState`뿐이다), `client/chat.tsx`

### U-8. 이름 바꾸기 창의 안내가 실제 동작과 다르다

- 재현: 제목이 "main A"인 워크스페이스에서 이름 바꾸기를 연다 → 비우고 저장한다.
- 기대: 안내대로 "폴더 이름"으로 돌아간다.
- 실제: 안내는 "비워 두면 폴더 이름(main A)으로 돌아갑니다"인데(괄호 안이 현재 제목이다), 비우면 `main`(브랜치 이름)이 된다. 폴더 이름은 `alpha-service`다. 다시 열면 "폴더 이름(main)"으로 나온다. 괄호 값도 "폴더"라는 말도 맞지 않는다.
- 스크린샷: `screenshots/03-rename-dialog.png`
- 의심 위치: `client/nested-sidebar.tsx`의 `<RenameModal folder={ws.folder}>`(값이 현재 표시 이름이다), `client/sidebar-strings.ts`의 `renameFallback`

### U-9. 툴박스(`/mcp`, `/plugins`)는 에이전트 채팅 안에서만 열 수 있다

- 재현: 에이전트가 하나도 없는 새 설치 상태에서 플러그인/MCP 화면을 찾는다.
- 기대: 사이드바나 Command Center에서 바로 연다.
- 실제: 슬래시 명령과 Command Center 항목이 모두 `context: "agent"`다. 사이드바 항목도 없다. 에이전트 채팅을 먼저 열어야만 들어갈 수 있고, 그 사실을 알려 주는 곳이 없다. 패널은 사이드바 헤더에 항목이 있는 것과 대조된다.
- 의심 위치: `client/toolbox/index.tsx`
- 비고: 화면에서 Command Center를 열어 확인하지는 못했고 등록 코드로 판단했다.

### U-10. 출처 설치의 입력 오류가 "지원하지 않는 작업"과 영어 문장으로 나오고, 입력이 날아간다

- 재현: `/plugins` → Paseo → "출처에서 설치" → 저장소에 `http://github.com/a/b` → "명령 확인".
- 기대: 입력 칸 아래에 한국어 오류, 고쳐서 다시 시도.
- 실제: 확인 창에 "이 프로필에서는 지원하지 않는 작업입니다."(틀린 설명)와 `Git URLs must use https.`(영어)가 뜬다. `--`로 시작하는 값, 계정이 든 URL, 없는 저장소도 같다(`Remove credentials from the Git URL.`, git의 `fatal:` 원문). "취소"하고 다시 열면 입력한 값이 비어 있다. MCP 서버 추가 폼은 값이 남아 있어 두 폼의 동작이 다르다.
- 스크린샷: `screenshots/15-source-install-validation-error-english.png`
- 의심 위치: `client/toolbox/action-flow.tsx`(미리보기 실패 표시), `client/toolbox/source-form.tsx`(폼 상태), `server/core/source.ts`(오류 문구)

### U-11. 추가 계정 사용량 카드의 오류가 영어이고, 카드끼리 구분이 어렵다

- 재현: `claude`를 확장한 로그인 안 된 프로바이더와 `codex`를 확장한 빈 프로바이더를 설정하고 사용량 창을 연다.
- 기대: 한국어 안내와 다음 행동(로그인 방법), 어느 계정인지 한눈에 구분.
- 실제: `Claude: Claude OAuth login was not found.`, `Codex: No Codex rate limits recorded in local session logs.`처럼 영어 원문이 붉게 나오고 "Claude: Claude"가 겹친다. 카드 제목은 기본 계정과 똑같이 "Claude"/"Codex"이고, 프로바이더 라벨은 접두어가 잘린 채("Codex audit" → "audit") 맨 아래 작은 회색 글씨로만 나온다. 사용할 수 없는 카드가 기본 계정 카드보다 위에 놓인다.
- 스크린샷: `screenshots/16-usage-extra-account-cards-english-errors.png` (이메일과 요금제는 가렸다)
- 의심 위치: `server/usage/rate-limits.ts`, `server/usage/codex-usage.ts`(영어 문구), `server/usage/source.ts`(카드 제목과 라벨)

### U-12. compact 패널 화면: 빈 화면 안내가 드래그만 말하고, 가로 스크롤이 패널 단위로 멈추지 않는다

- 재현: 420px에서 패널 화면을 연다(패널 0개일 때와 4개일 때).
- 기대: compact에서는 "행을 길게 눌러 패널에서 열기"를 안내하고, 스크롤이 패널 하나씩 맞춰 멈춘다.
- 실제: 빈 화면 문구가 "사이드바에서 세션을 여기로 끌어다 놓으면…" 하나뿐인데 compact에서는 드래그가 꺼져 있다. 웹 compact에서는 `scroll-snap-type`이 `none`이라 패널이 반쯤 잘린 채 멈춘다(`snapToInterval`은 네이티브에서만 듣는다).
- 스크린샷: `screenshots/22-panes-empty-state.png`
- 의심 위치: `client/chat-strings.ts`의 `empty`, `client/panes/screen.tsx:440`

---

## P3

### U-13. 패널 제목(에이전트 제목)과 사이드바 행 이름(워크스페이스 제목)이 달라 짝짓기 어렵다
사이드바의 "main A" 행을 패널로 열면 패널 제목은 "Root orchestrator"다. 패널 헤더에 워크스페이스/프로젝트 이름이 없다. `screenshots/05-panes-one.png`. 위치: `client/panes/pane.tsx`.

### U-14. 패널 이동 화살표가 더 갈 곳이 없어도 켜져 있다
패널이 하나이거나 가족 묶음 하나뿐일 때, 맨 왼쪽/오른쪽일 때도 "왼쪽/오른쪽으로 옮기기"가 활성 모양이고 눌러도 아무 일이 없다(`aria-disabled` 없음). 가족 묶음에서는 첫 패널에만 화살표가 있어 일관되지 않아 보인다. `screenshots/06-panes-three-group.png`. 위치: `client/panes/pane.tsx`.

### U-15. 에이전트가 없는 워크스페이스 행을 패널로 끌면 아무 반응이 없다
드롭 영역 표시도, 안내도 없다. 호버 버튼도 "패널에서 열기"만 빠져 있어 이유를 알 수 없다. 위치: `client/nested-sidebar.tsx`의 `payload` 없는 행.

### U-16. MCP 제거/로그인 확인 창의 "실행할 명령"에 명령이 없다
제목은 "실행할 명령"인데 내용은 "정확한 명령은 실행 결과에 표시됩니다."다. 서버 추가 미리보기는 `claude mcp add-json -s local -- <이름> -`만 보여 주어 입력한 명령/인자/환경 변수가 확인 창에 나오지 않는다. claude.ai 커넥터에도 "제거" 버튼이 붙는데 CLI로 지울 수 있는 대상인지 실행해 보지는 못했다(실계정이라 취소). `screenshots/13-mcp-remove-confirm-no-command.png`. 위치: `client/toolbox/mcp-screen.tsx`, `client/toolbox/action-flow.tsx`.

### U-17. MCP 서버 이름을 미리 검증하지 않는다
공백, `&`, `$(...)`가 든 이름으로도 "명령 확인"까지 간다(인자는 따로 전달되어 주입 위험은 보이지 않았다). 범위 `local / project / user`는 영어이고 설명이 없다. 위치: `client/toolbox/mcp-screen.tsx`의 추가 폼.

### U-18. 로컬 폴더로 설치한 Atrium이 카탈로그에서는 "설치"로 보인다
Paseo 둘러보기에서 Atrium 카드가 미설치로 나오고, 미리보기에도 같은 ID가 이미 설치되어 있다는 경고가 없다. 상세의 "버전"은 `eb3badd`(커밋)로 나온다(다른 플러그인은 `v0.x`). 개발 설치에서만 생기는 경우다. 위치: `client/toolbox/store-logic.ts`.

### U-19. 툴박스의 범위 안내 줄이 관계없는 상태에서도 나오고, 문장에 줄표가 있다
"alpha-service 기준 — 다른 프로젝트의 local · project 항목은 보이지 않습니다"가 미설치 Antigravity 탭과 Paseo 탭 진입 직후에도 보인다. 패널 입력창 안내("…작업 중입니다 — 메시지는…")도 줄표를 쓴다(0.3.0에서 줄표를 문장부호로 바꾼 방침과 어긋난다). `screenshots/14-mcp-antigravity-not-installed.png`. 위치: `client/toolbox/locales/ko.ts`, `client/chat-strings.ts`.

### U-20. 접근성 레이블이 영어로 고정되어 있고, 버튼 안에 버튼이 있다
`Open …`, `Open agent …`, `New workspace in …`, `Collapse`/`Expand`가 모든 언어에서 영어다. 상태 점에는 레이블이 없다(Paseo 기본 사이드바는 "검토 대기"를 읽어 준다). 행 버튼 안에 접기/패널/이름/보관 버튼이 중첩된다. 위치: `client/nested-sidebar.tsx:1010, 1028, 1229, 1366, 1518`.

### U-21. 아랍어에서 행 글자가 아이콘과 떨어진다
레이아웃은 LTR인데 글자만 오른쪽으로 붙는다: "새 대화 시작" 행, "일반" 헤더, 패널 개수, 패널 제목. `screenshots/19-arabic-light-sidebar-alignment.png`, `screenshots/20-arabic-light-panes.png`. 위치: `client/nested-sidebar.tsx`, `client/chat.tsx`, `client/panes/screen.tsx`의 `Text` 정렬. 라이트 테마 자체는 문제없었다.

### U-22. 보관 확인 창의 경고가 한 줄에 몰려 있고 용어가 섞인다
"비게 되는 worktree 1개의 폴더도 삭제됩니다 · 푸시하지 않은 변경은 되찾을 수 없습니다 · 하위 3개도 함께 보관됩니다 · 비게 되는 워크스페이스 1개도 함께 보관됩니다"가 가운뎃점으로 이어진 한 문단이다. 배지는 "워크트리", 창은 "worktree"다. worktree 워크스페이스를 직접 보관할 때는 "worktree 폴더가 삭제됩니다"만 나오고 푸시 안 된 변경 경고가 빠진다. 보관 후 되돌리기나 알림도 없다. `screenshots/18-archive-parent-dialog-dense-warning.png`. 위치: `client/archive.tsx`, `client/sidebar-strings.ts`.

### U-23. 일반(General) 채팅의 구현이 화면에 드러난다
"새 대화"를 누르면 Paseo의 "새 워크스페이스" 화면이 열리고 프로젝트 칸에 `.paseo-chat`이 보인다. 누르기만 해도 `.paseo-chat` 프로젝트와 빈 워크스페이스가 등록된다. 폴더는 `PASEO_HOME`과 상관없이 항상 `~/.paseo-chat`이라 격리/개발 데몬과 실사용 데몬이 같은 작업 폴더를 쓴다. 위치: `server/chat.ts`, `client/chat.tsx`.

### U-24. 그 밖의 작은 것
- 접힌 프로젝트 안에 지금 열린 워크스페이스가 있어도 헤더에 표시가 없다.
- 이름 길이 제한이 없다(150자 이상 저장되어 Paseo 상단에서 프로젝트 이름을 밀어낸다).
- 사이드바 헤더 항목 이름이 설정에서는 "채팅을 패널로 보기", 사이드바에서는 "패널"이다. 사이드바 보기 선택의 Atrium 설명은 영어 고정이다(`index.client.tsx`).
- 패널은 최소 300px 아래로 줄지 않고 기본 460px이라 1280px 창에서 3개째부터 가로 스크롤이 생긴다. 화면 밖 패널이 있다는 표시는 스크롤 막대뿐이다.
- 데몬이 재연결되면 "하위 에이전트 N개도 함께 열기" 안내가 사라진다.
- 프로젝트를 지워도 `project-order.json`에 경로가 남는다(의도된 동작으로 보이나 계속 쌓인다).

---

## 정리 상태

- 격리 데몬(`/private/tmp/atrium-uxaudit`)과 정적 웹 서버(6792)는 종료했다. 실사용 데몬(6767)은 그대로다.
- 임시 폴더 `/private/tmp/atrium-uxaudit`, `/private/tmp/atrium-uxaudit-fx`, `/private/tmp/atrium-uxaudit-web`은 재현용으로 남겨 두었다. 지워도 된다.
- 테스트 에이전트는 호스트의 실제 Claude 계정으로 Haiku 한 줄 응답을 십여 번 실행했다(세션 로그가 `~/.claude/projects`에 남는다). `~/.paseo-chat`에서 일반 채팅 에이전트 2개를 돌렸고 파일은 만들지 않았다.
- 소스 코드는 수정하지 않았다. 추가한 것은 이 보고서와 `docs/audit/screenshots/`의 PNG 21장이다.

---

# 재검증 (2026-11-22, `fix/client-audit` @ e66157d)

- 환경: 격리 데몬 6811 + 정적 웹 클라이언트 6812 (`docs/releasing-isolated-web` fd1c7d4의 RELEASING.md §3 절차 그대로, 추가 조치 없이 연결됨). 실사용 데몬(6767)은 건드리지 않았다.
- 픽스처: 1차와 같은 구성을 새로 만들었다(프로젝트 3개, 같은 브랜치 워크스페이스 4개, worktree 1개, 부모 → 자식 → 손자, 로그인 안 된 추가 Claude/Codex 프로바이더).
- **중요한 전제**: 브랜치를 그대로 설치하면 클라이언트가 아예 뜨지 않는다(아래 R-1). 그래서 U-1..U-24는 `/private/tmp`에 만든 **임시 사본에서 배지 id 한 줄만 `"worktree"`로 바꾼 것**으로 검증했다. 저장소와 worktree의 소스는 수정하지 않았다. 아래 "수정됨" 판정은 모두 R-1이 고쳐진다는 조건에서만 유효하다.
- 한계는 1차와 같다. Claude/Codex 변경은 확인 창까지만 열었고, Command Center는 등록 코드로만 확인했다.

## 새로 발견한 문제

### R-1 (P0, 회귀). 브랜치 그대로는 Atrium 클라이언트가 전혀 로드되지 않는다

- 재현: `.worktrees/client-audit`(e66157d)를 격리 데몬에 폴더 설치 → `paseo plugin ls`는 `running` → 웹 클라이언트(Paseo 0.17.1)를 연다.
- 기대: 설정 > 사이드바 > 보기에 Atrium이 있고, 헤더에 "패널"이 나온다.
- 실제: 보기 목록에 "기본 보기"만 있고 "패널" 항목, `/mcp`, `/plugins`도 없다. 브라우저 콘솔: `[Plugins] Failed to evaluate srv_…/atrium Error: Invalid workspace row badge item id: atrium.worktree`. 클라이언트 엔트리 전체가 실패해서 사이드바, 패널, 툴박스가 모두 사라진다. 서버 쪽은 정상이라 `plugin ls`만 봐서는 드러나지 않는다.
- 원인으로 보이는 곳: `client/worktree-badge-item.tsx:37`의 `id: "atrium.worktree"`(커밋 75c1232, A-4). 호스트가 id의 점을 받아들이지 않는 것으로 보인다(다른 등록 id는 `panes`, `toolbox-mcp`처럼 점이 없다). 임시 사본에서 id를 `"worktree"`로만 바꾸자 정상 로드됐다.
- 덧붙임: 등록 하나가 실패하면 플러그인 전체가 죽는다. 새 API(`addWorkspaceRowBadgeItem`) 등록은 실패해도 나머지가 살도록 감싸는 편이 안전하다. `requirements.paseo`가 `>=0.16.1`인데 이 API가 그 버전에 있는지도 확인이 필요하다(확인하지 못했다).
- 스크린샷 없음(콘솔 문구로 대체).

### R-2 (P3). Paseo 탭이 안내문만 있는 막다른 화면이다

`/plugins`의 Paseo 탭은 "Paseo 플러그인은 Paseo에서 관리합니다 … 설정 > 플러그인을 열어…" 문구만 보여 주고, 그 화면을 여는 버튼이나 링크가 없다. 결정된 방향(네이티브 Gallery 위임)에는 맞지만, 탭을 눌러 들어온 사람은 직접 설정을 찾아가야 한다. 호스트 이름이 보여 스크린샷은 남기지 않았다. 위치: `client/toolbox/plugins-screen.tsx`.

### R-3 (P3). "전체" 보기의 MCP 서버 추가 폼은 미리보기에서 취소하면 입력이 지워진다

프로필이 둘 이상이라 "전체" 보기가 될 때, 서버 추가 → 명령 확인 → 취소 후 다시 열면 이름/명령이 비어 있다. 1차 때 단일 프로필 보기에서는 값이 남았다. 출처 설치 폼(U-10)은 이번에 값이 유지되도록 고쳐져서 두 폼이 다시 어긋난다. 위치: `client/toolbox/mcp-screen.tsx`의 전체 보기 추가 폼.

### R-4 (P3). 보관된 세션의 패널 문구

패널 제목이 원래 제목("결제 에이전트") 대신 "제거된 세션"이 되고, 안내가 "보관되었거나 프로젝트가 제거되었습니다"다. 이제 Atrium에서 프로젝트를 제거할 수 없으므로 "제거"라는 말이 맞지 않는다. `screenshots/re-05-archived-pane-readonly.png`.

## 항목별 결과

| ID | 결과 | 확인한 내용 |
|---|---|---|
| U-1 | 수정됨 (새 동작) | 버튼이 "사이드바에서 숨기기"가 됐고, 확인 문구가 실제 동작과 맞다. 숨긴 뒤에도 `paseo project ls`와 세션이 그대로다. "숨긴 프로젝트 1개 / 다시 표시"로 되돌아오고, 새로고침 후에도 숨김이 유지된다(`project-order.json`의 `hiddenProjects`). compact의 프로젝트 메뉴에도 있다. `re-02-project-hidden-entry.png` |
| U-2 | 수정됨 | 하위 에이전트 패널에 "Root orchestrator에게서" + 지시 본문이 나온다. 손자도 같다. `re-04-pane-permission-banner-and-sender.png` |
| U-3 | 수정됨 | compact 길게 누르기 메뉴에 "이름 바꾸기"가 있고 창이 열린다. |
| U-4 | 수정됨 | 보관된 에이전트의 패널은 입력창이 없어지고 "이 패널에서는 메시지를 보낼 수 없습니다"가 나온다. 기록은 보인다. 문구는 R-4. `re-05-archived-pane-readonly.png` |
| U-5 | 수정됨 | 제목 없는 같은 브랜치 워크스페이스가 에이전트 제목으로 나온다("Reply with exactly: ok1" 등). 에이전트가 없는 것만 `main`이다. `re-01-sidebar-agent-titles.png` |
| U-6 | 수정됨 | 패널 상단에 "권한 승인을 기다리고 있습니다. 패널에서는 응답할 수 없습니다." + "Paseo에서 응답" 버튼, 헤더 표시도 사이드바와 같은 주황 아이콘이다. 도구 행은 여전히 "Write 실행 중"이다(사소). `re-04-…png` |
| U-7 | 수정됨 | 하위 트리, 프로젝트, 일반 영역의 접힘이 새로고침 후에도 유지된다. |
| U-8 | 수정됨 | 안내가 "비워 두면 브랜치 이름(main)으로 돌아갑니다"로 바뀌었고 값이 맞다. 단, U-5 때문에 비운 뒤 행에는 브랜치 이름이 아니라 에이전트 제목("Root orchestrator")이 보인다. 안내와 화면이 한 번 더 어긋나는 지점이라 적어 둔다. |
| U-9 | 수정 안 됨 | `/mcp`, `/plugins`의 슬래시 명령과 Command Center 항목이 여전히 `context: "agent"`뿐이고 사이드바 항목도 없다(`client/toolbox/index.tsx`). Paseo 플러그인만 네이티브 설정으로 넘어가 어디서든 열 수 있게 됐다. Claude/Codex 플러그인과 MCP는 그대로 에이전트 채팅이 있어야 들어간다. |
| U-10 | 수정됨 | Claude 탭의 출처 설치로 확인(Paseo 출처 설치는 없어졌다). "명령을 확인하지 못했습니다: https:// 주소를 사용하세요." 처럼 한국어로 나오고 "지원하지 않는 작업" 문구가 없다. 취소 후 다시 열면 입력이 남아 있다. |
| U-11 | 부분 수정 | 카드 제목이 "Claude profiles"/"Codex profiles"로 구분되고, 라벨이 잘리지 않으며, 기본 계정 카드 아래에 놓인다. 오류가 "Run claude auth login for this profile, then refresh."처럼 할 일을 알려 준다. 문구는 영어 그대로다(결정 사항으로 전달받음). 프로필 라벨이 오류 줄과 아래 줄에 두 번 나온다. |
| U-12 | 수정됨 | compact 빈 화면이 "세션을 길게 누르고 '패널에서 열기'를 고르면…"으로 바뀌었다. 웹 compact에서 스크롤을 놓으면 패널 경계(408px)로 맞춰진다. "모두 닫기" 확인 문구는 compact에서도 "다시 끌어다 놓을 수 있습니다"다(사소). |
| U-13 | 수정됨 | 패널 제목 아래 "alpha-service · main A"가 나온다. |
| U-14 | 수정됨 | 패널이 하나일 때 양쪽, 끝에 있을 때 해당 쪽 화살표가 비활성(`aria-disabled`)이다. 이동도 정상이다. |
| U-15 | 부분 수정 | 에이전트 없는 행의 패널 버튼이 비활성 + "아직 패널에서 열 대화가 없습니다"로 나온다. 끌어다 놓으면 여전히 아무 반응이 없다. |
| U-16 | 부분 수정 | 서버 추가 미리보기에 전송 방식과 명령/인자가 나온다. 제거/로그인 창은 빈 "실행할 명령" 제목이 없어졌지만 여전히 "정확한 명령은 실행 결과에 표시됩니다."만 나온다. claude.ai 커넥터의 "제거"는 이번에도 실행해 보지 않았다. |
| U-17 | 수정됨 | 잘못된 이름이면 "명령 확인"이 비활성이고 "영문, 숫자와 _ - . : @ / 만…" 안내가 나온다. 범위가 "이 프로젝트 · 이 계정 / 이 프로젝트 · 공유 / 계정 전체" + 설명으로 바뀌었다. |
| U-18 | 해당 없음 (결정 변경) | Paseo 카탈로그가 툴박스에서 빠졌다. 새 화면은 R-2. |
| U-19 | 수정됨 | 미설치 Antigravity 탭에 기준 줄이 안 나오고, 줄표가 문장부호로 바뀌었다("alpha-service 기준입니다. 다른 프로젝트의…", "작업 중입니다. 메시지는…"). |
| U-20 | 부분 수정 | 레이블이 번역됐다("main A 열기", "에이전트 … 열기", "…에 새 워크스페이스", "접기/펼치기", 아랍어도 확인). 상태 점도 읽힌다("완료, 아직 확인 안 함", "대기", "입력을 기다리는 중"). 행 버튼 안에 버튼이 중첩되는 구조는 그대로다. "다시 표시" 버튼 레이블에 프로젝트 이름이 없다. |
| U-21 | 수정됨 | 아랍어에서 "새 대화 시작" 행, 일반 헤더, 패널 개수가 아이콘 옆에 붙는다. `re-06-arabic-light-aligned.png` |
| U-22 | 부분 수정 | 결과가 줄마다 나뉘고 "워크트리"로 통일됐으며 보관 후 "보관했습니다. Paseo의 보관함에서 찾을 수 있습니다." 알림이 뜬다. 다만 "비게 되는 워크트리 1개도 함께 보관되고, Paseo가 같은 방식으로 폴더를 지웁니다."의 "같은 방식으로"가 무엇과 같다는 것인지 읽히지 않고, 푸시 안 된 변경 경고가 모든 경우에서 빠졌다. |
| U-23 | 수정 안 됨 | "새 대화"가 여전히 Paseo의 "새 워크스페이스" 화면을 열고 `.paseo-chat`이 보인다. 누르기만 해도 프로젝트와 빈 워크스페이스가 등록되고, 폴더는 `~/.paseo-chat` 고정이다(`server/chat.ts:12`). |
| U-24 | 부분 수정 | 고쳐짐: 접힌 프로젝트 안에 열린 워크스페이스가 있으면 헤더가 굵게 나온다(`re-03-folded-active-project-bold.png`), 이름 80자 제한, 설정의 헤더 항목 이름이 "패널"로 통일, 보기 설명이 번역 키를 쓴다(코드로 확인). 그대로: 재연결 후 "하위 에이전트 N개도 함께 열기" 안내가 사라진다, 패널 기본 너비/가로 스크롤, 지운 프로젝트 경로가 순서 파일에 남는 것(이번에는 확인하지 않았다). |

## 회귀 확인 (1차에 정상이던 영역)

R-1을 우회한 사본 기준으로 모두 정상이다: 트리 중첩, worktree 배지, 프로젝트/세션 드래그 순서 변경과 저장, 이름 바꾸기, 보관, 행 버튼과 드래그로 패널 추가, 가족 묶음과 "함께 열기", 패널 이동/닫기/모두 닫기, 패널에서 메시지 전송(새 `chat.send` 경로), 새로고침 후 패널 복원, 데몬 재시작 후 자동 재연결, `/mcp`와 `/plugins` 진입, 420px compact, 아랍어 + 라이트 테마.

## 정리 상태

- 격리 데몬(`/private/tmp/atrium-uxre`, 6811)과 정적 서버(6812)는 종료했다. 실사용 데몬은 그대로다.
- 임시 폴더 `/private/tmp/atrium-uxre`, `/private/tmp/atrium-uxre-fx`, `/private/tmp/atrium-uxre-src`(id 한 줄을 바꾼 사본)가 남아 있다. 지워도 된다.
- 테스트 에이전트는 실제 Claude 계정으로 Haiku 한 줄 응답을 십여 번 실행했다. 이번에는 `~/.paseo-chat`에서 에이전트를 돌리지 않았다(격리 데몬에 프로젝트 등록만 됐다).
- 추가한 것은 이 섹션과 `docs/audit/screenshots/re-*.png` 6장이다.

---

# 재검증 2차 (2026-11-22, `fix/client-audit` @ 668025d, 수정 없이 설치)

- 환경: 격리 데몬 6811 + 정적 웹 클라이언트 6812, RELEASING.md §3(fd1c7d4 추가분 포함) 절차 그대로. `.worktrees/client-audit`를 **고치지 않고** 폴더 설치했다. 실사용 데몬(6767)은 건드리지 않았다.
- 픽스처: git 프로젝트 2개, local 워크스페이스 3개(하나는 에이전트 없음), worktree 워크스페이스 1개, 부모 → 다른 worktree의 자식, 추가 Claude 프로바이더 1개(전체 보기용).
- 한계: Claude/Codex 변경은 이번에도 확인 창까지만 열었다. 브라우저에 1차 재검증 데몬의 캐시가 남아 있어 localStorage/IndexedDB를 비우고 새로 연결했다.

| 항목 | 결과 | 확인한 내용 |
|---|---|---|
| R-1 | 수정됨 | 수정 없는 브랜치로 클라이언트가 로드된다. 설정 > 사이드바 > 보기에 Atrium, 헤더에 "패널"이 있고 `/mcp`, `/plugins`가 열린다. worktree 배지와 색 막대가 보인다. 세션 내내 `browser_logs`에 평가 오류가 없었다(RN의 `useNativeDriver` 경고뿐). 배지 id는 `"worktree"`(`client/worktree-badge-item.tsx:44`). `re2-01-unmodified-loads-with-badges.png` |
| U-15 | 수정됨 | 에이전트 없는 행을 패널로 끌어다 놓으면 "아직 패널에서 열 대화가 없습니다" 알림이 뜬다. 패널은 추가되지 않는다. |
| U-16 | 수정됨 (명령 표시는 그대로) | 제거 창에 "이름", 로그인 창에 "이름"과 "범위(claude.ai 커넥터)"가 나와 무엇에 작용하는지 알 수 있다. "정확한 명령은 실행 결과에 표시됩니다."는 남아 있어 실행될 명령 자체는 여전히 미리 볼 수 없다. |
| U-22 | 수정됨 | "비게 되는 워크트리 1개도 함께 보관됩니다. 공유 중이거나 외부에서 추가한 워크트리가 아니면 Paseo가 그 폴더도 지웁니다. 푸시하지 않은 변경은 되찾을 수 없습니다." 로 읽히게 바뀌었고, worktree 워크스페이스를 직접 보관할 때도 같은 경고가 나온다. |
| R-3 | 수정됨 | 전체 보기의 MCP 추가 폼에서 미리보기를 취소하고 다시 열면 이름/명령이 남아 있다. |
| R-4 | 부분 수정 | 보관/삭제된 세션의 패널이 원래 제목("Beta agent", "Child in worktree")을 유지하고 "프로젝트가 제거되었습니다" 표현이 없어졌다. 다만 보관한 것과 `paseo delete`로 지운 것 모두 같은 문구("이 세션은 보관되었거나 더 이상 없습니다…")가 나와 둘이 구분되지는 않는다. 제목 아래 프로젝트 · 워크스페이스 줄도 사라진다. `re2-02-archived-pane-keeps-title.png` |
| Paseo 탭 안내 | 그대로 (R-2) | "Paseo 플러그인은 Paseo에서 관리합니다 / <호스트>의 Paseo에서 설정 > 플러그인을 열어 … 여기의 다른 탭은 Claude Code, Codex, Antigravity 플러그인을 관리합니다." 문구는 정확하다. 설정을 여는 버튼이나 링크는 여전히 없다. |

## 회귀 스모크

모두 정상: 프로젝트 숨기기 → "숨긴 프로젝트 1개" → 다시 표시, 패널 3개 열기와 메시지 전송(응답 수신), 이름 바꾸기(한글 + 이모지, 안내 문구 "브랜치 이름(main)"), compact 길게 누르기(세션: 패널에서 열기 / 이름 바꾸기 / 보관, 프로젝트: 순서 바꾸기 / 사이드바에서 숨기기), 보관된 세션 패널의 입력 차단.

남은 사소한 것: "다시 표시" 버튼의 접근성 레이블에 프로젝트 이름이 없다(1차 재검증 U-20에 적은 것과 같다).

## 정리 상태

격리 데몬(`/private/tmp/atrium-uxre2`)과 정적 서버는 종료했다. 임시 폴더 `/private/tmp/atrium-uxre2`, `/private/tmp/atrium-uxre2-fx`가 남아 있다. 추가한 것은 이 섹션과 `re2-*.png` 2장이다.

---

# 재검증 3차 (rebase 후) (2026-11-22, `fix/client-audit` @ cdf0c4e, origin/main 0.5.0 위)

- 환경: 격리 데몬 A(6811) + B(6813), 정적 웹 클라이언트 6812. RELEASING.md §3 절차대로 두 데몬에 브랜치를 **수정 없이** 폴더 설치하고 `host add 127.0.0.1:6813 --label "Host B"`로 A에 B를 붙였다. 브라우저는 새 origin(`http://localhost:6812`)으로 열었다. 실사용 데몬(6767)은 건드리지 않았다.
- 픽스처: 호스트마다 git 프로젝트 3개, worktree 워크스페이스 1개, 에이전트 2~3개.
- 한계: 세션 대부분 동안 브라우저 탭이 화면 캡처를 내주지 않아(`screenshot_no_frame`) 확인은 DOM 읽기로 했고, 스크린샷은 마지막에 compact 너비로 3장만 남겼다. 캡처에 보이는 "Host A"는 호스트 이름을 가린 것이다. 세션 내내 콘솔에 평가 오류는 없었다.

| # | 항목 | 결과 | 확인한 내용 |
|---|---|---|---|
| 1 | 호스트 섹션에서 숨기기 | 통과 | A 섹션의 `a-beta`, B 섹션의 `b-two`를 숨기면 각 섹션에서 빠지고 "숨긴 프로젝트 2개"에 `a-beta / <A 이름>`, `b-two / Host B`로 호스트가 붙어 나온다. 순서를 바꾸지 않고 다시 표시하면 원래 자리로 돌아온다(A의 가운데, B의 맨 끝 모두 확인). `re3-03-hidden-list-with-host-labels.png` |
| 2 | A 숨김 중 B 재정렬 → 다시 표시 | 통과 | `a-beta`를 숨긴 채 B 섹션에서 `b-one`을 맨 위로 옮기고 다시 표시하니 A 순서(`a-gamma, a-beta, a-alpha`)가 그대로다. |
| 3 | 숨기기 창 제목 "이름 · 호스트" | 통과 | `a-beta · <A 이름>`, `b-two · Host B`. compact의 프로젝트 메뉴 제목도 `b-one · Host B`. `re3-02-hide-dialog-name-and-host.png`, `re3-01-compact-project-menu-host-label.png` |
| 4 | worktree 레인/배지와 Atrium 배지 항목 공존 | 통과 | Paseo 기본 사이드바에서 두 호스트의 worktree 행에 Atrium 배지(`feature-login · feature/login`, `feature-b · feature/b`)가 붙고 일반 행에는 없다. Atrium 보기에서는 A의 worktree 행에 배지가, B의 worktree 행에는 Paseo의 브랜치 줄(`feature/b`)이 나온다(다른 호스트는 기본 줄을 쓰는 기존 설계). 겹치거나 깨진 행은 없었다. 색과 레인의 모양은 캡처가 안 돼 눈으로 확인하지 못했다. |
| 5 | `/plugins` Paseo 탭 안내 | 통과 | "Paseo 플러그인은 Paseo에서 관리합니다 / <호스트>의 Paseo에서 설정 > 플러그인을 열어 … 여기의 다른 탭은 Claude Code, Codex, Antigravity 플러그인을 관리합니다." |
| 6 | 설정 > 사이드바 > 보기 → Atrium | 통과 | 목록에 Atrium이 있고, 고르면 호스트 섹션 두 개와 프로젝트, 세션이 나온다. |
| 7 | 스모크 | 통과 | 패널 전송(A의 에이전트에 보내고 응답 수신), 이름 바꾸기(A, B 워크스페이스 모두), compact 길게 누르기(세션: 패널에서 열기 / 이름 바꾸기 / 보관, 프로젝트: 순서 바꾸기 / 사이드바에서 숨기기). |

## 새로 본 것 (사소, PR을 막을 정도는 아님)

- **같은 섹션 안에서 숨김 + 재정렬**: B가 `b-two, b-one, b-three`일 때 가운데 `b-one`을 숨기고 남은 둘을 맞바꾼 뒤(`b-three, b-two`) 다시 표시하면 `b-one`이 가운데가 아니라 섹션 맨 위로 온다(`b-one, b-three, b-two`). 저장된 순서에서도 맨 앞이다. 요청받은 경우(다른 호스트 섹션을 재정렬)는 문제없고, 같은 섹션을 건드렸을 때만 숨긴 항목의 자리가 바뀐다. 두 번 재현했다. 위치로 보이는 곳: 프로젝트 순서 저장 시 숨긴 항목을 합치는 부분(`shared/project-order.ts`).
- **다른 호스트의 패널 안내에 서버 ID가 그대로 나온다**: B의 세션을 패널로 열면 "다른 호스트(srv_…)의 채팅은 아직 여기에 표시할 수 없습니다. Paseo에서 열어 보세요."로 나온다. 사이드바는 "Host B"라는 이름을 쓰는데 여기만 내부 ID다.
- "다시 표시" 버튼의 접근성 레이블에 프로젝트 이름과 호스트가 없다(이전 회차와 같음).

## 정리 상태

격리 데몬 두 개(`/private/tmp/atrium-uxre3a`, `/private/tmp/atrium-uxre3b`)와 정적 서버는 종료했다. 임시 폴더 `/private/tmp/atrium-uxre3a`, `…3b`, `/private/tmp/atrium-uxre3-fx`가 남아 있다. 추가한 것은 이 섹션과 `re3-*.png` 3장이다.
