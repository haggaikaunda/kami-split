package ledger_test

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strings"
	"testing"

	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
)

func TestRepaymentCursorPreservesLegacyWireAndSeparatesScopes(t *testing.T) {
	key := bytes.Repeat([]byte{7}, 32)
	codec, err := ledger.NewCursorCodec("legacy", map[string][]byte{"legacy": key})
	if err != nil {
		t.Fatal(err)
	}
	group := ledger.PublicID("Group", "82000000-0000-4000-8000-000000000001")
	expenseID := ledger.PublicID("Expense", "82000000-0000-4000-8000-000000000002")
	// Independently build the deployed envelope without the new optional kind field.
	payload := fmt.Sprintf(`{"v":1,"cursor":{"group":%q,"filter":{"from":"","to":"","category":"","participant":""},"revision":3,"date":"2026-09-29","created":"2026-09-29T12:34:56.123456Z","expense":%q}}`, group, expenseID)
	prefix := "legacy." + base64.RawURLEncoding.EncodeToString([]byte(payload))
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(prefix))
	legacy := prefix + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	decoded, err := codec.Decode(legacy, group, ledger.Filter{}, 3)
	if err != nil {
		t.Fatalf("legacy rejected: %v", err)
	}
	encoded, err := codec.Encode(decoded)
	if err != nil || encoded != legacy {
		t.Fatalf("legacy wire changed: %s %v", encoded, err)
	}
	if _, err := codec.DecodeRepayment(legacy, group, 3); err == nil {
		t.Fatal("expense cursor accepted for repayment")
	}
	repayment := decoded
	repayment.Kind = "Repayment"
	repayment.ExpenseID = ledger.PublicID("Repayment", "82000000-0000-4000-8000-000000000002")
	token, err := codec.Encode(repayment)
	if err != nil {
		t.Fatal(err)
	}
	got, err := codec.DecodeRepayment(token, group, 3)
	if err != nil || got != repayment {
		t.Fatalf("repayment roundtrip: %+v %v", got, err)
	}
	if _, err := codec.Decode(token, group, ledger.Filter{}, 3); err == nil {
		t.Fatal("repayment cursor accepted for expenses")
	}
	if _, err := codec.DecodeRepayment(token, group, 2); err == nil {
		t.Fatal("signed future anchor accepted")
	}
	foreign := ledger.PublicID("Group", "82000000-0000-4000-8000-000000000003")
	if _, err := codec.DecodeRepayment(token, foreign, 3); err == nil {
		t.Fatal("foreign group accepted")
	}
	parts := strings.Split(token, ".")
	body, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	parts[1] = base64.RawURLEncoding.EncodeToString(bytes.Replace(body, []byte(`"revision":3`), []byte(`"revision":2`), 1))
	if _, err := codec.DecodeRepayment(strings.Join(parts, "."), group, 3); err == nil {
		t.Fatal("tampered inclusion anchor accepted")
	}
}
