package auth

import (
	"regexp"
	"strings"
	"unicode/utf8"

	"digital-assets/backend/internal/types"
)

var usernamePattern = regexp.MustCompile(`^[\p{L}\p{N}._-]+$`)

func NormalizeUsername(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func ValidUsername(value string) bool {
	length := utf8.RuneCountInString(value)
	return length >= 2 && length <= 32 && usernamePattern.MatchString(value)
}

func IsSuperAdmin(user types.User, configuredUsername string) bool {
	return user.IsAdmin && user.Username == NormalizeUsername(configuredUsername)
}
