# 작업·배포 규칙

여러 팀이 같은 저장소를 다루므로 아래 규칙을 따른다. 출시는 사용자 승인 후에만 진행한다.

## 1. 역할

| 하는 일 | 기능 팀 | 배포 팀 |
|---|---|---|
| 기능·수정 PR 작성 | O | |
| CHANGELOG `## [Unreleased]` 항목 추가 | O | |
| PR 머지 | | O |
| 버전 올리기, CHANGELOG 확정 | | O |
| 태그, GitHub Release | | O |
| getpaseo/plugins 제출 | | O |
| 원격 브랜치 정리 | | O |

## 2. 작업 위치

원본 체크아웃의 `main`에서 직접 작업하지 않는다. 작업마다 worktree를 만든다.

```bash
git fetch origin
git worktree add -b <type>/<name> ../atrium-<name> origin/main
```

- PR은 squash 머지한다. 머지 전에 `origin/main` 위로 rebase한다.
- worktree의 `node_modules`는 심볼릭 링크일 수 있다. 커밋하지 않는다.

## 3. 테스트 환경

- 실사용 Paseo 데몬(`~/.paseo`, 포트 6767)에는 운영판(마켓플레이스)과 개발판을 함께 설치해 두고, **한 번에 하나만 켠다**. 둘은 사용량 소스 ID가 같아 동시에 켜면 나중에 켠 쪽이 `Duplicate usage source`로 실패한다(`failed`). 플러그인 서버 코드는 자기 설치 ID를 알 수 없어 코드로 피할 수 없다.
- 설치 확인(git 소스 관리 설치)과 여러 host 구성 같은 재현은 격리 데몬과 앱 내장 웹 클라이언트로 한다.

### 실사용 데몬의 운영판과 개발판

| | ID | 설정의 이름 | 소스 |
|---|---|---|---|
| 운영판 | `atrium` | Atrium | 마켓플레이스 `mr-doosun/atrium` |
| 개발판 | `atrium-dev` | Atrium dev | 전용 worktree `../atrium-live` (폴더 소스) |

처음 설정:

```bash
PASEO=/Applications/Paseo.app/Contents/Resources/bin/paseo
git worktree add --detach ../atrium-live origin/main
ln -s ../atrium/node_modules ../atrium-live/node_modules
sed -i '' 's/"name": "Atrium"/"name": "Atrium dev"/' ../atrium-live/paseo-plugin.json   # 커밋하지 않는다
cp ~/.paseo/config.json ~/.paseo/config.json.bak-$(date +%Y%m%d)-atrium
$PASEO plugin install mr-doosun/atrium          # 운영판
$PASEO plugin disable atrium                    # 하나만 켜 둔다
$PASEO plugin install "$(cd ../atrium-live && pwd)" --id atrium-dev
$PASEO plugin ls                                # atrium disabled, atrium-dev running
```

바꿔 쓰기: 설정 → 플러그인에서 켜진 쪽을 먼저 끄고 다른 쪽을 켠다. CLI로는 아래와 같다.

```bash
$PASEO plugin disable atrium-dev && $PASEO plugin enable atrium   # 운영판으로
$PASEO plugin disable atrium && $PASEO plugin enable atrium-dev   # 개발판으로
```

- 둘 다 켜서 한쪽이 `failed`가 되면, 그쪽을 끈다.
- 사이드바 보기 선택은 플러그인 ID별이다(`atrium/atrium`, `atrium-dev/atrium`). 바꾼 뒤 사이드바가 기본 보기로 돌아가면 설정 → 사이드바 → 보기에서 Atrium을 다시 고른다.
- 사이드바 순서 같은 atrium 데이터(`~/.paseo/atrium/`, 예전 경로 `~/.paseo/nested-agents/`)는 두 판이 함께 쓴다.
- 운영판 업데이트: `$PASEO plugin update atrium --yes`. 폴더 소스인 개발판은 업데이트 대상이 아니다.

개발판에서 확인할 브랜치로 바꾸기(`Atrium dev` 이름 수정은 stash로 잠시 치웠다가 되돌린다):

```bash
git -C ../atrium-live fetch origin
git -C ../atrium-live stash
git -C ../atrium-live checkout --detach origin/<branch>
git -C ../atrium-live stash pop
$PASEO plugin reload atrium-dev
$PASEO plugin logs atrium-dev                   # Plugin ready 확인
```

- `plugin reload`는 데몬 쪽 코드만 다시 불러온다. 앱은 예전 화면 코드를 그대로 들고 있을 수 있으니, 앱을 새로고침(`Cmd + R`)하거나 설정 → 플러그인에서 Atrium dev를 껐다 켠다.

### 격리 데몬

