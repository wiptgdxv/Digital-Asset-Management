package auth

import "testing"

func TestTemporaryPassword(t *testing.T) {
	first, err := TemporaryPassword(18)
	if err != nil {
		t.Fatal(err)
	}
	second, err := TemporaryPassword(18)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 18 || len(second) != 18 {
		t.Fatalf("unexpected lengths: %d, %d", len(first), len(second))
	}
	if first == second {
		t.Fatal("temporary passwords unexpectedly matched")
	}
}
