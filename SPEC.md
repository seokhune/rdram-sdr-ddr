# 과제: RDRAM vs SDR vs DDR 메모리 시스템 시뮬레이터 (TypeScript) — 원샷 전체 실행

이 프롬프트는 자기완결적이다. 아래 전체를 M1부터 M5까지 사용자 개입 없이
순서대로 전부 실행한다. 중간에 질문하지 말 것. 각 마일스톤마다
테스트 통과 + 자기 리뷰 + 커밋을 마쳤으면 다음 마일스톤으로 자동 진행한다.

## 0. 실행 프로토콜 (최우선)
1. 시작 전에 이 명세 전문을 SPEC.md로 저장하고 커밋한다.
2. §1 절대 규칙과 §11 금지 목록을 .cursor/rules/ 프로젝트 룰로 반영한다.
3. M1→M5를 순서대로 진행. 각 마일스톤 끝에서:
   a) §10 해당 테스트 실행 → 전부 통과 확인
   b) 작성한 코드를 §11 금지 목록과 하나씩 대조해 자기 리뷰, 위반 발견 시 즉시 수정 후 재테스트
   c) 커밋 (메시지 예: "M1: gates + core FSM, tests green")
4. 다섯 마일스톤 전부 끝나면 최종 보고서를 출력한다:
   - 시나리오 1~5 결과 표 (아키텍처별 대역폭/평균 지연)
   - 검증 포인트 각각의 통과/실패: RDRAM 효율 U자 곡선 존재 / row-hit 시 지연 급감 /
     다중 요청에서 RDRAM 우위 역전 / 고정 지연 RDRAM > DDR
   - CSV 파일 경로 (metrics/out/)
   - 시나리오 결과가 기대 형태와 다르면 원인 분석 후 구현 버그로 수정한다.
     성능 수치를 상수로 조정해서 맞추는 것은 §11 위반이다.

## 1. 절대 규칙 (위반 시 재작성 대상)
1. 시간은 정수 틱(1틱=1.25ns). float ns 금지.
2. 지연 delay(k)는 길이 k의 FIFO(시프트 레지스터)로 구현. `readyAt = t + k` 같은
   덧셈 금지. 이유: 컬럼 접근과 이전 데이터 전송의 중첩(page mode overlap)이
   창발해야 하므로.
3. 게이트/디코더/멕스는 순수 함수. 함수 내부에 은닉 상태 금지.
   상태(뱅크 FSM, 큐)는 명시적 자료구조로만 스레딩.
4. 세 아키텍처는 "공통 DRAM 코어 1벌 + 인터페이스 래퍼 3종" 구조.
   코어를 3벌로 복붙하지 말 것.
5. 각 디바이스는 자기 클럭의 분주 카운터로만 스텝. 전역 단일 클럭 금지.
6. 결정론: 워크로드 생성기의 난수는 반드시 시드 고정.
7. 타이머는 매 디바이스 틱마다 감소하며, 0이 된 "그 틱에" 바로 상태 전이.
   다음 틱에 전이하는 오프바이원 금지.

## 2. 시간·단위 체계 (전역 틱 = 1.25ns)
- SDRAM PC100: 클럭 10ns = 8틱 (상승 엣지만)
- DDR(100MHz 코어, Cuppu 2001 모델): 클럭 10ns = 8틱, 비트 5ns = 4틱 (양 엣지)
- Direct RDRAM: 클럭 2.5ns = 2틱, 비트 1.25ns = 1틱 (양 엣지)
- 워드 단위: 시스템 버스 64비트를 기본 워드로 쓴다.

## 3. 디렉터리 구조
src/
  gates/        # L0: 순수 게이트, delay(FIFO), 클럭 분주기
  core/         # L1: 공통 DRAM 코어 (뱅크 FSM, 디코더, 명령 테이블)
  wrappers/     # L2: sdr.ts, ddr.ts, rdram.ts
  channel/      # L3: 채널 아비터, 아웃스탠딩 테이블, 컨트롤러
  metrics/      # L4: 시나리오 러너, 통계, CSV 출력
  main.ts
test/           # vitest 또는 node:test

## 4. L0 — gates/
- and/or/not 등 조합 게이트: 순수 함수, 상태 없음.
- `makeDelay<T>(k)` = 길이 k FIFO. push하면 k틱 전 값을 반환.
- `makeDivider(period)` = period틱마다 true를 반환하는 분주 카운터.

## 5. L1 — core/ (공통 코어, 1벌만)
- Bank = { state: 'idle'|'rowActivating'|'active'|'precharging',
          openRow: number|null, timer: number }
