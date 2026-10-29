# 수치 재대조

출처 파일은 metrics/out/scenarios.csv 58행과 README.md이다. 생성 스크립트는 paper/figures/gen_figures.mjs이고, 감도 스윕과 192점 대조는 sweep/refresh-sweep.ts와 sweep/closed-form-192.ts이다.

CSV 대조 불일치 0건.
표 3, 표 4, 표 5, 표 6의 숫자는 CSV와 같다.
리프레시 간격 ±50%의 네 행(-r50/-r150)은 CSV 끝에 있다. 2.6절의 감도 스윕 문장과 같다: sustain 총 틱 109,883 / 109,703 / 109,875, 최악 추가 1,285 / 32 / 292. single-bank 총 틱 16,343 / 16,303 / 16,331, 최악 추가 28 / 0 / 28.

b = 3의 40, 24, 47틱은 CSV 행이 아니다. CSV에 burst 3 행이 있는지: false. 그 세 수는 식 (1), (2), (3)의 값이다.
동시 1인 400요청의 +48, +8, +28틱과 최악 +32, +8, +26틱은 CSV 행이 아니다. README.md에 있다.
b = 1부터 64까지 192점 대조: sweep/closed-form-192.ts, 불일치 0.
리포 코드(main@42f847b)로 재생성한 scenarios.csv는 원본 42f847b의 CSV와 바이트 단위로 같다. 기준선 재현 확인.
proof/의 세 정리: Lean 4.35.0 재컴파일 오류 0·경고 0. #print axioms는 fifo_emergence [propext], rdram_beats_sdr과 ddr_wins_all [propext, Quot.sound]이다.
6446 / 1562 = 4.127. 1차본의 약 4.1배와 맞다.
점유율 40/12500 = 0.32%, 32/12500 = 0.26%, 30/1562 = 1.92%.
