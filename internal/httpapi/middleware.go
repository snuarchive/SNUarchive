package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"regexp"
	"runtime/debug"
	"strings"
	"time"

	"github.com/snuarchive/snuarchive/internal/apperr"
)

const (
	CSRFCookie = "snu_csrf"
	CSRFHeader = "X-CSRF-Token"
)

type ctxKey int

const (
	requestIDKey ctxKey = iota
	clientIPKey
)

// RequestID returns the request's ID, or "" outside a request.
func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}

// ClientIP returns the resolved client address (see withClientIP).
func ClientIP(ctx context.Context) netip.Addr {
	ip, _ := ctx.Value(clientIPKey).(netip.Addr)
	return ip
}

var validRequestID = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

// withRequestID honours an incoming X-Request-ID only when the direct peer
// (RemoteAddr) is a trusted proxy; otherwise, and whenever the incoming value
// fails format validation, it generates a new one. This keeps an untrusted
// caller from injecting a request ID that would otherwise correlate logs
// across hops it doesn't control.
func withRequestID(trusted []netip.Prefix) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := r.Header.Get("X-Request-ID")
			peer, ok := parsePeer(r.RemoteAddr)
			fromTrustedPeer := ok && isTrusted(peer, trusted)
			if !fromTrustedPeer || !validRequestID.MatchString(id) {
				var b [16]byte
				_, _ = rand.Read(b[:])
				id = hex.EncodeToString(b[:])
			}
			w.Header().Set("X-Request-ID", id)
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey, id)))
		})
	}
}

// traceHeaders are what the W3C TraceContext and Baggage propagators read.
var traceHeaders = []string{"Traceparent", "Tracestate", "Baggage"}

// withTrustedTraceContext drops incoming trace context unless the direct peer
// is a trusted proxy, for the same reason withRequestID does: an untrusted
// caller must not choose the trace its request joins. It runs before otelhttp,
// which then starts a new root span.
func withTrustedTraceContext(trusted []netip.Prefix) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if peer, ok := parsePeer(r.RemoteAddr); !ok || !isTrusted(peer, trusted) {
				for _, k := range traceHeaders {
					r.Header.Del(k)
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// withClientIP honours X-Forwarded-For only when the direct peer is a trusted
// proxy. The chain is walked right to left and the first untrusted hop wins,
// so a client cannot spoof its address by sending the header itself. Every
// header line counts, since a proxy may append a line rather than extend one.
func withClientIP(trusted []netip.Prefix) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			xff := strings.Join(r.Header.Values("X-Forwarded-For"), ",")
			ip := resolveClientIP(r.RemoteAddr, xff, trusted)
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), clientIPKey, ip)))
		})
	}
}

// parsePeer parses the host portion of RemoteAddr into a netip.Addr, the same
// direct-peer parsing withClientIP and withRequestID both rely on to decide
// trust.
func parsePeer(remoteAddr string) (netip.Addr, bool) {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}, false
	}
	return addr.Unmap(), true
}

func resolveClientIP(remoteAddr, xff string, trusted []netip.Prefix) netip.Addr {
	peer, ok := parsePeer(remoteAddr)
	if !ok {
		return netip.Addr{}
	}
	if !isTrusted(peer, trusted) || strings.TrimSpace(xff) == "" {
		return peer
	}
	hops := strings.Split(xff, ",")
	for i := len(hops) - 1; i >= 0; i-- {
		hop, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			return peer
		}
		hop = hop.Unmap()
		if !isTrusted(hop, trusted) {
			return hop
		}
		peer = hop
	}
	return peer
}

func isTrusted(ip netip.Addr, trusted []netip.Prefix) bool {
	for _, p := range trusted {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (s *statusRecorder) WriteHeader(code int) {
	if s.status == 0 {
		s.status = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	n, err := s.ResponseWriter.Write(b)
	s.bytes += n
	return n, err
}

func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

func withAccessLog(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w}
			next.ServeHTTP(rec, r)
			level := slog.LevelInfo
			if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
				level = slog.LevelDebug
			}
			log.Log(r.Context(), level, "request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"bytes", rec.bytes,
				"duration_ms", time.Since(start).Milliseconds(),
				"request_id", RequestID(r.Context()),
				"client_ip", ClientIP(r.Context()).String(),
			)
		})
	}
}

func withRecover(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				v := recover()
				if v == nil {
					return
				}
				if v == http.ErrAbortHandler {
					panic(v)
				}
				log.ErrorContext(r.Context(), "panic", "value", v, "stack", string(debug.Stack()),
					"request_id", RequestID(r.Context()))
				writeError(w, r, log, apperr.New(apperr.Internal))
			}()
			next.ServeHTTP(w, r)
		})
	}
}

func limitBody(n int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil && r.Body != http.NoBody {
				r.Body = http.MaxBytesReader(w, r.Body, n)
			}
			next.ServeHTTP(w, r)
		})
	}
}

// requireCSRF checks unsafe requests: the Origin header must be the app's
// origin and, when checkToken is set, the X-CSRF-Token header must equal the
// snu_csrf cookie (double submit).
func requireCSRF(origin string, checkToken bool, log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if origin == "" || r.Header.Get("Origin") != origin {
				writeError(w, r, log, apperr.New(apperr.CSRFInvalid))
				return
			}
			if checkToken {
				c, err := r.Cookie(CSRFCookie)
				token := r.Header.Get(CSRFHeader)
				if err != nil || c.Value == "" || subtle.ConstantTimeCompare([]byte(c.Value), []byte(token)) != 1 {
					writeError(w, r, log, apperr.New(apperr.CSRFInvalid))
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
