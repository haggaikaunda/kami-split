package ledger

import "sort"

// Percentage retains responsibility in integer hundredths of a percent (10000 = 100%).
// Values are validated independently of payer identity and resolved cents.
type Percentage struct {
	ParticipantID string
	Hundredths    int64
}

// CreateVersion preserves deployed v1 bytes for unextended Equal/Exact inputs.
// Even malformed mixed percentage inputs need v2 so durable rejections retain intent.
// The version never changes the actor/group/kind/key uniqueness scope.
func CreateVersion(in Input) string {
	if in.Split == "PERCENTAGE" || in.Percentages != nil {
		return "create-expense-percentage-v2"
	}
	return "create-expense-v1"
}

func percentageAllocations(total int64, participants []string, percentages []Percentage) ([]Allocation, []FieldProblem) {
	invalid := func(message string) ([]Allocation, []FieldProblem) {
		return nil, []FieldProblem{{Path: []string{"input", "percentages"}, Code: "INVALID_INPUT", Message: message}}
	}
	if len(participants) == 0 || len(percentages) != len(participants) {
		return invalid("Provide one percentage per selected participant.")
	}
	selected := make(map[string]bool, len(participants))
	for _, id := range participants {
		selected[id] = true
	}
	values := make(map[string]int64, len(percentages))
	var sum int64
	for _, p := range percentages {
		if _, exists := values[p.ParticipantID]; exists || !selected[p.ParticipantID] {
			return invalid("Provide one percentage per distinct selected participant.")
		}
		if p.Hundredths < 0 || p.Hundredths > 10000 {
			return invalid("Use percentages between 0% and 100% with up to two decimal places.")
		}
		// Stop before accumulation can overflow, even for unbounded direct callers.
		if sum > 10000-p.Hundredths {
			return invalid("Percentages must add up to exactly 100%.")
		}
		sum += p.Hundredths
		values[p.ParticipantID] = p.Hundredths
	}
	if sum != 10000 {
		return invalid("Percentages must add up to exactly 100%.")
	}
	if total < 1 || total > MaxExpense {
		return invalid("Use a valid expense amount.")
	}
	ids := append([]string(nil), participants...)
	sort.Strings(ids)
	allocations := make([]Allocation, 0, len(ids))
	type fraction struct {
		index     int
		remainder int64
		id        string
	}
	fractions := make([]fraction, 0, len(ids))
	remaining := total
	for _, id := range ids {
		// Bounds above guarantee multiplication <= 9999999990000, safely within int64.
		product := total * values[id]
		amount := product / 10000
		allocations = append(allocations, Allocation{id, amount})
		remaining -= amount
		if values[id] > 0 {
			fractions = append(fractions, fraction{len(allocations) - 1, product % 10000, id})
		}
	}
	sort.Slice(fractions, func(i, j int) bool {
		if fractions[i].remainder == fractions[j].remainder {
			return fractions[i].id < fractions[j].id
		}
		return fractions[i].remainder > fractions[j].remainder
	})
	for i := int64(0); i < remaining; i++ {
		allocations[fractions[i].index].Amount++
	}
	return allocations, nil
}
