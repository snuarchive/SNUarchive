package httpapi

import (
	"net/url"
	"strings"
)

const maxNextLength = 2048

// safeNext accepts a same-origin path to return to after signing in (design
// spec §5.1): it starts with "/", its second character is not "/" or "\",
// it has no "\" anywhere, no control characters, DEL or spaces, and resolved
// against the app origin it stays on that origin. Anything else is refused,
// which closes the open-redirect forms browsers accept ("//evil",
// "/\evil", "/\t/evil").
//
// It also refuses a path (O32, 2026-09-29 user decision) whose resolved form
// starts with "//" (scheme-relative) or that has a "." or ".." path segment,
// checking both the raw path and its percent-decoded form so an encoded
// segment such as "%2e%2e" or an encoded slash in "%2F%2Fx" is caught too.
func safeNext(next, appOrigin string) (string, bool) {
	if next == "" || len(next) > maxNextLength || next[0] != '/' {
		return "", false
	}
	if len(next) > 1 && (next[1] == '/' || next[1] == '\\') {
		return "", false
	}
	for _, r := range next {
		if r == '\\' || r <= 0x20 || r == 0x7f {
			return "", false
		}
	}
	pathPart := next
	if i := strings.IndexAny(pathPart, "?#"); i >= 0 {
		pathPart = pathPart[:i]
	}
	if unsafeNextPath(pathPart) {
		return "", false
	}
	base, err := url.Parse(appOrigin + "/")
	if err != nil {
		return "", false
	}
	u, err := base.Parse(next)
	if err != nil || u.Scheme != base.Scheme || u.Host != base.Host {
		return "", false
	}
	return next, true
}

// unsafeNextPath reports whether pathPart (next's path, with any query and
// fragment already cut off) could escape the app's origin once
// percent-decoding is taken into account: a leading "//" turns it
// scheme-relative, and a "." or ".." segment can walk outside the intended
// prefix. It is checked both on the raw path and, if it decodes cleanly, on
// its percent-decoded form.
func unsafeNextPath(pathPart string) bool {
	if hasDotSegment(pathPart) {
		return true
	}
	decoded, err := url.PathUnescape(pathPart)
	if err != nil {
		return false
	}
	return strings.HasPrefix(decoded, "//") || hasDotSegment(decoded)
}

func hasDotSegment(path string) bool {
	for _, seg := range strings.Split(path, "/") {
		if seg == "." || seg == ".." {
			return true
		}
	}
	return false
}

// withAuthOK adds auth=ok to the query of a path from safeNext, keeping the
// rest of the query and the fragment exactly as written. Any existing `auth`
// parameter is dropped first (O32, 2026-09-29 user decision): its key is
// compared after percent-decoding, so an encoded spelling like `a%75th`
// counts too.
func withAuthOK(next string) string {
	pathQuery, fragment, hasFragment := strings.Cut(next, "#")
	path, query, _ := strings.Cut(pathQuery, "?")
	var kept []string
	for _, kv := range strings.Split(query, "&") {
		if kv == "" {
			continue
		}
		key, _, _ := strings.Cut(kv, "=")
		if k, err := url.QueryUnescape(key); err == nil && k == "auth" {
			continue
		}
		kept = append(kept, kv)
	}
	kept = append(kept, "auth=ok")
	out := path + "?" + strings.Join(kept, "&")
	if hasFragment {
		out += "#" + fragment
	}
	return out
}
