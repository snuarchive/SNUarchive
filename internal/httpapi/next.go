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
// scheme-relative, a "." or ".." segment can walk outside the intended
// prefix, and the browser's own normalisation of "\", control characters,
// DEL or spaces (the same forms safeNext already refuses in the raw next)
// can do the same once decoded — "/%5Cevil" and "/%09/evil" decode to
// "/\evil" and "/\t/evil", which a browser turns into "//evil". It is
// checked both on the raw path and, if it decodes cleanly, on its
// percent-decoded form; a path that fails to decode is treated as unsafe
// rather than passed through.
func unsafeNextPath(pathPart string) bool {
	if hasDotSegment(pathPart) {
		return true
	}
	decoded, err := url.PathUnescape(pathPart)
	if err != nil {
		return true
	}
	if strings.HasPrefix(decoded, "//") || hasDotSegment(decoded) {
		return true
	}
	if len(decoded) > 1 && (decoded[1] == '/' || decoded[1] == '\\') {
		return true
	}
	for _, r := range decoded {
		if r == '\\' || r <= 0x20 || r == 0x7f {
			return true
		}
	}
	return false
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
// rest of the query and the fragment exactly as written — including an
// empty pair from a doubled "&", such as in "/x?a=1&&b=2". Any existing
// `auth` parameter is dropped first (O32, 2026-09-29 user decision): its key
// is compared after percent-decoding, so an encoded spelling like `a%75th`
// counts too.
func withAuthOK(next string) string {
	pathQuery, fragment, hasFragment := strings.Cut(next, "#")
	path, query, hasQuery := strings.Cut(pathQuery, "?")
	if !hasQuery {
		out := path + "?auth=ok"
		if hasFragment {
			out += "#" + fragment
		}
		return out
	}
	var kept []string
	for _, kv := range strings.Split(query, "&") {
		key, _, _ := strings.Cut(kv, "=")
		if k, err := url.QueryUnescape(key); err == nil && k == "auth" {
			continue
		}
		kept = append(kept, kv)
	}
	// strings.Join(strings.Split(query, "&"), "&") reproduces query
	// exactly when nothing was removed, including any doubled "&"; only
	// the appended "auth=ok" needs its own separator, and only when rest
	// doesn't already end in one.
	rest := strings.Join(kept, "&")
	newQuery := rest + "auth=ok"
	if rest != "" && !strings.HasSuffix(rest, "&") {
		newQuery = rest + "&auth=ok"
	}
	out := path + "?" + newQuery
	if hasFragment {
		out += "#" + fragment
	}
	return out
}
