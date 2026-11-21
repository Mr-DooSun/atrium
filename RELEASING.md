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

- 실사용 Paseo 데몬(`~/.paseo`, 포트 6767)에는 atrium을 하나만 설치한다. 마켓플레이스판과 개발판은 사용량 소스 ID가 같아 함께 실행할 수 없다(`Duplicate usage source`).
- 개발판을 평소 쓰는 Paseo에서 확인하려면 마켓플레이스판을 빼고 개발판으로 바꿔 끼운다(아래 "실사용 데몬에서 개발판 쓰기").
- 설치 확인(git 소스 관리 설치)과 여러 host 구성 같은 재현은 격리 데몬과 앱 내장 웹 클라이언트로 한다.

### 실사용 데몬에서 개발판 쓰기

전용 worktree `../atrium-live`를 폴더 소스로 설치한다. 폴더 소스는 그 자리의 코드를 그대로 쓰고 `plugin update` 대상에서 빠진다. 원본 체크아웃(`main`)은 설치하지 않는다.

```bash
PASEO=/Applications/Paseo.app/Contents/Resources/bin/paseo
git worktree add --detach ../atrium-live origin/main
ln -s ../atrium/node_modules ../atrium-live/node_modules
cp ~/.paseo/config.json ~/.paseo/config.json.bak-$(date +%Y%m%d)-atrium-live
$PASEO plugin remove atrium                     # 마켓플레이스판 제거
sed -i '' 's/"name": "Atrium"/"name": "Atrium dev"/' ../atrium-live/paseo-plugin.json   # 커밋하지 않는다
$PASEO plugin install "$(cd ../atrium-live && pwd)"
$PASEO plugin ls atrium                         # running, name "Atrium dev" 확인
```

`../atrium-live`의 `paseo-plugin.json`은 이름(`name`, `translations.zh-CN.name`)만 `Atrium dev`로 바꿔 두고 커밋하지 않는다. 설정의 플러그인 목록에서 개발판은 `Atrium dev`, 마켓플레이스판은 `Atrium`으로 구분된다. id는 `atrium` 그대로 둔다.

확인할 브랜치로 바꾼 뒤 다시 불러온다.

```bash
git -C ../atrium-live fetch origin
git -C ../atrium-live stash                      # Atrium dev 이름 수정을 잠시 치운다
git -C ../atrium-live checkout --detach origin/<branch>
git -C ../atrium-live stash pop                  # 이름 수정을 되돌려 놓는다
$PASEO plugin reload atrium
$PASEO plugin logs atrium                       # Plugin ready 확인
```

마켓플레이스판으로 돌아갈 때:

```bash
$PASEO plugin remove atrium
$PASEO plugin install mr-doosun/atrium
git -C ../atrium-live checkout -- paseo-plugin.json   # 이름 수정 되돌리기(선택)
```

- 사이드바 순서 같은 atrium 데이터는 플러그인 폴더가 아니라 `~/.paseo/atrium/`(예전 경로 `~/.paseo/nested-agents/`)에 있어 바꿔 끼워도 남는다.
- 개발판이 깨지면 평소 쓰는 사이드바도 깨진다. 실패하면 `plugin logs`를 확인하고, 급하면 마켓플레이스판으로 돌아간다.
- 설정의 플러그인 목록에서 폴더 소스는 커밋 대신 폴더 경로로 보인다.

`paseo daemon start`에는 `--port` 옵션이 없다(`--home`, `--timeout`만 있다). 포트는 격리 홈의 `config.json`에 미리 써 둔다.

```bash
PASEO=/Applications/Paseo.app/Contents/Resources/bin/paseo
DIR=/private/tmp/<dir>; PORT=<다른 포트>
mkdir -p $DIR
cat > $DIR/config.json <<JSON
{"version":1,"daemon":{"listen":"127.0.0.1:$PORT","mcp":{"injectIntoAgents":false},"relay":{"enabled":false}},"pluginsEnabled":true}
JSON
env -u PASEO_AGENT_ID -u PASEO_HOME $PASEO daemon start --home $DIR
```

git 소스 관리 설치 확인과 정리:

```bash
PASEO_HOME=$DIR $PASEO plugin install git:Mr-DooSun/atrium --ref <branch> --id <test-id> --host 127.0.0.1:$PORT </dev/null
PASEO_HOME=$DIR $PASEO plugin ls --host 127.0.0.1:$PORT    # running 확인
$PASEO daemon stop --home $DIR
```

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
7. 심사가 머지되면 실사용 데몬에서 `paseo plugin update atrium --yes`를 실행한다. 목록 갱신이 늦을 수 있다. 개발판(폴더 소스)을 쓰는 중이면 `../atrium-live`를 태그로 옮겨 `plugin reload`하거나, 3번의 방법으로 마켓플레이스판으로 돌아간다.

## 9. 사용자 승인이 필요한 일

되돌리기(revert, reset), 삭제, force push, 원격 브랜치 삭제는 사용자 승인 후에만 한다.
