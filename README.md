# RDRAM, SDR, and DDR tick simulator

The simulator runs one DRAM core under three interfaces and records bandwidth and latency in integer ticks. One tick is 1.25 ns. The checked behavior is the scenario CSV, not a hard-coded performance table.

## Run the simulator

Install Node 22 or newer. From this directory, run the tests, then the scenarios.

```
npm test
npm run simulate
```

`npm test` runs the unit tests and writes `metrics/out/scenarios.csv`. `npm run simulate` prints the same rows and writes that file again.

## Read the scenario results

The timing numbers come from Cuppu and Jacob, 2001, Table 1, converted with 1 tick = 1.25 ns. SDR PC100 uses a 4-bank core, tRP 16 ticks, row access 24, column access 24, and one 64-bit word per 8-tick clock. DDR uses the same 8-tick clock, tRP 16, row access 16, column access 16, and two words per clock because the model drains on both edges. Direct RDRAM uses 16 banks, a 2-tick clock, tRP 16, row access 14, column access 24, and an 8-to-1 shift from a 128-bit internal chunk onto a 16-bit channel. Row access is the Cuppu component. It is not the datasheet tRCD. Command pins follow the ISSI IS43R16800CC truth table. The golden read uses that part's CL=2 waveform, with a 6-tick clock.

A delay is a shift register. The column pipe keeps shifting while an earlier burst still occupies the pins, so overlap shows up as ticks on the request rather than as a scheduled sum.

What the runs are for:

- `burst` sweeps 1, 2, 4, 8, 16, 32, and 64 words on an already open row. RDRAM efficiency should rise, and the rise should flatten, because the COL header and the column wait stay fixed while the data term grows. The curve does not dip in the middle. A fixed packet cost cannot produce that dip.
- `row-hit` and `row-miss` issue eight requests one at a time. The open-page run should finish sooner on every interface. `pipeline` issues the open-page run four at a time and should record overlap above zero.
- `multi` issues a seeded random stream at concurrency 1, 2, 4, and 8. Bandwidth should rise from concurrency 1 to 4. DDR remains faster than RDRAM here. Both interfaces peak at 1600 MB/s in this parameter set, and every RDRAM miss also pays for ROW and COL headers, so extra banks do not repay that cost once the channel is busy.
- `parts` compares a DDR burst of 4 words with a burst of 64 on an open row. Bandwidth should rise. Time to first data, and the column component, should stay the same.
- `fixed` is one closed-page read. Time to first data should be longer on RDRAM than on DDR.

Refresh runs only when a scenario turns it on. The default is off, so the original scenario rows keep their numbers. A refresh is a wall-clock event, not a delay added to every request.

Commodity DRAM, from the ISSI IS43R16800CC datasheet, keeps a row for 64 ms and splits that window into 4096 refresh commands. The gap is 12,500 ticks. Cuppu and Jacob, section 5.1, describe that refresh as ganged. Every bank stops new activates, reads, and precharges together. Data already in the column pipe, the pin queue, or the DDR prefetch register keeps draining. The busy time is tRP plus the row access. That is 40 ticks on SDR and 32 ticks on DDR.

Direct RDRAM refreshes one internal bank at a time. The channel stays up, and the other 15 banks keep taking commands. The locked bank rotates. The busy time is 30 ticks. The spacing is the REFA interval tREF / 2^(BBIT+RBIT) from Samsung KM416RD8AC (128/144 Mbit, Rev. 1.01, October 1999), whose Table 19 sets tREF to 32 ms. The RIMM SPD for that die records 16,384 refreshes in that window (2×16 banks and 9 row bits). 32 ms is 25,600,000 ticks, and 25,600,000 / 16,384 is 1,562.5. tREF is a maximum, so the interval is 1,562 ticks. An earlier 6,446 came from dividing a 33 ms note by the commodity count of 4,096. That count was an assumption. The 64 Mbit Rambus sheet (12 March 1998) uses the same 32 ms over 8,192 commands, which is 3,125 ticks. This model follows the 128 Mbit part.

`sustain-baseline` and `sustain-refresh` run the same 2,048-request random stream, burst 8, concurrency 8, seed 7. The stream finishes inside the 2,000,000-tick horizon.

