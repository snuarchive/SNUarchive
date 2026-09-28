package httpapi

import (
	"strings"
	"testing"
)

func TestSafeNext(t *testing.T) {
	const app = "https://archive.example.com"
	for _, ok := range []string{
		"/", "/courses/12", "/courses/12?tab=stats", "/search?q=%EB%AF%B8%EC%A0%81%EB%B6%84", "/a#b", "/%2F%2Fevil",
	} {
		if got, accepted := safeNext(ok, app); !accepted || got != ok {
			t.Errorf("%q refused", ok)
		}
	}
	for _, bad := range []string{
		"", "courses", "//evil.example", "/\\evil.example", "/x\\y", "https://evil.example/",
		"/\t/evil.example", "/a b", "/a\x00", "/a\x7f", "/" + strings.Repeat("a", 2048),
	} {
		if _, accepted := safeNext(bad, app); accepted {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestWithAuthOK(t *testing.T) {
	for in, want := range map[string]string{
		"/":                "/?auth=ok",
		"/courses/12":      "/courses/12?auth=ok",
		"/search?q=x":      "/search?q=x&auth=ok",
		"/search?q=x#top":  "/search?q=x&auth=ok#top",
		"/a#b":             "/a?auth=ok#b",
		"/search?":         "/search?auth=ok",
		"/search?q=x&":     "/search?q=x&auth=ok",
		"/p?q=%20#frag?x=": "/p?q=%20&auth=ok#frag?x=",
	} {
		if got := withAuthOK(in); got != want {
			t.Errorf("withAuthOK(%q) = %q, want %q", in, got, want)
		}
	}
}
