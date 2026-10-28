package google

import (
	"context"
	"testing"
	"time"
)

// TestNewDefaultClientHasTimeout guards F1: without an HTTPClient override,
// New must not fall back to http.DefaultClient, which never times out.
func TestNewDefaultClientHasTimeout(t *testing.T) {
	c := New(context.Background(), Options{ClientID: "x"})
	if c.http.Timeout != 10*time.Second {
		t.Fatalf("default client timeout = %v, want 10s", c.http.Timeout)
	}
}
