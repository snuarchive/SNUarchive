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
	mux     *http.ServeMux
	deps    Deps
	routes  []Route
	allowed map[string][]string
}

func newRouter(d Deps) *router {
	rt := &router{mux: http.NewServeMux(), deps: d, allowed: map[string][]string{}}
	rt.mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, r, d.Logger, apperr.New(apperr.NotFound))
	}))
	return rt
}

func isSafe(method string) bool {
	return method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions
}

// handle registers method+path. The first registration of a path also adds a
// method-less pattern for it, which the mux picks for any other method, so
// 405 responses use the JSON error envelope.
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
	if _, seen := rt.allowed[path]; !seen {
		rt.mux.Handle(path, rt.methodNotAllowed(path))
	}
	rt.allowed[path] = append(rt.allowed[path], method)
	rt.routes = append(rt.routes, Route{Method: method, Path: path})
}

func (rt *router) methodNotAllowed(path string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methods := slices.Clone(rt.allowed[path])
		if slices.Contains(methods, http.MethodGet) && !slices.Contains(methods, http.MethodHead) {
			methods = append(methods, http.MethodHead)
		}
		slices.Sort(methods)
		w.Header().Set("Allow", strings.Join(methods, ", "))
		writeError(w, r, rt.deps.Logger, apperr.New(apperr.MethodNotAllowed))
	})
}
