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

Refresh is not simulated. Commodity DRAM would refresh every bank together every 64 ms. Rambus would refresh one bank at a time on a 33 ms period. The constants are named in `src/core/params.ts` and left unused.
