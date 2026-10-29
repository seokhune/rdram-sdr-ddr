set_option linter.unusedVariables false

def pushDelay (f : List (Option Nat)) (v : Option Nat) : List (Option Nat) × Option Nat := (f.drop 1 ++ [v], (f.head?).getD none)

def pushAll (f : List (Option Nat)) : List (Option Nat) → List (Option Nat) × List (Option Nat)
  | [] => (f, [])
  | v :: vs => 
    let (f', out) := pushDelay f v
    let (f'', outs) := pushAll f' vs
    (f'', out :: outs)

theorem pushAll_take (f vs : List (Option Nat)) (hf : 1 ≤ f.length) :
    (pushAll f vs).2 = (f ++ vs).take vs.length := by
  induction vs generalizing f with
  | nil => rfl
  | cons v vs ih =>
    cases f with
    | nil => exact absurd hf (by simp)
    | cons h f0 =>
      simp only [pushAll, pushDelay, List.head?, Option.getD_some, List.drop, List.cons_append]
      rw [ih (f0 ++ [v]) (by simp)]
      simp

theorem take_replicate_append (k : Nat) (l : List (Option Nat)) :
    (List.replicate k (none : Option Nat) ++ l).take (k + 1)
      = List.replicate k (none : Option Nat) ++ l.take 1 := by
  induction k generalizing l with
  | zero => simp
  | succ k ih =>
    have step : ((none : Option Nat) :: (List.replicate k (none : Option Nat) ++ l)).take (k + 1 + 1)
        = (none : Option Nat) :: (List.replicate k (none : Option Nat) ++ l).take (k + 1) := rfl
    rw [show List.replicate (k + 1) (none : Option Nat) ++ l
        = (none : Option Nat) :: (List.replicate k (none : Option Nat) ++ l) from rfl]
    rw [step, ih]
    rfl

theorem fifo_emergence (k t : Nat) (xs : List (Option Nat)) (hxs : xs.length = k) (hk : 1 ≤ k) :
    (pushAll (List.replicate k (none : Option Nat)) (some t :: xs)).2
      = List.replicate k (none : Option Nat) ++ [some t] := by
  have h := pushAll_take (List.replicate k (none : Option Nat)) (some t :: xs) (by simp [hk])
  rw [h]
  rw [show (some t :: xs).length = k + 1 by simp [hxs]]
  rw [take_replicate_append]
  simp
