package banking

import (
	"encoding/json"
	"math/big"
	"strconv"
	"strings"
	"time"
)

type plaidSyncTransaction struct {
	ID                   string          `json:"transaction_id"`
	Account              string          `json:"account_id"`
	Amount               json.RawMessage `json:"amount"`
	Currency             string          `json:"iso_currency_code"`
	UnofficialCurrency   *string         `json:"unofficial_currency_code"`
	Date                 string          `json:"date"`
	AuthorizedDate       *string         `json:"authorized_date"`
	Pending              *bool           `json:"pending"`
	PendingTransactionID *string         `json:"pending_transaction_id"`
	Name                 *string         `json:"name"`
	MerchantName         *string         `json:"merchant_name"`
	Code                 *string         `json:"transaction_code"`
	Category             *struct {
		Primary    *string `json:"primary"`
		Detailed   *string `json:"detailed"`
		Confidence *string `json:"confidence_level"`
	} `json:"personal_finance_category"`
}

func decodeSyncPage(raw []byte, binding SyncBinding, cursor SyncCursor) (SyncPage, error) {
	invalid := &SyncError{Kind: SyncInvalidResponse}
	var payload struct {
		Accounts []struct {
			ID string `json:"account_id"`
		} `json:"accounts"`
		Added    []plaidSyncTransaction `json:"added"`
		Modified []plaidSyncTransaction `json:"modified"`
		Removed  []struct {
			ID      string  `json:"transaction_id"`
			Account *string `json:"account_id"`
		} `json:"removed"`
		NextCursor *string `json:"next_cursor"`
		HasMore    *bool   `json:"has_more"`
		Status     *string `json:"transactions_update_status"`
		ErrorCode  string  `json:"error_code"`
	}
	if json.Unmarshal(raw, &payload) != nil || payload.ErrorCode != "" || payload.Accounts == nil || payload.Added == nil || payload.Modified == nil || payload.Removed == nil || payload.NextCursor == nil || payload.HasMore == nil {
		return SyncPage{}, invalid
	}
	if len(payload.Added)+len(payload.Modified)+len(payload.Removed) > 20 || len(payload.Accounts) > 1 {
		return SyncPage{}, invalid
	}
	for _, account := range payload.Accounts {
		if account.ID != binding.AccountID {
			return SyncPage{}, invalid
		}
	}
	if payload.Status != nil && len(*payload.Status) > 128 {
		return SyncPage{}, invalid
	}
	if *payload.NextCursor == "" {
		// The documented initial not-ready response must not erase a saved
		// checkpoint or acknowledge even a partial financial payload.
		if cursor.value == "" && !*payload.HasMore && len(payload.Added)+len(payload.Modified)+len(payload.Removed) == 0 {
			return SyncPage{}, &SyncError{Kind: SyncNotReady}
		}
		return SyncPage{}, invalid
	}
	next, err := NewSyncCursor(binding, *payload.NextCursor)
	if err != nil || (*payload.HasMore && next.value == cursor.value) {
		return SyncPage{}, invalid
	}
	page := SyncPage{Binding: binding, NextCursor: next, HasMore: *payload.HasMore, UpdateStatus: payload.Status,
		Added: make([]SyncTransaction, 0, len(payload.Added)), Modified: make([]SyncTransaction, 0, len(payload.Modified)), Removed: make([]SyncRemoval, 0, len(payload.Removed))}
	// Duplicate IDs within one change set are malformed. The same ID in different
	// change sets is retained: applying the complete batch is the consumer's job.
	for _, change := range []struct {
		rows []plaidSyncTransaction
		out  *[]SyncTransaction
	}{{payload.Added, &page.Added}, {payload.Modified, &page.Modified}} {
		seen := make(map[string]bool)
		for _, row := range change.rows {
			fact, ok := decodeSyncTransaction(row, binding.AccountID)
			if !ok || seen[row.ID] {
				return SyncPage{}, invalid
			}
			seen[row.ID] = true
			*change.out = append(*change.out, fact)
		}
	}
	seen := make(map[string]bool)
	for _, row := range payload.Removed {
		if !validProviderID(row.ID) || seen[row.ID] || (row.Account != nil && *row.Account != binding.AccountID) {
			return SyncPage{}, invalid
		}
		seen[row.ID] = true
		page.Removed = append(page.Removed, SyncRemoval{row.ID, row.Account})
	}
	return page, nil
}

func decodeSyncTransaction(row plaidSyncTransaction, accountID string) (SyncTransaction, bool) {
	if !validProviderID(row.ID) || row.Account != accountID || row.Currency != "USD" || row.UnofficialCurrency != nil || row.Pending == nil || !validBankDate(row.Date) {
		return SyncTransaction{}, false
	}
	if (row.PendingTransactionID != nil && !validProviderID(*row.PendingTransactionID)) || (row.AuthorizedDate != nil && !validBankDate(*row.AuthorizedDate)) {
		return SyncTransaction{}, false
	}
	amount, ok := exactUSDMinor(row.Amount)
	if !ok {
		return SyncTransaction{}, false
	}
	fact := SyncTransaction{TransactionID: row.ID, AccountID: row.Account, Date: row.Date, AmountMinor: amount, Currency: row.Currency,
		Pending: *row.Pending, PendingTransactionID: row.PendingTransactionID, AuthorizedDate: row.AuthorizedDate,
		Name: row.Name, MerchantName: row.MerchantName, TransactionCode: row.Code}
	if row.Category != nil {
		fact.ProviderPrimaryCategory = row.Category.Primary
		fact.ProviderCategory = row.Category.Detailed
		fact.ProviderConfidence = row.Category.Confidence
	}
	return fact, true
}

func validBankDate(value string) bool {
	if len(value) != len(time.DateOnly) || value[:4] == "0000" {
		return false
	}
	parsed, err := time.Parse(time.DateOnly, value)
	return err == nil && parsed.Format(time.DateOnly) == value
}

// Bound the numeric lexeme and exponent before big-integer arithmetic. JSON's
// number grammar is checked without ever decoding money into a binary float.
func exactUSDMinor(raw json.RawMessage) (int64, bool) {
	value := strings.TrimSpace(string(raw))
	if len(value) == 0 || len(value) > 128 || !json.Valid([]byte(value)) || (value[0] != '-' && (value[0] < '0' || value[0] > '9')) {
		return 0, false
	}
	mantissa := value
	exponent := 0
	if at := strings.IndexAny(value, "eE"); at >= 0 {
		mantissa = value[:at]
		var err error
		exponent, err = strconv.Atoi(value[at+1:])
		if err != nil || exponent < -1000 || exponent > 1000 {
			return 0, false
		}
	}
	fractionDigits := 0
	if at := strings.IndexByte(mantissa, '.'); at >= 0 {
		fractionDigits = len(mantissa) - at - 1
		mantissa = mantissa[:at] + mantissa[at+1:]
	}
	coefficient, ok := new(big.Int).SetString(mantissa, 10)
	if !ok {
		return 0, false
	}
	scale := exponent - fractionDigits + 2
	if scale >= 0 {
		factor := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(scale)), nil)
		coefficient.Mul(coefficient, factor)
	} else {
		divisor := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(-scale)), nil)
		remainder := new(big.Int)
		coefficient.QuoRem(coefficient, divisor, remainder)
		if remainder.Sign() != 0 {
			return 0, false
		}
	}
	return coefficient.Int64(), coefficient.IsInt64()
}