- 뱅크는 배열. 각 뱅크 FSM은 독립 진행. 전역 단일 큐 금지.
- row-hit: state==='active' && openRow===req.row → ACT 생략(오픈 페이지).
- 주소 디코더: (addr) → {bank, row, col} 비트 슬라이싱 순수 함수.
- 명령 디코더: 룩업 테이블(ISSI IS43R16800CC 진리표, 0=L, 1=H):
  ACTIVATE: CS0 RAS0 CAS1 WE1 | READ: 0,1,0,1 | WRITE: 0,1,0,0
  PRECHARGE: 0,0,1,0 | REFRESH: 0,0,0,1 | MRS: 0,0,0,0
- 파라미터(Cuppu-Jacob 2001 Table 1 기준, 틱 환산):
  * SDRAM PC100 (4뱅크): tRP 16틱(20ns), RowAccess 24틱(30ns),
    ColAccess 24틱(30ns), Transfer 8틱/워드(10ns)
  * DDR (4뱅크): tRP 16틱, RowAccess 16틱(20ns), ColAccess 16틱(20ns),
    Transfer 8틱/워드. 단 워드는 클럭당 2회(양 엣지)로 배출.
  * RDRAM (16뱅크): tRP 16틱, RowAccess 14틱(17.5ns), ColAccess 24틱(30ns),
    Transfer: 내부 128비트(16바이트)/10ns → 8:1 직렬화.
- 주의: "Row Access"는 프리차지를 포함할 수 있는 성분 값이지
  데이터시트의 tRCD와 1:1 대응이 아니다. 상수 이름에 CUPPU_ROW_ACCESS 등으로
  출처를 박아둘 것.
- refresh: 1차 버전은 생략하되 TODO로 파라미터 자리만 남길 것.
  단 아키텍처별로 값이 다르다는 사실을 주석으로 남길 것:
  일반 DRAM 주기 64ms(전체 동시), Rambus 33ms(내부 뱅크 개별 + N등분 분산,
  최악 대기 = 행 1개 리프레시 분량).

## 6. L2 — wrappers/ (같은 코어에 끼우는 래퍼 3종)
[sdr.ts]
- 코어 → makeDelay(CL) → 클럭당 상승 엣지 1회, 1워드 drain.
- SDR이 코어를 스텝하는 것은 8틱마다. 틱마다 스텝하면 대역폭 8배 과장.

[ddr.ts]
- prefetch(2n): 내부 2배 폭 시프트 레지스터(wide-in, narrow-out).
  구현 주의: 2-깊이 시프트로 만들 것. 호출마다 배열이 자라나는 형태 금지.
  "다음 주소를 미리 읽는 예측" 절대 금지 — 프리페치는 폭 변환이다.
- serialize: 클럭당 2회 drain(상승 1워드 + 하강 1워드). DQS는 신호가 아니라
  "비트당 시간 슬롯" 추상화.
- 기대 결과: 대역폭 정확히 2배, ns 지연은 SDR과 거의 동일(CL은 코어 클럭 단위).

[rdram.ts]
- packetize: 요청 → ROW 패킷(뱅크+행) + COL 패킷(열+제어) 프레임.
  헤더 토큰은 스트림에서 실제 틱을 소비해야 한다(껍데기 금지).
  채널 예약 단위 octcycle = 8틱. 패킷당 헤더 octcycle 수는 설정 파라미터
  (원문 스펙 미확정 수치이므로 하드코딩하지 말 것).
- 코어′: 16뱅크 + half-row buffer 17개 슬롯.
  뱅크 i 활성화 = 슬롯 i, i+1 점유 → 인접 뱅크(i±1) 동시 활성 금지.
  precharge/행 교체 시 슬롯 해제 필수(누락 시 전체 누적 락업).
- serialize(8:1): 내부 128비트 ↔ 채널 16비트. producer-consumer 큐.
  큐가 비는 동안 채널 낭비가 그대로 대역폭 효율로 나타나야 함.
- channelArbiter: 공유 채널(좁고 양방향, 풀듀플렉스 아님) +
  Map<txnId, 완료콜백> 아웃스탠딩 테이블, 디바이스당 미결 최대 4개.
  응답은 요청 순서와 무관하게 반환 가능(분할 트랜잭션).

## 7. L3 — channel/
- 메모리 컨트롤러: 요청 스트림을 받아 아키텍처별 인터페이스로 변환.
- 스케줄러는 open-page 정책을 유지하되, RDRAM에서는 half-row 인접 제약을
  스케줄링(인접 뱅크 동시 요청 회피)에 반영할 것.

