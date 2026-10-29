# proof/ — 시뮬레이터 모델 닫힌 식의 Lean 4 증명

이 디렉터리는 틱 단위 DRAM 시뮬레이터(`../src/`, 명세는 `../SPEC.md`)의
단일 요청·row-hit 버스트 읽기 모델에 대해 Lean 4로 증명된 정리를 담는다.
정리 서술과 증명 본문은 이 세션에서 Lean 커널이 수락한 파일(Rdram.lean)에서
그대로 옮겨 온 것이다 — 다시 쓰거나 요약하지 않았다.

> **단서: 이 증명은 시뮬레이터 모델의 닫힌 식에 대한 것이지 측정 하드웨어가 아니다.**
> 증명 대상은 추상화된 모델(지연 FIFO, 엣지 케이던스, 청크 점유)의 성질이며,
> 실제 RDRAM/SDR/DDR 칩의 측정 지연이 아니다. 모델의 물리 상수는
> `../src/core/params.ts`(Cuppu Table 1 환산)에서 온 **입력**이지 증명 대상이 아니다.

## 정리 목록

### 1. `fifo_emergence` — [fifo_emergence.lean](fifo_emergence.lean)

- 명제(한 줄): k깊이 지연 FIFO에 push된 토큰은 정확히 k번의 후속 push 뒤에 나온다.
- 서명 원문:

```lean
theorem fifo_emergence (k t : Nat) (xs : List (Option Nat)) (hxs : xs.length = k) (hk : 1 ≤ k) :
    (pushAll (List.replicate k (none : Option Nat)) (some t :: xs)).2
      = List.replicate k (none : Option Nat) ++ [some t] := by
```

- 의존 공리: `propext`
- 보조 정리: `pushAll_take`, `take_replicate_append` (같은 파일, 유도법 증명)

### 2. `rdram_beats_sdr` — [rdram_beats_sdr.lean](rdram_beats_sdr.lean)

- 명제(한 줄): RDRAM이 SDR을 읽기 지연에서 역전하는 지점은 정확히 b ≥ 4다
  (1999년 "좁은 직렬 채널이 SDRAM을 이긴다" 서사의 수학적 근거).
- 서명 원문:

```lean
theorem rdram_beats_sdr (b : Nat) (hb : 1 ≤ b) :
    rdramDoneAt b < sdrDoneAt b ↔ 4 ≤ b := by
```

- 의존 공리: `propext`, `Quot.sound`

### 3. `ddr_wins_all` — [ddr_wins_all.lean](ddr_wins_all.lean)

- 명제(한 줄): DDR은 모든 b ≥ 1에서 SDR과 RDRAM 양쪽보다 완료 틱이 이르다
  (2001년 서사).
- 서명 원문:

```lean
theorem ddr_wins_all (b : Nat) (hb : 1 ≤ b) :
    ddrDoneAt b < sdrDoneAt b ∧ ddrDoneAt b < rdramDoneAt b := by
```

- 의존 공리: `propext`, `Quot.sound`

## 증명 상태와 재검증

- Lean 4.35.0, **core 표준 라이브러리만 사용**(Mathlib 무의존, `import` 문 0개).
- `sorry` 없음, `axiom` 선언 없음, `native_decide` 없음.
- 커널 수준 의존 공리는 Lean 표준 기초인 `propext`/`Quot.sound`뿐
  (`#print axioms`로 확인). 도메인 공리는 없다.
- 재검증: `lean proof/fifo_emergence.lean` 등 각 파일 단독 컴파일 —
  오류 0, 경고 0.
- 정의의 물리 상수(clock=8틱, colAccess=24/16틱, OCTCYCLE=8틱 등)는
  `params.ts`에서 온 모델 입력이며, 공식 상수(24/16/32/8/4)는 정의에
  리터럴로 등장하지 않고 파라미터 나눗셈으로만 유도된다.
