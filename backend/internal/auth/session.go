package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"digital-assets/backend/internal/types"
	"encoding/hex"
	"net/http"
)

const CookieName = "assets_session"

type Key struct{}
type Session struct {
	User               types.User
	Csrf               string
	Hash               string
	MustChangePassword bool
}

func Current(ctx context.Context) Session { s, _ := ctx.Value(Key{}).(Session); return s }
func Token() (string, error) {
	b := make([]byte, 32)
	_, err := rand.Read(b)
	return hex.EncodeToString(b), err
}
func Hash(token string) string { h := sha256.Sum256([]byte(token)); return hex.EncodeToString(h[:]) }
func Cookie(token string, secure bool, maxAge int) *http.Cookie {
	return &http.Cookie{Name: CookieName, Value: token, Path: "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteStrictMode, MaxAge: maxAge}
}