## 8. L4 — metrics/ (검증 시나리오 = 통과 조건, 전부 자동화)
1. 버스트 사이즈 스윕(버스트 1워드→64워드): 버스트↑ → RDRAM 효율 회복,
   버스트↓ → 프레이밍 오버헤드로 급락. RDRAM 효율 곡선이 U자로 꺾져야 함.
2. row-hit 시나리오: 같은 행 연속 접근 시 평균 지연 급감(page mode),
   컬럼/전송 중첩 발생. row-hit률 변화에 따라 세 아키텍처 우위가 뒤집혀야 함.
3. 멀티 리퀘스트(동시성 1→8): 뱅크 16개+미결 4개인 RDRAM이 뱅크 4개 대비
   유리해지는 지점이 존재해야 함.
4. 지연 성분 분해: 접근마다 row/column/transfer/overlap을 분리 기록
   (Cuppu Table 2 방식). "대역폭은 오르지만 고정 지연은 그대로"가 재현되는지.
5. 단일 요청 고정 지연: RDRAM > DDR이어야 함.
- 워크로드 생성기: 순차 / 랜덤(시드 고정) / 행 지역성 혼합비 지정 가능.
- 모든 시나리오 결과를 표 + CSV(metrics/out/)로 출력.

## 9. 골든 테스트 (틱 단위 정합 필수)
IS43R16800CC 기준 CL=2 읽기: 클럭 7.5ns = 6틱, READ 후 첫 데이터는
CL×클럭 뒤 상승 엣지에서 나오고 이후 매 엣지(3틱)마다 1워드.
예상: ACT 후 tRCD 타이머, READ 후 정확히 CL 지연 뒤 첫 워드.

## 10. 빌드 마일스톤 (순서대로. 각 단계 끝에서 §0 프로토콜 적용)
M1. gates/ + 코어 FSM: 단위 테스트(delay FIFO k틱 배출, 타이머 오프바이원 없음,
    row-hit 판정, half-row 인접 활성 금지+해제)
M2. SDR 래퍼: 골든 테스트(CL=2) 통과
M3. DDR 래퍼: 대역폭 정확히 2배 + prefetch 버퍼 길이 불변 테스트
M4. RDRAM 래퍼 + 채널: octcycle 예약, 아웃스탠딩 4개 상한 테스트
M5. 시나리오 1~5 실행기 + CSV 출력

## 11. 금지 목록 (안티패턴 — 자기 리뷰 체크리스트)
- delay를 `t + k` 덧셈으로 구현
- prefetch를 주소 예측 또는 무한 성장 배열로 구현
- 코어 3벌 복붙
- 전역 단일 클럭 / SDR을 틱마다 스텝
- float ns 사용
- 게이트 함수 내 은닉 상태
- 매 요청 무조건 ACT (row-hit 판정 없음)
- 뱅크 전역 큐 1개
- RDRAM을 "그냥 넓고 빠른 버스"로 구현(패킷 프레이밍 없음)
- 채널 풀듀플렉스 구현
- half-row 슬롯 점유만 하고 해제 안 함
- 성능 차이를 하드코딩된 상수 반환으로 구현

## 12. 산출물
- 위 구조의 TypeScript 프로젝트 + 통과하는 단위 테스트 전부
- README.md: 실행법(npm run simulate), 시나리오별 기대 형태와 결과 해석,
  파라미터 출처(Cuppu-Jacob 2001 Table 1 / ISSI IS43R16800CC)
- SPEC.md 저장본, 마일스톤별 커밋 5개, 최종 보고서(§0의 4)

## 13. 리프레시

과제: RDRAM vs SDR/DDR 시뮬레이터에 리프레시 추가 (기존 저장소 확장, TypeScript).

이 프롬프트는 자기완결적이다. 기존 시뮬레이터(src/, test/) 위에 리프레시를 추가한다.
사용자 개입 없이 M6→M8까지 순서대로 전부 실행한다. 중간에 질문하지 말 것.
각 마일스톤 끝에서 테스트 실행 → 자기 리뷰(§8 금지 목록 대조) → 커밋 후 다음 단계.

### 13.0 실행 프로토콜 (최우선)

1. 시작 전에 이 명세 전문을 SPEC.md의 §13(리프레시)으로 추가하고 커밋한다.
2. M6→M8 순서대로 진행. 각 단계 끝에서:
   a) §7 해당 테스트 실행 → 전부 통과 확인
   b) 작성한 코드를 §8 금지 목록과 대조한 자기 리뷰, 위반 시 수정 후 재테스트
   c) 커밋 (메시지 예: "M6: refresh scheduler + unit tests")
