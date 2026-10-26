package auth

import "testing"

func TestNormalizeAndValidateUsername(t *testing.T) {
	tests := []struct {
		input      string
		normalized string
		valid      bool
	}{
		{" Alice_01 ", "alice_01", true},
		{"张三.研发", "张三.研发", true},
		{"ab", "ab", false},
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