| Stream | SDR | DDR | RDRAM |
| --- | --- | --- | --- |
| Ticks, refresh off | 131112 | 65564 | 109645 |
| Ticks, refresh on | 131112 | 65564 | 109703 |
| Bandwidth, MB/s | 799 | 1599 | 956 off, 955 on |
| Refresh events | 10 | 5 | 70 |
| Added latency, average ticks | 0 | 0 | 0 |
| Added latency, max ticks | 0 | 32 | 32 |

The saturated commodity streams do not lose bandwidth. The scheduler issues the next column command while an earlier burst still occupies the pin, and that slack is longer than one refresh. An SDR read that lands inside a refresh starts 40 ticks later and still reaches the pin before the bus is ready for it, so its completion time does not move. DDR reorders requests by 32 ticks. The pairs cancel, so the makespan stays put and the average added latency rounds to 0. RDRAM의 70번 뱅크 락은 끝나는 시각을 58틱 밀고, 정수 대역폭은 956 MB/s에서 955 MB/s로 내려간다. 평균 추가 지연은 0이다. 최악 요청은 32틱 늘어 DDR과 같다. 이 시드에서 포화 테일은 동점이다. Duty cycle은 SDR 0.32%, DDR 0.26%, RDRAM 1.92%(30 / 1,562)이다. 잠기는 뱅크는 하나이고, 이벤트는 폐기된 6,446틱 간격보다 약 네 배 잦다.

`single-bank-refresh` sends 160 burst-8 requests to one closed RDRAM bank. With a 1,562-tick interval the round-robin locks that bank once, at tick 1,562, and the later locks are other banks. No request in this window finishes later than the refresh-off run, so the added maximum is 0. The 30-tick cap still holds. It is a phase result, not a proof that a lock cannot stall the bank.

A serial stream of 400 requests at concurrency 1, same seed, is not a CSV row. It puts the command closer to the critical path. The makespan grows by 48 ticks on SDR over 4 events, 8 ticks on DDR over 2 events, and 28 ticks on RDRAM over 23 events. The worst request grows by 32, 8, and 26 ticks. RDRAM's worst wait stays inside one bank refresh. It is smaller than SDR's makespan growth and larger than DDR's.

## Run the viewer

The viewer replays a trace. It does not run a second DRAM model.

```
npm run trace -- --scenario burst --seed 42 --arch all
npm run viewer
```

`npm run trace` writes `traces/<scenario>-<arch>-s<seed>.jsonl` and prints the SHA-256 of that file. The page opens on an open-row burst of 8. **Record** builds the trace for the scenario, seed, burst, concurrency, and architecture in the bar. **Replay check** records it again and compares the hash. **A/B** needs a second **Record** so both architectures share one tick. Use the JSONL input for a trace that is already on disk.

Space plays and pauses. The left and right arrows step one tick. Shift plus an arrow steps 8 ticks. Home and End jump to the ends. Plus and minus zoom. R lists the raw events at the playhead.

What the panels show:

- The timeline draws commands, bank state, pin words, and, for RDRAM, half-row slots and channel segments. A commodity refresh shades the full window. An RDRAM refresh shades only the locked bank.
- The column pipe is the delay FIFO. The sentence under it quotes the token's push tick, pop tick, and shift count from the trace. That shift count is the pipe depth.
- The waveform draws CS, RAS, CAS, WE, and DQ. On the golden CL=2 run, READ is at tick 12 and the first word is at tick 24.
- The request list shows `rowSpan`, `colSpan`, `transferSpan`, and `overlap` from the request summary. An open burst of 8 reads 80 ticks on SDR, 44 on DDR, and 63 on RDRAM.
- The side column counts completions, in-flight requests, outstanding transactions, pin words, and latency up to the playhead. The burst chart reads `metrics/out/scenarios.csv`. The dots are the closed forms `24+(b-1)*8`, `16+(b-1)*4`, and `32+ceil(8b/16)*8-1`.
- The event table lists events near the playhead. Click a row to move the playhead. A/B lines up the same request id on both sides.


