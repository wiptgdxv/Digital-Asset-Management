package chat

import (
	"digital-assets/backend/internal/auth"
	"digital-assets/backend/internal/model"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Hub struct {
	mu      sync.Mutex
	clients map[chan struct{}]struct{}
	store   *model.Store
	origin  string
}

func New(store *model.Store, origin string) *Hub {
	return &Hub{clients: make(map[chan struct{}]struct{}), store: store, origin: strings.TrimRight(origin, "/")}
}

// Invalidation signals carry no message content or conversation identifiers.
func (h *Hub) Notify() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		select {
		case c <- struct{}{}:
		default:
		}
	}
}

func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return r.Header.Get("Origin") == h.origin }}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	current := auth.Current(r.Context())
	events := make(chan struct{}, 1)
	h.mu.Lock()
	h.clients[events] = struct{}{}
	h.mu.Unlock()
	defer func() { h.mu.Lock(); delete(h.clients, events); h.mu.Unlock() }()
	closed := make(chan struct{})
	conn.SetReadLimit(1024)
	go func() {
		defer close(closed)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-closed:
			return
		case <-r.Context().Done():
			return
		case <-ticker.C:
			// Revoked sessions must not keep an active connection indefinitely.
			session, err := h.store.Session(r.Context(), current.Hash)
			if err != nil || session.MustChangePassword {
				return
			}
			_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err = conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-events:
			_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err = conn.WriteJSON(struct {
				Type string `json:"type"`
			}{Type: "changed"}); err != nil {
				return
			}
		}
	}
}
