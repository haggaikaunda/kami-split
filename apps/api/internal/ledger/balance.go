package ledger

import (
	"errors"
	"math"
	"math/big"
	"sort"
)

// Position contains complete nonnegative expense and repayment aggregates for one retained
// membership. Callers must include inactive history and all group financial history.
type Position struct {
	MemberID       string
	Paid, Owed     int64
	Sent, Received int64
}

// NetPosition adds the exact paid-minus-owed-plus-sent-minus-received net.
type NetPosition struct {
	Position
	Net int64
}

// Obligation is a simplified current obligation, never an extra persisted debt.
type Obligation struct {
	From, To string
	Amount   int64
}

// Balance is a complete reconciled group projection. Settled requires every
// individual net to be zero, rather than only their sum.
type Balance struct {
	Total       int64
	Positions   []NetPosition
	Obligations []Obligation
	Settled     bool
}

// CheckedAdd rejects signed overflow rather than wrapping or rounding.
func CheckedAdd(a, b int64) (int64, error) {
	if (b > 0 && a > math.MaxInt64-b) || (b < 0 && a < math.MinInt64-b) {
		return 0, errors.New("AMOUNT_OVERFLOW")
	}
	return a + b, nil
}

// Balances validates complete group aggregates and deterministically matches
// debtors and creditors in canonical membership-ID order. Wide accumulation
// avoids false overflow from intermediate sums of otherwise valid positions.
// The input is copied; no caller-owned slice is mutated.
func Balances(total int64, positions []Position) (Balance, error) {
	fail := func() (Balance, error) { return Balance{}, errors.New("AMOUNT_OVERFLOW") }
	if total < 0 {
		return fail()
	}
	ordered := append([]Position(nil), positions...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].MemberID < ordered[j].MemberID })
	result := Balance{Total: total, Positions: make([]NetPosition, 0, len(ordered)), Obligations: []Obligation{}, Settled: true}
	var paid, owed, sent, received big.Int
	type remaining struct {
		id     string
		amount int64
	}
	var debtors, creditors []remaining
	for i, p := range ordered {
		if _, err := ParseID(p.MemberID, "Membership"); err != nil {
			return Balance{}, errors.New("invalid membership position")
		}
		if i > 0 && p.MemberID == ordered[i-1].MemberID {
			return Balance{}, errors.New("duplicate membership position")
		}
		if p.Paid < 0 || p.Owed < 0 || p.Sent < 0 || p.Received < 0 {
			return fail()
		}
		paid.Add(&paid, big.NewInt(p.Paid))
		owed.Add(&owed, big.NewInt(p.Owed))
		sent.Add(&sent, big.NewInt(p.Sent))
		received.Add(&received, big.NewInt(p.Received))
		wide := big.NewInt(p.Paid)
		wide.Sub(wide, big.NewInt(p.Owed))
		wide.Add(wide, big.NewInt(p.Sent))
		wide.Sub(wide, big.NewInt(p.Received))
		if !wide.IsInt64() || wide.Int64() == math.MinInt64 {
			return fail()
		}
		net := wide.Int64()
		result.Positions = append(result.Positions, NetPosition{p, net})
		if net < 0 {
			debtors = append(debtors, remaining{p.MemberID, -net})
			result.Settled = false
		}
		if net > 0 {
			creditors = append(creditors, remaining{p.MemberID, net})
			result.Settled = false
		}
	}
	expected := big.NewInt(total)
	if paid.Cmp(expected) != 0 || owed.Cmp(expected) != 0 || sent.Cmp(&received) != 0 {
		return fail()
	}
	for d, c := 0, 0; d < len(debtors) && c < len(creditors); {
		amount := debtors[d].amount
		if creditors[c].amount < amount {
			amount = creditors[c].amount
		}
		result.Obligations = append(result.Obligations, Obligation{debtors[d].id, creditors[c].id, amount})
		debtors[d].amount -= amount
		creditors[c].amount -= amount
		if debtors[d].amount == 0 {
			d++
		}
		if creditors[c].amount == 0 {
			c++
		}
	}
	return result, nil
}
