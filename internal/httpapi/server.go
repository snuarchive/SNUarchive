// internal/httpapi/server.go (Task 9 minimal; Task 10 expands this)
package httpapi

import (
	"context"
	"log/slog"

	"github.com/snuarchive/snuarchive/internal/config"
	"github.com/snuarchive/snuarchive/internal/refdata"
)

type Pinger interface{ Ping(ctx context.Context) error }

type ConfigSource interface {
	Config(ctx context.Context) (refdata.Config, error)
}

type Deps struct {
	Config  *config.Config
	Logger  *slog.Logger
	DB      Pinger
	RefData ConfigSource
}

type Route struct {
	Method string
	Path   string
}
