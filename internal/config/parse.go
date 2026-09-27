package config

import (
	"encoding/base64"
	"fmt"
	"log/slog"
	"net/netip"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
)

// parser reads variables and collects every problem instead of stopping at
// the first, so an operator fixes a broken environment in one pass.
type parser struct {
	lookup LookupFunc
	errs   []error
}

func (p *parser) fail(key, msg string) { p.errs = append(p.errs, fmt.Errorf("%s %s", key, msg)) }

func (p *parser) str(key, def string) string {
	v, ok := p.lookup(key)
	v = strings.TrimSpace(v)
	if !ok || v == "" {
		return def
	}
	return v
}

func (p *parser) required(key string) string {
	v := p.str(key, "")
	if v == "" {
		p.fail(key, "is required")
	}
	return v
}

func (p *parser) boolean(key string, def bool) bool {
	v := p.str(key, "")
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		p.fail(key, "must be true or false")
		return def
	}
	return b
}

func (p *parser) integer(key string, def, lo, hi int) int {
	v := p.str(key, "")
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < lo || n > hi {
		p.fail(key, fmt.Sprintf("must be an integer between %d and %d", lo, hi))
		return def
	}
	return n
}

func (p *parser) duration(key string, def time.Duration) time.Duration {
	v := p.str(key, "")
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		p.fail(key, "must be a positive duration such as 24h")
		return def
	}
	return d
}

func (p *parser) oneOf(key, def string, allowed ...string) string {
	v := p.str(key, def)
	if !slices.Contains(allowed, v) {
		shown := slices.DeleteFunc(slices.Clone(allowed), func(s string) bool { return s == "" })
		p.fail(key, "must be one of "+strings.Join(shown, ", "))
		return def
	}
	return v
}

func (p *parser) list(key string) []string {
	var out []string
	for _, item := range strings.Split(p.str(key, ""), ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

func (p *parser) origin(key string) string {
	v := p.required(key)
	if v == "" {
		return ""
	}
	u, err := url.Parse(v)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
		(u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		p.fail(key, "must be an origin such as https://archive.example.com")
		return ""
	}
	return u.Scheme + "://" + u.Host
}

func (p *parser) sessionKeys(key string) [][]byte {
	raw := p.list(key)
	if len(raw) == 0 {
		p.fail(key, "is required")
		return nil
	}
	keys := make([][]byte, 0, len(raw))
	for i, s := range raw {
		b, err := base64.StdEncoding.DecodeString(s)
		if err != nil {
			b, err = base64.RawURLEncoding.DecodeString(s)
		}
		if err != nil || len(b) < 32 {
			p.fail(key, fmt.Sprintf("entry %d must be base64 of at least 32 bytes", i+1))
			continue
		}
		keys = append(keys, b)
	}
	return keys
}

func (p *parser) adminEmails(key string) []string {
	var out []string
	for _, e := range p.list(key) {
		e = strings.ToLower(e)
		local, domain, ok := strings.Cut(e, "@")
		if !ok || local == "" || domain != "snu.ac.kr" {
			p.fail(key, fmt.Sprintf("entry %q must be an @snu.ac.kr address", e))
			continue
		}
		out = append(out, e)
	}
	return out
}

func (p *parser) prefixes(key string) []netip.Prefix {
	var out []netip.Prefix
	for _, s := range p.list(key) {
		if pfx, err := netip.ParsePrefix(s); err == nil {
			out = append(out, pfx.Masked())
			continue
		}
		if addr, err := netip.ParseAddr(s); err == nil {
			addr = addr.Unmap()
			out = append(out, netip.PrefixFrom(addr, addr.BitLen()))
			continue
		}
		p.fail(key, fmt.Sprintf("entry %q is not an IP address or CIDR", s))
	}
	return out
}

func (p *parser) level(key, def string) slog.Level {
	var l slog.Level
	if err := l.UnmarshalText([]byte(p.str(key, def))); err != nil {
		p.fail(key, "must be debug, info, warn or error")
		_ = l.UnmarshalText([]byte(def))
	}
	return l
}

func (p *parser) gdrive(archiveEnabled bool) GDrive {
	g := GDrive{
		Auth:              p.oneOf("GDRIVE_AUTH", "", "", "service_account", "oauth"),
		FolderID:          p.str("GDRIVE_FOLDER_ID", ""),
		OAuthClientID:     p.str("GDRIVE_OAUTH_CLIENT_ID", ""),
		OAuthClientSecret: p.str("GDRIVE_OAUTH_CLIENT_SECRET", ""),
		OAuthRefreshToken: p.str("GDRIVE_OAUTH_REFRESH_TOKEN", ""),
	}
	if raw := p.str("GDRIVE_SERVICE_ACCOUNT_JSON", ""); raw != "" {
		b, err := base64.StdEncoding.DecodeString(raw)
		if err != nil {
			p.fail("GDRIVE_SERVICE_ACCOUNT_JSON", "must be base64")
		} else {
			g.ServiceAccountJSON = b
		}
	}
	if !archiveEnabled {
		return g
	}
	if g.Auth == "" {
		p.fail("GDRIVE_AUTH", "is required when LOG_ARCHIVE_ENABLED=true")
	}
	if g.FolderID == "" {
		p.fail("GDRIVE_FOLDER_ID", "is required when LOG_ARCHIVE_ENABLED=true")
	}
	switch g.Auth {
	case "service_account":
		if len(g.ServiceAccountJSON) == 0 {
			p.fail("GDRIVE_SERVICE_ACCOUNT_JSON", "is required when GDRIVE_AUTH=service_account")
		}
	case "oauth":
		for _, kv := range [][2]string{
			{"GDRIVE_OAUTH_CLIENT_ID", g.OAuthClientID},
			{"GDRIVE_OAUTH_CLIENT_SECRET", g.OAuthClientSecret},
			{"GDRIVE_OAUTH_REFRESH_TOKEN", g.OAuthRefreshToken},
		} {
			if kv[1] == "" {
				p.fail(kv[0], "is required when GDRIVE_AUTH=oauth")
			}
		}
	}
	return g
}
