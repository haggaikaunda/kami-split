package ledger

import (
	"bytes"
	"encoding/json"
	"math/rand"
	"os"
	"reflect"
	"strconv"
	"testing"
)

func TestPercentageSharedVectors(t *testing.T) {
	data, err := os.ReadFile("../../../../packages/schema/testdata/percentage.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors []struct {
		Total       string
		Percentages []int64
		Amounts     []int64
	}
	if err = json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, v := range vectors {
		in := validInput()
		in.Split = "PERCENTAGE"
		in.Total, err = strconv.ParseInt(v.Total, 10, 64)
		if err != nil {
			t.Fatal(err)
		}
		in.ParticipantIDs = nil
		for i, p := range v.Percentages {
			id := testID("Membership", i+1)
			in.ParticipantIDs = append(in.ParticipantIDs, id)
			in.Percentages = append(in.Percentages, Percentage{id, p})
		}
		a, problems := Validate(in)
		if v.Amounts == nil {
			if len(problems) == 0 {
				t.Fatal("accepted unreconciled thirds")
			}
			continue
		}
		if len(problems) > 0 {
			t.Fatal(problems)
		}
		for i, amount := range v.Amounts {
			if a[i].Amount != amount {
				t.Fatalf("%+v: %+v", v, a)
			}
		}
		n, c, h, err := Normalize(in)
		if err != nil {
			t.Fatal(err)
		}
		for i, j := 0, len(in.Percentages)-1; i < j; i, j = i+1, j-1 {
			in.Percentages[i], in.Percentages[j] = in.Percentages[j], in.Percentages[i]
			in.ParticipantIDs[i], in.ParticipantIDs[j] = in.ParticipantIDs[j], in.ParticipantIDs[i]
		}
		_, c2, h2, err := Normalize(in)
		if err != nil || !bytes.Equal(c, c2) || h != h2 {
			t.Fatal("order changed intent")
		}
		a2, p := Validate(in)
		if len(p) > 0 || !reflect.DeepEqual(a, a2) {
			t.Fatal("order changed rounding")
		}
		in.Percentages[0].Hundredths = 999
		if n.Percentages[0].Hundredths == 999 {
			t.Fatal("aliased intent")
		}
	}
}

func TestPercentageConservationAndBounds(t *testing.T) {
	rng := rand.New(rand.NewSource(199))
	for sample := 0; sample < 500; sample++ {
		count := 1 + rng.Intn(120)
		values := make([]Percentage, count)
		ids := make([]string, count)
		remaining := int64(10000)
		for i := range values {
			p := int64(rng.Intn(int(remaining + 1)))
			if i == count-1 {
				p = remaining
			}
			remaining -= p
			ids[i] = testID("Membership", i+1)
			values[i] = Percentage{ids[i], p}
		}
		total := int64(1 + rng.Intn(int(MaxExpense)))
		a, p := percentageAllocations(total, ids, values)
		if len(p) > 0 {
			t.Fatal(p)
		}
		var sum int64
		for i, share := range a {
			sum += share.Amount
			floor := total * values[i].Hundredths / 10000
			if share.Amount < floor || share.Amount > floor+1 || (values[i].Hundredths == 0 && share.Amount != 0) {
				t.Fatal("invalid share", share)
			}
		}
		if sum != total {
			t.Fatal("lost cents")
		}
		rng.Shuffle(count, func(i, j int) { values[i], values[j] = values[j], values[i]; ids[i], ids[j] = ids[j], ids[i] })
		b, p := percentageAllocations(total, ids, values)
		if len(p) > 0 || !reflect.DeepEqual(a, b) {
			t.Fatal("non-deterministic")
		}
	}
}

func TestPercentageValidationAndCanonicalCompatibility(t *testing.T) {
	in := validInput()
	_, old, _, _ := Normalize(in)
	if CreateVersion(in) != "create-expense-v1" || !bytes.HasPrefix(old, []byte(`["create-expense-v1",`)) {
		t.Fatal("lost historical encoding")
	}
	in.Split = "PERCENTAGE"
	in.Total = 1
	in.ParticipantIDs = in.ParticipantIDs[:2]
	in.Percentages = []Percentage{{in.ParticipantIDs[0], 6000}, {in.ParticipantIDs[1], 4000}}
	_, first, _, _ := Normalize(in)
	in.Percentages[0].Hundredths = 7000
	in.Percentages[1].Hundredths = 3000
	_, second, _, _ := Normalize(in)
	if bytes.Equal(first, second) {
		t.Fatal("lost distinct intent")
	}
	for _, change := range []func(*Input){
		func(i *Input) { i.Percentages = nil }, func(i *Input) { i.Percentages = []Percentage{} },
		func(i *Input) { i.Percentages[0].Hundredths = -1 }, func(i *Input) { i.Percentages[0].Hundredths = 10001 },
		func(i *Input) { i.Percentages[0].ParticipantID = i.Percentages[1].ParticipantID },
		func(i *Input) { i.Percentages[0].ParticipantID = testID("Membership", 99) },
		func(i *Input) { i.ExactAllocations = []Allocation{} }, func(i *Input) { i.Split = "EQUAL" }, func(i *Input) { i.Split = "EXACT" },
	} {
		candidate := in
		candidate.Percentages = append([]Percentage(nil), in.Percentages...)
		change(&candidate)
		if _, p := Validate(candidate); len(p) == 0 {
			t.Fatal("accepted invalid input", candidate)
		}
	}
}