3. 완료 후 최종 보고서 출력: 아키텍처별 리프레시 패널티 표(§6의 판정 지표),
   비대칭 관측 결과, 예상과 다르면 원인 분석 후 구현 버그로 수정.
   성능 수치를 상수로 조정해 맞추는 것은 §8 위반이다.

### 13.1 전제

- 기존 코드(src/gates, src/core, src/wrappers, src/channel, src/metrics, test/)를
  그대로 재사용한다. 구조를 재작성하지 말 것.
- 기존 테스트(m1~m5)는 전부 통과 상태를 유지해야 한다.
- 리프레시는 기본 OFF. 시나리오에서 명시적으로 켤 때만 작동한다.
  기존 시나리오 CSV의 기존 행 수치는 한 줄도 바뀌면 안 된다.
- 시간은 정수 틱(1틱=1.25ns) 기존 규칙 그대로. float ms/ns 금지.

### 13.2 모델 정의

- DRAM 셀은 누전되므로 모든 행을 주기적으로 재생성해야 한다.
  리프레시는 요청과 무관하게 벽시계 틱 기준으로 스케줄된 "이벤트"다.
- 사료 근거 (params.ts 주석에 박아둘 것):
  * 일반 DRAM: 리프레시 주기 64ms, 4096회 분할 (ISSI IS43R16800CC 데이터시트).
    이벤트 간격 = 64ms / 4096 = 12,500틱.
    Cuppu-Jacob §5.1: ganged 일반 DRAM은 뱅크 전체가 동시 리프레시되며,
    리프레시 대기가 전체 지연의 최대 50%까지 간 사례가 보고됨.
  * Rambus: 리프레시 주기 33ms, 내부 뱅크를 개별·분산 리프레시
    (Cuppu-Jacob 1999 §5.1 "Rambus refreshes internal banks individually").
    1회 이벤트에 뱅크 1개만 잠기고, 최악 대기 = 행 1개 리프레시 분량.
- 리프레시 1회 소요(행 재생 = 프리차지 + 행 접근):
  * SDR: tRP 16 + Row 24 = 40틱 (50ns)
  * DDR: tRP 16 + Row 16 = 32틱 (40ns)
  * RDRAM: tRP 16 + Row 14 = 30틱 (37.5ns)
- RDRAM의 이벤트 간격: 33ms / 4096 = 6,446틱 (반올림, 주석에 명시).
  주의: Rambus 파트의 내부 리프레시 사이클 수(4096)는 원문 미확정 가정이다.
  REFRESH_CYCLES_PER_PERIOD를 파라미터로 두고 TODO(Davis 논문/데이터시트에서
  확정 필요) 주석을 남길 것. 일반 DRAM의 4096은 ISSI로 확정된 값이다.

### 13.3 상태·스케줄링 변경

src/core/refresh.ts 신규.

RefreshScheduler = { enabled, intervalTicks, busyTicks, nextEventAt, remaining,
lockedBank, lastBank, events, busyTicksTotal }.

tickRefresh(scheduler, tick)는 순수 전이 함수 (기존 core 레이어 스타일).
tick === nextEventAt인 틱에 이벤트 시작(remaining = busyTicks,
nextEventAt += intervalTicks). 이벤트는 트래픽 유무와 무관하게 발생.

commodity (SDR/DDR): 이벤트가 active면 device-wide block.
새 ACT/READ/PRE 발급 불가. 이미 파이프라인에 들어간 데이터
(컬럼 FIFO, 핀, prefetch)는 계속 drain. 실제 tRFC 동작과 동일.

rdram: 이벤트가 active면 뱅크 1개만 lock(라운드로빈: 직전 뱅크와 다른
뱅크, 마지막 활성 뱅크 이후 순환). 잠긴 뱅크에만 ACT/READ 불가,
나머지 15개 뱅크와 채널은 정상 서비스. 채널은 잠기지 않는다.

스케줄러는 존재하지 않는 리프레시 지연을 요청에 배분하지 않는다.
요청이 받는 영향은 오직 "이벤트 구간과 충돌했는가"로 발생해야 한다.

### 13.4 메트릭 확장

RunRow에 추가: refresh (0/1), refreshEvents, refreshBusyTicks,
latP50, latP99, latMax (요청 지연 = doneAt − enqueuedAt),
refreshAddedLatencyAvg, refreshAddedLatencyMax.

CSV 컬럼 확장. 기존 컬럼 순서 유지(기존 열 뒤에 append).

