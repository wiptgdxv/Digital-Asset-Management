package auth

import (
	"crypto/rand"
	"math/big"
)

const temporaryPasswordAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_"

func TemporaryPassword(length int) (string, error) {
	result := make([]byte, length)
	limit := big.NewInt(int64(len(temporaryPasswordAlphabet)))
	for i := range result {
		index, err := rand.Int(rand.Reader, limit)
		if err != nil {
			return "", err
		}
		result[i] = temporaryPasswordAlphabet[index.Int64()]
	}
	return string(result), nil
}
