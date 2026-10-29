set_option linter.unusedVariables false

def clockSdr : Nat := 8
def colAccessSdr : Nat := 24
def clockDdr : Nat := 8
def colAccessDdr : Nat := 16
def clockRdram : Nat := 2
def colAccessRdram : Nat := 24
def octcycle : Nat := 8
def headerOctcycles : Nat := 1

def casClocksSdr : Nat := colAccessSdr / clockSdr
def columnLatencySdr : Nat := casClocksSdr * clockSdr

def casClocksDdr : Nat := colAccessDdr / clockDdr
def columnLatencyDdr : Nat := casClocksDdr * clockDdr

def casClocksRdram : Nat := colAccessRdram / clockRdram
def columnLatencyRdram : Nat := casClocksRdram * clockRdram
def headerTimeRdram : Nat := headerOctcycles * octcycle
def colEndRdram : Nat := headerTimeRdram + columnLatencyRdram

def sdrDoneAt (b : Nat) : Nat := columnLatencySdr + (b - 1) * clockSdr
def ddrDoneAt (b : Nat) : Nat := columnLatencyDdr + (b - 1) * (clockDdr / 2)
def rdramDoneAt (b : Nat) : Nat := colEndRdram + ((b + 1) / 2) * octcycle - 1

theorem rdram_beats_sdr (b : Nat) (hb : 1 ≤ b) :
    rdramDoneAt b < sdrDoneAt b ↔ 4 ≤ b := by
  constructor
  · intro h
    unfold rdramDoneAt sdrDoneAt colEndRdram headerTimeRdram columnLatencyRdram columnLatencySdr casClocksRdram casClocksSdr clockRdram clockSdr colAccessRdram colAccessSdr octcycle headerOctcycles at h
    omega
  · intro h4
    unfold rdramDoneAt sdrDoneAt colEndRdram headerTimeRdram columnLatencyRdram columnLatencySdr casClocksRdram casClocksSdr clockRdram clockSdr colAccessRdram colAccessSdr octcycle headerOctcycles
    omega
