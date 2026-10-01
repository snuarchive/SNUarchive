package httpapi

import (
	"net/http"
	"slices"
	"strings"

	"github.com/snuarchive/snuarchive/internal/apperr"
)

const defaultBodyLimit = 64 << 10

type csrfMode int

const (
	csrfFull csrfMode = iota
	csrfOriginOnly
	csrfNone
)

type routeConfig struct {
	bodyLimit int64
	csrf      csrfMode
}

type routeOption func(*routeConfig)

// bodyLimit overrides the 64 KiB default for one route (uploads).
func bodyLimit(n int64) routeOption { return func(c *routeConfig) { c.bodyLimit = n } }

// originOnly skips the token check for routes used before a session exists
// (dev login); the Origin check still applies.
func originOnly() routeOption { return func(c *routeConfig) { c.csrf = csrfOriginOnly } }

// noCSRF is for routes authenticated another way (the cron bearer secret).
func noCSRF() routeOption { return func(c *routeConfig) { c.csrf = csrfNone } }

type router struct {
	mux    *http.ServeMux
	deps   Deps
	routes []Route
}

func newRouter(d Deps) *router {
	rt := &router{mux: http.NewServeMux(), deps: d}
	rt.mux.Handle("/", http.HandlerFunc(rt.fallback))
	return rt
}

var probeMethods = []string{
	http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut,
	http.MethodPatch, http.MethodDelete, http.MethodOptions,
}

// fallback answers requests no route matched. It asks the mux which other
// methods would match the path, so 405 responses use the JSON error envelope.
// A method-less pattern per path would do the same, but the mux panics when
// one overlaps a wildcard route (/courses/home next to /courses/{courseId}).
func (rt *router) fallback(w http.ResponseWriter, r *http.Request) {
	probe := r.Clone(r.Context())
	var allowed []string
	for _, m := range probeMethods {
		if m == r.Method {
			continue
		}
		probe.Method = m
		if _, pattern := rt.mux.Handler(probe); pattern != "/" {
			allowed = append(allowed, m)
		}
	}
	if len(allowed) == 0 {
		writeError(w, r, rt.deps.Logger, apperr.New(apperr.NotFound))
		return
	}
	slices.Sort(allowed)
	w.Header().Set("Allow", strings.Join(allowed, ", "))
	writeError(w, r, rt.deps.Logger, apperr.New(apperr.MethodNotAllowed))
}

func isSafe(method string) bool {
	return method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions
}

// handle registers method+path.
func (rt *router) handle(method, path string, h http.Handler, opts ...routeOption) {
	cfg := routeConfig{bodyLimit: defaultBodyLimit}
	for _, o := range opts {
		o(&cfg)
	}
	if !isSafe(method) && cfg.csrf != csrfNone {
		h = requireCSRF(rt.deps.Config.AppOrigin, cfg.csrf == csrfFull, rt.deps.Logger)(h)
	}
	h = limitBody(cfg.bodyLimit)(h)
	rt.mux.Handle(method+" "+path, h)
	rt.routes = append(rt.routes, Route{Method: method, Path: path})
}
