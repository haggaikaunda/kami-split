package banking

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/google/uuid"
)

func TestSyncStorageEncodingPreservesExactFactsAndProvenance(t *testing.T) {
	binding := SyncBinding{BindingID: uuid.NewString(), Environment: "sandbox", ItemID: "private-item", AccountID: "selected-account"}
	from, _ := NewSyncCursor(binding, "private-original")
	next, _ := NewSyncCursor(binding, "private-next")
	batch := SyncBatch{id: uuid.New(), binding: binding, cursor: from}
	pending := "pending-id"
	page := SyncPage{Binding: binding, NextCursor: next, Added: []SyncTransaction{{TransactionID: "posted-id", AccountID: binding.AccountID, Date: "2026-10-01", AmountMinor: -9223372036854775808, Currency: "USD", PendingTransactionID: &pending}}, Removed: []SyncRemoval{{TransactionID: pending}}}
	raw, err := encodeSyncPage(batch, from, page)
	if err != nil {
		t.Fatal(err)
	}
	var stored syncStoredPage
	if err = json.Unmarshal(raw, &stored); err != nil {
		t.Fatal(err)
	}
	if stored.From != "private-original" || stored.Next != "private-next" || len(stored.Changes) != 2 || *stored.Changes[0].Amount != "-9223372036854775808" || *stored.Changes[0].PendingID != pending || stored.Changes[1].AccountID != nil {
		t.Fatal("exact facts or removal scope changed")
	}
	// Returned bytes own their data; subsequent caller mutations cannot change them.
	page.Added[0].AmountMinor = 5
	if *stored.Changes[0].Amount != "-9223372036854775808" {
		t.Fatal("retained mutable facts")
	}
	other := binding
	other.AccountID = "sibling"
	wrong, _ := NewSyncCursor(other, "")
	if _, err := encodeSyncPage(batch, wrong, page); err == nil {
		t.Fatal("accepted sibling input cursor")
	}
	page.NextCursor = wrong
	if _, err := encodeSyncPage(batch, from, page); err == nil {
		t.Fatal("accepted sibling output cursor")
	}
	if fmt.Sprintf("%v %#v", batch, batch) != "[redacted banking sync batch] [redacted banking sync batch]" {
		t.Fatal("batch diagnostics disclosed private provenance")
	}
}

func TestReplacementMaterialConflictCannotContribute(t *testing.T) {
	purchase := "purchase"
	impact, err := summarizeReplacement([]replacementSource{{Currency: "USD", Amount: "2500", Date: "2026-10-01", Processing: "posted", Activity: &purchase, MaterialConflict: true}})
	if err != nil || impact.SpendingMinor != "0" || impact.UnresolvedCount != 1 {
		t.Fatal("conflicted retained override contributed", err)
	}
}
