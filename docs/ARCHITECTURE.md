# FourierLab 구조

백엔드 없이 모든 계산과 렌더링이 브라우저에서 이루어지는 단일 페이지 앱입니다(React 19, TypeScript, Vite, Tailwind CSS 4, Canvas 2D, Recharts).

## 디렉터리

```
src/
  math/        순수 수학 엔진 (DOM·React 의존 없음, Node에서 테스트)
    complex.ts     복소수 연산 (참조용·테스트용)
    fft.ts         기수-2 FFT, O(N²) 참조 DFT
    path.ts        정제·검증·호 길이 재표본화, 경로 처리 방식
    fourier.ts     정규화 계수, 부호 있는 주파수
    selection.ts   성분 선택(저주파/진폭)과 연결 순서
    epicycles.ts   에피사이클 관절 계산 (렌더러가 그대로 사용)
    reconstruct.ts 역 FFT 재구성, RMSE, 파세발 오차 곡선
    presets.ts     예제 경로 9종
  core/        React와 무관한 앱 로직
    settings.ts    설정 타입·기본값·범위
    player.ts      재생 시계 (rAF, 실제 경과 시간 기반)
    view.ts        월드↔화면 변환, 확대·이동·맞춤
    project.ts     JSON 프로젝트 파일 형식과 검증
    storage.ts     localStorage 자동 저장
    debug.ts       window.__FOURIERLAB__ (읽기 전용 상태, 브라우저 테스트용)
  render/
    scene.ts       정적/동적 레이어 그리기, 원 선택(hit test)
    export.ts      PNG 내보내기, 다운로드
  hooks/useAnalysis.ts  분석 파이프라인 메모이제이션
  components/   React UI
e2e/            실제 브라우저 테스트(puppeteer-core) 및 성능 측정
scripts/bench.ts  수학 엔진 벤치마크
```

## 데이터 흐름

```
그리기 캔버스 ──(획: 수학 좌표)──► history(실행 취소/다시 실행)
                                     │ 「재구성 시작」 또는 예제 선택
                                     ▼
analyzed 경로 + settings ──► useAnalysis
   preparePath(경로, 모드, N)         ← 경로·모드·N이 바뀔 때만
   computeSpectrum (FFT)              ← 위와 같음
   rankComponents ×2, errorCurve ×2   ← 위와 같음
   selectComponents(K, 선택, 연결순서) ← K·방식이 바뀔 때 (FFT 재계산 없음)
   compileChain, evaluateSeries(역 FFT)
                                     ▼
SceneData ──► Visualizer (정적 캔버스 + 동적 캔버스)
Player ──(매 프레임 t)──► 동적 레이어만 다시 그림
```

- **계산과 렌더링 분리**: FFT는 입력 경로·경로 처리 방식·샘플 수가 바뀔 때만 실행합니다. 원 개수나 선택 방식을 바꾸면 이미 계산한 계수 배열을 다시 정렬하고 자르기만 합니다.
- **React와 애니메이션 분리**: `Player`는 React 바깥의 클래스입니다. 매 프레임 `onFrame` 구독자(캔버스 그리기, 타임라인·시간 표시·성분 카드의 현재 각도)가 DOM이나 캔버스를 직접 갱신하므로, 재생 중에는 React 재렌더링이 일어나지 않습니다. 재생/정지 같은 상태 변화만 `useSyncExternalStore`로 전달합니다.
- **차트 우선순위**: 스펙트럼·오차 차트는 `memo`로 감싸고 `useDeferredValue`로 지연된 K를 받습니다. 그래서 슬라이더를 움직이면 애니메이션이 먼저 갱신되고 차트는 뒤따라 갱신됩니다([PERFORMANCE.md](PERFORMANCE.md)).

## 재생 시계

- 진행도 p ∈ [0, 1]이며, dp/dt = speed / 10초입니다. 1×에서 그림 한 바퀴가 10초입니다.
- requestAnimationFrame의 실제 타임스탬프 차이를 사용합니다. 한 프레임의 최대 진행은 0.1초로 제한하고, `visibilitychange` 이벤트 때 기준 시각을 초기화합니다. 그래서 탭으로 돌아왔을 때 진행도가 갑자기 건너뛰지 않습니다.
- 정지 상태에서는 rAF 루프가 없습니다. 데이터나 뷰가 바뀌면 한 번만 다시 그립니다.
- 한 번만 재생 모드에서는 p = 1에서 멈추고 완성된 그림을 보여 줍니다. 다시 재생하면 0부터 시작합니다.

## Canvas 렌더링

- 두 캔버스를 겹쳐 사용합니다. 정적 레이어(배경, 격자, 원본, 전체 근사 곡선)와 동적 레이어(궤적, 원, 벡터, 펜 끝, 선택 강조)입니다.
- devicePixelRatio(최대 3)를 반영해 버퍼 크기를 정합니다. ResizeObserver 콜백 안에서 크기를 바꾸는 즉시 다시 그리므로 빈 화면이나 검은 화면이 보이지 않습니다.
- 원은 화면상 반지름에 따라 네 단계로 묶어 경로를 일괄 그립니다. 큰 원일수록 진하게 그리고, 0.6px 미만인 원은 생략합니다(벡터는 모두 그림). 회전 방향(k 부호)에 따라 색을 구분하는 옵션이 있습니다.
- 펜 끝은 `evaluateChain`의 마지막 관절입니다. 단위 테스트와 브라우저 테스트로 화면의 펜 끝이 수학 함수 ẑ(t)와 일치함을 확인합니다.
- 상호작용: 휠 확대(커서 기준), 드래그 이동, 클릭으로 원 선택(링·팔까지의 거리 8px 이내), 버튼(확대·축소·화면 맞춤·원점 복귀·끝점 따라가기).

## 그림 입력

- Pointer Events 하나로 마우스·터치·펜을 처리합니다. `setPointerCapture`를 써서 캔버스 밖으로 나가도 획이 이어지게 하고, 지원되는 브라우저에서는 `getCoalescedEvents`로 빠른 드래그의 중간 좌표까지 받습니다.
- 그리기 캔버스에만 `touch-action: none`을 적용합니다. 시각화 캔버스는 `pan-y`라서 모바일에서 세로 스크롤을 막지 않습니다.
- `pointercancel`이 오면 그리던 획을 버리고 안내합니다. 좌표가 20 000개에 이르면 그 지점에서 획을 끝내고 경고를 표시합니다.

## 저장

- 프로젝트 JSON 형식은 `{ format: "fourierlab-project", version: 1, savedAt, source, path: [[x, y], …], settings }`입니다. 좌표는 10⁻⁶ 단위로 반올림합니다.
- 불러올 때는 `JSON.parse`만 사용하고 코드는 실행하지 않습니다. 모든 필드의 타입, 열거값, 숫자 범위, 배열 길이, 색상 형식(#rrggbb)을 검증하고, 실패하면 이유를 한국어로 표시합니다.
- 같은 형식으로 localStorage에 자동 저장하므로 새로고침해도 상태가 복원됩니다. 저장소에 접근할 수 없으면 조용히 기본값을 사용합니다.
