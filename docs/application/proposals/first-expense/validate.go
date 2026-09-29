// Run from apps/api: go run ../../docs/application/proposals/first-expense/validate.go
// Uses the existing pinned gqlparser dependency; never generates runtime code.
package main

import (
	"fmt"
	"os"

	"github.com/vektah/gqlparser/v2"
	"github.com/vektah/gqlparser/v2/ast"
)

func main() {
	const base = "../../docs/application/proposals/first-expense/"
	schemaBytes, err := os.ReadFile(base + "schema.graphql")
	if err != nil {
		fail(err)
	}
	schema, err := gqlparser.LoadSchema(&ast.Source{Name: "proposal", Input: string(schemaBytes)})
	if err != nil {
		fail(err)
	}
	operationBytes, err := os.ReadFile(base + "operations.graphql")
	if err != nil {
		fail(err)
	}
	doc, errors := gqlparser.LoadQuery(schema, string(operationBytes))
	if len(errors) != 0 {
		fail(errors)
	}
	// Ensure negative probes are actually rejected by the selected validator.
	for _, bad := range []string{
		`query { group(id: "x") { ... on Group { nonexistent } } }`,
		`mutation { createExpense(input: {groupId:"x"}) { __typename } }`,
		`query { group(id: "x") { ... on Group { expenses(first:"20") { __typename } } } }`,
	} {
		if _, errs := gqlparser.LoadQuery(schema, bad); len(errs) == 0 {
			fail("negative probe accepted")
		}
	}
	fmt.Printf("Validated proposed SDL, %d operations, %d fragments; 3 invalid operations rejected.\n", len(doc.Operations), len(doc.Fragments))
}

func fail(err any) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
