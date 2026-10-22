package banking

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
)

// SnapshotID identifies all transaction facts, effective annotations and provenance
// in this projection. It is a cache key, never a source navigation or edit key.
func (r Transaction) SnapshotID() string {
	// These fixed DTOs contain only JSON-supported values and cannot form cycles.
	encoded, _ := json.Marshal(r)
	return reportIdentity("BankingTransaction", encoded)
}

// SnapshotID isolates account coverage and recovery context from other periods
// and revisions. The stable logical account identity remains ID.
func (r ReportAccount) SnapshotID() string {
	encoded, _ := json.Marshal(r)
	return reportIdentity("BankingReportAccount", encoded)
}

// SnapshotID identifies the complete filtered report and exact page, regardless
// of GraphQL field selection. Partial refreshes cannot retain an older summary.
func (r Report) SnapshotID() string {
	encoded, _ := json.Marshal(r)
	return reportIdentity("BankingReport", encoded)
}

func reportIdentity(kind string, encoded []byte) string {
	digest := sha256.Sum256(encoded)
	return kind + ":" + base64.RawURLEncoding.EncodeToString(digest[:])
}
