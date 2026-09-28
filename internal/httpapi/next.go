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

// withAuthOK adds auth=ok to the query of a path from safeNext, keeping the
// existing query and fragment as written.
func withAuthOK(next string) string {
	pathQuery, fragment, hasFragment := strings.Cut(next, "#")
	sep := "?"
	if strings.Contains(pathQuery, "?") {
		sep = "&"
		if strings.HasSuffix(pathQuery, "?") || strings.HasSuffix(pathQuery, "&") {
			sep = ""
		}
	}
	out := pathQuery + sep + "auth=ok"
	if hasFragment {
		out += "#" + fragment
	}
	return out
}
