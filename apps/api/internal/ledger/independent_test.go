package ledger_test

import (
	"fmt"
	"math"
	"math/big"
	"math/rand"
	"reflect"
	"testing"

	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
)

func member(n int) string { return fmt.Sprintf("ks1:Membership:82000000-0000-4000-8000-%012d", n) }

// Exercise the financial equations independently of the implementation's examples.
func TestIndependentAllocationAndSimplificationProperties(t *testing.T) {
	rng := rand.New(rand.NewSource(82))
	for trial := 0; trial < 1000; trial++ {
		count := 1 + rng.Intn(25)
		total := int64(1 + rng.Intn(999999999))
		if trial < 25 {
			total = 1
		}
		ids := make([]string, count)
		for i := range ids {
			ids[i] = member(count - i)
		}
		in := ledger.Input{Currency: "USD", Total: total, Description: "d", EffectiveDate: "9999-12-31", Category: "OTHER", Split: "EQUAL", ParticipantIDs: ids}
		allocations, problems := ledger.Validate(in)
		if len(problems) > 0 {
			t.Fatal(problems)
		}
		positions := make([]ledger.Position, count)
		var sum int64
		for i, a := range allocations {
			want := total / int64(count)
			if int64(i) < total%int64(count) {
				want++
			}
			if a.ParticipantID != member(i+1) || a.Amount != want {
				t.Fatalf("trial %d: %v expected %d", trial, a, want)
			}
			sum += a.Amount
			positions[i] = ledger.Position{MemberID: a.ParticipantID, Owed: a.Amount}
		}
		positions[rng.Intn(count)].Paid = total
		if sum != total {
			t.Fatal("split loses money")
		}
		before := append([]ledger.Position(nil), positions...)
		balance, err := ledger.Balances(total, positions)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(before, positions) {
			t.Fatal("mutated positions")
		}
		remaining := map[string]int64{}
		for _, p := range balance.Positions {
			remaining[p.MemberID] = p.Net
		}
		for _, o := range balance.Obligations {
			if o.Amount <= 0 || o.From == o.To {
				t.Fatal("invalid obligation", o)
			}
			remaining[o.From] += o.Amount
			remaining[o.To] -= o.Amount
		}
		for id, v := range remaining {
			if v != 0 {
				t.Fatalf("plan fails to reconcile %s=%d", id, v)
			}
		}
	}
}

func TestIndependentCheckedAddAgainstWideArithmetic(t *testing.T) {
	rng := rand.New(rand.NewSource(8200))
	values := []int64{math.MinInt64, math.MinInt64 + 1, -1, 0, 1, math.MaxInt64 - 1, math.MaxInt64}
	for i := 0; i < 100; i++ {
		values = append(values, int64(rng.Uint64()))
	}
	for _, a := range values {
		for _, b := range values {
			expected := new(big.Int).Add(big.NewInt(a), big.NewInt(b))
			got, err := ledger.CheckedAdd(a, b)
			if expected.IsInt64() {
				if err != nil || got != expected.Int64() {
					t.Fatalf("%d+%d=%d %v", a, b, got, err)
				}
			} else if err == nil {
				t.Fatalf("accepted overflow %d+%d", a, b)
			}
		}
	}
}
