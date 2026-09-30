//go:build integration

package expense_test

import (
	"bytes"
	"encoding/binary"
	"io"
	"net"
	"net/url"
	"sync"
	"sync/atomic"
	"testing"
)

// commitLossProxy preserves the actual PostgreSQL transaction and drops only
// its successful COMMIT acknowledgement after seeing the financial result insert.
// Unlike dropping an HTTP response, this forces pgx.Commit itself to report an
// uncertain outcome after the database has made the financial effect durable.
func commitLossProxy(t *testing.T, databaseURL string) (string, <-chan struct{}) {
	t.Helper()
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	upstreamAddress := target.Host
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	var workers sync.WaitGroup
	var peersMu sync.Mutex
	var peers []net.Conn
	dropped := make(chan struct{})
	var once sync.Once
	workers.Go(func() {
		for {
			client, e := listener.Accept()
			if e != nil {
				return
			}
			upstream, e := net.Dial("tcp", upstreamAddress)
			if e != nil {
				client.Close()
				return
			}
			peersMu.Lock()
			peers = append(peers, client, upstream)
			peersMu.Unlock()
			financial := &atomic.Bool{}
			workers.Go(func() {
				defer client.Close()
				defer upstream.Close()
				var header [4]byte
				if _, e := io.ReadFull(client, header[:]); e != nil {
					return
				}
				n := int(binary.BigEndian.Uint32(header[:]))
				if n < 4 || n > 1<<20 {
					return
				}
				payload := make([]byte, n-4)
				if _, e := io.ReadFull(client, payload); e != nil {
					return
				}
				if _, e := upstream.Write(append(header[:], payload...)); e != nil {
					return
				}
				for {
					frame, e := pgFrame(client)
					if e != nil {
						return
					}
					if bytes.Contains(bytes.ToLower(frame[5:]), []byte("insert into app.expense_operations")) {
						financial.Store(true)
					}
					if _, e = upstream.Write(frame); e != nil {
						return
					}
				}
			})
			workers.Go(func() {
				defer client.Close()
				defer upstream.Close()
				for {
					frame, e := pgFrame(upstream)
					if e != nil {
						return
					}
					if frame[0] == 'C' && bytes.Equal(frame[5:], []byte("COMMIT\x00")) && financial.Load() {
						once.Do(func() { close(dropped) })
						return
					}
					if _, e = client.Write(frame); e != nil {
						return
					}
				}
			})
		}
	})
	t.Cleanup(func() {
		listener.Close()
		peersMu.Lock()
		for _, peer := range peers {
			peer.Close()
		}
		peersMu.Unlock()
		workers.Wait()
	})
	target.Host = listener.Addr().String()
	return target.String(), dropped
}
func pgFrame(source io.Reader) ([]byte, error) {
	header := make([]byte, 5)
	if _, e := io.ReadFull(source, header); e != nil {
		return nil, e
	}
	n := int(binary.BigEndian.Uint32(header[1:]))
	if n < 4 || n > 64<<20 {
		return nil, io.ErrUnexpectedEOF
	}
	frame := make([]byte, n+1)
	copy(frame, header)
	_, e := io.ReadFull(source, frame[5:])
	return frame, e
}
