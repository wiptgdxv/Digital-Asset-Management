package auth

import (
	"testing"

	"digital-assets/backend/internal/types"
)

func TestNormalizeAndValidateUsername(t *testing.T) {
	tests := []struct {
		input      string
		normalized string
		valid      bool
	}{
		{" Alice_01 ", "alice_01", true},
		{"张三.研发", "张三.研发", true},
		{"张三", "张三", true},
		{"ab", "ab", true},
		{"a", "a", false},
		{"user@example.com", "user@example.com", false},
		{"user name", "user name", false},
		{"abcdefghijklmnopqrstuvwxyz1234567", "abcdefghijklmnopqrstuvwxyz1234567", false},
	}
	for _, test := range tests {
		normalized := NormalizeUsername(test.input)
		if normalized != test.normalized {
			t.Fatalf("NormalizeUsername(%q) = %q, want %q", test.input, normalized, test.normalized)
		}
		if got := ValidUsername(normalized); got != test.valid {
			t.Fatalf("ValidUsername(%q) = %v, want %v", normalized, got, test.valid)
		}
	}
}

func TestIsSuperAdmin(t *testing.T) {
	admin := types.User{Username: "admin", IsAdmin: true}
	if !IsSuperAdmin(admin, " ADMIN ") {
		t.Fatal("configured bootstrap administrator was not recognized")
	}
	if IsSuperAdmin(types.User{Username: "admin", IsAdmin: false}, "admin") {
		t.Fatal("non-admin user was recognized as super administrator")
	}
	if IsSuperAdmin(types.User{Username: "other", IsAdmin: true}, "admin") {
		t.Fatal("delegated administrator was recognized as super administrator")
	}
}
