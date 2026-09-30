package ledger

import (
	"crypto/sha256"
	"errors"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// MaxExpense is the approved per-record USD cents ceiling, independent of aggregates.
const MaxExpense int64 = 999999999

// Allocation retains explicit participation, including an exact zero share.
type Allocation struct {
	ParticipantID string
	Amount        int64
}

// Input contains one caller's intent. All identity strings are public typed IDs;
// actor identity is deliberately absent. Nil and empty exact lists differ.
type Input struct {
	GroupID, Key, Currency, Description, EffectiveDate, Category, Note, PayerID, Split string
	Total                                                                              int64
	ParticipantIDs                                                                     []string
	ExactAllocations                                                                   []Allocation
}

// FieldProblem is a safe domain validation outcome that may be durably recorded.
type FieldProblem struct {
	Path          []string
	Code, Message string
}

// Normalize copies and canonicalizes intent before durable comparison. It rejects
// malformed identities or Unicode that cannot be represented losslessly. Domain
// failures remain canonicalizable so a definitive rejection can be recovered.
// Canonical bytes use fixed-position arrays, decimal money strings, raw UTF-8,
// and only mandatory JSON escaping. Compare bytes as well as the SHA-256 hash.
func Normalize(in Input) (Input, []byte, [32]byte, error) {
	fail := func() (Input, []byte, [32]byte, error) {
		return Input{}, nil, [32]byte{}, errors.New("invalid input identity or text")
	}
	if _, e := ParseID(in.GroupID, "Group"); e != nil {
		return fail()
	}
	if _, e := ParseID(in.PayerID, "Membership"); e != nil {
		return fail()
	}
	var key OperationKey
	if key.UnmarshalGQL(in.Key) != nil {
		return fail()
	}
	for _, s := range []string{in.Description, in.Note, in.Currency, in.EffectiveDate, in.Category, in.Split} {
		if !utf8.ValidString(s) {
			return fail()
		}
	}
	in.Description = strings.Trim(in.Description, " \t\r\n")
	in.ParticipantIDs = append([]string{}, in.ParticipantIDs...)
	for _, id := range in.ParticipantIDs {
		if _, e := ParseID(id, "Membership"); e != nil {
			return fail()
		}
	}
	sort.Strings(in.ParticipantIDs)
	if in.ExactAllocations != nil {
		in.ExactAllocations = append([]Allocation{}, in.ExactAllocations...)
	}
	for _, a := range in.ExactAllocations {
		if _, e := ParseID(a.ParticipantID, "Membership"); e != nil {
			return fail()
		}
	}
	sort.Slice(in.ExactAllocations, func(i, j int) bool {
		a, b := in.ExactAllocations[i], in.ExactAllocations[j]
		if a.ParticipantID == b.ParticipantID {
			return a.Amount < b.Amount
		}
		return a.ParticipantID < b.ParticipantID
	})
	var b strings.Builder
	b.WriteByte('[')
	for i, s := range []string{"create-expense-v1", in.GroupID, in.Currency, strconv.FormatInt(in.Total, 10), in.Description, in.EffectiveDate, in.Category, in.Note, in.PayerID, in.Split} {
		if i > 0 {
			b.WriteByte(',')
		}
		writeJSONString(&b, s)
	}
	b.WriteString(",[")
	for i, id := range in.ParticipantIDs {
		if i > 0 {
			b.WriteByte(',')
		}
		writeJSONString(&b, id)
	}
	b.WriteString("],")
	if in.ExactAllocations == nil {
		b.WriteString("null")
	} else {
		b.WriteByte('[')
		for i, a := range in.ExactAllocations {
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteByte('[')
			writeJSONString(&b, a.ParticipantID)
			b.WriteByte(',')
			writeJSONString(&b, strconv.FormatInt(a.Amount, 10))
			b.WriteByte(']')
		}
		b.WriteByte(']')
	}
	b.WriteByte(']')
	data := []byte(b.String())
	return in, data, sha256.Sum256(data), nil
}

// JSON's optional HTML, slash and non-ASCII escapes are deliberately excluded.
func writeJSONString(b *strings.Builder, s string) {
	const hex = "0123456789abcdef"
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"', '\\':
			b.WriteByte('\\')
			b.WriteRune(r)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 32 {
				b.WriteString(`\u00`)
				b.WriteByte(hex[byte(r)>>4])
				b.WriteByte(hex[byte(r)&15])
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
}

// Validate checks normalized domain input and returns allocations in canonical ID
// order. It does not check current group access or participant eligibility; those
// must be checked under database locks before creating any financial effect.
func Validate(in Input) ([]Allocation, []FieldProblem) {
	var problems []FieldProblem
	add := func(field, code, message string) {
		problems = append(problems, FieldProblem{[]string{"input", field}, code, message})
	}
	if in.Currency != "USD" {
		add("currency", "INVALID_INPUT", "Use USD.")
	}
	if in.Total < 1 || in.Total > MaxExpense {
		add("totalMinor", "OUT_OF_RANGE", "Use 1 to 999999999 cents.")
	}
	description := strings.Trim(in.Description, " \t\r\n")
	if !utf8.ValidString(description) || strings.ContainsRune(description, 0) || utf8.RuneCountInString(description) < 1 || utf8.RuneCountInString(description) > 120 {
		add("description", "INVALID_INPUT", "Use 1 to 120 Unicode characters without NUL.")
	}
	if !utf8.ValidString(in.Note) || strings.ContainsRune(in.Note, 0) || utf8.RuneCountInString(in.Note) > 2000 {
		add("note", "INVALID_INPUT", "Use at most 2000 Unicode characters without NUL.")
	}
	if !ValidDate(in.EffectiveDate) {
		add("effectiveDate", "INVALID_INPUT", "Use a valid Gregorian date.")
	}
	switch in.Category {
	case "DINING", "GROCERIES", "ACCOMMODATION", "TRANSPORT", "ACTIVITIES", "HOME", "OTHER":
	default:
		add("category", "INVALID_INPUT", "Use a supported category.")
	}
	participants := append([]string(nil), in.ParticipantIDs...)
	sort.Strings(participants)
	selected := make(map[string]bool, len(participants))
	if len(participants) == 0 {
		add("participantIds", "INVALID_INPUT", "Select at least one participant.")
	}
	for _, id := range participants {
		if selected[id] {
			add("participantIds", "INVALID_INPUT", "Participants must be distinct.")
			break
		}
		selected[id] = true
	}
	allocations := make([]Allocation, 0, len(participants))
	switch in.Split {
	case "EQUAL":
		if in.ExactAllocations != nil {
			add("exactAllocations", "INVALID_INPUT", "Omit exact allocations for an equal split.")
		}
		if len(participants) > 0 && in.Total > 0 && in.Total <= MaxExpense {
			base, remainder := in.Total/int64(len(participants)), in.Total%int64(len(participants))
			for i, id := range participants {
				amount := base
				if int64(i) < remainder {
					amount++
				}
				allocations = append(allocations, Allocation{id, amount})
			}
		}
	case "EXACT":
		seen := make(map[string]bool, len(in.ExactAllocations))
		var sum int64
		for i, a := range in.ExactAllocations {
			if seen[a.ParticipantID] || !selected[a.ParticipantID] {
				add("exactAllocations", "INVALID_INPUT", "Provide one allocation per selected participant.")
			}
			seen[a.ParticipantID] = true
			if a.Amount < 0 || a.Amount > in.Total || a.Amount > MaxExpense {
				problems = append(problems, FieldProblem{[]string{"input", "exactAllocations", strconv.Itoa(i), "amountMinor"}, "OUT_OF_RANGE", "Use a share between zero and the expense total."})
			} else if in.Total > 0 && sum <= MaxExpense {
				sum += a.Amount
			}
		}
		if len(in.ExactAllocations) != len(participants) || len(seen) != len(selected) {
			add("exactAllocations", "INVALID_INPUT", "Provide one allocation per selected participant.")
		}
		if sum != in.Total {
			add("exactAllocations", "RECONCILIATION", "Shares must sum to the expense total.")
		}
		allocations = append(allocations, in.ExactAllocations...)
		sort.Slice(allocations, func(i, j int) bool { return allocations[i].ParticipantID < allocations[j].ParticipantID })
	default:
		add("split", "INVALID_INPUT", "Use EQUAL or EXACT.")
	}
	if len(problems) > 0 {
		return nil, problems
	}
	return allocations, nil
}
