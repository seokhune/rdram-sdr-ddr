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

Direct RDRAM, from the same section, uses a 33 ms period and refreshes one internal bank at a time. The channel stays up, and the other 15 banks keep taking commands. The locked bank rotates. The busy time is 30 ticks. The 33 ms gap divided by 4,096 is 6,445.3125 ticks, and the model uses the rounded 6,446. The 4,096 count for the Rambus part is not in the paper. It is an assumption, marked TODO in `src/core/params.ts`, pending a Davis thesis or a Rambus datasheet. The commodity 4,096 is the ISSI figure.

`sustain-baseline` and `sustain-refresh` run the same 2,048-request random stream, burst 8, concurrency 8, seed 7. The stream finishes inside the 2,000,000-tick horizon.

| Stream | SDR | DDR | RDRAM |
| --- | --- | --- | --- |
| Ticks, refresh off | 131112 | 65564 | 109645 |
| Ticks, refresh on | 131112 | 65564 | 109645 |
| Bandwidth, MB/s, off and on | 799 | 1599 | 956 |
| Refresh events | 10 | 5 | 17 |
| Added latency, max ticks | 0 | 32 | 0 |

The saturated stream does not lose bandwidth. The scheduler issues the next column command while an earlier burst still occupies the pin, and that slack is longer than one refresh. An SDR read that lands inside a refresh starts 40 ticks later and still reaches the pin before the bus is ready for it, so its completion time does not move. DDR does reorder two pairs of requests by 32 ticks. Each pair cancels, so the makespan stays put and the average added latency rounds to 0. Across 17 RDRAM events the locked bank was never the next channel command, so no RDRAM timestamp moved. The duty-cycle estimates, 0.32% for SDR, 0.26% for DDR, and 0.47% for RDRAM, would be the loss if the data bus itself stopped. The bus does not stop while a burst is already in flight, and a burst of 8 is at least as long as the refresh.

`single-bank-refresh` sends 160 burst-8 requests to one closed RDRAM bank. The worst request takes 28 ticks more than the same stream with refresh off. That is inside the 30-tick bank refresh. There is no other bank to cover the gap, so the stall shows up.

A serial stream of 400 requests at concurrency 1, same seed, is not a CSV row. It puts the command closer to the critical path. The makespan grows by 48 ticks on SDR over 4 events, 8 ticks on DDR over 2 events, and 36 ticks on RDRAM over 5 events. The worst request grows by 32, 8, and 30 ticks. RDRAM's worst wait is one bank refresh. It is smaller than SDR's makespan growth and larger than DDR's, because DDR's 32-tick refresh still fits in most of the remaining slack.

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


