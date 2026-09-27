package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"maps"
	"net/http"

	"github.com/snuarchive/snuarchive/internal/apperr"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

type errorBody struct {
	Error errorPayload `json:"error"`
}

type errorPayload struct {
	Code      apperr.Code    `json:"code"`
	Message   string         `json:"message"`
	RequestID string         `json:"requestId,omitempty"`
	Details   map[string]any `json:"details,omitempty"`
}

// writeError renders err as the contract's Error schema. Errors that are not
// *apperr.Error become 500 INTERNAL; their text never reaches the client.
func writeError(w http.ResponseWriter, r *http.Request, log *slog.Logger, err error) {
	ae, ok := apperr.As(err)
	if !ok {
		log.ErrorContext(r.Context(), "unhandled error", "err", err, "request_id", RequestID(r.Context()))
		ae = apperr.New(apperr.Internal)
	} else if ae.Status() >= 500 && ae.Cause() != nil {
		log.ErrorContext(r.Context(), "server error", "code", ae.Code, "err", ae.Cause(), "request_id", RequestID(r.Context()))
	}
	details := maps.Clone(ae.Details)
	if len(ae.Fields) > 0 {
		if details == nil {
			details = map[string]any{}
		}
		details["fields"] = ae.Fields
	}
	writeJSON(w, ae.Status(), errorBody{Error: errorPayload{
		Code:      ae.Code,
		Message:   ae.Message,
		RequestID: RequestID(r.Context()),
		Details:   details,
	}})
}

// decodeJSON reads exactly one JSON object into v and rejects unknown fields.
func decodeJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			return apperr.New(apperr.MalformedRequest).
				WithMessage("요청 본문이 너무 큽니다.").
				WithDetail("limit", tooBig.Limit).
				Wrap(err)
		}
		return apperr.New(apperr.MalformedRequest).Wrap(err)
	}
	if dec.More() {
		return apperr.New(apperr.MalformedRequest).WithMessage("JSON 객체 하나만 보낼 수 있습니다.")
	}
	return nil
}