`paseo daemon start`에는 `--port` 옵션이 없다(`--home`, `--timeout`만 있다). 포트는 격리 홈의 `config.json`에 미리 써 둔다. 웹 UI(`http://127.0.0.1:<PORT>/`)를 쓰려면 `features.webUi.enabled`를 켠다. Atrium 화면은 설정 → 사이드바 → 보기에서 Atrium을 골라야 보인다.

```bash
PASEO=/Applications/Paseo.app/Contents/Resources/bin/paseo
DIR=/private/tmp/<dir>; PORT=<다른 포트>
mkdir -p $DIR
cat > $DIR/config.json <<JSON
{"version":1,"daemon":{"listen":"127.0.0.1:$PORT","mcp":{"injectIntoAgents":false},"relay":{"enabled":false}},"pluginsEnabled":true,"features":{"webUi":{"enabled":true}}}
JSON
env -u PASEO_AGENT_ID -u PASEO_HOME $PASEO daemon start --home $DIR
```

git 소스 관리 설치 확인과 정리:

```bash
PASEO_HOME=$DIR $PASEO plugin install git:Mr-DooSun/atrium --ref <branch> --host 127.0.0.1:$PORT </dev/null
PASEO_HOME=$DIR $PASEO plugin ls --host 127.0.0.1:$PORT    # running 확인
$PASEO daemon stop --home $DIR
```

- 같은 데몬에 atrium을 두 번 설치하면 사용량 소스가 겹친다. 다시 설치하기 전에 `plugin remove`로 앞선 설치를 지운다.
- 여러 host 재현: 격리 데몬 두 개를 띄우고 `$PASEO --host 127.0.0.1:<A> host add 127.0.0.1:<B> --label <이름>`으로 A에 B를 붙인 뒤 A의 웹 UI를 연다.

## 4. 머지 전 확인

- [ ] `npm run typecheck`
- [ ] `npm run typecheck:tests`
- [ ] `npm test`를 `PASEO_HOME` 설정한 경우와 해제한 경우 모두 실행
- [ ] `tests/runtime-imports.test.ts` 통과. 허용 import는 `@getpaseo/plugin*`, `react`, `react-native`, `zod`, `@tanstack/react-query`, `node:*`, 상대 경로뿐이다. `import type`도 `@getpaseo/client`를 쓰면 안 된다(0.2.0에서 관리 설치 빌드가 실패한 원인).
- [ ] 격리 데몬에 git 소스로 관리 설치해 `running`을 확인한다. `node_modules`가 없는 실제 환경이어야 한다.
- [ ] 개인정보 검사: 이메일, 토큰, 절대 경로, 실명이 코드·문서·스크린샷·커밋 작성자에 없는지 확인한다.

## 5. 문서

- 새 기능이 실행하는 명령, 외부 통신, 읽거나 쓰는 파일을 바꾸면 같은 PR에서 `OVERVIEW.md`의 기능 설명과 Data access를 갱신한다. 심사에서 코드와 대조한다.
- `OVERVIEW.md`에는 `paseo plugin add`, `npm install`, `npm i`를 쓰지 않는다. 검증에서 거부된다.

## 6. 저장소 크기

마켓플레이스판은 git 커밋을 체크아웃해 설치하므로 `package.json`의 `files`가 적용되지 않는다.

- 런타임에 쓰지 않는 큰 파일(디자인 원본 등)은 `main`에 넣지 않는다. 보관은 orphan 브랜치 `brand-assets`를 쓴다.
- manifest `media`는 JPG나 WebP를 권장한다.

## 7. 버전 규칙

Semantic Versioning을 따른다. 1.0 전에는 버그 수정은 `0.x.y`, 기능 추가나 동작 변경은 `0.x.0`이다.

## 8. 출시 절차

1. release 브랜치(worktree)에서 버전과 CHANGELOG를 확정한다.
2. 독립 검증을 하고, 격리 데몬에 git 소스로 관리 설치한다(4번 목록).
3. PR을 squash 머지한다.
4. 머지된 트리가 검증한 트리와 같은지 확인한다.
5. `gh release create vX.Y.Z --target <merge sha>`로 태그와 Release를 만든다.
6. getpaseo/plugins 제출 이슈를 연다.
   - Source: `https://github.com/Mr-DooSun/atrium/tree/vX.Y.Z`
   - Git reference: `vX.Y.Z`
   - Commit: 머지 sha
   - Categories: Sidebar, Workspaces, Orchestration, Utils
   - 변경 요약
7. 심사가 머지되면 실사용 데몬에서 `paseo plugin update atrium --yes`로 운영판을 올린다. 목록 갱신이 늦을 수 있다.

## 9. 사용자 승인이 필요한 일

되돌리기(revert, reset), 삭제, force push, 원격 브랜치 삭제는 사용자 승인 후에만 한다.
