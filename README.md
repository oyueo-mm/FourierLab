# FourierLab

**직접 그린 그림을 푸리에 급수와 회전하는 원으로 재구성하며 수학적 원리를 탐구하는 인터랙티브 시각화 실험실**

마우스나 손가락으로 선을 하나 그리면 FourierLab이 그 선을 복소 푸리에 급수로 분해합니다. 그다음 여러 개의 회전하는 원(에피사이클)을 머리와 꼬리가 이어지도록 연결해, 마지막 원의 끝점이 그림을 다시 그려 내도록 합니다. 원의 개수, 속도, 성분 선택 방식을 바꾸면서 근사가 어떻게 정확해지는지 직접 실험할 수 있습니다.

## Live Demo

**https://oyueo-mm.github.io/FourierLab/**

![FourierLab 데스크톱 화면: 하트를 50개의 원으로 다시 그리는 모습](docs/images/desktop.png)

## 주요 기능

**그림 입력**
- 마우스·터치·펜으로 한 번에 이어지는 선을 그립니다(Pointer Events, Pointer Capture, Coalesced Events).
- 실행 취소, 다시 실행, 지우기, 전체 초기화를 지원합니다.
- 예제 9종: 하트, 원, 타원, 정사각형, 삼각형, 별, 무한대, 장미 곡선, 나선
- 경로 처리 방식 3가지: **닫힌 경로**(기본), **왕복 경로**, **열린 경로**(불연속과 깁스 진동 관찰)
- 잘못된 입력(점 하나, 너무 짧은 선, 과다 좌표, 입력 취소)은 이유를 알려 주는 메시지와 함께 거부합니다.

**에피사이클 애니메이션**
- 원, 회전 벡터, 재구성 궤적, 원본, 전체 근사 곡선을 각각 표시하거나 숨길 수 있습니다.
- 재생, 일시정지, 처음으로, 처음부터 다시, 한 단계 앞/뒤, 타임라인 탐색, 0.1–5배속, 반복/한 번 재생
- 원 개수 1 ~ N−1개(로그 슬라이더와 직접 입력). 이미 계산한 계수를 재사용하며 재생 시각도 유지됩니다.
- 성분 선택: **진폭 큰 순서** / **저주파부터**. 원을 화면에 잇는 순서도 따로 선택할 수 있습니다.
- 휠 확대, 드래그 이동, 화면 맞춤, 원점 복귀, **끝점 따라가기**
- 원을 클릭하면 해당 성분의 주파수, 회전 방향, 반지름, 위상, 현재 각도, 크기 순위가 표시됩니다.

**수학적 분석**
- 주파수 스펙트럼: 양수/음수 주파수를 구분하고, 사용 중인 성분을 강조하며, 막대를 클릭하면 해당 원이 강조됩니다.
- 원 개수와 RMSE 그래프: 두 선택 방식을 한 그래프에서 비교합니다.
- 실시간 RMSE와 상대 오차
- 쉬운 한국어로 쓴 원리 설명. 현재 시뮬레이션 값과 연결되어 있고 바로 실험해 볼 수 있는 버튼이 있습니다.

**저장**
- PNG 내보내기: 현재 화면 / 재구성 결과(1600×1600) / 원본 그림
- 프로젝트 JSON 저장·불러오기: 버전을 기록하고 모든 필드를 검증합니다.
- 자동 저장: 새로고침해도 같은 그림과 설정이 복원됩니다.

| 원 10개로 그린 별 | 모바일 |
|---|---|
| ![별을 원 10개로 근사](docs/images/star-10.png) | ![모바일 화면](docs/images/mobile.png) |

![원 개수와 오차 그래프](docs/images/error-chart.png)

## 푸리에 에피사이클이란?

그림을 한 바퀴 따라가는 점의 위치를 복소수 z(t) = x(t) + i·y(t)로 나타내면, 이것은 주기 t ∈ [0, 1)의 주기 함수가 됩니다. 이 함수를 다음과 같이 분해할 수 있습니다.

```
ẑ(t) = Σ c_k · e^(i·2πkt)
```

각 항 c_k·e^(i·2πkt)는 **반지름 |c_k|인 원 위를 일정한 속도로 도는 화살표**입니다. k는 한 주기 동안 도는 바퀴 수이며, k > 0이면 반시계, k < 0이면 시계 방향으로 돕니다. t = 0일 때의 각도는 arg c_k(위상)입니다. 이 화살표들을 이어 붙이면 마지막 끝점이 그림을 따라 움직입니다.

## 수학적 원리 요약

