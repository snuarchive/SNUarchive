// Package session signs the cookies the server hands out and decides when a
// session expires or is renewed.
package session

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
)

// ErrInvalid covers every token that cannot be trusted: malformed, signed
// with an unknown key, signed for another purpose, or not the expected JSON.
var ErrInvalid = errors.New("session: invalid token")

var b64 = base64.RawURLEncoding

// Codec signs small JSON payloads with HMAC-SHA256. The first key signs and
// every key verifies, so a new key is rolled out by putting it first and an
// old one retired by removing it once its tokens have expired.
type Codec struct {
	keys [][]byte
}

func NewCodec(keys [][]byte) *Codec { return &Codec{keys: keys} }

// Seal returns base64url(json(v)) + "." + base64url(mac). The purpose is
// part of the MAC, so a token sealed for one cookie never opens as another.
func (c *Codec) Seal(purpose string, v any) (string, error) {
	if len(c.keys) == 0 {
		return "", errors.New("session: no signing key")
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	payload := b64.EncodeToString(raw)
	return payload + "." + b64.EncodeToString(mac(c.keys[0], purpose, payload)), nil
}

// Open verifies token for purpose and decodes its payload into v.
func (c *Codec) Open(purpose, token string, v any) error {
	payload, sig, ok := strings.Cut(token, ".")
	if !ok {
		return ErrInvalid
	}
	got, err := b64.DecodeString(sig)
	if err != nil {
		return ErrInvalid
	}
	valid := false
	for _, k := range c.keys {
		if hmac.Equal(got, mac(k, purpose, payload)) {
			valid = true
			break
		}
	}
	if !valid {
		return ErrInvalid
	}
	raw, err := b64.DecodeString(payload)
	if err != nil {
		return ErrInvalid
	}
	if err := json.Unmarshal(raw, v); err != nil {
		return ErrInvalid
	}
	return nil
}

func mac(key []byte, purpose, payload string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(purpose))
	h.Write([]byte{0})
	h.Write([]byte(payload))
	return h.Sum(nil)
}
