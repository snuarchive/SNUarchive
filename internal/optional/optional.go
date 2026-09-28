// Package optional tells a JSON field that was left out apart from one sent
// as null. PATCH-style bodies need the difference: an omitted field keeps the
// stored value, while null clears it (docs/api/openapi.yaml: PATCH /me,
// PATCH /admin/statistics/{id}, the sitting override on approve).
// encoding/json decodes both to a nil pointer, so those fields use Field.
package optional

import (
	"bytes"
	"encoding/json"
)

// Field is one JSON object member. The zero value means the key was absent.
type Field[T any] struct {
	Set   bool // the key was present
	Null  bool // it was present with the value null
	Value T    // the decoded value when Set and not Null
}

// Of returns a field that was sent with v.
func Of[T any](v T) Field[T] { return Field[T]{Set: true, Value: v} }

// Null returns a field that was sent as null.
func Null[T any]() Field[T] { return Field[T]{Set: true, Null: true} }

// UnmarshalJSON runs only when the key is present, null included, which is
// what lets Set record presence.
func (f *Field[T]) UnmarshalJSON(b []byte) error {
	var v T
	if bytes.Equal(b, []byte("null")) {
		*f = Field[T]{Set: true, Null: true}
		return nil
	}
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*f = Field[T]{Set: true, Value: v}
	return nil
}

// Ptr returns nil when the field was null or absent and a pointer to the
// value otherwise, for writing to a nullable column once Set is checked.
func (f Field[T]) Ptr() *T {
	if !f.Set || f.Null {
		return nil
	}
	v := f.Value
	return &v
}
