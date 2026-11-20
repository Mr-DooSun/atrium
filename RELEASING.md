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

- 실사용 Paseo 데몬(`~/.paseo`, 포트 6767)에 개발판을 설치하거나 플러그인을 켜고 끄지 않는다. 마켓플레이스판과 사용량 소스 ID가 같아 동시에 실행할 수 없다.
- UI와 설치 확인은 격리 데몬과 앱 내장 웹 클라이언트로 한다.

```bash
PASEO=/Applications/Paseo.app/Contents/Resources/bin/paseo
PASEO_AGENT_ID= $PASEO daemon start --home /private/tmp/<dir> --port <다른 포트>
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
7. 심사가 머지되면 실사용 데몬에서 `paseo plugin update atrium --yes`를 실행한다. 목록 갱신이 늦을 수 있다.

## 9. 사용자 승인이 필요한 일

되돌리기(revert, reset), 삭제, force push, 원격 브랜치 삭제는 사용자 승인 후에만 한다.
