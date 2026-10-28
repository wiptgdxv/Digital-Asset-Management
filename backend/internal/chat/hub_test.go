package chat

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestHubRejectsCrossOriginAndBroadcastsNoPrivateData(t *testing.T) {
	hub := New(nil, "http://internal.example")
	server := httptest.NewServer(hub)
	defer server.Close()
	url := "ws" + strings.TrimPrefix(server.URL, "http")
	headers := http.Header{"Origin": []string{"http://untrusted.example"}}
	_, resp, err := websocket.DefaultDialer.Dial(url, headers)
	if err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-origin websocket was not rejected: %v, %#v", err, resp)
	}
	headers.Set("Origin", "http://internal.example")
	conn, _, err := websocket.DefaultDialer.Dial(url, headers)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	deadline := time.Now().Add(time.Second)
	for {
		hub.mu.Lock()
		n := len(hub.clients)
		hub.mu.Unlock()
		if n == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("client not registered")
		}
		time.Sleep(time.Millisecond)
	}
	hub.Notify()
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil || strings.TrimSpace(string(data)) != `{"type":"changed"}` {
		t.Fatalf("unexpected notification: %s %v", data, err)
	}
}
