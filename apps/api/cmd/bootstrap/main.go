// Command bootstrap is an explicit operator tool, never a server startup hook.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"time"

	"github.com/haggaikaunda/kami-split/apps/api/internal/bootstrap"
	"github.com/jackc/pgx/v5"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func readInput(reader io.Reader, target any) error {
	raw, err := io.ReadAll(io.LimitReader(reader, 8193))
	if err != nil || len(raw) > 8192 {
		return errors.New("bootstrap input must be at most 8192 bytes")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return errors.New("one valid JSON object required on stdin; see bootstrap runbook")
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return errors.New("unexpected trailing input")
	}
	return nil
}

func run() error {
	if len(os.Args) != 2 || (os.Args[1] != "create-auth" && os.Args[1] != "provision") {
		return errors.New("usage: bootstrap create-auth|provision < private-input.json")
	}
	parent, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()
	if os.Args[1] == "create-auth" {
		var input struct {
			Email string `json:"email"`
		}
		if err := readInput(os.Stdin, &input); err != nil {
			return err
		}
		id, err := bootstrap.CreateAuthUser(ctx, os.Getenv("BOOTSTRAP_AUTH_URL"), os.Getenv("BOOTSTRAP_AUTH_ADMIN_KEY"), input.Email)
		if err != nil {
			return err
		}
		// Output is operator identity evidence, never an email, password or token.
		return json.NewEncoder(os.Stdout).Encode(map[string]string{"authUserId": id})
	}
	var target bootstrap.Target
	if err := readInput(os.Stdin, &target); err != nil {
		return err
	}
	if err := target.Validate(); err != nil {
		return err
	}
	databaseURL := os.Getenv("BOOTSTRAP_DATABASE_URL")
	if databaseURL == "" {
		return errors.New("BOOTSTRAP_DATABASE_URL must explicitly select the migration connection")
	}
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return errors.New("bootstrap database connection failed")
	}
	defer conn.Close(context.Background())
	result, err := bootstrap.Provision(ctx, conn, target)
	if err != nil {
		return err
	}
	fmt.Fprintln(os.Stdout, result)
	return nil
}
