package files

import "testing"

func TestNormalizeRelativePath(t *testing.T) {
	tests := []struct {
		input string
		want  string
		ok    bool
	}{
		{"", "", true},
		{"源代码/config", "源代码/config", true},
		{"../secret", "", false},
		{"a/../b", "", false},
		{"/absolute", "", false},
		{"a//b", "", false},
		{`a\b`, "", false},
	}
	for _, test := range tests {
		got, ok := normalizeRelativePath(test.input)
		if got != test.want || ok != test.ok {
			t.Fatalf("normalizeRelativePath(%q) = %q,%v; want %q,%v", test.input, got, ok, test.want, test.ok)
		}
	}
}
