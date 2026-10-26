package logic

import (
	"reflect"
	"testing"
)

func TestMentionedUsernames(t *testing.T) {
	got := mentionedUsernames("请 @Alice_01 看看，也请@研发-二组 确认；重复 @alice_01，邮箱a@corp.com不算")
	want := []string{"alice_01", "研发-二组"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("mentionedUsernames() = %#v, want %#v", got, want)
	}
}
