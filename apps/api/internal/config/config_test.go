package config

import (
	"testing"
	"time"
)

func TestLoad(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		want    Config
		invalid bool
	}{
		{name: "defaults", want: Config{Addr: "127.0.0.1:8080", ShutdownTimeout: 5 * time.Second}},
		{name: "overrides", env: map[string]string{"API_ADDR": "[::1]:9090", "API_SHUTDOWN_TIMEOUT": "10s"}, want: Config{Addr: "[::1]:9090", ShutdownTimeout: 10 * time.Second}},
		{name: "empty", env: map[string]string{"API_ADDR": ""}, invalid: true},
		{name: "port missing", env: map[string]string{"API_ADDR": "localhost"}, invalid: true},
		{name: "port name", env: map[string]string{"API_ADDR": "localhost:http"}, invalid: true},
		{name: "port range", env: map[string]string{"API_ADDR": ":65536"}, invalid: true},
		{name: "zero port", env: map[string]string{"API_ADDR": ":0"}, invalid: true},
		{name: "bad duration", env: map[string]string{"API_SHUTDOWN_TIMEOUT": "soon"}, invalid: true},
		{name: "zero duration", env: map[string]string{"API_SHUTDOWN_TIMEOUT": "0s"}, invalid: true},
		{name: "negative duration", env: map[string]string{"API_SHUTDOWN_TIMEOUT": "-1s"}, invalid: true},
		{name: "excessive duration", env: map[string]string{"API_SHUTDOWN_TIMEOUT": "2m"}, invalid: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Load(func(k string) (string, bool) { v, ok := tt.env[k]; return v, ok })
			if tt.invalid {
				if err == nil {
					t.Fatal("expected validation error")
				}
				return
			}
			if err != nil || got != tt.want {
				t.Fatalf("got %+v, %v; want %+v", got, err, tt.want)
			}
		})
	}
}

// Retired deployment settings must neither change configuration nor prevent startup.
func TestRetiredPercentageSettingIgnored(t *testing.T) {
	want, err := Load(func(string) (string, bool) { return "", false })
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"false", "true", "", "invalid"} {
		t.Run(value, func(t *testing.T) {
			got, err := Load(func(key string) (string, bool) {
				return value, key == "API_PERCENTAGE_WRITES_ENABLED"
			})
			if err != nil || got != want {
				t.Fatalf("retired setting changed configuration: %+v, %v", got, err)
			}
		})
	}
}
