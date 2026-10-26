package logic

import (
	"regexp"

	"digital-assets/backend/internal/auth"
)

var mentionPattern = regexp.MustCompile(`(?:^|[^A-Za-z0-9._-])@([\p{L}\p{N}._-]{3,32})`)

func mentionedUsernames(content string) []string {
	matches := mentionPattern.FindAllStringSubmatch(content, -1)
	seen := make(map[string]struct{}, len(matches))
	result := make([]string, 0, len(matches))
	for _, match := range matches {
		username := auth.NormalizeUsername(match[1])
		if username == "" {
			continue
		}
		if _, exists := seen[username]; exists {
			continue
		}
		seen[username] = struct{}{}
		result = append(result, username)
	}
	return result
}