added latency: refresh ON과 OFF에서 같은 시드·같은 워크로드로 두 번 돌려
요청 id별로 지연을 짝지어 ON−OFF 차이의 평균/최대를 계산.

### 13.5 시나리오

src/metrics/scenarios.ts에 신규 추가. 기존 행 유지.

1. sustain-baseline: 시드 고정 스트림(랜덤, burst 8, 동시성 8, 은행 16/16 매핑
   기존 randomJobs 방식)을 시각 지평 2,000,000틱(또는 그 안에서 소진되는
   요청 수)까지. 리프레시 OFF. 세 아키텍처 모두.
2. sustain-refresh: 동일 시드·동일 워크로드, 리프레시 ON. 세 아키텍처 모두.
3. single-bank-refresh: RDRAM 단독. 열려 있지 않은 한 뱅크에만 burst 8 요청을
   연속 발행, 리프레시 ON. 잠긴 뱅크에 요청이 걸렸을 때의 최악 대기 관측.

시나리오 옵션으로 refresh: 'off' | 'on'을 runArch/runJedec/runRdram에 전달.

### 13.6 골든 테스트 + 통과 조건

단위 테스트:

- 이벤트 정확성: intervalTicks마다 정확히 발생, busyTicks 후 정확히 해제.
  이벤트 카운트 = floor(지평/intervalTicks)와 일치.
- commodity: 이벤트 active 동안 새 명령 발급이 막히는지,
  이미 in-flight인 데이터는 drain되는지.
- rdram: 잠긴 뱅크는 거부, 다른 뱅크는 즉시 서비스, 라운드로빈으로
  연속 이벤트가 다른 뱅크를 잠그는지.
- 결정론: 동일 시드 재실행 결과 동일.

판정 조건 (시나리오):

- refresh ON이면 세 아키텍처 모두 대비 baseline에서 대역폭 하락 또는
  지연 증가가 0보다 커야 한다.
- 핵심 비대칭: RDRAM의 패널티(대역폭 하락률, addedAvg/addedMax)가
  SDR/DDR의 패널티보다 작아야 한다. 전 디바이스 정지 vs 뱅크 1개 정지의
  구조적 결과로 창발해야 한다. 상수 비교가 아니라 같은 모델에서
  요청 충돌 확률의 차이로 나와야 한다.
  계산 참고: SDR duty 40/12,500 = 0.32%, DDR 32/12,500 = 0.26%,
  RDRAM 30/6,446 = 0.47%. duty cycle은 RDRAM이 약간 높아도,
  16분의 1 트래픽만 영향받는 것이 포인트.
- single-bank 시나리오에서 RDRAM 최악 추가 대기 ≤ busyTicks(30틱).
- 전체 우위가 뒤집히는 것은 요구하지 않는다. DDR이 여전히 빠를 수 있다.
  관측 대상은 패널티의 상대 크기다.

### 13.7 빌드 마일스톤

M6. src/core/refresh.ts + 래퍼/러너 연결 + 단위 테스트 전부.
    기존 m1~m5 회귀 없음 확인.
M7. 메트릭 확장 + 시나리오 3종 + CSV. m1~m5 회귀 재확인.
M8. 최종 실행 + 보고서. 각 단계 끝 커밋.

### 13.8 금지 목록

- 리프레시를 요청마다 균등 배분된 상수 지연으로 구현 (이벤트 충돌 모델이어야 함)
- RDRAM이 이기도록 상수를 조정 (판정 기준은 패널티 비대칭이지 전체 승리가 아님)
- float ms/ns 사용 (간격은 사전에 정수 틱으로 환산해 상수화)
- 기존 시나리오 행 수치 변경 (리프레시 기본 OFF 위반)
- 기존 테스트 삭제·약화
- 리프레시 이벤트가 트래픽 유무에 따라 발생/미발생으로 바뀌는 구현
  (벽시계 기준이어야 함. idle 구간의 이벤트는 busyTicks에 카운트하되
  요청 영향은 0)
- rdram에서 채널까지 잠그는 구현 (잠기는 것은 뱅크만)
- 확정되지 않은 수치(RDRAM 사이클 수)를 확정값처럼 하드코딩 without TODO

### 13.9 산출물

- 위 변경사항 전부 + 통과하는 테스트 전부
- README.md에 리프레시 섹션 추가: 모델 가정(64/33ms, ganged vs 개별),
  관측된 패널티 수치, 해석
- 최종 보고서: 아키텍처별 baseline/refresh 비교 표, 패널티 비대칭 판정,
  single-bank 최악 대기 수치, 파라미터 출처와 TODO 목록
