// Package config validates startup configuration without global state.
package config

import (
	"fmt"
	"net"
	"strconv"
	"time"
)

// Config contains the server's deployment configuration.
type Config struct {
	PercentageWritesEnabled bool
	Addr                    string
	ShutdownTimeout         time.Duration
}

// Load reads configuration through the supplied environment lookup.
// Explicit empty values are rejected rather than replaced with defaults.
func Load(lookup func(string) (string, bool)) (Config, error) {
	c := Config{Addr: "127.0.0.1:8080", ShutdownTimeout: 5 * time.Second}
	if value, ok := lookup("API_ADDR"); ok {
		c.Addr = value
	}
	_, port, err := net.SplitHostPort(c.Addr)
	if err != nil {
		return Config{}, fmt.Errorf("API_ADDR must be host:port")
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return Config{}, fmt.Errorf("API_ADDR port must be between 1 and 65535")
	}
	if value, ok := lookup("API_SHUTDOWN_TIMEOUT"); ok {
		c.ShutdownTimeout, err = time.ParseDuration(value)
		if err != nil || c.ShutdownTimeout <= 0 || c.ShutdownTimeout > time.Minute {
			return Config{}, fmt.Errorf("API_SHUTDOWN_TIMEOUT must be positive and at most 1m")
		}
	}
	if value, ok := lookup("API_PERCENTAGE_WRITES_ENABLED"); ok {
		if value != "true" && value != "false" {
			return Config{}, fmt.Errorf("API_PERCENTAGE_WRITES_ENABLED must be true or false")
		}
		c.PercentageWritesEnabled = value == "true"
	}
	return c, nil
}
