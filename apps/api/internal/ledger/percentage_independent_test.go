package ledger

import (
	"crypto/sha256"
	"testing"
)

// Frozen pre-Percentage bytes guard lifetime compatibility beyond the version
// prefix: persisted bytes and hashes must continue to compare exactly.
func TestIndependentPrePercentageCanonicalBytesRemainFrozen(t *testing.T) {
	const equal = `["create-expense-v1","ks1:Group:00000000-0000-4000-8000-000000000001","USD","1000","Dinner","2026-09-29","DINING","","ks1:Membership:00000000-0000-4000-8000-000000000003","EQUAL",["ks1:Membership:00000000-0000-4000-8000-000000000001","ks1:Membership:00000000-0000-4000-8000-000000000002","ks1:Membership:00000000-0000-4000-8000-000000000003"],null]`
	const exact = `["create-expense-v1","ks1:Group:00000000-0000-4000-8000-000000000001","USD","1000","Dinner","2026-09-29","DINING","","ks1:Membership:00000000-0000-4000-8000-000000000003","EXACT",["ks1:Membership:00000000-0000-4000-8000-000000000001","ks1:Membership:00000000-0000-4000-8000-000000000002","ks1:Membership:00000000-0000-4000-8000-000000000003"],[["ks1:Membership:00000000-0000-4000-8000-000000000001","0"],["ks1:Membership:00000000-0000-4000-8000-000000000002","400"],["ks1:Membership:00000000-0000-4000-8000-000000000003","600"]]]`
	for _, mode := range []string{"EQUAL", "EXACT"} {
		t.Run(mode, func(t *testing.T) {
			input := validInput()
			expected := equal
			if mode == "EXACT" {
				input.Split = mode
				input.ExactAllocations = []Allocation{{testID("Membership", 3), 600}, {testID("Membership", 1), 0}, {testID("Membership", 2), 400}}
				expected = exact
			}
			_, canonical, hash, err := Normalize(input)
			if err != nil || string(canonical) != expected || hash != sha256.Sum256([]byte(expected)) {
				t.Fatalf("deployed canonical contract changed: %v %s", err, canonical)
			}
		})
	}
}
