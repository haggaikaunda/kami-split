package reportingtimezone

import (
	"bytes"
	"context"
	"testing"
)

func TestVersionWireContract(t *testing.T) {
	for _, input := range []any{nil, 1, "0", "-1", "01", "+1", "1.0", "9007199254740992"} {
		var version Version
		if version.UnmarshalGQL(input) == nil {
			t.Fatalf("accepted %v", input)
		}
	}
	for _, input := range []string{"1", "9007199254740991"} {
		var version Version
		if err := version.UnmarshalGQL(input); err != nil {
			t.Fatal(err)
		}
		var out bytes.Buffer
		version.MarshalGQL(&out)
		if out.String() != `"`+input+`"` {
			t.Fatal(out.String())
		}
	}
}

func TestOperationsRequireVerifiedRequest(t *testing.T) {
	service := New(nil)
	for _, out := range []Result{service.Read(context.Background()), service.Initialize(context.Background(), "attempt", nil), service.Update(context.Background(), "attempt", "UTC", 1), service.Recover(context.Background(), "UPDATE", "attempt")} {
		if out.Code != "UNAUTHENTICATED" || out.Timezone != nil || out.Version != nil {
			t.Fatal(out)
		}
	}
}
