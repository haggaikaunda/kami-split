package server

import (
	"github.com/99designs/gqlgen/graphql"
	"github.com/haggaikaunda/kami-split/apps/api/internal/ledger"
	"github.com/vektah/gqlparser/v2/ast"
	"strings"
	"unicode/utf8"
)

// gqlgen unmarshals custom scalar arguments while resolving a field. Preflight
// every selected input before any resolver runs so a later malformed scalar in
// a multi-field mutation cannot follow an already committed financial write.
func validOperationScalars(operation *graphql.OperationContext, schema *ast.Schema) bool {
	var valueValid func(*ast.Type, any) bool
	valueValid = func(kind *ast.Type, value any) bool {
		if value == nil {
			return true
		}
		if kind.Elem != nil {
			if list, ok := value.([]any); ok {
				for _, item := range list {
					if !valueValid(kind.Elem, item) {
						return false
					}
				}
				return true
			}
			return valueValid(kind.Elem, value)
		}
		switch kind.Name() {
		case "String":
			text, ok := value.(string)
			return ok && utf8.ValidString(text) && !strings.ContainsRune(text, 0)
		case "MinorUnits":
			var v ledger.MinorUnits
			return v.UnmarshalGQL(value) == nil
		case "Revision":
			var v ledger.Revision
			return v.UnmarshalGQL(value) == nil
		case "Date":
			var v ledger.Date
			return v.UnmarshalGQL(value) == nil
		case "DateTime":
			var v ledger.DateTime
			return v.UnmarshalGQL(value) == nil
		case "OperationKey":
			var v ledger.OperationKey
			return v.UnmarshalGQL(value) == nil
		}
		definition := schema.Types[kind.Name()]
		if definition != nil && definition.Kind == ast.InputObject {
			fields, ok := value.(map[string]any)
			if !ok {
				return false
			}
			for _, field := range definition.Fields {
				if !valueValid(field.Type, fields[field.Name]) {
					return false
				}
			}
		}
		return true
	}
	var selectionsValid func(ast.SelectionSet) bool
	selectionsValid = func(selection ast.SelectionSet) bool {
		for _, field := range graphql.CollectFields(operation, selection, nil) {
			if field.Definition != nil {
				arguments := field.ArgumentMap(operation.Variables)
				for _, argument := range field.Definition.Arguments {
					if !valueValid(argument.Type, arguments[argument.Name]) {
						return false
					}
				}
			}
			if !selectionsValid(field.SelectionSet) {
				return false
			}
		}
		return true
	}
	return selectionsValid(operation.Operation.SelectionSet)
}