1. **호 길이 재표본화**: 마우스 속도와 무관하게, 곡선을 따라 같은 간격인 N개 점(기본 1024개) z_n을 만듭니다.
2. **DFT**: c_k = (1/N) Σ z_n e^(−i2πkn/N). 직접 구현한 기수-2 FFT로 계산하고, O(N²) 참조 DFT와 비교해 검증합니다.
3. **부호 있는 주파수**: 빈 index를 k ∈ [−N/2, N/2)로 바꿉니다(나이퀴스트 빈은 −N/2). 복소 신호이므로 켤레 대칭을 가정하지 않습니다.
4. **재구성**: 선택한 K개 성분과 DC 성분 c₀를 더합니다. 궤적은 영 패딩 역 FFT로 한 번에 정확히 계산합니다.
5. **오차**: 파세발 정리에 따라 RMSE(K)² = Σ(빼 버린 |c_k|²)입니다. 원을 추가하면 오차는 절대 커지지 않으며, 진폭 순서가 같은 K에서 최적입니다.

자세한 내용은 [docs/MATHEMATICS.md](docs/MATHEMATICS.md)를 참고하세요.

## 기술 스택

React 19 · TypeScript · Vite 8 · Tailwind CSS 4 · HTML Canvas 2D · Recharts 3 · Vitest · puppeteer-core(브라우저 테스트) · GitHub Actions · GitHub Pages

FFT는 외부 라이브러리 없이 직접 구현했습니다(`src/math/fft.ts`, 약 60줄). 입력 길이가 2의 거듭제곱(256 ~ 2048)으로 정해져 있고, 참조 DFT와 비교해 정확성을 검증할 수 있어서 의존성과 라이선스 부담이 없는 쪽을 택했습니다. 백엔드는 없으며 모든 계산은 브라우저에서 이루어집니다.

## 설치와 실행

Node.js 24 이상을 권장합니다.

```bash
npm install
npm run dev        # http://localhost:5173/FourierLab/
npm run build      # dist/ 생성
npm run preview    # 빌드 결과 미리보기
```

## 프로젝트 구조

```
src/math/        수학 엔진: 복소수, FFT/DFT, 재표본화, 계수, 선택, 에피사이클, 재구성·오차, 예제
src/core/        재생 시계, 뷰 변환, 설정, 프로젝트 파일 검증, 자동 저장
src/render/      Canvas 그리기(정적/동적 레이어), PNG 내보내기
src/hooks/       분석 파이프라인 메모이제이션
src/components/  React UI
e2e/             실제 브라우저 테스트와 성능 측정
scripts/         수학 엔진 벤치마크
docs/            수학·구조·테스트·성능 문서
```

설계는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)에 설명되어 있습니다.

## 테스트 및 성능

```bash
npm run typecheck && npm test   # 단위 테스트 68개
npm run build && npm run e2e    # 실제 브라우저 검사 54개 (Chrome/Edge 필요)
npm run bench                   # 수학 엔진 벤치마크
npm run perf                    # 브라우저 렌더링 측정
```

- 전체 성분을 사용하면 원본 샘플이 10⁻¹² 이내로 복원됩니다(N = 256 ~ 2048).
- 브라우저 테스트에서 화면에 그려진 펜 끝과 수학 함수 ẑ(t)의 화면 좌표 차이는 0.00px였습니다.
- 헤드리스 Edge에서 N = 2048, 원 2047개일 때도 60 FPS를 유지했고, 동적 레이어 그리기 호출은 평균 0.35ms였습니다.
- 실제 터치 기기와 Firefox·Safari에서는 아직 테스트하지 않았습니다.

자세한 결과는 [docs/TESTING.md](docs/TESTING.md)와 [docs/PERFORMANCE.md](docs/PERFORMANCE.md)에 있습니다.

## 향후 개발 계획

- 여러 획 지원(글자 전체, 여러 경로를 순서대로 그리는 애니메이션)
- SVG 경로 입력과 SVG 내보내기
- GIF·영상 내보내기(브라우저별 인코딩 호환성 검토 후)
- 특정 원을 제거하거나 진폭·위상을 직접 편집하고 결과 비교
- 실제 터치 기기와 Firefox·Safari 검증

## 참고자료

- 3Blue1Brown — [But what is a Fourier series?](https://www.3blue1brown.com/lessons/fourier-series/)
- The Coding Train — [Drawing with Fourier Transform and Epicycles](https://thecodingtrain.com/challenges/130-drawing-with-fourier-transform-and-epicycles)
- MDN — [Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)
- Vite — [Deploying a Static Site](https://vite.dev/guide/static-deploy.html)

위 자료는 개념을 확인하는 데에만 참고했으며, 코드는 이 프로젝트를 위해 새로 작성했습니다.

## 라이선스

아직 라이선스를 지정하지 않았습니다. 라이선스 파일이 추가되기 전까지는 저작권자의 허락 없이 코드를 재사용할 수 없습니다.
